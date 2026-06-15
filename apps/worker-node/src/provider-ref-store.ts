import { randomUUID } from "node:crypto";

import {
  providerMessageKey,
  type ProviderMailboxIdentity,
  type ProviderMessageIdentity,
} from "./mail-provider/contract.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface UpsertMessageRefInput {
  accountId: string;
  messageId?: string;
  identity: ProviderMessageIdentity;
  rawRef?: unknown;
}

export interface UpsertMailboxRefInput {
  accountId: string;
  mailboxId?: string;
  identity: ProviderMailboxIdentity;
  displayName?: string;
  role?: string;
  rawRef?: unknown;
}

export interface ProviderMailboxRefRecord {
  id: string;
  provider: ProviderMailboxIdentity["provider"];
  providerMailboxId: string;
  displayName?: string;
  role?: string;
  gmailLabelId?: string;
  graphFolderId?: string;
  imapPath?: string;
  imapDelimiter?: string;
}

export interface ProviderMessageRefRecord {
  id: string;
  provider: ProviderMessageIdentity["provider"];
  providerMessageId?: string;
  providerMessageIdAliases?: string[];
  emailengineEmailId?: string;
  internetMessageId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  gmailHistoryId?: string;
  graphMessageId?: string;
  graphChangeKey?: string;
  graphConversationId?: string;
  imapMailboxId?: string;
  imapUidvalidity?: string;
  imapUid?: string;
  imapModseq?: string;
}

export interface RecordTombstoneInput {
  accountId: string;
  identity: ProviderMessageIdentity;
  deletedAt: string;
  reason?: string;
  rawEvent?: unknown;
}

export interface ProviderMessageTombstoneRecord {
  id: string;
  provider: ProviderMessageIdentity["provider"];
  idempotencyKey: string;
}

interface ProviderMessageRefRow extends Record<string, unknown> {
  id: string;
  provider: ProviderMessageIdentity["provider"];
  provider_message_id?: string | null;
  provider_message_id_aliases?: unknown;
  emailengine_email_id?: string | null;
  internet_message_id?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
  gmail_history_id?: string | null;
  graph_message_id?: string | null;
  graph_change_key?: string | null;
  graph_conversation_id?: string | null;
  imap_mailbox_id?: string | null;
  imap_uidvalidity?: string | null;
  imap_uid?: string | null;
  imap_modseq?: string | null;
}

interface TombstoneRow extends Record<string, unknown> {
  id: string;
  provider: ProviderMessageIdentity["provider"];
  idempotency_key: string;
}

interface ProviderMailboxRefRow extends Record<string, unknown> {
  id: string;
  provider: ProviderMailboxIdentity["provider"];
  provider_mailbox_id: string;
  display_name?: string | null;
  role?: string | null;
  gmail_label_id?: string | null;
  graph_folder_id?: string | null;
  imap_path?: string | null;
  imap_delimiter?: string | null;
}

export interface ProviderRefStore {
  upsertMailboxRef(
    input: UpsertMailboxRefInput,
  ): Promise<ProviderMailboxRefRecord>;
  upsertMessageRef(
    input: UpsertMessageRefInput,
  ): Promise<ProviderMessageRefRecord>;
  recordTombstone(
    input: RecordTombstoneInput,
  ): Promise<ProviderMessageTombstoneRecord>;
}

