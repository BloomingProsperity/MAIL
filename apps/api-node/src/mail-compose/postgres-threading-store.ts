import type {
  MailThreading,
  MailThreadingAction,
  MailThreadingMetadataStore,
} from "./mail-compose.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface ThreadingRow extends Record<string, unknown> {
  internet_message_id: string | null;
  rfc_in_reply_to_message_id: string | null;
  rfc_references_message_ids: unknown;
  provider_message_id: string | null;
  emailengine_email_id: string | null;
  emailengine_message_id: string | null;
  gmail_thread_id: string | null;
  graph_message_id: string | null;
}

export function createPostgresMailThreadingStore(
  client: Queryable,
): MailThreadingMetadataStore {
  return {
    async getThreadingMetadata(input) {
      const result = await client.query<ThreadingRow>(
        `
          SELECT
            messages.internet_message_id,
            messages.rfc_in_reply_to_message_id,
            messages.rfc_references_message_ids,
            messages.provider_message_id,
            emailengine_ref.emailengine_email_id,
            emailengine_ref.provider_message_id AS emailengine_message_id,
            gmail_ref.gmail_thread_id,
            graph_ref.graph_message_id
          FROM messages
          JOIN message_state
            ON message_state.message_id = messages.id
          LEFT JOIN LATERAL (
            SELECT
              provider_message_refs.emailengine_email_id,
              provider_message_refs.provider_message_id
            FROM provider_message_refs
            WHERE provider_message_refs.account_id = messages.account_id
              AND provider_message_refs.message_id = messages.id
              AND provider_message_refs.provider = 'emailengine'
            ORDER BY provider_message_refs.last_seen_at DESC, provider_message_refs.id DESC
            LIMIT 1
          ) AS emailengine_ref ON TRUE
          LEFT JOIN LATERAL (
            SELECT provider_message_refs.gmail_thread_id
            FROM provider_message_refs
            WHERE provider_message_refs.account_id = messages.account_id
              AND provider_message_refs.message_id = messages.id
              AND provider_message_refs.provider = 'gmail'
            ORDER BY provider_message_refs.last_seen_at DESC, provider_message_refs.id DESC
            LIMIT 1
          ) AS gmail_ref ON TRUE
          LEFT JOIN LATERAL (
            SELECT provider_message_refs.graph_message_id
            FROM provider_message_refs
            WHERE provider_message_refs.account_id = messages.account_id
              AND provider_message_refs.message_id = messages.id
              AND provider_message_refs.provider = 'graph'
            ORDER BY provider_message_refs.last_seen_at DESC, provider_message_refs.id DESC
            LIMIT 1
          ) AS graph_ref ON TRUE
          WHERE messages.account_id = $1
            AND messages.id = $2
            AND message_state.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM message_locations
              JOIN mailboxes
                ON mailboxes.id = message_locations.mailbox_id
              WHERE message_locations.message_id = messages.id
                AND mailboxes.account_id = messages.account_id
            )
          LIMIT 1
        `,
        [input.accountId, input.messageId],
      );

      return result.rows[0]
        ? rowToThreading(result.rows[0], input.action)
        : undefined;
    },
  };
}

function rowToThreading(
  row: ThreadingRow,
  action: MailThreadingAction,
): MailThreading {
  const inReplyTo = normalizeMessageId(row.internet_message_id);
  const parentInReplyTo = normalizeMessageId(row.rfc_in_reply_to_message_id);
  const references = uniqueMessageIds([
    ...messageIdArray(row.rfc_references_message_ids),
    ...(parentInReplyTo ? [parentInReplyTo] : []),
    ...(inReplyTo ? [inReplyTo] : []),
  ]);
  const emailEngineMessageId =
    readString(row.emailengine_email_id) ?? readString(row.emailengine_message_id);
  const gmailThreadId = readString(row.gmail_thread_id);
  const graphMessageId = readString(row.graph_message_id);
  const threading: MailThreading = {
    action,
    references,
  };
  if (inReplyTo) {
    threading.inReplyTo = inReplyTo;
  }
  if (emailEngineMessageId) {
    threading.emailEngineMessageId = emailEngineMessageId;
  }
  if (gmailThreadId) {
    threading.gmailThreadId = gmailThreadId;
  }
  if (graphMessageId) {
    threading.graphMessageId = graphMessageId;
  }

  return threading;
}

function messageIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeMessageId)
    .filter((item): item is string => Boolean(item));
}

function uniqueMessageIds(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeMessageId(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    return undefined;
  }
  const stripped = trimmed.replace(/^<|>$/g, "").trim();
  if (!stripped.includes("@") || /[\s<>]/.test(stripped)) {
    return undefined;
  }

  return `<${stripped}>`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
