import type {
  HermesAuditLogEntry,
  HermesAuditLogPage,
  HermesAuditLogStoreListInput,
  HermesAuditLogStore,
} from "./audit-log.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface HermesAuditLogRow extends Record<string, unknown> {
  id: string;
  event_type: string;
  skill_run_id?: string | null;
  skill_id?: string | null;
  skill_title?: string | null;
  read_message_ids: string[];
  memory_ids: string[];
  action: Record<string, unknown>;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  created_at: string | Date;
}

export function createPostgresHermesAuditLogStore(
  client: Queryable,
): HermesAuditLogStore {
  return {
    async listAuditEvents(input: HermesAuditLogStoreListInput) {
      const result = await client.query<HermesAuditLogRow>(
        `
          SELECT
            audit.id,
            audit.event_type,
            audit.skill_run_id,
            run.skill_id,
            skill.title AS skill_title,
            audit.read_message_ids::text[] AS read_message_ids,
            audit.memory_ids::text[] AS memory_ids,
            audit.action,
            run.input,
            run.output,
            audit.created_at
          FROM hermes_audit_events audit
          LEFT JOIN hermes_skill_runs run
            ON run.id = audit.skill_run_id
          LEFT JOIN hermes_skills skill
            ON skill.id = run.skill_id
          WHERE
            (
              $1::text IS NULL
              OR run.input->>'accountId' = $1
              OR EXISTS (
                SELECT 1
                FROM messages
                WHERE messages.account_id::text = $1
                  AND messages.id = ANY(audit.read_message_ids)
              )
            )
            AND ($2::text IS NULL OR run.skill_id = $2)
            AND ($3::text IS NULL OR $3 = ANY(audit.read_message_ids::text[]))
            AND ($4::text IS NULL OR $4 = ANY(audit.memory_ids::text[]))
          ORDER BY audit.created_at DESC, audit.id DESC
          LIMIT $5
        `,
        [
          input.accountId ?? null,
          input.skillId ?? null,
          input.messageId ?? null,
          input.memoryId ?? null,
          input.limit,
        ],
      );

      return {
        items: result.rows.map(rowToAuditEvent),
      } satisfies HermesAuditLogPage;
    },
  };
}

function rowToAuditEvent(row: HermesAuditLogRow): HermesAuditLogEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    ...(row.skill_run_id ? { skillRunId: row.skill_run_id } : {}),
    ...(row.skill_id ? { skillId: row.skill_id } : {}),
    ...(row.skill_title ? { skillTitle: row.skill_title } : {}),
    readMessageIds: row.read_message_ids ?? [],
    memoryIds: row.memory_ids ?? [],
    action: row.action ?? {},
    ...(row.input ? { input: row.input } : {}),
    ...(row.output ? { output: row.output } : {}),
    createdAt: toIsoString(row.created_at),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
