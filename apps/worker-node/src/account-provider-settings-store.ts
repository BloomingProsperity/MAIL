import { randomUUID } from "node:crypto";

import type { AccountRecoveryReason } from "./account-state-processor.js";

type PausedProvider = "gmail" | "graph" | "imap";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface AccountSyncPlan {
  accountId: string;
  email: string;
  provider: string;
  authMethod: string;
  syncState?: "syncing" | "reauth_required" | "paused";
  engineProvider: "emailengine" | "native";
  nativeProvider?: PausedProvider;
  capabilities: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface AccountProviderSettingsStore {
  getAccountSyncPlan(accountId: string): Promise<AccountSyncPlan | undefined>;
  markAccountReauthRequired(input: {
    accountId: string;
    reason: AccountRecoveryReason;
    at: string;
  }): Promise<{ taskId?: string }>;
}

interface AccountSyncPlanRow extends Record<string, unknown> {
  id: string;
  email: string;
  account_provider: string;
  auth_method: string;
  sync_state?: string | null;
  engine_provider: string;
  settings_provider?: string | null;
  native_provider?: string | null;
  capabilities?: unknown;
  settings?: unknown;
}

export function createPostgresAccountProviderSettingsStore(
  client: Queryable,
  options: { createId?: () => string } = {},
): AccountProviderSettingsStore {
  return {
    async getAccountSyncPlan(accountId) {
      const result = await client.query<AccountSyncPlanRow>(
        `
          SELECT
            connected_accounts.id,
            connected_accounts.email,
            connected_accounts.provider AS account_provider,
            connected_accounts.auth_method,
            connected_accounts.sync_state,
            connected_accounts.engine_provider,
            account_provider_settings.provider AS settings_provider,
            account_provider_settings.native_provider,
            account_provider_settings.capabilities,
            account_provider_settings.settings
          FROM connected_accounts
          LEFT JOIN account_provider_settings
            ON account_provider_settings.account_id = connected_accounts.id
          WHERE connected_accounts.id = $1
          LIMIT 1
        `,
        [accountId],
      );

      return result.rows[0] ? rowToAccountSyncPlan(result.rows[0]) : undefined;
    },

    async markAccountReauthRequired(input) {
      const taskId = (options.createId ?? randomUUID)();
      const result = await client.query<{ task_id?: string | null }>(
        `
          WITH marked_account AS (
            UPDATE connected_accounts
            SET sync_state = 'reauth_required',
                updated_at = $2
            WHERE id = $1
              AND engine_provider = 'emailengine'
            RETURNING id, email, provider, auth_method, display_name
          ),
          account_context AS (
            SELECT
              marked_account.id,
              marked_account.email,
              marked_account.provider,
              marked_account.auth_method,
              marked_account.display_name,
              account_provider_settings.settings
            FROM marked_account
            LEFT JOIN account_provider_settings
              ON account_provider_settings.account_id = marked_account.id
          ),
          existing_task AS (
            SELECT id
            FROM onboarding_tasks
            WHERE status IN ('pending', 'failed')
              AND payload ->> 'reauthRequired' = 'true'
              AND payload ->> 'accountId' = $1::text
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ),
          inserted_task AS (
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
              $3,
              account_context.email,
              account_context.provider,
              account_context.auth_method,
              'pending',
              $4::text,
              jsonb_strip_nulls(
                jsonb_build_object(
                  'source', 'emailengine_account_state',
                  'reauthRequired', true,
                  'accountId', account_context.id::text,
                  'displayName', account_context.display_name,
                  'loginHint',
                    CASE
                      WHEN account_context.auth_method = 'oauth'
                      THEN account_context.email
                    END,
                  'providerPreset',
                    account_context.settings #>> '{providerPreset}',
                  'username',
                    CASE
                      WHEN account_context.auth_method = 'password'
                      THEN COALESCE(
                        account_context.settings #>> '{smtp,username}',
                        account_context.settings #>> '{imap,username}',
                        account_context.email
                      )
                    END,
                  'imap',
                    CASE
                      WHEN account_context.auth_method = 'password'
                      THEN account_context.settings -> 'imap'
                    END,
                  'smtp',
                    CASE
                      WHEN account_context.auth_method = 'password'
                      THEN account_context.settings -> 'smtp'
                    END,
                  'reason', $4::text
                )
              )
            FROM account_context
            WHERE NOT EXISTS (SELECT 1 FROM existing_task)
            RETURNING id
          )
          SELECT id AS task_id FROM inserted_task
          UNION ALL
          SELECT id AS task_id FROM existing_task
          LIMIT 1
        `,
        [input.accountId, input.at, taskId, input.reason],
      );

      return {
        ...(result.rows[0]?.task_id
          ? { taskId: String(result.rows[0].task_id) }
          : {}),
      };
    },
  };
}

function rowToAccountSyncPlan(row: AccountSyncPlanRow): AccountSyncPlan {
  const nativeProvider = nativeProviderValue(row.native_provider);
  return {
    accountId: row.id,
    email: row.email,
    provider: row.settings_provider ?? row.account_provider,
    authMethod: row.auth_method,
    ...(row.sync_state && row.sync_state !== "syncing"
      ? { syncState: syncStateValue(row.sync_state) }
      : {}),
    engineProvider: row.engine_provider === "native" ? "native" : "emailengine",
    ...(nativeProvider ? { nativeProvider } : {}),
    capabilities: recordValue(row.capabilities),
    settings: recordValue(row.settings),
  };
}

function syncStateValue(value: string): AccountSyncPlan["syncState"] {
  if (value === "paused") {
    return "paused";
  }
  if (value === "reauth_required") {
    return "reauth_required";
  }
  return "syncing";
}

function nativeProviderValue(value: unknown): PausedProvider | undefined {
  return value === "gmail" || value === "graph" || value === "imap"
    ? value
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
