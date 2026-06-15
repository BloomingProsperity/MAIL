import type {
  GatekeeperMode,
  GatekeeperSettingsDto,
  GatekeeperSettingsStore,
} from "./settings.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface GatekeeperSettingsRow extends Record<string, unknown> {
  account_id: string;
  mode: GatekeeperMode;
  updated_at: string | Date;
}

export function createPostgresGatekeeperSettingsStore(
  client: Queryable,
): GatekeeperSettingsStore {
  return {
    async getSettings(input) {
      const result = await client.query<GatekeeperSettingsRow>(
        `
          SELECT account_id, mode, updated_at
          FROM gatekeeper_settings
          WHERE account_id = $1
          LIMIT 1
        `,
        [input.accountId],
      );

      return result.rows[0] ? rowToSettings(result.rows[0]) : undefined;
    },

    async setMode(input) {
      const result = await client.query<GatekeeperSettingsRow>(
        `
          INSERT INTO gatekeeper_settings (
            account_id,
            mode
          )
          VALUES ($1, $2)
          ON CONFLICT (account_id) DO UPDATE
          SET
            mode = EXCLUDED.mode,
            updated_at = now()
          RETURNING account_id, mode, updated_at
        `,
        [input.accountId, input.mode],
      );

      return rowToSettings(result.rows[0]);
    },
  };
}

function rowToSettings(row: GatekeeperSettingsRow): GatekeeperSettingsDto {
  return {
    accountId: row.account_id,
    mode: row.mode,
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
