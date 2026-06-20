import type {
  GetMessageInput,
  ListMailboxesInput,
  ListMessagesInput,
  MailReadStore,
  AttachmentDto,
  AttachmentDownloadRef,
  MailboxDto,
  MailQuickFilter,
  MailSearchScope,
  MessageBodyHydrator,
  MessageDetailDto,
  MessageListItemDto,
  Page,
} from "./mail-read-store.js";
import {
  decodeMailReadCursor,
  encodeMailReadCursor,
} from "./cursor.js";
import {
  findBuiltInSavedView,
  type SavedViewDefinition,
} from "../mail-navigation/saved-views.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export class InvalidMailSavedViewError extends Error {
  constructor(message = "invalid mail saved view") {
    super(message);
  }
}

export interface PostgresMailReadStoreOptions {
  bodyHydrator?: MessageBodyHydrator;
}

interface MailboxRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  name: string;
  role: string;
  message_count: string | number;
  unread_count: string | number;
}

interface MessageListRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  subject: string;
  from_email: string;
  from_name?: string | null;
  received_at: string | Date;
  snippet?: string | null;
  unread?: boolean | null;
  starred?: boolean | null;
  mailbox_ids?: unknown;
  attachment_count: string | number;
  bucket?: string | null;
  priority_score?: string | number | null;
  reasons?: unknown;
  search_preview?: string | null;
}

interface MessageDetailRow extends MessageListRow {
  to_emails?: unknown;
  cc_emails?: unknown;
  body_text?: string | null;
  body_html?: string | null;
  attachments?: unknown;
}

interface AttachmentDownloadRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  provider_attachment_id: string;
  filename: string;
  content_type: string;
  byte_size: string | number;
}

interface SavedViewRow extends Record<string, unknown> {
  id: string;
  label: string;
  tone: SavedViewDefinition["tone"];
  kind: SavedViewDefinition["kind"];
  keywords?: unknown;
  match_config?: Record<string, unknown> | null;
}

