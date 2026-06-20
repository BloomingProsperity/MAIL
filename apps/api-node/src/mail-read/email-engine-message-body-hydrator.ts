import type { GetMessageInput, MessageBodyHydrator } from "./mail-read-store.js";
import type { Queryable } from "./postgres-mail-read-store.js";

export interface EmailEngineMessageBodyHydratorOptions {
  client: Queryable;
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

interface ProviderMessageRefRow extends Record<string, unknown> {
  provider_message_id?: string | null;
}

export function createEmailEngineMessageBodyHydrator(
  options: EmailEngineMessageBodyHydratorOptions,
): MessageBodyHydrator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    async hydrateMessageBody(input: GetMessageInput) {
      const providerMessageId = await readEmailEngineMessageId(
        options.client,
        input,
      );
      if (!providerMessageId) {
        return;
      }

      const message = await fetchEmailEngineMessage({
        fetchImpl,
        baseUrl,
        accessToken: options.accessToken,
        accountId: input.accountId,
        providerMessageId,
      });
      const body = normalizeEmailEngineMessageBody(message);
      if (!body.snippet && !body.bodyText && !body.bodyHtml) {
        return;
      }

      await updateMessageBody(options.client, input, body);
      await updateSearchDocument(options.client, input);
    },
  };
}

async function readEmailEngineMessageId(
  client: Queryable,
  input: GetMessageInput,
): Promise<string | undefined> {
  const result = await client.query<ProviderMessageRefRow>(
    `
      SELECT provider_message_id
      FROM (
        SELECT provider_message_id, last_seen_at, id, 0 AS source_order
        FROM provider_message_refs
        WHERE account_id = $1
          AND message_id = $2
          AND provider = 'emailengine'
          AND provider_message_id IS NOT NULL
        UNION ALL
        SELECT provider_message_id, now() AS last_seen_at, id, 1 AS source_order
        FROM messages
        WHERE account_id = $1
          AND id = $2
          AND provider_message_id IS NOT NULL
      ) refs
      ORDER BY source_order, last_seen_at DESC, id DESC
      LIMIT 1
    `,
    [input.accountId, input.messageId],
  );

  return nonEmptyString(result.rows[0]?.provider_message_id);
}

async function fetchEmailEngineMessage(input: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  accessToken: string;
  accountId: string;
  providerMessageId: string;
}): Promise<unknown> {
  const params = new URLSearchParams();
  params.set("textType", "*");
  params.set("markAsSeen", "false");
  const response = await input.fetchImpl(
    `${input.baseUrl}/account/${encodeURIComponent(
      input.accountId,
    )}/message/${encodeURIComponent(input.providerMessageId)}?${params}`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`EmailEngine message body fetch failed: ${response.status}`);
  }

  return response.json();
}

function normalizeEmailEngineMessageBody(message: unknown): {
  snippet?: string;
  bodyText?: string;
  bodyHtml?: string;
} {
  const raw = asRecord(message);
  const text = asRecord(raw.text);
  return {
    ...(nonEmptyString(raw.preview) ?? nonEmptyString(raw.summary)
      ? { snippet: nonEmptyString(raw.preview) ?? nonEmptyString(raw.summary) }
      : {}),
    ...(nonEmptyString(text.plain) ?? nonEmptyString(raw.text)
      ? { bodyText: nonEmptyString(text.plain) ?? nonEmptyString(raw.text) }
      : {}),
    ...(nonEmptyString(text.html) ?? nonEmptyString(raw.html)
      ? { bodyHtml: nonEmptyString(text.html) ?? nonEmptyString(raw.html) }
      : {}),
  };
}

async function updateMessageBody(
  client: Queryable,
  input: GetMessageInput,
  body: {
    snippet?: string;
    bodyText?: string;
    bodyHtml?: string;
  },
): Promise<void> {
  await client.query(
    `
      UPDATE messages
      SET
        snippet = COALESCE($3, messages.snippet),
        body_text = COALESCE($4, messages.body_text),
        body_html = COALESCE($5, messages.body_html)
      WHERE account_id = $1
        AND id = $2
    `,
    [
      input.accountId,
      input.messageId,
      body.snippet ?? null,
      body.bodyText ?? null,
      body.bodyHtml ?? null,
    ],
  );
}

async function updateSearchDocument(
  client: Queryable,
  input: GetMessageInput,
): Promise<void> {
  await client.query(
    `
      WITH selected_message AS (
        SELECT
          messages.id,
          concat_ws(
            E'\n',
            messages.subject,
            messages.from_email,
            messages.from_name,
            array_to_string(messages.to_emails, E'\n'),
            array_to_string(messages.cc_emails, E'\n'),
            messages.snippet,
            messages.body_text
          ) AS raw_text
        FROM messages
        WHERE messages.account_id = $1
          AND messages.id = $2
      )
      INSERT INTO search_documents (
        message_id,
        raw_text,
        document,
        updated_at
      )
      SELECT
        selected_message.id,
        selected_message.raw_text,
        to_tsvector('simple', selected_message.raw_text),
        now()
      FROM selected_message
      ON CONFLICT (message_id) DO UPDATE
      SET
        raw_text = EXCLUDED.raw_text,
        document = EXCLUDED.document,
        updated_at = now()
    `,
    [input.accountId, input.messageId],
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
