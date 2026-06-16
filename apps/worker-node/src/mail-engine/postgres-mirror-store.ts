import { randomUUID } from "node:crypto";

import type {
  MirrorStore,
  MirrorProvider,
  RecordMessageDeletedInput,
  UpsertMailboxesInput,
  UpsertMessageInput,
} from "./mirror-store.js";
import type {
  ProviderMailboxIdentity,
  ProviderMessageIdentity,
} from "../mail-provider/contract.js";
import { createPostgresProviderRefStore } from "../provider-ref-store.js";
import {
  classifySmartInboxMessage,
  type SmartInboxHermesRule,
  type SmartInboxSenderRule,
} from "../smart-inbox/classifier.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface MailboxRow extends Record<string, unknown> {
  id: string;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
}

interface SmartInboxSenderRuleRow extends Record<string, unknown> {
  rule_type: string;
}

interface SenderScreeningRuleRow extends Record<string, unknown> {
  status: string;
  scope: string;
}

interface GatekeeperSettingsRow extends Record<string, unknown> {
  mode: string;
}

interface HermesClassificationRuleRow extends Record<string, unknown> {
  action: Record<string, unknown>;
}

interface HermesContentLabelRuleRow extends Record<string, unknown> {
  id: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
}

interface HermesContentLabelRule {
  id: string;
  labelId: string;
  keywords: string[];
}

export function createPostgresMirrorStore(client: Queryable): MirrorStore {
  const providerRefStore = createPostgresProviderRefStore(client);

  return {
    async upsertMailboxes(input: UpsertMailboxesInput) {
      for (const mailbox of input.mailboxes) {
        const normalizedMailbox = normalizeMailbox(input.provider, mailbox);
        if (!normalizedMailbox) {
          continue;
        }

        const raw = normalizedMailbox.raw;
        const providerMailboxId = normalizedMailbox.providerMailboxId;
        if (!providerMailboxId) {
          continue;
        }

        const generatedId = randomUUID();
        const name = normalizedMailbox.name;
        const role = normalizedMailbox.role;
        const result = await client.query<MailboxRow>(
          `
            INSERT INTO mailboxes (
              id,
              account_id,
              provider_mailbox_id,
              name,
              role
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id, provider_mailbox_id) DO UPDATE
            SET
              name = EXCLUDED.name,
              role = EXCLUDED.role
            RETURNING id
          `,
          [generatedId, input.engineAccountId, providerMailboxId, name, role],
        );

        await client.query(
          `
            INSERT INTO provider_mailbox_refs (
              id,
              mailbox_id,
              account_id,
              provider,
              provider_mailbox_id,
              display_name,
              role,
              raw_ref,
              last_seen_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
            ON CONFLICT (account_id, provider, provider_mailbox_id) DO UPDATE
            SET
              mailbox_id = COALESCE(EXCLUDED.mailbox_id, provider_mailbox_refs.mailbox_id),
              display_name = EXCLUDED.display_name,
              role = EXCLUDED.role,
              raw_ref = EXCLUDED.raw_ref,
              last_seen_at = now()
          `,
          [
            randomUUID(),
            result.rows[0]?.id ?? generatedId,
            input.engineAccountId,
            input.provider,
            providerMailboxId,
            name,
            role,
            raw,
          ],
        );
      }
    },

    async upsertMessage(input: UpsertMessageInput) {
      const message = normalizeMessage(
        input.provider,
        input.message,
        input.providerIdentity,
        input.mailboxPath,
        input.mailboxIdentity,
      );
      const existingMessageId = await findExistingMessageId(
        client,
        input.engineAccountId,
        input.provider,
        message,
        input.providerIdentity,
      );
      const result = existingMessageId
        ? await updateExistingMessage(
            client,
            input.engineAccountId,
            existingMessageId,
            message,
          )
        : await insertMessage(client, input.engineAccountId, message);
      const providerIdentity = providerIdentityForMessage(
        input.provider,
        message,
        input.providerIdentity,
      );

      const messageId = result.rows[0]?.id;
      if (!messageId) {
        throw new Error("message upsert returned no id");
      }

      await client.query(
        `
          INSERT INTO message_state (message_id, unread, starred)
          VALUES ($1, $2, $3)
          ON CONFLICT (message_id) DO UPDATE
          SET
            unread = EXCLUDED.unread,
            starred = EXCLUDED.starred,
            deleted_at = NULL,
            updated_at = now()
        `,
        [messageId, message.unread, message.starred],
      );

      for (const mailboxPath of message.mailboxPaths) {
        await upsertMessageLocation(
          client,
          input.engineAccountId,
          messageId,
          mailboxPath,
        );
      }

      await replaceAttachments(
        client,
        input.engineAccountId,
        input.provider,
        messageId,
        message.attachments,
      );
      await upsertSearchDocument(client, messageId, message);
      await upsertHermesContentLabelAssignments(
        client,
        input.engineAccountId,
        messageId,
        message,
      );

      await providerRefStore.upsertMessageRef({
        accountId: input.engineAccountId,
        messageId,
        identity: providerIdentity,
        rawRef: input.message,
      });

      await upsertMessageClassification(
        client,
        input.engineAccountId,
        messageId,
        message,
      );
    },

    async recordMessageDeleted(input: RecordMessageDeletedInput) {
      const mailboxPath =
        input.mailboxPath ??
        providerMailboxIdFromIdentity(input.mailboxIdentity) ??
        imapMailboxPath(input.providerIdentity);
      const providerIdentity =
        input.providerIdentity ??
        ({
          provider: input.provider,
          messageId: input.providerMessageId,
          ...(mailboxPath ? { mailboxPath } : {}),
        } satisfies Record<string, unknown>);
      await client.query(
        `
          INSERT INTO provider_message_tombstones (
            id,
            account_id,
            provider,
            provider_identity,
            provider_message_id,
            provider_mailbox_id,
            deleted_at,
            idempotency_key,
            raw_event
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (idempotency_key) DO UPDATE
          SET
            deleted_at = EXCLUDED.deleted_at,
            provider_mailbox_id = COALESCE(EXCLUDED.provider_mailbox_id, provider_message_tombstones.provider_mailbox_id),
            raw_event = EXCLUDED.raw_event
        `,
        [
          randomUUID(),
          input.engineAccountId,
          input.provider,
          providerIdentity,
          input.providerMessageId,
          mailboxPath,
          input.deletedAt,
          input.idempotencyKey,
          {},
        ],
      );

      if (!mailboxPath) {
      await deleteAllMessageLocationsForProviderMessage(
        client,
        input.engineAccountId,
        input.provider,
        input.providerMessageId,
        input.providerIdentity,
      );

      await markProviderMessageDeleted(
        client,
        input.engineAccountId,
        input.provider,
        input.deletedAt,
        input.providerMessageId,
        input.providerIdentity,
      );
      return;
    }

      await deleteMessageLocation(
        client,
        input.engineAccountId,
        input.provider,
        input.providerMessageId,
        mailboxPath,
        input.providerIdentity,
      );

      await markProviderMessageDeletedIfUnlocated(
        client,
        input.engineAccountId,
        input.provider,
        input.deletedAt,
        input.providerMessageId,
        input.providerIdentity,
      );
    },
  };
}

