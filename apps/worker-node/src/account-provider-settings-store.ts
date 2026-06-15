import type { NativeProvider } from "./mail-provider/contract.js";

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
  nativeProvider?: NativeProvider;
  capabilities: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface AccountProviderSettingsStore {
  getAccountSyncPlan(accountId: string): Promise<AccountSyncPlan | undefined>;
  markAccountReauthRequired(input: {
    accountId: string;
    reason: "auth_failed" | "sync_failed";
    at: string;
  }): Promise<void>;
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
      await client.query(
        `
          UPDATE connected_accounts
          SET sync_state = 'reauth_required',
              updated_at = $2
          WHERE id = $1
        `,
        [input.accountId, input.at],
      );
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

function nativeProviderValue(value: unknown): NativeProvider | undefined {
  return value === "gmail" || value === "graph" || value === "imap"
    ? value
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
