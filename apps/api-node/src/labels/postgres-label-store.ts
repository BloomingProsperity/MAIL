import type { LabelDto, LabelStore } from "./labels.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface LabelRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  name: string;
  color: LabelDto["color"];
  message_count: string | number;
  created_at: string | Date;
}

export function createPostgresLabelStore(client: Queryable): LabelStore {
  return {
    async listLabels(input) {
      const result = await client.query<LabelRow>(
        `
          SELECT
            labels.id,
            labels.account_id,
            labels.name,
            labels.color,
            COUNT(DISTINCT messages.id) FILTER (
              WHERE messages.id IS NOT NULL
                AND (
                  message_state.message_id IS NULL
                  OR message_state.deleted_at IS NULL
                )
            ) AS message_count,
            labels.created_at
          FROM labels
          LEFT JOIN label_assignments
            ON label_assignments.label_id = labels.id
          LEFT JOIN messages
            ON messages.id = label_assignments.message_id
           AND messages.account_id = labels.account_id
          LEFT JOIN message_state
            ON message_state.message_id = messages.id
          WHERE labels.account_id = $1
          GROUP BY labels.id, labels.account_id, labels.name, labels.color, labels.created_at
          ORDER BY lower(labels.name) ASC, labels.id ASC
        `,
        [input.accountId],
      );

      return { items: result.rows.map(labelFromRow) };
    },

    async upsertLabel(input) {
      const result = await client.query<LabelRow>(
        `
          INSERT INTO labels (id, account_id, name, color)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (account_id, lower(name)) WHERE account_id IS NOT NULL
          DO UPDATE
          SET name = EXCLUDED.name,
              color = EXCLUDED.color
          RETURNING
            labels.id,
            labels.account_id,
            labels.name,
            labels.color,
            0 AS message_count,
            labels.created_at
        `,
        [input.id, input.accountId, input.name, input.color],
      );

      return labelFromRow(result.rows[0]);
    },
  };
}

function labelFromRow(row: LabelRow): LabelDto {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    color: row.color,
    messageCount:
      typeof row.message_count === "number"
        ? row.message_count
        : Number.parseInt(row.message_count, 10),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