async function upsertSearchDocument(
  client: Queryable,
  messageId: string,
  message: NormalizedMirrorMessage,
): Promise<void> {
  const rawText = [
    message.subject,
    message.fromEmail,
    message.fromName,
    ...message.toEmails,
    ...message.ccEmails,
    message.snippet,
    message.bodyText,
    ...message.attachments.map((attachment) => attachment.filename),
  ]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .join("\n");

  await client.query(
    `
      INSERT INTO search_documents (
        message_id,
        raw_text,
        document,
        updated_at
      )
      VALUES ($1, $2, to_tsvector('simple', $2), now())
      ON CONFLICT (message_id) DO UPDATE
      SET
        raw_text = EXCLUDED.raw_text,
        document = EXCLUDED.document,
        updated_at = now()
    `,
    [messageId, rawText],
  );
}

async function upsertHermesContentLabelAssignments(
  client: Queryable,
  accountId: string,
  messageId: string,
  message: NormalizedMirrorMessage,
): Promise<void> {
  const rules = await loadHermesContentLabelRules(client, accountId);
  const labelIds = uniqueStrings(
    rules
      .filter((rule) => contentLabelRuleMatchesMessage(rule, message))
      .map((rule) => rule.labelId),
  );
  if (labelIds.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO label_assignments (message_id, label_id)
      SELECT messages.id, labels.id
      FROM messages
      JOIN message_state
        ON message_state.message_id = messages.id
      JOIN labels
        ON labels.account_id = messages.account_id
      WHERE messages.id = $1
        AND messages.account_id = $2
        AND message_state.deleted_at IS NULL
        AND labels.account_id = $2
        AND labels.id = ANY($3::uuid[])
      ON CONFLICT (message_id, label_id) DO NOTHING
    `,
    [messageId, accountId, labelIds],
  );
}

async function upsertMessageLocation(
  client: Queryable,
  accountId: string,
  messageId: string,
  mailboxPath: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO message_locations (message_id, mailbox_id)
      SELECT $1, id
      FROM mailboxes
      WHERE account_id = $2
        AND provider_mailbox_id = $3
      ON CONFLICT (message_id, mailbox_id) DO NOTHING
    `,
    [messageId, accountId, mailboxPath],
  );
}

async function deleteMessageLocation(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  providerMessageId: string,
  mailboxPath: string,
  providerIdentity?: ProviderMessageIdentity,
): Promise<void> {
  const locator = providerMessageRefLocator(
    provider,
    providerMessageId,
    providerIdentity,
    "$3",
    "$4",
    "$5",
  );
  await client.query(
    `
      DELETE FROM message_locations
      USING provider_message_refs, mailboxes
      WHERE provider_message_refs.account_id = $1
        AND provider_message_refs.provider = $2
        AND ${locator.sql}
        AND provider_message_refs.message_id = message_locations.message_id
        AND mailboxes.id = message_locations.mailbox_id
        AND mailboxes.account_id = $1
        AND mailboxes.provider_mailbox_id = $4
    `,
    [
      accountId,
      provider,
      providerMessageId,
      mailboxPath,
      ...locator.extraValues,
    ],
  );
}

async function deleteAllMessageLocationsForProviderMessage(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  providerMessageId: string,
  providerIdentity?: ProviderMessageIdentity,
): Promise<void> {
  const mailboxPath = imapMailboxPath(providerIdentity);
  const locator = providerMessageRefLocator(
    provider,
    providerMessageId,
    providerIdentity,
    "$3",
    "$4",
    "$5",
  );
  await client.query(
    `
      DELETE FROM message_locations
      USING provider_message_refs, mailboxes
      WHERE provider_message_refs.account_id = $1
        AND provider_message_refs.provider = $2
        AND ${locator.sql}
        AND provider_message_refs.message_id = message_locations.message_id
        AND mailboxes.id = message_locations.mailbox_id
        AND mailboxes.account_id = $1
    `,
    locator.extraValues.length > 0
      ? [accountId, provider, providerMessageId, mailboxPath, ...locator.extraValues]
      : [accountId, provider, providerMessageId],
  );
}

async function markProviderMessageDeleted(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  deletedAt: string,
  providerMessageId: string,
  providerIdentity?: ProviderMessageIdentity,
): Promise<void> {
  const mailboxPath = imapMailboxPath(providerIdentity);
  const locator = providerMessageRefLocator(
    provider,
    providerMessageId,
    providerIdentity,
    "$4",
    "$5",
    "$6",
  );
  await client.query(
    `
      UPDATE message_state
      SET deleted_at = $3::timestamptz, updated_at = now()
      WHERE message_state.message_id IN (
        SELECT message_id
        FROM provider_message_refs
        WHERE account_id = $1
          AND provider = $2
          AND ${locator.sql}
          AND message_id IS NOT NULL
      )
    `,
    locator.extraValues.length > 0
      ? [
          accountId,
          provider,
          deletedAt,
          providerMessageId,
          mailboxPath,
          ...locator.extraValues,
        ]
      : [accountId, provider, deletedAt, providerMessageId],
  );
}

async function markProviderMessageDeletedIfUnlocated(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  deletedAt: string,
  providerMessageId: string,
  providerIdentity?: ProviderMessageIdentity,
): Promise<void> {
  const mailboxPath = imapMailboxPath(providerIdentity);
  const locator = providerMessageRefLocator(
    provider,
    providerMessageId,
    providerIdentity,
    "$4",
    "$5",
    "$6",
  );
  await client.query(
    `
      UPDATE message_state
      SET deleted_at = $3::timestamptz, updated_at = now()
      WHERE message_state.message_id IN (
        SELECT message_id
        FROM provider_message_refs
        WHERE account_id = $1
          AND provider = $2
          AND ${locator.sql}
          AND message_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM message_locations
        WHERE message_locations.message_id = message_state.message_id
      )
    `,
    locator.extraValues.length > 0
      ? [
          accountId,
          provider,
          deletedAt,
          providerMessageId,
          mailboxPath,
          ...locator.extraValues,
        ]
      : [accountId, provider, deletedAt, providerMessageId],
  );
}