export function createPostgresMailReadStore(
  client: Queryable,
  options: PostgresMailReadStoreOptions = {},
): MailReadStore {
  return {
    async listMailboxes(input: ListMailboxesInput) {
      const result = await client.query<MailboxRow>(
        `
          SELECT
            mailboxes.id,
            mailboxes.account_id,
            mailboxes.name,
            mailboxes.role,
            COUNT(DISTINCT messages.id) FILTER (
              WHERE message_state.message_id IS NOT NULL
                AND message_state.deleted_at IS NULL
            ) AS message_count,
            COUNT(DISTINCT messages.id) FILTER (
              WHERE message_state.message_id IS NOT NULL
                AND message_state.deleted_at IS NULL
                AND COALESCE(message_state.unread, TRUE) = TRUE
            ) AS unread_count
          FROM mailboxes
          LEFT JOIN message_locations
            ON message_locations.mailbox_id = mailboxes.id
          LEFT JOIN messages
            ON messages.id = message_locations.message_id
           AND messages.account_id = mailboxes.account_id
          LEFT JOIN message_state
            ON message_state.message_id = messages.id
          WHERE mailboxes.account_id = $1
          GROUP BY mailboxes.id, mailboxes.account_id, mailboxes.name, mailboxes.role
          ORDER BY
            CASE mailboxes.role
              WHEN 'inbox' THEN 0
              WHEN 'drafts' THEN 1
              WHEN 'sent' THEN 2
              WHEN 'trash' THEN 3
              WHEN 'junk' THEN 4
              WHEN 'archive' THEN 5
              WHEN 'all' THEN 6
              ELSE 9
            END,
            mailboxes.name ASC
        `,
        [input.accountId],
      );

      return { items: result.rows.map(rowToMailbox) };
    },

    async listMessages(input: ListMessagesInput) {
      const cursor = input.cursor
        ? decodeMailReadCursor(input.cursor)
        : undefined;
      const q = input.q?.trim() ? input.q.trim() : null;
      const savedView = await resolveSavedView(client, input.savedViewId);
      const values: unknown[] = [input.accountId ?? null, input.mailboxId ?? null, q];
      const mailboxRoleSql = appendMailboxRoleFilter(values, input.mailboxRole);
      const quickFilterSql = appendQuickFilters(values, input);
      const structuredFilterSql = appendStructuredFilters(values, input);
      const savedViewSql = appendSavedViewFilter(values, savedView);
      const searchPreviewSql = buildSearchPreviewExpression(input.qScopes);
      const whereClause = [
        buildSearchClause(input.qScopes),
        mailboxRoleSql,
        quickFilterSql.whereClause,
        structuredFilterSql.whereClause,
        savedViewSql.whereClause,
      ]
        .filter((clause) => clause.trim().length > 0)
        .join("\n");
      const havingClause = buildHavingClause([
        quickFilterSql.havingClause,
        structuredFilterSql.havingClause,
        savedViewSql.havingClause,
      ]);
      const cursorStart = values.length + 1;
      const cursorClause = `
          AND (
            $${cursorStart}::timestamptz IS NULL
            OR (messages.received_at, messages.id::text) < ($${cursorStart}::timestamptz, $${cursorStart + 1}::text)
          )
        `;
      const orderBy = `
        ORDER BY messages.received_at DESC, messages.id DESC
        LIMIT $${cursorStart + 2}
      `;
      values.push(cursor?.receivedAt ?? null, cursor?.id ?? null, input.limit + 1);
      const result = await client.query<MessageListRow>(
        `
          SELECT
            messages.id,
            messages.account_id,
            messages.subject,
            messages.from_email,
            messages.from_name,
            messages.received_at,
            messages.snippet,
            COALESCE(message_state.unread, TRUE) AS unread,
            COALESCE(message_state.starred, FALSE) AS starred,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT mailboxes.id), NULL) AS mailbox_ids,
            COUNT(DISTINCT attachments.id) AS attachment_count,
            COALESCE(message_classification.bucket, 'P4 FYI / Updates') AS bucket,
            COALESCE(message_classification.priority_score, 0) AS priority_score,
            COALESCE(message_classification.reasons, '{}') AS reasons,
            ${searchPreviewSql} AS search_preview
          FROM messages
          JOIN message_state
            ON message_state.message_id = messages.id
          LEFT JOIN message_locations
            ON message_locations.message_id = messages.id
          LEFT JOIN mailboxes
            ON mailboxes.id = message_locations.mailbox_id
           AND mailboxes.account_id = messages.account_id
          LEFT JOIN attachments
            ON attachments.message_id = messages.id
          LEFT JOIN message_classification
            ON message_classification.message_id = messages.id
          LEFT JOIN search_documents
            ON search_documents.message_id = messages.id
          WHERE ($1::text IS NULL OR messages.account_id::text = $1::text)
            AND ($2::uuid IS NULL OR mailboxes.id = $2::uuid)
            AND message_state.deleted_at IS NULL
            ${whereClause}
            ${cursorClause}
          GROUP BY
            messages.id,
            messages.account_id,
            messages.subject,
            messages.from_email,
            messages.from_name,
            messages.received_at,
            messages.snippet,
            message_state.unread,
            message_state.starred,
            message_classification.bucket,
            message_classification.priority_score,
            message_classification.reasons
          ${havingClause}
          ${orderBy}
        `,
        values,
      );

      const pageRows = result.rows.slice(0, input.limit);
      const lastRow = pageRows[pageRows.length - 1];
      return {
        items: pageRows.map(rowToMessageListItem),
        ...(result.rows.length > input.limit && lastRow
          ? {
              nextCursor: encodeMailReadCursor({
                v: 1,
                receivedAt: toIsoString(lastRow.received_at),
                id: lastRow.id,
              }),
            }
          : {}),
      };
    },

    async getMessage(input: GetMessageInput) {
      const message = await getMessageDetail(client, input);
      if (!message || hasReadableBody(message) || !options.bodyHydrator) {
        return message;
      }

      try {
        await options.bodyHydrator.hydrateMessageBody(input);
      } catch {
        return message;
      }

      return (await getMessageDetail(client, input)) ?? message;
    },

    async getAttachmentDownload(input) {
      const result = await client.query<AttachmentDownloadRow>(
        `
          SELECT
            attachments.id,
            messages.account_id,
            attachments.provider_attachment_id,
            attachments.filename,
            attachments.content_type,
            attachments.byte_size
          FROM attachments
          JOIN messages
            ON messages.id = attachments.message_id
          JOIN message_state
            ON message_state.message_id = messages.id
          WHERE messages.account_id = $1
            AND attachments.id = $2
            AND message_state.deleted_at IS NULL
          LIMIT 1
        `,
        [input.accountId, input.attachmentId],
      );

      return result.rows[0]
        ? rowToAttachmentDownload(result.rows[0])
        : undefined;
    },
  };
}

