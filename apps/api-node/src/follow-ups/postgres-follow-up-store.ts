import type {
  FollowUpKind,
  FollowUpReminder,
  FollowUpSource,
  FollowUpStatus,
  FollowUpStore,
} from "./follow-ups.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface FollowUpRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  message_id: string;
  kind: string;
  status: string;
  due_at: string | Date;
  title: string | null;
  note: string | null;
  source: string;
  hermes_skill_run_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
  cancelled_at: string | Date | null;
}

export function createPostgresFollowUpStore(client: Queryable): FollowUpStore {
  return {
    async createFollowUp(input) {
      const result = await client.query<FollowUpRow>(
        `
          INSERT INTO follow_up_reminders (
            id,
            account_id,
            message_id,
            kind,
            due_at,
            title,
            note,
            source,
            hermes_skill_run_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10::timestamptz, $10::timestamptz)
          RETURNING ${followUpColumns()}
        `,
        [
          input.id,
          input.accountId,
          input.messageId,
          input.kind,
          input.dueAt,
          input.title ?? null,
          input.note ?? null,
          input.source,
          input.hermesSkillRunId ?? null,
          input.now,
        ],
      );

      return rowToFollowUp(result.rows[0]);
    },

    async listFollowUps(input) {
      const result =
        input.status === "all"
          ? await client.query<FollowUpRow>(
              `
                SELECT ${followUpColumns()}
                FROM follow_up_reminders
                WHERE account_id = $1
                ORDER BY due_at ASC, created_at ASC
                LIMIT $2
              `,
              [input.accountId, input.limit],
            )
          : await client.query<FollowUpRow>(
              `
                SELECT ${followUpColumns()}
                FROM follow_up_reminders
                WHERE account_id = $1
                  AND status = $2
                ORDER BY due_at ASC, created_at ASC
                LIMIT $3
              `,
              [input.accountId, input.status, input.limit],
            );

      return result.rows.map(rowToFollowUp);
    },

    async updateFollowUp(input) {
      const result = await client.query<FollowUpRow>(
        `
          UPDATE follow_up_reminders
          SET due_at = COALESCE($2::timestamptz, due_at),
              kind = COALESCE($3::text, kind),
              status = COALESCE($4::text, status),
              title = COALESCE($5::text, title),
              note = COALESCE($6::text, note),
              completed_at = CASE
                WHEN $4::text = 'done' THEN $7::timestamptz
                WHEN $4::text IN ('open', 'due') THEN NULL
                ELSE completed_at
              END,
              updated_at = $7::timestamptz
          WHERE id = $1
          RETURNING ${followUpColumns()}
        `,
        [
          input.id,
          input.dueAt ?? null,
          input.kind ?? null,
          input.status ?? null,
          input.title ?? null,
          input.note ?? null,
          input.now,
        ],
      );

      return result.rows[0] ? rowToFollowUp(result.rows[0]) : undefined;
    },

    async cancelFollowUp(input) {
      const result = await client.query<FollowUpRow>(
        `
          UPDATE follow_up_reminders
          SET status = 'cancelled',
              cancelled_at = $2::timestamptz,
              updated_at = $2::timestamptz
          WHERE id = $1
          RETURNING ${followUpColumns()}
        `,
        [input.id, input.now],
      );

      return result.rows[0] ? rowToFollowUp(result.rows[0]) : undefined;
    },
  };
}

function followUpColumns(prefix?: string): string {
  const table = prefix ? `${prefix}.` : "";
  return `
    ${table}id,
    ${table}account_id,
    ${table}message_id,
    ${table}kind,
    ${table}status,
    ${table}due_at,
    ${table}title,
    ${table}note,
    ${table}source,
    ${table}hermes_skill_run_id,
    ${table}created_at,
    ${table}updated_at,
    ${table}completed_at,
    ${table}cancelled_at
  `;
}

function rowToFollowUp(row: FollowUpRow): FollowUpReminder {
  return {
    id: row.id,
    accountId: row.account_id,
    messageId: row.message_id,
    kind: row.kind as FollowUpKind,
    status: row.status as FollowUpStatus,
    dueAt: toIso(row.due_at),
    ...(row.title ? { title: row.title } : {}),
    ...(row.note ? { note: row.note } : {}),
    source: row.source as FollowUpSource,
    ...(row.hermes_skill_run_id ? { hermesSkillRunId: row.hermes_skill_run_id } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...(row.completed_at ? { completedAt: toIso(row.completed_at) } : {}),
    ...(row.cancelled_at ? { cancelledAt: toIso(row.cancelled_at) } : {}),
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