async function findExistingMessageId(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  message: NormalizedMirrorMessage,
  providerIdentity?: ProviderMessageIdentity,
): Promise<string | undefined> {
  if (provider === "emailengine" && message.emailId) {
    const byEmailEngineEmailId = await client.query<MessageRow>(
      `
        SELECT message_id AS id
        FROM provider_message_refs
        WHERE account_id = $1
          AND provider = $2
          AND emailengine_email_id = $3
          AND message_id IS NOT NULL
        ORDER BY last_seen_at DESC
        LIMIT 1
      `,
      [accountId, provider, message.emailId],
    );

    if (byEmailEngineEmailId.rows[0]?.id) {
      return byEmailEngineEmailId.rows[0].id;
    }
  }

  if (provider !== "emailengine" && providerIdentity) {
    const lookup = providerMessageRefLookup(providerIdentity);
    const byNativeRef = await client.query<MessageRow>(
      `
        SELECT message_id AS id
        FROM provider_message_refs
        WHERE account_id = $1
          AND provider = $2
          AND ${lookup.sql}
          AND message_id IS NOT NULL
        ORDER BY last_seen_at DESC
        LIMIT 1
      `,
      [accountId, provider, ...lookup.values],
    );

    if (byNativeRef.rows[0]?.id) {
      return byNativeRef.rows[0].id;
    }
  }

  if (message.internetMessageId) {
    const byInternetMessageId = await client.query<MessageRow>(
      `
        SELECT id
        FROM messages
        WHERE account_id = $1
          AND internet_message_id = $2
        ORDER BY received_at DESC
        LIMIT 1
      `,
      [accountId, message.internetMessageId],
    );

    if (byInternetMessageId.rows[0]?.id) {
      return byInternetMessageId.rows[0].id;
    }
  }

  return undefined;
}

async function insertMessage(
  client: Queryable,
  accountId: string,
  message: NormalizedMirrorMessage,
): Promise<QueryResult<MessageRow>> {
  return client.query<MessageRow>(
    `
      INSERT INTO messages (
        id,
        account_id,
        provider_message_id,
        internet_message_id,
        rfc_in_reply_to_message_id,
        rfc_references_message_ids,
        subject,
        from_email,
        from_name,
        to_emails,
        cc_emails,
        received_at,
        snippet,
        body_text,
        body_html
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (account_id, provider_message_id) DO UPDATE
      SET
        internet_message_id = COALESCE(EXCLUDED.internet_message_id, messages.internet_message_id),
        rfc_in_reply_to_message_id = COALESCE(EXCLUDED.rfc_in_reply_to_message_id, messages.rfc_in_reply_to_message_id),
        rfc_references_message_ids = CASE
          WHEN cardinality(EXCLUDED.rfc_references_message_ids) > 0
            THEN EXCLUDED.rfc_references_message_ids
          ELSE messages.rfc_references_message_ids
        END,
        subject = EXCLUDED.subject,
        from_email = EXCLUDED.from_email,
        from_name = EXCLUDED.from_name,
        to_emails = EXCLUDED.to_emails,
        cc_emails = EXCLUDED.cc_emails,
        received_at = EXCLUDED.received_at,
        snippet = EXCLUDED.snippet,
        body_text = EXCLUDED.body_text,
        body_html = EXCLUDED.body_html
      RETURNING id
    `,
    [
      randomUUID(),
      accountId,
      message.id,
      message.internetMessageId,
      message.inReplyToMessageId,
      message.referenceMessageIds,
      message.subject,
      message.fromEmail,
      message.fromName,
      message.toEmails,
      message.ccEmails,
      message.receivedAt,
      message.snippet,
      message.bodyText,
      message.bodyHtml,
    ],
  );
}

async function updateExistingMessage(
  client: Queryable,
  accountId: string,
  messageId: string,
  message: NormalizedMirrorMessage,
): Promise<QueryResult<MessageRow>> {
  return client.query<MessageRow>(
    `
      UPDATE messages
      SET
        provider_message_id = $3,
        internet_message_id = COALESCE($4, internet_message_id),
        rfc_in_reply_to_message_id = COALESCE($5, rfc_in_reply_to_message_id),
        rfc_references_message_ids = CASE
          WHEN cardinality($6::text[]) > 0 THEN $6::text[]
          ELSE rfc_references_message_ids
        END,
        subject = $7,
        from_email = $8,
        from_name = $9,
        to_emails = $10,
        cc_emails = $11,
        received_at = $12,
        snippet = $13,
        body_text = $14,
        body_html = $15
      WHERE id = $1
        AND account_id = $2
      RETURNING id
    `,
    [
      messageId,
      accountId,
      message.id,
      message.internetMessageId,
      message.inReplyToMessageId,
      message.referenceMessageIds,
      message.subject,
      message.fromEmail,
      message.fromName,
      message.toEmails,
      message.ccEmails,
      message.receivedAt,
      message.snippet,
      message.bodyText,
      message.bodyHtml,
    ],
  );
}

interface NormalizedMailbox {
  providerMailboxId: string;
  name: string;
  role: string;
  raw: Record<string, unknown>;
}

interface NormalizedMirrorMessage {
  id: string;
  mailboxPaths: string[];
  emailId?: string;
  internetMessageId?: string;
  inReplyToMessageId?: string;
  referenceMessageIds: string[];
  threadId?: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  toEmails: string[];
  ccEmails: string[];
  receivedAt: string;
  snippet?: string;
  bodyText?: string;
  bodyHtml?: string;
  unread: boolean;
  starred: boolean;
  attachments: NormalizedMirrorAttachment[];
}

interface NormalizedMirrorAttachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  contentId?: string;
  embedded: boolean;
  inline: boolean;
  encodedInMessage: boolean;
}