interface SavedViewSql {
  whereClause: string;
  havingClause: string;
}

function buildSearchClause(qScopes: MailSearchScope[] | undefined): string {
  const scopes = normalizedSearchScopes(qScopes);
  const conditions: string[] = [];

  if (scopes.has("subject")) {
    conditions.push("messages.subject ILIKE '%' || $3 || '%'");
  }

  if (scopes.has("sender")) {
    conditions.push("messages.from_email ILIKE '%' || $3 || '%'");
    conditions.push("COALESCE(messages.from_name, '') ILIKE '%' || $3 || '%'");
  }

  if (scopes.has("recipients")) {
    conditions.push("messages.to_emails::text ILIKE '%' || $3 || '%'");
    conditions.push("messages.cc_emails::text ILIKE '%' || $3 || '%'");
  }

  if (scopes.has("body")) {
    conditions.push("COALESCE(messages.snippet, '') ILIKE '%' || $3 || '%'");
    conditions.push("search_documents.document @@ plainto_tsquery('simple', $3)");
    conditions.push("COALESCE(search_documents.raw_text, '') ILIKE '%' || $3 || '%'");
  }

  return `
            AND (
              $3::text IS NULL
              OR ${conditions.join("\n              OR ")}
            )
  `;
}

function buildSearchPreviewExpression(
  qScopes: MailSearchScope[] | undefined,
): string {
  const scopes = normalizedSearchScopes(qScopes);
  if (!scopes.has("body")) {
    return "NULL::text";
  }

  return `
            MAX(
              CASE
                WHEN $3::text IS NOT NULL
                  AND COALESCE(search_documents.raw_text, '') <> ''
                  AND (
                    search_documents.document @@ plainto_tsquery('simple', $3)
                    OR COALESCE(search_documents.raw_text, '') ILIKE '%' || $3 || '%'
                  )
                THEN ts_headline(
                  'simple',
                  search_documents.raw_text,
                  plainto_tsquery('simple', $3),
                  'MaxWords=24, MinWords=8, ShortWord=2, HighlightAll=false'
                )
                ELSE NULL
              END
            )
  `;
}

function normalizedSearchScopes(
  qScopes: MailSearchScope[] | undefined,
): Set<MailSearchScope> {
  return new Set<MailSearchScope>(
    qScopes && qScopes.length > 0
      ? qScopes
      : ["sender", "recipients", "subject", "body"],
  );
}

function appendQuickFilters(
  values: unknown[],
  input: ListMessagesInput,
): SavedViewSql {
  const quickFilters = new Set<MailQuickFilter>(input.quickFilters ?? []);
  const whereClauses: string[] = [];
  const havingClauses: string[] = [];

  if (quickFilters.has("unread")) {
    whereClauses.push("AND COALESCE(message_state.unread, TRUE) = TRUE");
  }

  if (quickFilters.has("starred")) {
    whereClauses.push("AND COALESCE(message_state.starred, FALSE) = TRUE");
  }

  if (quickFilters.has("snoozed")) {
    whereClauses.push("AND message_state.snoozed_until > now()");
  }

  if (quickFilters.has("attachments")) {
    havingClauses.push("COUNT(DISTINCT attachments.id) > 0");
  }

  if (quickFilters.has("labels") || (input.labelIds?.length ?? 0) > 0) {
    whereClauses.push(appendLabelFilter(values, input));
  }

  return {
    whereClause: whereClauses.join("\n"),
    havingClause: havingClauses.join("\n AND "),
  };
}

