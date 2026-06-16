import type { Queryable } from "../mail-read/postgres-mail-read-store.js";
import type {
  HermesMessageTranslationLookup,
  HermesMessageTranslationRecord,
  HermesMessageTranslationStore,
} from "./message-translation.js";

interface MessageTranslationRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  message_id: string;
  body_hash: string;
  target_language: string;
  source_language: string;
  tone: string;
  translated_text: string;
  skill_run_id: string;
  audit_event_id?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export function createPostgresHermesMessageTranslationStore(
  client: Queryable,
): HermesMessageTranslationStore {
  return {
    async getCachedTranslation(input) {
      const result = await client.query<MessageTranslationRow>(
        `
          SELECT
            id,
            account_id,
            message_id,
            body_hash,
            target_language,
            source_language,
            tone,
            translated_text,
            skill_run_id,
            audit_event_id,
            created_at,
            updated_at
          FROM hermes_message_translations
          WHERE account_id = $1
            AND message_id = $2
            AND body_hash = $3
            AND target_language = $4
            AND source_language = $5
            AND tone = $6
          LIMIT 1
        `,
        lookupValues(input),
      );

      return result.rows[0] ? rowToMessageTranslation(result.rows[0]) : undefined;
    },

    async saveTranslation(input) {
      const result = await client.query<MessageTranslationRow>(
        `
          INSERT INTO hermes_message_translations (
            id,
            account_id,
            message_id,
            body_hash,
            target_language,
            source_language,
            tone,
            translated_text,
            skill_run_id,
            audit_event_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (
            account_id,
            message_id,
            target_language,
            source_language,
            tone,
            body_hash
          )
          DO UPDATE SET
            translated_text = EXCLUDED.translated_text,
            skill_run_id = EXCLUDED.skill_run_id,
            audit_event_id = EXCLUDED.audit_event_id,
            updated_at = now()
          RETURNING
            id,
            account_id,
            message_id,
            body_hash,
            target_language,
            source_language,
            tone,
            translated_text,
            skill_run_id,
            audit_event_id,
            created_at,
            updated_at
        `,
        [
          input.id,
          ...lookupValues(input),
          input.translatedText,
          input.skillRunId,
          input.auditEventId ?? null,
        ],
      );

      return rowToMessageTranslation(result.rows[0]);
    },
  };
}

function lookupValues(input: HermesMessageTranslationLookup): unknown[] {
  return [
    input.accountId,
    input.messageId,
    input.bodyHash,
    input.targetLanguage,
    input.sourceLanguage,
    input.tone,
  ];
}

function rowToMessageTranslation(
  row: MessageTranslationRow,
): HermesMessageTranslationRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    messageId: row.message_id,
    bodyHash: row.body_hash,
    targetLanguage: row.target_language,
    sourceLanguage: row.source_language,
    tone: row.tone,
    translatedText: row.translated_text,
    skillRunId: row.skill_run_id,
    ...(row.audit_event_id ? { auditEventId: row.audit_event_id } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
