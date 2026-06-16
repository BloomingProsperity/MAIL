import type { HermesSkillSettings } from "./skills.js";
import type { HermesSkillSettingsStore } from "./skill-settings.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface HermesSkillSettingsRow extends Record<string, unknown> {
  skill_id: string;
  enabled: boolean;
  max_context_chars: number;
  memory_limit: number;
  allow_body_read: boolean;
  allow_memory_write: boolean;
  require_confirmation: boolean;
}

export function createPostgresHermesSkillSettingsStore(
  client: Queryable,
): HermesSkillSettingsStore {
  return {
    async listSettings() {
      const result = await client.query<HermesSkillSettingsRow>(
        `
          SELECT
            skill_id,
            enabled,
            max_context_chars,
            memory_limit,
            allow_body_read,
            allow_memory_write,
            require_confirmation
          FROM hermes_skill_settings
        `,
      );

      return Object.fromEntries(
        result.rows.map((row) => [row.skill_id, rowToSettings(row)]),
      );
    },

    async getSettings(skillId) {
      const result = await client.query<HermesSkillSettingsRow>(
        `
          SELECT
            skill_id,
            enabled,
            max_context_chars,
            memory_limit,
            allow_body_read,
            allow_memory_write,
            require_confirmation
          FROM hermes_skill_settings
          WHERE skill_id = $1
          LIMIT 1
        `,
        [skillId],
      );

      return result.rows[0] ? rowToSettings(result.rows[0]) : undefined;
    },

    async saveSettings(input) {
      const result = await client.query<HermesSkillSettingsRow>(
        `
          INSERT INTO hermes_skill_settings (
            skill_id,
            enabled,
            max_context_chars,
            memory_limit,
            allow_body_read,
            allow_memory_write,
            require_confirmation
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (skill_id) DO UPDATE
          SET
            enabled = EXCLUDED.enabled,
            max_context_chars = EXCLUDED.max_context_chars,
            memory_limit = EXCLUDED.memory_limit,
            allow_body_read = EXCLUDED.allow_body_read,
            allow_memory_write = EXCLUDED.allow_memory_write,
            require_confirmation = EXCLUDED.require_confirmation,
            updated_at = now()
          RETURNING
            skill_id,
            enabled,
            max_context_chars,
            memory_limit,
            allow_body_read,
            allow_memory_write,
            require_confirmation
        `,
        [
          input.skillId,
          input.settings.enabled,
          input.settings.maxContextChars,
          input.settings.memoryLimit,
          input.settings.allowBodyRead,
          input.settings.allowMemoryWrite,
          input.settings.requireConfirmation,
        ],
      );

      return rowToSettings(result.rows[0]);
    },
  };
}

function rowToSettings(row: HermesSkillSettingsRow): HermesSkillSettings {
  return {
    enabled: row.enabled,
    maxContextChars: row.max_context_chars,
    memoryLimit: row.memory_limit,
    allowBodyRead: row.allow_body_read,
    allowMemoryWrite: row.allow_memory_write,
    requireConfirmation: row.require_confirmation,
  };
}
