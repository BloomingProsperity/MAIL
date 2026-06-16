import type { Queryable } from "../mail-read/postgres-mail-read-store.js";
import type {
  HermesMessageSummaryLookup,
  HermesMessageSummaryRecord,
  HermesMessageSummaryStore,
} from "./message-summary.js";

interface MessageSummaryRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  message_id: string;
  body_hash: string;
  mode: "short" | "detailed" | "action_points";
  focus: string;
  language: string;
  summary_text: string;
  skill_run_id: string;
  audit_event_id?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export function createPostgresHermesMessageSummaryStore(
  client: Queryable,
): HermesMessageSummaryStore {
  return {
    async getCachedSummary(input) {
      const result = await client.query<MessageSummaryRow>(
        `
          SELECT
            id,
            account_id,
            message_id,
            body_hash,
            mode,
            focus,
            language,
            summary_text,
            skill_run_id,
            audit_event_id,
            created_at,
            updated_at
          FROM hermes_message_summaries
          WHERE account_id = $1
            AND message_id = $2
            AND body_hash = $3
            AND mode = $4
            AND focus = $5
            AND language = $6
          LIMIT 1
        `,
        lookupValues(input),
      );

      return result.rows[0] ? rowToMessageSummary(result.rows[0]) : undefined;
    },

    async saveSummary(input) {
      const result = await client.query<MessageSummaryRow>(
        `
          INSERT INTO hermes_message_summaries (
            id,
            account_id,
            message_id,
            body_hash,
            mode,
            focus,
            language,
            summary_text,
            skill_run_id,
            audit_event_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (
            account_id,
            message_id,
            mode,
            focus,
            language,
            body_hash
          )
          DO UPDATE SET
            summary_text = EXCLUDED.summary_text,
            skill_run_id = EXCLUDED.skill_run_id,
            audit_event_id = EXCLUDED.audit_event_id,
            updated_at = now()
          RETURNING
            id,
            account_id,
            message_id,
            body_hash,
            mode,
            focus,
            language,
            summary_text,
            skill_run_id,
            audit_event_id,
            created_at,
            updated_at
        `,
        [
          input.id,
          ...lookupValues(input),
          input.summaryText,
          input.skillRunId,
          input.auditEventId ?? null,
        ],
      );

      return rowToMessageSummary(result.rows[0]);
    },
  };
}

function lookupValues(input: HermesMessageSummaryLookup): unknown[] {
  return [
    input.accountId,
    input.messageId,
    input.bodyHash,
    input.mode,
    input.focus,
    input.language,
  ];
}

function rowToMessageSummary(row: MessageSummaryRow): HermesMessageSummaryRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    messageId: row.message_id,
    bodyHash: row.body_hash,
    mode: row.mode,
    focus: row.focus,
    language: row.language,
    summaryText: row.summary_text,
    skillRunId: row.skill_run_id,
    ...(row.audit_event_id ? { auditEventId: row.audit_event_id } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