function appendMailboxRoleFilter(
  values: unknown[],
  mailboxRole: string | undefined,
): string {
  if (!mailboxRole) {
    return "";
  }

  values.push(mailboxRole);
  const parameter = `$${values.length}`;
  return `
    AND EXISTS (
      SELECT 1
      FROM message_locations AS role_message_locations
      JOIN mailboxes AS role_mailboxes
        ON role_mailboxes.id = role_message_locations.mailbox_id
      WHERE role_message_locations.message_id = messages.id
        AND role_mailboxes.account_id = messages.account_id
        AND role_mailboxes.role = ${parameter}
    )
  `;
}

function appendStructuredFilters(
  values: unknown[],
  input: ListMessagesInput,
): SavedViewSql {
  const whereClauses: string[] = [];
  const havingClauses: string[] = [];

  if (input.senderQuery) {
    const parameter = `$${values.length + 1}`;
    values.push(input.senderQuery);
    whereClauses.push(`
            AND (
              messages.from_email ILIKE '%' || ${parameter}::text || '%'
              OR COALESCE(messages.from_name, '') ILIKE '%' || ${parameter}::text || '%'
            )
    `);
  }

  if (input.recipientQuery) {
    const parameter = `$${values.length + 1}`;
    values.push(input.recipientQuery);
    whereClauses.push(`
            AND (
              messages.to_emails::text ILIKE '%' || ${parameter}::text || '%'
              OR messages.cc_emails::text ILIKE '%' || ${parameter}::text || '%'
            )
    `);
  }

  if (input.receivedAfter) {
    const parameter = `$${values.length + 1}`;
    values.push(input.receivedAfter);
    whereClauses.push(
      `AND messages.received_at >= ${parameter}::timestamptz`,
    );
  }

  if (input.receivedBefore) {
    const parameter = `$${values.length + 1}`;
    values.push(input.receivedBefore);
    whereClauses.push(
      `AND messages.received_at < ${parameter}::timestamptz`,
    );
  }

  if (input.hasAttachment === true) {
    havingClauses.push("COUNT(DISTINCT attachments.id) > 0");
  }

  if (input.hasAttachment === false) {
    havingClauses.push("COUNT(DISTINCT attachments.id) = 0");
  }

  return {
    whereClause: whereClauses.join("\n"),
    havingClause: havingClauses.join("\n AND "),
  };
}

function appendLabelFilter(
  values: unknown[],
  input: ListMessagesInput,
): string {
  const labelIds = input.labelIds ?? [];
  if (labelIds.length === 0) {
    return `
            AND EXISTS (
              SELECT 1
              FROM label_assignments selected_labels
              JOIN labels selected_label_defs
                ON selected_label_defs.id = selected_labels.label_id
              WHERE selected_labels.message_id = messages.id
                AND selected_label_defs.account_id = messages.account_id
            )
    `;
  }

  const parameter = `$${values.length + 1}`;
  values.push(labelIds);
  if (input.tagMode === "all") {
    return `
            AND (
              SELECT COUNT(DISTINCT selected_labels.label_id)
              FROM label_assignments selected_labels
              JOIN labels selected_label_defs
                ON selected_label_defs.id = selected_labels.label_id
              WHERE selected_labels.message_id = messages.id
                AND selected_label_defs.account_id = messages.account_id
                AND selected_labels.label_id = ANY(${parameter}::uuid[])
            ) = cardinality(${parameter}::uuid[])
    `;
  }

  return `
            AND EXISTS (
              SELECT 1
              FROM label_assignments selected_labels
              JOIN labels selected_label_defs
                ON selected_label_defs.id = selected_labels.label_id
              WHERE selected_labels.message_id = messages.id
                AND selected_label_defs.account_id = messages.account_id
                AND selected_labels.label_id = ANY(${parameter}::uuid[])
            )
  `;
}

function buildHavingClause(clauses: string[]): string {
  const conditions = clauses
    .flatMap((clause) =>
      clause
        .replace(/^\s*HAVING\s+/i, "")
        .split(/\n\s+AND\s+/i)
        .map((condition) => condition.trim())
        .filter((condition) => condition.length > 0),
    );

  return conditions.length > 0 ? `HAVING ${conditions.join("\n AND ")}` : "";
}