export function createPostgresProviderRefStore(
  client: Queryable,
): ProviderRefStore {
  return {
    async upsertMailboxRef(input) {
      const identity = input.identity;
      const providerMailboxId = providerMailboxIdFor(identity);
      const result = await client.query<ProviderMailboxRefRow>(
        `
          INSERT INTO provider_mailbox_refs (
            id,
            mailbox_id,
            account_id,
            provider,
            provider_mailbox_id,
            display_name,
            role,
            gmail_label_id,
            graph_folder_id,
            imap_path,
            imap_delimiter,
            raw_ref,
            last_seen_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
          ON CONFLICT (account_id, provider, provider_mailbox_id) DO UPDATE
          SET
            mailbox_id = COALESCE(EXCLUDED.mailbox_id, provider_mailbox_refs.mailbox_id),
            display_name = COALESCE(EXCLUDED.display_name, provider_mailbox_refs.display_name),
            role = COALESCE(EXCLUDED.role, provider_mailbox_refs.role),
            gmail_label_id = COALESCE(EXCLUDED.gmail_label_id, provider_mailbox_refs.gmail_label_id),
            graph_folder_id = COALESCE(EXCLUDED.graph_folder_id, provider_mailbox_refs.graph_folder_id),
            imap_path = COALESCE(EXCLUDED.imap_path, provider_mailbox_refs.imap_path),
            imap_delimiter = COALESCE(EXCLUDED.imap_delimiter, provider_mailbox_refs.imap_delimiter),
            raw_ref = EXCLUDED.raw_ref,
            last_seen_at = now()
          RETURNING
            id,
            provider,
            provider_mailbox_id,
            display_name,
            role,
            gmail_label_id,
            graph_folder_id,
            imap_path,
            imap_delimiter
        `,
        [
          randomUUID(),
          input.mailboxId,
          input.accountId,
          identity.provider,
          providerMailboxId,
          input.displayName,
          input.role,
          identity.provider === "gmail" ? identity.labelId : undefined,
          identity.provider === "graph" ? identity.folderId : undefined,
          identity.provider === "imap" ? identity.path : undefined,
          identity.provider === "imap" ? identity.delimiter : undefined,
          input.rawRef ?? {},
        ],
      );

      if (!result.rows[0]) {
        throw new Error("provider mailbox ref upsert returned no rows");
      }

      return rowToProviderMailboxRef(result.rows[0]);
    },

    async upsertMessageRef(input) {
      const values = messageRefValues(input);
      const result = await client.query<ProviderMessageRefRow>(
        `
          INSERT INTO provider_message_refs (
            id,
            message_id,
            account_id,
            provider,
            provider_message_id,
            emailengine_email_id,
            internet_message_id,
            gmail_message_id,
            gmail_thread_id,
            gmail_history_id,
            graph_message_id,
            graph_change_key,
            graph_conversation_id,
            imap_mailbox_id,
            imap_uidvalidity,
            imap_uid,
            imap_modseq,
            provider_message_id_aliases,
            raw_ref,
            last_seen_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, now()
          )
          ${conflictClause(input.identity)}
          RETURNING
            id,
            provider,
            provider_message_id,
            emailengine_email_id,
            internet_message_id,
            gmail_message_id,
            gmail_thread_id,
            gmail_history_id,
            graph_message_id,
            graph_change_key,
            graph_conversation_id,
            imap_mailbox_id,
            imap_uidvalidity,
            imap_uid,
            imap_modseq,
            provider_message_id_aliases
        `,
        values,
      );

      if (!result.rows[0]) {
        throw new Error("provider message ref upsert returned no rows");
      }

      return rowToProviderMessageRef(result.rows[0]);
    },

    async recordTombstone(input) {
      const idempotencyKey = `tombstone:${input.accountId}:${providerMessageKey(
        input.identity,
      )}`;
      const result = await client.query<TombstoneRow>(
        `
          INSERT INTO provider_message_tombstones (
            id,
            account_id,
            provider,
            provider_identity,
            provider_message_id,
            provider_mailbox_id,
            deleted_at,
            reason,
            idempotency_key,
            raw_event
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (idempotency_key) DO UPDATE
          SET
            deleted_at = EXCLUDED.deleted_at,
            reason = EXCLUDED.reason,
            raw_event = EXCLUDED.raw_event
          RETURNING id, provider, idempotency_key
        `,
        [
          randomUUID(),
          input.accountId,
          input.identity.provider,
          input.identity,
          providerMessageIdFor(input.identity),
          providerMessageMailboxIdFor(input.identity),
          input.deletedAt,
          input.reason ?? "provider_deleted",
          idempotencyKey,
          input.rawEvent ?? {},
        ],
      );

      if (!result.rows[0]) {
        throw new Error("provider message tombstone insert returned no rows");
      }

      return {
        id: result.rows[0].id,
        provider: result.rows[0].provider,
        idempotencyKey: result.rows[0].idempotency_key,
      };
    },
  };
}