function normalizeMailbox(
  provider: MirrorProvider,
  mailbox: unknown,
): NormalizedMailbox | undefined {
  const wrapper = asRecord(mailbox);
  const nestedRaw = asRecord(wrapper.raw);
  const raw = Object.keys(nestedRaw).length > 0 ? nestedRaw : wrapper;
  const identity = providerMailboxIdentityFromUnknown(
    wrapper.identity ?? raw.identity,
  );
  const providerMailboxId =
    providerMailboxIdFromIdentity(identity) ??
    readString(raw.path) ??
    readString(raw.id) ??
    readString(raw.mailboxId) ??
    readString(wrapper.providerMailboxId);
  if (!providerMailboxId) {
    return undefined;
  }

  return {
    providerMailboxId,
    name:
      readString(wrapper.displayName) ??
      readString(raw.displayName) ??
      readString(raw.name) ??
      providerMailboxId,
    role:
      readString(wrapper.role) ??
      readString(raw.role) ??
      nativeMailboxRole(provider, providerMailboxId, raw),
    raw,
  };
}

function normalizeMessage(
  provider: MirrorProvider,
  message: unknown,
  providerIdentity?: ProviderMessageIdentity,
  mailboxPath?: string,
  mailboxIdentity?: ProviderMailboxIdentity,
): NormalizedMirrorMessage {
  if (provider === "gmail") {
    return normalizeGmailMessage(message, providerIdentity, mailboxIdentity);
  }
  if (provider === "graph") {
    return normalizeGraphMessage(message, providerIdentity, mailboxIdentity);
  }
  if (provider === "imap") {
    return normalizeImapMessage(message, providerIdentity, mailboxIdentity);
  }

  return normalizeEmailEngineMessage(message, mailboxPath);
}

function normalizeEmailEngineMessage(
  message: unknown,
  mailboxPath?: string,
): NormalizedMirrorMessage {
  const raw = asRecord(message);
  const from = asRecord(raw.from);
  const text = asRecord(raw.text);
  const headers = messageHeaders(raw.headers);

  const id = readString(raw.id) ?? readString(raw.messageId);
  if (!id) {
    throw new Error("EmailEngine message is missing id");
  }

  return {
    id,
    mailboxPaths: uniqueStrings([
      mailboxPath,
      readString(raw.path),
      readString(raw.mailbox),
    ]),
    emailId: readString(raw.emailId),
    internetMessageId: readString(raw.messageId),
    inReplyToMessageId: firstMessageId(
      raw.inReplyTo,
      raw.inReplyToMessageId,
      headers["in-reply-to"],
    ),
    referenceMessageIds: messageIdsFromHeader(
      raw.references,
      raw.referenceMessageIds,
      headers.references,
    ),
    threadId: readString(raw.threadId),
    subject: readString(raw.subject) ?? "",
    fromEmail: readString(from.address) ?? readString(raw.from) ?? "",
    fromName: readString(from.name),
    toEmails: addressList(raw.to),
    ccEmails: addressList(raw.cc),
    receivedAt:
      readString(raw.date) ??
      readString(raw.receivedAt) ??
      new Date(0).toISOString(),
    snippet: readString(raw.preview) ?? readString(raw.summary),
    bodyText: readString(text.plain) ?? readString(raw.text),
    bodyHtml: readString(text.html) ?? readString(raw.html),
    unread: flagList(raw.flags).includes("\\Seen") ? false : true,
    starred: flagList(raw.flags).includes("\\Flagged"),
    attachments: attachmentList(raw.attachments),
  };
}

function normalizeGmailMessage(
  message: unknown,
  providerIdentity?: ProviderMessageIdentity,
  mailboxIdentity?: ProviderMailboxIdentity,
): NormalizedMirrorMessage {
  const raw = asRecord(message);
  const headers = gmailHeaders(raw);
  const id =
    providerIdentity?.provider === "gmail"
      ? providerIdentity.messageId
      : readString(raw.id);
  if (!id) {
    throw new Error("Gmail message is missing id");
  }

  const from = parseMailboxAddress(readString(headers.from) ?? readString(raw.from));
  const text = asRecord(raw.text);
  const labelIds = stringArray(raw.labelIds);

  return {
    id,
    mailboxPaths: uniqueStrings([
      providerMailboxIdFromIdentity(mailboxIdentity),
      ...labelIds,
    ]),
    internetMessageId:
      readString(headers["message-id"]) ?? readString(raw.internetMessageId),
    inReplyToMessageId: firstMessageId(headers["in-reply-to"]),
    referenceMessageIds: messageIdsFromHeader(headers.references),
    threadId:
      providerIdentity?.provider === "gmail"
        ? providerIdentity.threadId
        : readString(raw.threadId),
    subject: readString(headers.subject) ?? readString(raw.subject) ?? "",
    fromEmail: from.email,
    fromName: from.name,
    toEmails: headerAddressList(headers.to),
    ccEmails: headerAddressList(headers.cc),
    receivedAt:
      dateFromUnixMs(raw.internalDate) ??
      readString(headers.date) ??
      readString(raw.date) ??
      readString(raw.receivedAt) ??
      new Date(0).toISOString(),
    snippet: readString(raw.snippet) ?? readString(raw.preview),
    bodyText: readString(text.plain) ?? readString(raw.bodyText),
    bodyHtml: readString(text.html) ?? readString(raw.bodyHtml),
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    attachments: attachmentList(raw.attachments),
  };
}

function normalizeGraphMessage(
  message: unknown,
  providerIdentity?: ProviderMessageIdentity,
  mailboxIdentity?: ProviderMailboxIdentity,
): NormalizedMirrorMessage {
  const raw = asRecord(message);
  const id =
    providerIdentity?.provider === "graph"
      ? providerIdentity.id
      : readString(raw.id);
  if (!id) {
    throw new Error("Graph message is missing id");
  }

  const from = graphEmailAddress(raw.from);
  const body = asRecord(raw.body);
  const headers = messageHeaders(raw.internetMessageHeaders);

  return {
    id,
    mailboxPaths: uniqueStrings([
      providerMailboxIdFromIdentity(mailboxIdentity),
      readString(raw.parentFolderId),
    ]),
    internetMessageId: readString(raw.internetMessageId),
    inReplyToMessageId: firstMessageId(headers["in-reply-to"]),
    referenceMessageIds: messageIdsFromHeader(headers.references),
    threadId:
      providerIdentity?.provider === "graph"
        ? providerIdentity.conversationId
        : readString(raw.conversationId),
    subject: readString(raw.subject) ?? "",
    fromEmail: from.email,
    fromName: from.name,
    toEmails: graphRecipientList(raw.toRecipients),
    ccEmails: graphRecipientList(raw.ccRecipients),
    receivedAt:
      readString(raw.receivedDateTime) ??
      readString(raw.sentDateTime) ??
      new Date(0).toISOString(),
    snippet: readString(raw.bodyPreview),
    bodyText:
      readString(body.contentType)?.toLowerCase() === "text"
        ? readString(body.content)
        : readString(raw.bodyText),
    bodyHtml:
      readString(body.contentType)?.toLowerCase() === "html"
        ? readString(body.content)
        : readString(raw.bodyHtml),
    unread: raw.isRead === false,
    starred:
      readString(asRecord(raw.flag).flagStatus)?.toLowerCase() === "flagged",
    attachments: attachmentList(raw.attachments),
  };
}

