import type {
  HermesRuntimeConfigStore,
  HermesRuntimeMode,
  HermesRuntimeSettingsDto,
  HermesRuntimeUpdateChannel,
  HermesRuntimeUpdateInput,
  HermesRuntimeUpdatePolicy,
} from "./runtime-config.js";

const SETTINGS_ID = "default";
const API_KEY_SECRET_REF = "hermes/default/api-key";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface HermesRuntimeSettingsRow extends Record<string, unknown> {
  enabled: boolean;
  mode: HermesRuntimeMode;
  provider_key: string;
  endpoint_url: string | null;
  model: string;
  api_key_secret_ref: string | null;
  api_key_updated_at: string | Date | null;
  update_policy: HermesRuntimeUpdatePolicy;
  update_channel: HermesRuntimeUpdateChannel;
  installed_version: string | null;
  latest_version: string | null;
  last_checked_at: string | Date | null;
  updated_at: string | Date;
}

interface HermesRuntimeConnectionRow extends HermesRuntimeSettingsRow {
  secret_value: string | null;
}

export function createPostgresHermesRuntimeConfigStore(
  client: Queryable,
): HermesRuntimeConfigStore {
  return {
    async getSettings() {
      const result = await client.query<HermesRuntimeSettingsRow>(
        `
          SELECT
            enabled,
            mode,
            provider_key,
            endpoint_url,
            model,
            api_key_secret_ref,
            api_key_updated_at,
            update_policy,
            update_channel,
            installed_version,
            latest_version,
            last_checked_at,
            updated_at
          FROM hermes_runtime_settings
          WHERE id = $1
          LIMIT 1
        `,
        [SETTINGS_ID],
      );

      return result.rows[0] ? rowToPublicSettings(result.rows[0]) : undefined;
    },

    async getConnectionSettings() {
      const result = await client.query<HermesRuntimeConnectionRow>(
        `
          SELECT
            settings.enabled,
            settings.mode,
            settings.provider_key,
            settings.endpoint_url,
            settings.model,
            settings.api_key_secret_ref,
            settings.api_key_updated_at,
            settings.update_policy,
            settings.update_channel,
            settings.installed_version,
            settings.latest_version,
            settings.last_checked_at,
            settings.updated_at,
            secrets.secret_value
          FROM hermes_runtime_settings settings
          LEFT JOIN stored_secrets secrets
            ON secrets.secret_ref = settings.api_key_secret_ref
          WHERE settings.id = $1
          LIMIT 1
        `,
        [SETTINGS_ID],
      );
      const row = result.rows[0];
      if (!row?.enabled || !row.endpoint_url) {
        return undefined;
      }

      return {
        enabled: row.enabled,
        providerKey: row.provider_key,
        endpointUrl: row.endpoint_url,
        model: row.model,
        ...(row.secret_value ? { apiKey: row.secret_value } : {}),
      };
    },

    async saveSettings(input) {
      if (input.apiKey) {
        await client.query(
          `
            INSERT INTO stored_secrets (secret_ref, secret_value)
            VALUES ($1, $2)
            ON CONFLICT (secret_ref) DO UPDATE
            SET secret_value = EXCLUDED.secret_value,
                updated_at = now()
          `,
          [API_KEY_SECRET_REF, input.apiKey],
        );
      }

      if (input.clearApiKey) {
        await client.query(
          `
            DELETE FROM stored_secrets
            WHERE secret_ref = $1
          `,
          [API_KEY_SECRET_REF],
        );
      }

      const result = await client.query<HermesRuntimeSettingsRow>(
        `
          INSERT INTO hermes_runtime_settings (
            id,
            enabled,
            mode,
            provider_key,
            endpoint_url,
            model,
            api_key_secret_ref,
            api_key_updated_at,
            update_policy,
            update_channel
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            CASE
              WHEN $7::boolean THEN NULL
              WHEN $8::boolean THEN $9
              ELSE NULL
            END,
            CASE
              WHEN $8::boolean THEN now()
              ELSE NULL
            END,
            $10,
            $11
          )
          ON CONFLICT (id) DO UPDATE
          SET
            enabled = EXCLUDED.enabled,
            mode = EXCLUDED.mode,
            provider_key = EXCLUDED.provider_key,
            endpoint_url = EXCLUDED.endpoint_url,
            model = EXCLUDED.model,
            api_key_secret_ref = CASE
              WHEN $7::boolean THEN NULL
              WHEN $8::boolean THEN $9
              ELSE hermes_runtime_settings.api_key_secret_ref
            END,
            api_key_updated_at = CASE
              WHEN $7::boolean THEN NULL
              WHEN $8::boolean THEN now()
              ELSE hermes_runtime_settings.api_key_updated_at
            END,
            update_policy = EXCLUDED.update_policy,
            update_channel = EXCLUDED.update_channel,
            updated_at = now()
          RETURNING
            enabled,
            mode,
            provider_key,
            endpoint_url,
            model,
            api_key_secret_ref,
            api_key_updated_at,
            update_policy,
            update_channel,
            installed_version,
            latest_version,
            last_checked_at,
            updated_at
        `,
        [
          SETTINGS_ID,
          input.enabled,
          input.mode,
          input.providerKey ?? "custom",
          input.endpointUrl ?? null,
          input.model,
          Boolean(input.clearApiKey),
          Boolean(input.apiKey),
          API_KEY_SECRET_REF,
          input.updatePolicy,
          input.updateChannel,
        ],
      );

      return rowToPublicSettings(result.rows[0]);
    },

    async saveVersionStatus(input) {
      const result = await client.query<HermesRuntimeSettingsRow>(
        `
          INSERT INTO hermes_runtime_settings (
            id,
            enabled,
            mode,
            provider_key,
            model,
            update_policy,
            update_channel,
            installed_version,
            latest_version,
            last_checked_at
          )
          VALUES (
            $1,
            FALSE,
            'openai_compatible',
            'custom',
            'hermes-email',
            'manual',
            'stable',
            $2,
            $3,
            $4
          )
          ON CONFLICT (id) DO UPDATE
          SET
            installed_version = COALESCE($2, hermes_runtime_settings.installed_version),
            latest_version = COALESCE($3, hermes_runtime_settings.latest_version),
            last_checked_at = $4,
            updated_at = now()
          RETURNING
            enabled,
            mode,
            provider_key,
            endpoint_url,
            model,
            api_key_secret_ref,
            api_key_updated_at,
            update_policy,
            update_channel,
            installed_version,
            latest_version,
            last_checked_at,
            updated_at
        `,
        [
          SETTINGS_ID,
          input.installedVersion ?? null,
          input.latestVersion ?? null,
          input.lastCheckedAt,
        ],
      );

      return rowToPublicSettings(result.rows[0]);
    },
  };
}

function rowToPublicSettings(
  row: HermesRuntimeSettingsRow,
): HermesRuntimeSettingsDto {
  return {
    enabled: row.enabled,
    mode: row.mode,
    providerKey: row.provider_key,
    ...(row.endpoint_url ? { endpointUrl: row.endpoint_url } : {}),
    model: row.model,
    apiKeyConfigured: Boolean(row.api_key_secret_ref),
    ...(row.api_key_updated_at
      ? { apiKeyUpdatedAt: toIso(row.api_key_updated_at) }
      : {}),
    updatePolicy: row.update_policy,
    updateChannel: row.update_channel,
    ...(row.installed_version ? { installedVersion: row.installed_version } : {}),
    ...(row.latest_version ? { latestVersion: row.latest_version } : {}),
    updateAvailable:
      Boolean(row.installed_version && row.latest_version) &&
      row.installed_version !== row.latest_version,
    ...(row.last_checked_at ? { lastCheckedAt: toIso(row.last_checked_at) } : {}),
    source: "database",
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