function messageRefValues(input: UpsertMessageRefInput): unknown[] {
  const identity = input.identity;

  return [
    randomUUID(),
    input.messageId,
    input.accountId,
    identity.provider,
    providerMessageIdFor(identity),
    identity.provider === "emailengine" ? identity.emailId : undefined,
    identity.provider === "emailengine"
      ? identity.internetMessageId
      : undefined,
    identity.provider === "gmail" ? identity.messageId : undefined,
    identity.provider === "gmail" ? identity.threadId : undefined,
    identity.provider === "gmail" ? identity.historyId : undefined,
    identity.provider === "graph" ? identity.id : undefined,
    identity.provider === "graph" ? identity.changeKey : undefined,
    identity.provider === "graph" ? identity.conversationId : undefined,
    identity.provider === "imap" ? identity.mailbox.path : undefined,
    identity.provider === "imap" ? identity.uidvalidity : undefined,
    identity.provider === "imap" ? identity.uid : undefined,
    identity.provider === "imap" ? identity.modseq : undefined,
    providerMessageIdAliasesFor(identity),
    input.rawRef ?? {},
  ];
}

function conflictClause(identity: ProviderMessageIdentity): string {
  switch (identity.provider) {
    case "emailengine":
      if (identity.emailId) {
        return `
          ON CONFLICT (account_id, provider, emailengine_email_id)
          WHERE provider = 'emailengine' AND emailengine_email_id IS NOT NULL
          DO UPDATE
          SET
            message_id = COALESCE(EXCLUDED.message_id, provider_message_refs.message_id),
            provider_message_id = EXCLUDED.provider_message_id,
            internet_message_id = COALESCE(EXCLUDED.internet_message_id, provider_message_refs.internet_message_id),
            provider_message_id_aliases = ${mergedProviderMessageIdAliasesSql()},
            raw_ref = EXCLUDED.raw_ref,
            last_seen_at = now()
        `;
      }

      return `
        ON CONFLICT (account_id, provider, provider_message_id) DO UPDATE
        SET
          message_id = COALESCE(EXCLUDED.message_id, provider_message_refs.message_id),
          emailengine_email_id = COALESCE(EXCLUDED.emailengine_email_id, provider_message_refs.emailengine_email_id),
          internet_message_id = COALESCE(EXCLUDED.internet_message_id, provider_message_refs.internet_message_id),
          provider_message_id_aliases = ${mergedProviderMessageIdAliasesSql()},
          raw_ref = EXCLUDED.raw_ref,
          last_seen_at = now()
      `;
    case "gmail":
      return `
        ON CONFLICT (account_id, provider, gmail_message_id) DO UPDATE
        SET
          message_id = COALESCE(EXCLUDED.message_id, provider_message_refs.message_id),
          gmail_thread_id = EXCLUDED.gmail_thread_id,
          gmail_history_id = EXCLUDED.gmail_history_id,
          raw_ref = EXCLUDED.raw_ref,
          last_seen_at = now()
      `;
    case "graph":
      return `
        ON CONFLICT (account_id, provider, graph_message_id) DO UPDATE
        SET
          message_id = COALESCE(EXCLUDED.message_id, provider_message_refs.message_id),
          graph_change_key = EXCLUDED.graph_change_key,
          graph_conversation_id = EXCLUDED.graph_conversation_id,
          raw_ref = EXCLUDED.raw_ref,
          last_seen_at = now()
      `;
    case "imap":
      return `
        ON CONFLICT (account_id, provider, imap_mailbox_id, imap_uidvalidity, imap_uid) DO UPDATE
        SET
          message_id = COALESCE(EXCLUDED.message_id, provider_message_refs.message_id),
          imap_modseq = EXCLUDED.imap_modseq,
          raw_ref = EXCLUDED.raw_ref,
          last_seen_at = now()
      `;
  }
}