function normalizeImapMessage(
  message: unknown,
  providerIdentity?: ProviderMessageIdentity,
  mailboxIdentity?: ProviderMailboxIdentity,
): NormalizedMirrorMessage {
  const raw = asRecord(message);
  const envelope = asRecord(raw.envelope);
  const headers = messageHeaders(raw.headers);
  const identity =
    providerIdentity?.provider === "imap" ? providerIdentity : undefined;
  const fallbackMailboxPath =
    providerMailboxIdFromIdentity(mailboxIdentity) ??
    readString(raw.mailboxPath) ??
    readString(raw.path);
  const fallbackUidvalidity = readString(raw.uidvalidity);
  const fallbackUid = readString(raw.uid) ?? readString(raw.id);
  const id = identity
    ? localProviderMessageId(identity)
    : fallbackMailboxPath && fallbackUidvalidity && fallbackUid
      ? `imap:${fallbackMailboxPath}:${fallbackUidvalidity}:${fallbackUid}`
      : fallbackUid;
  if (!id) {
    throw new Error("IMAP message is missing uid");
  }

  const from = parseMailboxAddress(
    readString(raw.from) ?? readString(envelope.from),
  );
  const flags = flagList(raw.flags);

  return {
    id,
    mailboxPaths: uniqueStrings([
      providerMailboxIdFromIdentity(mailboxIdentity),
      identity?.mailbox.path,
      readString(raw.mailboxPath),
      readString(raw.path),
    ]),
    internetMessageId:
      readString(raw.messageId) ?? readString(envelope.messageId),
    inReplyToMessageId: firstMessageId(
      raw.inReplyTo,
      envelope.inReplyTo,
      headers["in-reply-to"],
    ),
    referenceMessageIds: messageIdsFromHeader(
      raw.references,
      envelope.references,
      headers.references,
    ),
    subject: readString(raw.subject) ?? readString(envelope.subject) ?? "",
    fromEmail: from.email,
    fromName: from.name,
    toEmails: addressList(raw.to),
    ccEmails: addressList(raw.cc),
    receivedAt:
      readString(raw.date) ??
      readString(envelope.date) ??
      readString(raw.receivedAt) ??
      new Date(0).toISOString(),
    snippet: readString(raw.preview) ?? readString(raw.snippet),
    bodyText: readString(raw.text) ?? readString(raw.bodyText),
    bodyHtml: readString(raw.html) ?? readString(raw.bodyHtml),
    unread: !flags.includes("\\Seen"),
    starred: flags.includes("\\Flagged"),
    attachments: attachmentList(raw.attachments),
  };
}

function providerIdentityForMessage(
  provider: MirrorProvider,
  message: NormalizedMirrorMessage,
  identity?: ProviderMessageIdentity,
): ProviderMessageIdentity {
  if (identity) {
    return identity;
  }

  if (provider === "emailengine") {
    return {
      provider,
      messageId: message.id,
      ...(message.emailId ? { emailId: message.emailId } : {}),
      ...(message.internetMessageId
        ? { internetMessageId: message.internetMessageId }
        : {}),
      ...(message.threadId ? { threadId: message.threadId } : {}),
    };
  }
  if (provider === "gmail") {
    return {
      provider,
      messageId: message.id,
      ...(message.threadId ? { threadId: message.threadId } : {}),
    };
  }
  if (provider === "graph") {
    return {
      provider,
      id: message.id,
      ...(message.threadId ? { conversationId: message.threadId } : {}),
    };
  }

  throw new Error("IMAP provider identity is required to mirror IMAP messages");
}

function localProviderMessageId(identity: ProviderMessageIdentity): string {
  switch (identity.provider) {
    case "emailengine":
      return identity.messageId;
    case "gmail":
      return identity.messageId;
    case "graph":
      return identity.id;
    case "imap":
      return `imap:${identity.mailbox.path}:${identity.uidvalidity}:${identity.uid}`;
  }
}

async function replaceAttachments(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  messageId: string,
  attachments: NormalizedMirrorAttachment[],
): Promise<void> {
  await client.query(
    `
      DELETE FROM attachments
      WHERE message_id = $1
    `,
    [messageId],
  );

  for (const attachment of attachments) {
    await client.query(
      `
        INSERT INTO attachments (
          id,
          message_id,
          provider_attachment_id,
          filename,
          content_type,
          byte_size,
          content_id,
          embedded,
          inline,
          encoded_in_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (message_id, provider_attachment_id) DO UPDATE
        SET
          filename = EXCLUDED.filename,
          content_type = EXCLUDED.content_type,
          byte_size = EXCLUDED.byte_size,
          content_id = EXCLUDED.content_id,
          embedded = EXCLUDED.embedded,
          inline = EXCLUDED.inline,
          encoded_in_message = EXCLUDED.encoded_in_message
      `,
      [
        randomUUID(),
        messageId,
        attachment.id,
        attachment.filename,
        attachment.contentType,
        attachment.byteSize,
        attachment.contentId ?? null,
        attachment.embedded,
        attachment.inline,
        attachment.encodedInMessage,
      ],
    );

    if (shouldExtractAttachmentText(attachment)) {
      await enqueueAttachmentTextExtractionJob(
        client,
        accountId,
        provider,
        messageId,
        attachment,
      );
    }
  }
}

const ATTACHMENT_TEXT_MAX_BYTES = 25_000_000;

const ATTACHMENT_TEXT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/rtf",
]);

function shouldExtractAttachmentText(
  attachment: NormalizedMirrorAttachment,
): boolean {
  if (attachment.inline || attachment.embedded) {
    return false;
  }
  if (attachment.byteSize <= 0 || attachment.byteSize > ATTACHMENT_TEXT_MAX_BYTES) {
    return false;
  }

  return ATTACHMENT_TEXT_CONTENT_TYPES.has(
    attachment.contentType.trim().toLowerCase(),
  );
}