async function resolveSavedView(
  client: Queryable,
  savedViewId: string | undefined,
): Promise<SavedViewDefinition | undefined> {
  if (!savedViewId) {
    return undefined;
  }

  const savedView = findBuiltInSavedView(savedViewId);
  if (!savedView) {
    const result = await client.query<SavedViewRow>(
      `
        SELECT id, label, tone, kind, keywords, match_config
        FROM saved_views
        WHERE id = $1
          AND enabled = TRUE
        LIMIT 1
      `,
      [savedViewId],
    );
    if (!result.rows[0]) {
      throw new InvalidMailSavedViewError();
    }
    return savedViewFromRow(result.rows[0]);
  }

  return savedView;
}

function appendSavedViewFilter(
  values: unknown[],
  savedView: SavedViewDefinition | undefined,
): SavedViewSql {
  if (!savedView) {
    return { whereClause: "", havingClause: "" };
  }

  if (savedView.minAttachmentCount !== undefined) {
    const parameter = `$${values.length + 1}`;
    values.push(savedView.minAttachmentCount);
    return {
      whereClause: "",
      havingClause: `HAVING COUNT(DISTINCT attachments.id) >= ${parameter}::int`,
    };
  }

  const viewIdParameter = `$${values.length + 1}`;
  values.push(savedView.id);
  const keywordParameter = `$${values.length + 1}`;
  values.push(savedView.keywords);
  return {
    whereClause: `
            AND (
              EXISTS (
                SELECT 1
                FROM hermes_rules saved_view_label_rules
                JOIN label_assignments saved_view_labels
                  ON saved_view_labels.message_id = messages.id
                 AND saved_view_labels.label_id::text = saved_view_label_rules.action->>'labelId'
                WHERE saved_view_label_rules.account_id = messages.account_id
                  AND saved_view_label_rules.enabled = TRUE
                  AND saved_view_label_rules.rule_type = 'content_label'
                  AND saved_view_label_rules.action->>'type' = 'apply_label'
                  AND saved_view_label_rules.action->'savedView'->>'id' = ${viewIdParameter}::text
              )
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM hermes_rules saved_view_label_rule_presence
                  WHERE saved_view_label_rule_presence.account_id = messages.account_id
                    AND saved_view_label_rule_presence.enabled = TRUE
                    AND saved_view_label_rule_presence.rule_type = 'content_label'
                    AND saved_view_label_rule_presence.action->>'type' = 'apply_label'
                    AND saved_view_label_rule_presence.action->'savedView'->>'id' = ${viewIdParameter}::text
                )
                AND EXISTS (
                  SELECT 1
                  FROM unnest(${keywordParameter}::text[]) AS saved_view_keyword(keyword)
                  WHERE messages.subject ILIKE '%' || saved_view_keyword.keyword || '%'
                    OR messages.from_email ILIKE '%' || saved_view_keyword.keyword || '%'
                    OR COALESCE(messages.from_name, '') ILIKE '%' || saved_view_keyword.keyword || '%'
                    OR COALESCE(messages.snippet, '') ILIKE '%' || saved_view_keyword.keyword || '%'
                    OR COALESCE(attachments.filename, '') ILIKE '%' || saved_view_keyword.keyword || '%'
                    OR COALESCE(search_documents.raw_text, '') ILIKE '%' || saved_view_keyword.keyword || '%'
                    OR COALESCE(message_classification.reasons::text, '') ILIKE '%' || saved_view_keyword.keyword || '%'
                )
              )
            )
    `,
    havingClause: "",
  };
}

function savedViewFromRow(row: SavedViewRow): SavedViewDefinition {
  const minAttachmentCount = readMinAttachmentCount(row.match_config);
  return {
    id: row.id,
    label: row.label,
    tone: row.tone,
    kind: row.kind,
    keywords: toStringArray(row.keywords),
    ...(minAttachmentCount === undefined ? {} : { minAttachmentCount }),
  };
}

function readMinAttachmentCount(
  matchConfig: Record<string, unknown> | null | undefined,
): number | undefined {
  const value = matchConfig?.minAttachmentCount;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function rowToMailbox(row: MailboxRow): MailboxDto {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    role: row.role,
    messageCount: toNumber(row.message_count),
    unreadCount: toNumber(row.unread_count),
  };
}