function providerMessageIdFor(identity: ProviderMessageIdentity): string {
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

function providerMailboxIdFor(identity: ProviderMailboxIdentity): string {
  switch (identity.provider) {
    case "gmail":
      return identity.labelId;
    case "graph":
      return identity.folderId;
    case "imap":
      return identity.path;
  }
}

function providerMessageMailboxIdFor(
  identity: ProviderMessageIdentity,
): string | undefined {
  return identity.provider === "imap" ? identity.mailbox.path : undefined;
}

function providerMessageIdAliasesFor(
  identity: ProviderMessageIdentity,
): string[] {
  const providerMessageId = providerMessageIdFor(identity);
  return providerMessageId ? [providerMessageId] : [];
}

function mergedProviderMessageIdAliasesSql(): string {
  return `(
    SELECT COALESCE(jsonb_agg(DISTINCT alias_value), '[]'::jsonb)
    FROM jsonb_array_elements_text(
      COALESCE(provider_message_refs.provider_message_id_aliases, '[]'::jsonb)
      || to_jsonb(ARRAY_REMOVE(ARRAY[
        provider_message_refs.provider_message_id,
        EXCLUDED.provider_message_id
      ]::text[], NULL))
    ) AS provider_message_id_aliases(alias_value)
    WHERE alias_value <> ''
  )`;
}

function rowToProviderMessageRef(
  row: ProviderMessageRefRow,
): ProviderMessageRefRecord {
  return {
    id: row.id,
    provider: row.provider,
    ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
    ...("provider_message_id_aliases" in row
      ? { providerMessageIdAliases: toStringArray(row.provider_message_id_aliases) }
      : {}),
    ...(row.emailengine_email_id
      ? { emailengineEmailId: row.emailengine_email_id }
      : {}),
    ...(row.internet_message_id
      ? { internetMessageId: row.internet_message_id }
      : {}),
    ...(row.gmail_message_id ? { gmailMessageId: row.gmail_message_id } : {}),
    ...(row.gmail_thread_id ? { gmailThreadId: row.gmail_thread_id } : {}),
    ...(row.gmail_history_id ? { gmailHistoryId: row.gmail_history_id } : {}),
    ...(row.graph_message_id ? { graphMessageId: row.graph_message_id } : {}),
    ...(row.graph_change_key ? { graphChangeKey: row.graph_change_key } : {}),
    ...(row.graph_conversation_id
      ? { graphConversationId: row.graph_conversation_id }
      : {}),
    ...(row.imap_mailbox_id ? { imapMailboxId: row.imap_mailbox_id } : {}),
    ...(row.imap_uidvalidity
      ? { imapUidvalidity: row.imap_uidvalidity }
      : {}),
    ...(row.imap_uid ? { imapUid: row.imap_uid } : {}),
    ...(row.imap_modseq ? { imapModseq: row.imap_modseq } : {}),
  };
}

function rowToProviderMailboxRef(
  row: ProviderMailboxRefRow,
): ProviderMailboxRefRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerMailboxId: row.provider_mailbox_id,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.role ? { role: row.role } : {}),
    ...(row.gmail_label_id ? { gmailLabelId: row.gmail_label_id } : {}),
    ...(row.graph_folder_id ? { graphFolderId: row.graph_folder_id } : {}),
    ...(row.imap_path ? { imapPath: row.imap_path } : {}),
    ...(row.imap_delimiter ? { imapDelimiter: row.imap_delimiter } : {}),
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