async function enqueueAttachmentTextExtractionJob(
  client: Queryable,
  accountId: string,
  provider: MirrorProvider,
  messageId: string,
  attachment: NormalizedMirrorAttachment,
): Promise<void> {
  const idempotencyKey = `attachment-text:${accountId}:${messageId}:${attachment.id}`;
  await client.query(
    `
      INSERT INTO attachment_text_extraction_jobs (
        id,
        account_id,
        message_id,
        provider,
        provider_attachment_id,
        filename,
        content_type,
        byte_size,
        idempotency_key,
        status,
        not_before,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', now(), now())
      ON CONFLICT (idempotency_key) DO UPDATE
      SET
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        byte_size = EXCLUDED.byte_size,
        status = CASE
          WHEN attachment_text_extraction_jobs.status = 'done' THEN attachment_text_extraction_jobs.status
          ELSE 'queued'
        END,
        not_before = CASE
          WHEN attachment_text_extraction_jobs.status = 'done' THEN attachment_text_extraction_jobs.not_before
          ELSE now()
        END,
        error_message = NULL,
        updated_at = now()
    `,
    [
      randomUUID(),
      accountId,
      messageId,
      provider,
      attachment.id,
      attachment.filename,
      attachment.contentType,
      attachment.byteSize,
      idempotencyKey,
    ],
  );
}

async function upsertMessageClassification(
  client: Queryable,
  accountId: string,
  messageId: string,
  message: NormalizedMirrorMessage,
): Promise<void> {
  const senderRules = await loadSmartInboxSenderRules(
    client,
    accountId,
    message.fromEmail,
  );
  await ensureUnknownSenderScreeningRule(client, {
    accountId,
    messageId,
    senderEmail: message.fromEmail,
  });
  const screeningRules = await loadSenderScreeningRules(
    client,
    accountId,
    message.fromEmail,
  );
  const hermesRules = await loadHermesClassificationRules(
    client,
    accountId,
    message.fromEmail,
  );
  const classification = classifySmartInboxMessage({
    subject: message.subject,
    fromEmail: message.fromEmail,
    fromName: message.fromName,
    toEmails: message.toEmails,
    ccEmails: message.ccEmails,
    snippet: message.snippet,
    bodyText: message.bodyText,
    unread: message.unread,
    starred: message.starred,
    attachments: message.attachments,
    senderRules: [...screeningRules, ...senderRules],
    hermesRules,
  });

  await client.query(
    `
      INSERT INTO message_classification (
        message_id,
        bucket,
        priority_score,
        reasons,
        classified_by
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (message_id) DO UPDATE
      SET
        bucket = EXCLUDED.bucket,
        priority_score = EXCLUDED.priority_score,
        reasons = EXCLUDED.reasons,
        classified_by = EXCLUDED.classified_by,
        updated_at = now()
    `,
    [
      messageId,
      classification.bucket,
      classification.priorityScore,
      classification.reasons,
      classification.classifiedBy,
    ],
  );
}

async function ensureUnknownSenderScreeningRule(
  client: Queryable,
  input: {
    accountId: string;
    messageId: string;
    senderEmail: string;
  },
): Promise<void> {
  const mode = await loadGatekeeperMode(client, input.accountId);
  if (mode === "off_accept_all") {
    return;
  }

  const domain = domainFromEmail(input.senderEmail);
  if (!domain) {
    return;
  }

  await client.query(
    `
      INSERT INTO sender_screening_rules (
        id,
        account_id,
        scope,
        sender_email,
        domain,
        status,
        created_from_message_id
      )
      SELECT $1, $2, 'email', lower($3), lower($4), 'unknown', $5
      WHERE NOT EXISTS (
        SELECT 1
        FROM sender_screening_rules existing
        WHERE existing.account_id = $2
          AND (
            (
              existing.scope = 'email'
              AND lower(existing.sender_email) = lower($3)
            )
            OR (
              existing.scope = 'domain'
              AND lower(existing.domain) = lower($4)
            )
          )
      )
        AND NOT EXISTS (
          SELECT 1
          FROM smart_inbox_sender_rules existing_smart_rule
          WHERE existing_smart_rule.account_id = $2
            AND lower(existing_smart_rule.sender_email) = lower($3)
        )
      ON CONFLICT (account_id, lower(sender_email)) WHERE scope = 'email'
      DO NOTHING
    `,
    [
      randomUUID(),
      input.accountId,
      input.senderEmail,
      domain,
      input.messageId,
    ],
  );
}

async function loadGatekeeperMode(
  client: Queryable,
  accountId: string,
): Promise<"before_inbox" | "inside_email" | "off_accept_all"> {
  const result = await client.query<GatekeeperSettingsRow>(
    `
      SELECT mode
      FROM gatekeeper_settings
      WHERE account_id = $1
      LIMIT 1
    `,
    [accountId],
  );
  const mode = result.rows[0]?.mode;
  if (mode === "before_inbox" || mode === "inside_email") {
    return mode;
  }

  return "off_accept_all";
}

async function loadSmartInboxSenderRules(
  client: Queryable,
  accountId: string,
  senderEmail: string,
): Promise<SmartInboxSenderRule[]> {
  const result = await client.query<SmartInboxSenderRuleRow>(
    `
      SELECT rule_type
      FROM smart_inbox_sender_rules
      WHERE account_id = $1
        AND lower(sender_email) = lower($2)
    `,
    [accountId, senderEmail],
  );

  return result.rows.flatMap((row) =>
    isSmartInboxSenderRule(row.rule_type) ? [row.rule_type] : [],
  );
}

async function loadHermesClassificationRules(
  client: Queryable,
  accountId: string,
  senderEmail: string,
): Promise<SmartInboxHermesRule[]> {
  const result = await client.query<HermesClassificationRuleRow>(
    `
      SELECT action
      FROM hermes_rules
      WHERE account_id = $1
        AND lower(condition->>'senderEmail') = lower($2)
        AND enabled = TRUE
        AND action->>'type' = 'classify_sender'
      ORDER BY approved_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT 5
    `,
    [accountId, senderEmail],
  );

  return result.rows.flatMap((row) => hermesRuleFromAction(row.action));
}

async function loadHermesContentLabelRules(
  client: Queryable,
  accountId: string,
): Promise<HermesContentLabelRule[]> {
  const result = await client.query<HermesContentLabelRuleRow>(
    `
      SELECT id, condition, action
      FROM hermes_rules
      WHERE account_id = $1
        AND enabled = TRUE
        AND rule_type = 'content_label'
        AND action->>'type' = 'apply_label'
        AND action->>'labelId' IS NOT NULL
      ORDER BY approved_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT 100
    `,
    [accountId],
  );

  return result.rows.flatMap(contentLabelRuleFromRow);
}