async function getMessageDetail(
  client: Queryable,
  input: GetMessageInput,
): Promise<MessageDetailDto | undefined> {
  const result = await client.query<MessageDetailRow>(
    `
      SELECT
        messages.id,
        messages.account_id,
        messages.subject,
        messages.from_email,
        messages.from_name,
        messages.to_emails,
        messages.cc_emails,
        messages.received_at,
        messages.snippet,
        messages.body_text,
        messages.body_html,
        COALESCE(message_state.unread, TRUE) AS unread,
        COALESCE(message_state.starred, FALSE) AS starred,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT mailboxes.id), NULL) AS mailbox_ids,
        COUNT(DISTINCT attachments.id) AS attachment_count,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'id', attachments.id,
              'filename', attachments.filename,
              'contentType', attachments.content_type,
              'byteSize', attachments.byte_size,
              'contentId', attachments.content_id,
              'embedded', attachments.embedded,
              'inline', attachments.inline
            )
          ) FILTER (WHERE attachments.id IS NOT NULL),
          '[]'::jsonb
        ) AS attachments
      FROM messages
      JOIN message_state
        ON message_state.message_id = messages.id
      LEFT JOIN message_locations
        ON message_locations.message_id = messages.id
      LEFT JOIN mailboxes
        ON mailboxes.id = message_locations.mailbox_id
       AND mailboxes.account_id = messages.account_id
      LEFT JOIN attachments
        ON attachments.message_id = messages.id
      WHERE messages.account_id = $1
        AND messages.id = $2
        AND message_state.deleted_at IS NULL
      GROUP BY
        messages.id,
        messages.account_id,
        messages.subject,
        messages.from_email,
        messages.from_name,
        messages.to_emails,
        messages.cc_emails,
        messages.received_at,
        messages.snippet,
        messages.body_text,
        messages.body_html,
        message_state.unread,
        message_state.starred
    `,
    [input.accountId, input.messageId],
  );

  return result.rows[0] ? rowToMessageDetail(result.rows[0]) : undefined;
}

function hasReadableBody(message: MessageDetailDto): boolean {
  return Boolean(message.bodyText?.trim() || message.bodyHtml?.trim());
}

function rowToMessageListItem(row: MessageListRow): MessageListItemDto {
  return {
    id: row.id,
    accountId: row.account_id,
    subject: row.subject,
    from: {
      email: row.from_email,
      ...(row.from_name ? { name: row.from_name } : {}),
    },
    receivedAt: toIsoString(row.received_at),
    ...(row.snippet ? { snippet: row.snippet } : {}),
    unread: row.unread ?? true,
    starred: row.starred ?? false,
    mailboxIds: toStringArray(row.mailbox_ids),
    attachmentCount: toNumber(row.attachment_count),
    classification: {
      bucket: row.bucket ?? "P4 FYI / Updates",
      priorityScore: row.priority_score ? toNumber(row.priority_score) : 0,
      reasons: toStringArray(row.reasons),
    },
    ...(row.search_preview
      ? {
          searchPreview: {
            source: "indexed_text" as const,
            text: normalizePreview(row.search_preview),
          },
        }
      : {}),
  };
}

function rowToMessageDetail(row: MessageDetailRow): MessageDetailDto {
  return {
    ...rowToMessageListItem(row),
    to: toStringArray(row.to_emails),
    cc: toStringArray(row.cc_emails),
    ...(row.body_text ? { bodyText: row.body_text } : {}),
    ...(row.body_html ? { bodyHtml: row.body_html } : {}),
    attachments: toAttachmentDtos(row.attachments),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toAttachmentDtos(value: unknown): AttachmentDto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.filename !== "string" ||
      typeof record.contentType !== "string"
    ) {
      return [];
    }

    return [
      {
        id: record.id,
        filename: record.filename,
        contentType: record.contentType,
        byteSize:
          typeof record.byteSize === "number"
            ? record.byteSize
            : Number.parseInt(String(record.byteSize ?? 0), 10),
        ...(typeof record.contentId === "string"
          ? { contentId: record.contentId }
          : {}),
        embedded: record.embedded === true,
        inline: record.inline === true,
      },
    ];
  });
}

function rowToAttachmentDownload(
  row: AttachmentDownloadRow,
): AttachmentDownloadRef {
  return {
    id: row.id,
    accountId: row.account_id,
    providerAttachmentId: row.provider_attachment_id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: toNumber(row.byte_size),
  };
}
