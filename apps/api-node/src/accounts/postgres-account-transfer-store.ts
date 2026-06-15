import type {
  AccountTransferAccount,
  AccountTransferSource,
} from "./account-transfer.js";

interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export function createPostgresAccountTransferStore(
  client: Queryable,
): AccountTransferSource {
  return {
    async listTransferAccounts(input) {
      const hasFilter = input.accountIds !== undefined && input.accountIds.length > 0;
      const result = await client.query(
        `
          SELECT
            id,
            email,
            provider,
            auth_method,
            display_name,
            engine_provider
          FROM connected_accounts
          ${hasFilter ? "WHERE id = ANY($1::uuid[])" : ""}
          ORDER BY email, provider
        `,
        hasFilter ? [input.accountIds] : undefined,
      );

      return result.rows.map(mapAccount);
    },
  };
}

function mapAccount(row: Record<string, unknown>): AccountTransferAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    provider: String(row.provider),
    authMethod: row.auth_method === "oauth" ? "oauth" : "password",
    displayName:
      typeof row.display_name === "string" ? row.display_name : undefined,
    engineProvider: row.engine_provider === "native" ? "native" : "emailengine",
  };
}