async function loadSenderScreeningRules(
  client: Queryable,
  accountId: string,
  senderEmail: string,
): Promise<SmartInboxSenderRule[]> {
  const domain = domainFromEmail(senderEmail);
  const result = await client.query<SenderScreeningRuleRow>(
    `
      SELECT status, scope
      FROM sender_screening_rules
      WHERE account_id = $1
        AND (
          (scope = 'email' AND lower(sender_email) = lower($2))
          OR (scope = 'domain' AND lower(domain) = lower($3))
        )
        AND status IN ('unknown', 'blocked')
      ORDER BY
        CASE scope
          WHEN 'email' THEN 0
          ELSE 1
        END,
        updated_at DESC,
        id DESC
    `,
    [accountId, senderEmail, domain],
  );

  return result.rows.flatMap(screeningRuleToSenderRule);
}

function contentLabelRuleFromRow(
  row: HermesContentLabelRuleRow,
): HermesContentLabelRule[] {
  const labelId = row.action.labelId;
  if (typeof labelId !== "string" || labelId.trim().length === 0) {
    return [];
  }
  const keywords = Array.isArray(row.condition.anyKeywords)
    ? row.condition.anyKeywords.filter(
        (keyword): keyword is string =>
          typeof keyword === "string" && keyword.trim().length > 0,
      )
    : [];
  if (keywords.length === 0) {
    return [];
  }

  return [
    {
      id: row.id,
      labelId,
      keywords: uniqueStrings(keywords.map((keyword) => keyword.trim())),
    },
  ];
}

function contentLabelRuleMatchesMessage(
  rule: HermesContentLabelRule,
  message: NormalizedMirrorMessage,
): boolean {
  const haystack = [
    message.subject,
    message.fromEmail,
    message.fromName,
    ...message.toEmails,
    ...message.ccEmails,
    message.snippet,
    message.bodyText,
    ...message.attachments.map((attachment) => attachment.filename),
  ]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .join("\n")
    .toLowerCase();

  return rule.keywords.some((keyword) =>
    haystack.includes(keyword.trim().toLowerCase()),
  );
}

function screeningRuleToSenderRule(
  row: SenderScreeningRuleRow,
): SmartInboxSenderRule[] {
  if (row.status === "unknown") {
    return ["screen_unknown"];
  }
  if (row.status === "blocked" && row.scope === "domain") {
    return ["blocked_domain"];
  }
  if (row.status === "blocked") {
    return ["blocked_sender"];
  }

  return [];
}

function hermesRuleFromAction(
  action: Record<string, unknown>,
): SmartInboxHermesRule[] {
  if (
    typeof action.bucket !== "string" ||
    typeof action.priorityScore !== "number"
  ) {
    return [];
  }

  return [
    {
      bucket: action.bucket,
      priorityScore: action.priorityScore,
      ...(typeof action.reason === "string" ? { reason: action.reason } : {}),
    },
  ];
}

function isSmartInboxSenderRule(value: string): value is SmartInboxSenderRule {
  return (
    value === "always_important" ||
    value === "mute" ||
    value === "personal" ||
    value === "notifications" ||
    value === "newsletters" ||
    value === "feed" ||
    value === "screen_unknown" ||
    value === "blocked_sender" ||
    value === "blocked_domain"
  );
}

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function mailboxRole(raw: Record<string, unknown>): string {
  const specialUse = readString(raw.specialUse)?.toLowerCase();
  const path = readString(raw.path)?.toLowerCase();
  if (specialUse?.includes("sent") || path === "sent") return "sent";
  if (specialUse?.includes("draft") || path === "drafts") return "drafts";
  if (specialUse?.includes("junk") || path === "junk") return "junk";
  if (specialUse?.includes("trash") || path === "trash") return "trash";
  if (specialUse?.includes("archive") || path === "archive") return "archive";
  return "inbox";
}

function nativeMailboxRole(
  provider: MirrorProvider,
  providerMailboxId: string,
  raw: Record<string, unknown>,
): string {
  if (provider === "emailengine" || provider === "imap") {
    return mailboxRole(raw);
  }

  const marker = (
    readString(raw.wellKnownName) ??
    readString(raw.id) ??
    readString(raw.name) ??
    readString(raw.displayName) ??
    providerMailboxId
  ).toLowerCase();

  if (provider === "gmail") {
    if (marker === "inbox" || marker === "category_primary") return "inbox";
    if (marker === "sent") return "sent";
    if (marker === "draft") return "drafts";
    if (marker === "trash") return "trash";
    if (marker === "spam") return "junk";
    if (marker === "starred") return "starred";
    if (marker === "important") return "important";
    if (marker.startsWith("category_")) return "feed";
    return "label";
  }

  if (marker === "inbox") return "inbox";
  if (marker === "sentitems" || marker === "sent") return "sent";
  if (marker === "drafts") return "drafts";
  if (marker === "deleteditems" || marker === "trash") return "trash";
  if (marker === "junkemail" || marker === "junk") return "junk";
  if (marker === "archive") return "archive";
  return "label";
}

function providerMailboxIdentityFromUnknown(
  value: unknown,
): ProviderMailboxIdentity | undefined {
  const raw = asRecord(value);
  if (raw.provider === "gmail") {
    const labelId = readString(raw.labelId);
    return labelId ? { provider: "gmail", labelId } : undefined;
  }
  if (raw.provider === "graph") {
    const folderId = readString(raw.folderId);
    return folderId ? { provider: "graph", folderId } : undefined;
  }
  if (raw.provider === "imap") {
    const path = readString(raw.path);
    return path
      ? {
          provider: "imap",
          path,
          ...(readString(raw.delimiter)
            ? { delimiter: readString(raw.delimiter) }
            : {}),
        }
      : undefined;
  }

  return undefined;
}

function providerMailboxIdFromIdentity(
  identity?: ProviderMailboxIdentity,
): string | undefined {
  if (!identity) {
    return undefined;
  }
  switch (identity.provider) {
    case "gmail":
      return identity.labelId;
    case "graph":
      return identity.folderId;
    case "imap":
      return identity.path;
  }
}

