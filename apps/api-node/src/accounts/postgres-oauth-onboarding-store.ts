import type {
  CompleteOAuthAccountInput,
  OAuthConnectedAccount,
  OAuthOnboardingResult,
  OAuthOnboardingStore,
  OAuthOnboardingTask,
  OAuthSession,
} from "./oauth-onboarding.js";
import { type PoolLike, withTransaction } from "../db/transaction.js";

export function createPostgresOAuthOnboardingStore(
  client: PoolLike,
): OAuthOnboardingStore {
  return {
    async createSession(input) {
      const result = await client.query(
        `
          INSERT INTO onboarding_tasks (
            id,
            email,
            provider,
            auth_method,
            status,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, email, provider, auth_method, status, error_message, payload
        `,
        [
          input.task.id,
          input.task.email,
          input.task.provider,
          input.task.authMethod,
          input.task.status,
          input.task.payload ?? {},
        ],
      );

      return mapTask(result.rows[0]);
    },

    async getSessionByState(state) {
      const result = await client.query(
        `
          SELECT id, provider, payload
          FROM onboarding_tasks
          WHERE auth_method = 'oauth'
            AND status = 'pending'
            AND payload ->> 'state' = $1
          LIMIT 1
        `,
        [state],
      );

      return result.rows[0] ? mapSession(result.rows[0]) : undefined;
    },

    async completeOAuthAccount(input) {
      return withTransaction(client, async (tx) => {
        await tx.query(
          `
            INSERT INTO stored_secrets (
              secret_ref,
              secret_value
            )
            VALUES ($1, $2)
            ON CONFLICT (secret_ref)
            DO UPDATE SET
              secret_value = EXCLUDED.secret_value,
              updated_at = now()
          `,
          [input.secret.secretRef, input.secret.secretValue],
        );

        const accountResult = await tx.query(
          `
            INSERT INTO connected_accounts (
              id,
              email,
              provider,
              auth_method,
              display_name,
              sync_state,
              engine_provider
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (email, provider)
            DO UPDATE SET
              display_name = EXCLUDED.display_name,
              sync_state = EXCLUDED.sync_state,
              engine_provider = EXCLUDED.engine_provider,
              updated_at = now()
            RETURNING id, email, provider, auth_method, display_name, sync_state, engine_provider
          `,
          [
            input.account.id,
            input.account.email,
            input.account.provider,
            input.account.authMethod,
            input.account.displayName ?? null,
            input.account.syncState,
            input.account.engineProvider,
          ],
        );
        const account = mapAccount(accountResult.rows[0]);

        await tx.query(
          `
            INSERT INTO account_credentials (
              id,
              account_id,
              credential_kind,
              secret_ref
            )
            VALUES (gen_random_uuid(), $1, $2, $3)
            ON CONFLICT (account_id, credential_kind)
            DO UPDATE SET
              secret_ref = EXCLUDED.secret_ref,
              updated_at = now()
          `,
          [
            account.id,
            input.credential.credentialKind,
            input.credential.secretRef,
          ],
        );

        await tx.query(
          `
            INSERT INTO account_provider_settings (
              account_id,
              provider,
              native_provider,
              capabilities,
              settings
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id)
            DO UPDATE SET
              provider = EXCLUDED.provider,
              native_provider = EXCLUDED.native_provider,
              capabilities = EXCLUDED.capabilities,
              settings = EXCLUDED.settings,
              updated_at = now()
          `,
          [
            account.id,
            input.providerSettings.provider,
            input.providerSettings.nativeProvider,
            input.providerSettings.capabilities,
            input.providerSettings.settings,
          ],
        );

        const taskResult = await tx.query(
          `
            UPDATE onboarding_tasks
            SET email = $2,
                status = 'completed',
                error_message = NULL,
                updated_at = now()
            WHERE id = $1
            RETURNING id, email, provider, auth_method, status, error_message, payload
          `,
          [input.taskId, input.taskEmail],
        );

        return {
          task: publicTask(mapTask(taskResult.rows[0])),
          account,
        } satisfies OAuthOnboardingResult;
      });
    },

    async failTask(input) {
      const result = await client.query(
        `
          UPDATE onboarding_tasks
          SET status = 'failed',
              error_message = $2,
              updated_at = now()
          WHERE id = $1
          RETURNING id, email, provider, auth_method, status, error_message, payload
        `,
        [input.taskId, input.errorMessage],
      );

      return mapTask(result.rows[0]);
    },
  };
}

function mapSession(row: Record<string, unknown>): OAuthSession | undefined {
  const payload = recordValue(row.payload);
  const state = readString(payload.state);
  const redirectUri = readString(payload.redirectUri);
  if (!state || !redirectUri) {
    return undefined;
  }

  const provider = row.provider === "outlook" ? "outlook" : "gmail";
  return {
    taskId: String(row.id),
    provider,
    state,
    redirectUri,
    ...(readString(payload.loginHint)
      ? { loginHint: readString(payload.loginHint) }
      : {}),
  };
}

function mapTask(row: Record<string, unknown>): OAuthOnboardingTask {
  return {
    id: String(row.id),
    email: String(row.email),
    provider: row.provider === "outlook" ? "outlook" : "gmail",
    authMethod: "oauth",
    status: mapTaskStatus(row.status),
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : undefined,
    payload: recordValue(row.payload),
  };
}

function mapAccount(row: Record<string, unknown>): OAuthConnectedAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    provider: row.provider === "outlook" ? "outlook" : "gmail",
    authMethod: "oauth",
    displayName:
      typeof row.display_name === "string" ? row.display_name : undefined,
    syncState: row.sync_state === "syncing" ? "syncing" : "reauth_required",
    engineProvider: row.engine_provider === "native" ? "native" : "emailengine",
  };
}

function publicTask(task: OAuthOnboardingTask): OAuthOnboardingTask {
  return {
    id: task.id,
    email: task.email,
    provider: task.provider,
    authMethod: "oauth",
    status: task.status,
    errorMessage: task.errorMessage,
  };
}

function mapTaskStatus(value: unknown): OAuthOnboardingTask["status"] {
  if (value === "completed" || value === "failed") {
    return value;
  }

  return "pending";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
