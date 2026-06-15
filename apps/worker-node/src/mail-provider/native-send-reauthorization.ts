import type { Queryable } from "../credentials/account-credential-store.js";
import { GmailApiError } from "../google/gmail-api-client.js";
import { GraphApiError } from "../microsoft/graph-api-client.js";
import type { ScheduledSendTransport } from "../scheduled-send-runner.js";
import type { NativeProvider } from "./contract.js";

type ReauthorizableNativeProvider = Extract<NativeProvider, "gmail" | "graph">;

export interface NativeSendReauthorizationMarker {
  markRequired(input: {
    accountId: string;
    provider: "gmail" | "outlook";
    reason: string;
  }): Promise<{ taskId?: string }>;
}

export function createPostgresNativeSendReauthorizationMarker(input: {
  client: Queryable;
  createId: () => string;
}): NativeSendReauthorizationMarker {
  return {
    async markRequired(mark) {
      const taskId = input.createId();
      const result = await input.client.query<{ task_id?: string | null }>(
        `
          WITH marked_account AS (
            UPDATE connected_accounts
            SET sync_state = 'reauth_required',
                updated_at = now()
            WHERE id = $1
              AND auth_method = 'oauth'
            RETURNING id, email, provider, auth_method, display_name
          ), existing_task AS (
            SELECT id
            FROM onboarding_tasks
            WHERE status IN ('pending', 'failed')
              AND payload ->> 'reauthRequired' = 'true'
              AND payload ->> 'accountId' = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ), inserted_task AS (
            INSERT INTO onboarding_tasks (
              id,
              email,
              provider,
              auth_method,
              status,
              error_message,
              payload
            )
            SELECT
              $2,
              marked_account.email,
              marked_account.provider,
              marked_account.auth_method,
              'pending',
              $3,
              jsonb_strip_nulls(
                jsonb_build_object(
                  'source', 'native_send',
                  'reauthRequired', true,
                  'accountId', marked_account.id::text,
                  'displayName', marked_account.display_name,
                  'loginHint', marked_account.email,
                  'reason', $3
                )
              )
            FROM marked_account
            WHERE NOT EXISTS (SELECT 1 FROM existing_task)
            RETURNING id
          )
          SELECT id AS task_id FROM inserted_task
          UNION ALL
          SELECT id AS task_id FROM existing_task
          LIMIT 1
        `,
        [mark.accountId, taskId, mark.reason],
      );

      return {
        ...(result.rows[0]?.task_id
          ? { taskId: String(result.rows[0].task_id) }
          : {}),
      };
    },
  };
}

export function createReauthorizationAwareNativeSendTransport(input: {
  provider: ReauthorizableNativeProvider;
  delegate: ScheduledSendTransport;
  marker?: NativeSendReauthorizationMarker;
}): ScheduledSendTransport {
  return {
    async submitMessage(message) {
      try {
        return await input.delegate.submitMessage(message);
      } catch (error) {
        if (input.marker && isReauthorizationRequiredError(error)) {
          await input.marker.markRequired({
            accountId: message.accountId,
            provider: providerForReauthorization(input.provider),
            reason: safeReason(error),
          });
        }

        throw error;
      }
    },
  };
}

export function providerForReauthorization(
  nativeProvider: ReauthorizableNativeProvider,
): "gmail" | "outlook" {
  return nativeProvider === "gmail" ? "gmail" : "outlook";
}

function isReauthorizationRequiredError(error: unknown): boolean {
  if (error instanceof GmailApiError || error instanceof GraphApiError) {
    if (error.status === 401) {
      return true;
    }

    return error.status === 403 && isAuthOrPermissionCode(error.code);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("oauth refresh failed") &&
      (message.includes("invalid_grant") ||
        message.includes("invalid_client") ||
        message.includes("unauthorized_client") ||
        message.includes("invalid_scope") ||
        message.includes("insufficient_scope"))
    ) {
      return true;
    }

    return (
      message.includes("missing google_oauth_refresh_token credential") ||
      message.includes("missing microsoft_oauth_refresh_token credential") ||
      message.includes("empty google_oauth_refresh_token secret") ||
      message.includes("empty microsoft_oauth_refresh_token secret")
    );
  }

  return false;
}

function isAuthOrPermissionCode(code: string): boolean {
  const normalized = code.toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("permission") ||
    normalized.includes("insufficient") ||
    normalized.includes("accessdenied") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthenticated") ||
    normalized.includes("unauthorized")
  );
}

function safeReason(error: unknown): string {
  if (error instanceof GmailApiError) {
    return `Gmail ${error.status} ${error.code}`;
  }
  if (error instanceof GraphApiError) {
    return `Microsoft Graph ${error.status} ${error.code}`;
  }
  if (error instanceof Error) {
    return error.message;
  }

  return "native scheduled send authorization failed";
}
