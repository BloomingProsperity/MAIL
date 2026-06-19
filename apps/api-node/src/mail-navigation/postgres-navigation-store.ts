import type {
  FolderCount,
  MailNavigationStore,
  ProviderCount,
  QuickCategoryCount,
  QuickCategoryDefinition,
} from "./navigation-summary.js";
import {
  getBuiltInSavedViewIds,
  getSavedViewKeywordValuesSql,
} from "./saved-views.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface CountRow extends Record<string, unknown> {
  provider?: string;
  id?: string;
  count: string | number;
}

interface SavedViewRow extends Record<string, unknown> {
  id: string;
  label: string;
  tone: QuickCategoryDefinition["tone"];
}

export function createPostgresMailNavigationStore(
  client: Queryable,
): MailNavigationStore {
  return {
    async listProviderCounts() {
      const result = await client.query<CountRow>(
        `
          SELECT provider, COUNT(*) AS count
          FROM connected_accounts
          GROUP BY provider
          ORDER BY provider ASC
        `,
      );

      return result.rows.map((row) => ({
        provider: String(row.provider ?? ""),
        count: readCount(row.count),
      })) satisfies ProviderCount[];
    },

    async listFolderCounts() {
      const result = await client.query<CountRow>(
        `
          WITH visible_messages AS (
            SELECT
              messages.id,
              COALESCE(message_state.starred, FALSE) AS starred,
              message_state.snoozed_until,
              COUNT(DISTINCT attachments.id) AS attachment_count
            FROM messages
            LEFT JOIN message_state
              ON message_state.message_id = messages.id
            LEFT JOIN attachments
              ON attachments.message_id = messages.id
            WHERE message_state.deleted_at IS NULL
               OR message_state.message_id IS NULL
            GROUP BY
              messages.id,
              message_state.starred,
              message_state.snoozed_until
          ),
          role_counts AS (
            SELECT mailboxes.role AS id, COUNT(DISTINCT messages.id) AS count
            FROM messages
            LEFT JOIN message_state
              ON message_state.message_id = messages.id
            JOIN message_locations
              ON message_locations.message_id = messages.id
            JOIN mailboxes
              ON mailboxes.id = message_locations.mailbox_id
            WHERE message_state.deleted_at IS NULL
               OR message_state.message_id IS NULL
            GROUP BY mailboxes.role
          ),
          fact_counts AS (
            SELECT 'all' AS id, COUNT(*) AS count
            FROM visible_messages
            UNION ALL
            SELECT 'flagged' AS id, COUNT(*) AS count
            FROM visible_messages
            WHERE starred = TRUE
            UNION ALL
            SELECT 'snoozed' AS id, COUNT(*) AS count
            FROM visible_messages
            WHERE snoozed_until > now()
            UNION ALL
            SELECT 'attachments' AS id, COUNT(*) AS count
            FROM visible_messages
            WHERE attachment_count > 0
          )
          SELECT id, SUM(count) AS count
          FROM (
            SELECT id, count FROM role_counts
            UNION ALL
            SELECT id, count FROM fact_counts
          ) folder_counts
          GROUP BY id
          ORDER BY id ASC
        `,
      );

      return result.rows.map((row) => ({
        id: String(row.id ?? ""),
        count: readCount(row.count),
      })) satisfies FolderCount[];
    },

    async listQuickCategoryCounts() {
      const result = await client.query<CountRow>(
        `
          WITH visible_messages AS (
            SELECT
              messages.id,
              lower(concat_ws(
                ' ',
                messages.subject,
                messages.snippet,
                messages.body_text,
                messages.from_email,
                messages.from_name,
                array_to_string(message_classification.reasons, ' ')
              )) AS text,
              COUNT(attachments.id) AS attachment_count
            FROM messages
            LEFT JOIN message_state
              ON message_state.message_id = messages.id
            LEFT JOIN message_classification
              ON message_classification.message_id = messages.id
            LEFT JOIN attachments
              ON attachments.message_id = messages.id
            WHERE message_state.deleted_at IS NULL
               OR message_state.message_id IS NULL
            GROUP BY
              messages.id,
              messages.subject,
              messages.snippet,
              messages.body_text,
              messages.from_email,
              messages.from_name,
              message_classification.reasons
          ),
          keyword_counts AS (
            SELECT category.id, COUNT(DISTINCT visible_messages.id) AS count
            FROM visible_messages
            JOIN (
              VALUES
                ${getSavedViewKeywordValuesSql()}
            ) AS category(id, keywords)
              ON EXISTS (
                SELECT 1
                FROM unnest(category.keywords) AS keyword
                WHERE visible_messages.text LIKE '%' || lower(keyword) || '%'
              )
            GROUP BY category.id
          ),
          custom_keyword_counts AS (
            SELECT saved_views.id, COUNT(DISTINCT visible_messages.id) AS count
            FROM visible_messages
            JOIN saved_views
              ON saved_views.enabled = TRUE
             AND saved_views.kind = 'keyword'
             AND saved_views.id <> ALL($1::text[])
             AND EXISTS (
                SELECT 1
                FROM unnest(saved_views.keywords) AS keyword
                WHERE visible_messages.text LIKE '%' || lower(keyword) || '%'
             )
            GROUP BY saved_views.id
          ),
          fact_counts AS (
            SELECT 'large_attachments' AS id, COUNT(*) AS count
            FROM visible_messages
            WHERE attachment_count >= 1
          )
          SELECT id, SUM(count) AS count
          FROM (
            SELECT id, count FROM keyword_counts
            UNION ALL
            SELECT id, count FROM custom_keyword_counts
            UNION ALL
            SELECT id, count FROM fact_counts
          ) saved_view_counts
          WHERE count > 0
          GROUP BY id
          ORDER BY id ASC
        `,
        [getBuiltInSavedViewIds()],
      );

      return result.rows.map((row) => ({
        id: String(row.id ?? ""),
        count: readCount(row.count),
      })) satisfies QuickCategoryCount[];
    },

    async listQuickCategories() {
      const result = await client.query<SavedViewRow>(
        `
          SELECT id, label, tone
          FROM saved_views
          WHERE enabled = TRUE
          ORDER BY sort_order ASC, id ASC
        `,
      );

      return result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        tone: row.tone,
      })) satisfies QuickCategoryDefinition[];
    },
  };
}

function readCount(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}