function providerMessageIdFromIdentity(
  identity: ProviderMessageIdentity,
): string {
  switch (identity.provider) {
    case "emailengine":
      return identity.messageId;
    case "gmail":
      return identity.messageId;
    case "graph":
      return identity.id;
    case "imap":
      return identity.uid;
  }
}

function providerMessageRefLookup(identity: ProviderMessageIdentity): {
  sql: string;
  values: unknown[];
} {
  switch (identity.provider) {
    case "emailengine":
      return {
        sql: "provider_message_id = $3",
        values: [identity.messageId],
      };
    case "gmail":
      return {
        sql: "gmail_message_id = $3",
        values: [identity.messageId],
      };
    case "graph":
      return {
        sql: "graph_message_id = $3",
        values: [identity.id],
      };
    case "imap":
      return {
        sql: `
          imap_mailbox_id = $3
          AND imap_uidvalidity = $4
          AND imap_uid = $5
        `,
        values: [identity.mailbox.path, identity.uidvalidity, identity.uid],
      };
  }
}

function providerMessageRefLocator(
  provider: MirrorProvider,
  providerMessageId: string,
  identity: ProviderMessageIdentity | undefined,
  messageParam: string,
  mailboxParam: string,
  uidvalidityParam: string,
): { sql: string; extraValues: unknown[] } {
  if (identity?.provider === "imap") {
    return {
      sql: `
        provider_message_refs.imap_mailbox_id = ${mailboxParam}
        AND provider_message_refs.imap_uidvalidity = ${uidvalidityParam}
        AND provider_message_refs.imap_uid = ${messageParam}
      `,
      extraValues: [identity.uidvalidity],
    };
  }

  if (provider === "gmail" || identity?.provider === "gmail") {
    return {
      sql: `
        (
          provider_message_refs.gmail_message_id = ${messageParam}
          OR provider_message_refs.provider_message_id = ${messageParam}
        )
      `,
      extraValues: [],
    };
  }

  if (provider === "graph" || identity?.provider === "graph") {
    return {
      sql: `
        (
          provider_message_refs.graph_message_id = ${messageParam}
          OR provider_message_refs.provider_message_id = ${messageParam}
        )
      `,
      extraValues: [],
    };
  }

  return {
    sql: `
      (
        provider_message_refs.provider_message_id = ${messageParam}
        OR provider_message_refs.provider_message_id_aliases ? ${messageParam}
      )
    `,
    extraValues: [],
  };
}

function imapMailboxPath(
  identity?: ProviderMessageIdentity,
): string | undefined {
  return identity?.provider === "imap" ? identity.mailbox.path : undefined;
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const address = readString(record.address);
    return address ? [address] : [];
  });
}

function graphRecipientList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const address = graphEmailAddress(entry).email;
    return address ? [address] : [];
  });
}

function flagList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function attachmentList(value: unknown): NormalizedMirrorAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const raw = asRecord(entry);
    const id = readString(raw.id);
    if (!id) {
      return [];
    }

    return [
      {
        id,
        filename: readString(raw.filename) ?? `attachment-${id}`,
        contentType:
          readString(raw.contentType) ??
          readString(raw.content_type) ??
          readString(raw.mimeType) ??
          "application/octet-stream",
        byteSize:
          readNumber(raw.encodedSize) ??
          readNumber(raw.size) ??
          readNumber(raw.byteSize) ??
          0,
        contentId: readString(raw.contentId),
        embedded: readBoolean(raw.embedded),
        inline: readBoolean(raw.inline) || readBoolean(raw.isInline),
        encodedInMessage: readBoolean(raw.encodedInMessage),
      },
    ];
  });
}

function gmailHeaders(raw: Record<string, unknown>): Record<string, string> {
  const payload = asRecord(raw.payload);
  const headers = Array.isArray(payload.headers) ? payload.headers : raw.headers;
  return messageHeaders(headers);
}

function messageHeaders(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
        const headerValue = readString(item);
        return headerValue ? [[key.toLowerCase(), headerValue]] : [];
      }),
    );
  }

  const headers = value;
  if (!Array.isArray(headers)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const header of headers) {
    const record = asRecord(header);
    const name = readString(record.name)?.toLowerCase();
    const value = readString(record.value);
    if (name && value) {
      result[name] = value;
    }
  }
  return result;
}

function firstMessageId(...values: unknown[]): string | undefined {
  return messageIdsFromHeader(...values)[0];
}

function messageIdsFromHeader(...values: unknown[]): string[] {
  const ids: string[] = [];
  for (const value of values) {
    collectMessageIds(value, ids);
  }
  return uniqueStrings(ids);
}

function collectMessageIds(value: unknown, ids: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMessageIds(item, ids);
    }
    return;
  }

  const raw = readString(value);
  if (!raw) {
    return;
  }

  const flattened = raw.replace(/[\r\n]+/g, " ");
  const bracketed = [...flattened.matchAll(/<[^<>\s]+@[^<>\s]+>/g)]
    .map((match) => normalizeRfcMessageId(match[0]))
    .filter((id): id is string => Boolean(id));
  if (bracketed.length > 0) {
    ids.push(...bracketed);
    return;
  }

  ids.push(
    ...flattened
      .split(/[\s,]+/g)
      .map(normalizeRfcMessageId)
      .filter((id): id is string => Boolean(id)),
  );
}

function normalizeRfcMessageId(value: string): string | undefined {
  const stripped = value
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/^<|>$/g, "")
    .trim();
  if (!stripped || !stripped.includes("@") || /[\s<>]/.test(stripped)) {
    return undefined;
  }

  return `<${stripped}>`;
}

function graphEmailAddress(value: unknown): { email: string; name?: string } {
  const raw = asRecord(value);
  const address = asRecord(raw.emailAddress);
  return {
    email: readString(address.address) ?? readString(raw.address) ?? "",
    name: readString(address.name) ?? readString(raw.name),
  };
}

function parseMailboxAddress(value?: string): { email: string; name?: string } {
  if (!value) {
    return { email: "" };
  }

  const match = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(value.trim());
  if (!match) {
    return { email: value.trim() };
  }

  const name = match[1]?.trim();
  return {
    email: match[2].trim(),
    ...(name ? { name } : {}),
  };
}

function headerAddressList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => parseMailboxAddress(entry).email)
    .filter((entry) => entry.length > 0);
}

function dateFromUnixMs(value: unknown): string | undefined {
  const raw =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : typeof value === "number"
        ? value
        : undefined;
  if (!raw || !Number.isFinite(raw)) {
    return undefined;
  }

  return new Date(raw).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}
