import type { Queryable } from "../accounts/oauth-access-token.js";

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

export function providerForReauthorization(
  nativeProvider: "gmail" | "graph",
): "gmail" | "outlook" {
  return nativeProvider === "gmail" ? "gmail" : "outlook";
}
