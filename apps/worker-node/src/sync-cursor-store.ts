import { randomUUID } from "node:crypto";

import type {
  MailProvider,
  ProviderCursor,
  ProviderMailboxIdentity,
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

export interface GetCursorInput {
  accountId: string;
  provider: MailProvider;
  mailbox?: ProviderMailboxIdentity;
}

export interface UpsertCursorInput {
  accountId: string;
  cursor: ProviderCursor;
}

export interface MarkCursorResetInput {
  accountId: string;
  provider: MailProvider;
  reason: string;
}

export interface SyncCursorStore {
  getCursor(input: GetCursorInput): Promise<ProviderCursor | undefined>;
  upsertCursor(input: UpsertCursorInput): Promise<void>;
  markCursorReset(input: MarkCursorResetInput): Promise<void>;
}

interface SyncCursorRow extends Record<string, unknown> {
  provider: string;
  cursor_scope?: string | null;
  provider_mailbox_id?: string | null;
  gmail_history_id?: string | null;
  graph_delta_link?: string | null;
  cursor_json?: unknown;
  state?: string | null;
  reset_reason?: string | null;
}

export function createPostgresSyncCursorStore(
  client: Queryable,
): SyncCursorStore {
  return {
    async getCursor(input) {
      const descriptor = cursorDescriptor(input.provider, input.mailbox);
      const result = await client.query<SyncCursorRow>(
        `
          SELECT
            provider,
            cursor_scope,
            provider_mailbox_id,
            gmail_history_id,
            graph_delta_link,
            cursor_json,
            state,
            reset_reason
          FROM sync_cursors
          WHERE account_id = $1
            AND provider = $2
            AND mailbox_key = $3
            AND cursor_type = $4
            AND state = 'active'
          LIMIT 1
        `,
        [
          input.accountId,
          input.provider,
          descriptor.mailboxKey,
          descriptor.cursorType,
        ],
      );

      return result.rows[0] ? rowToCursor(result.rows[0]) : undefined;
    },

    async upsertCursor(input) {
      const descriptor = cursorDescriptor(input.cursor);
      await client.query(
        `
          INSERT INTO sync_cursors (
            id,
            account_id,
            provider,
            mailbox_key,
            cursor_type,
            cursor_value,
            cursor_json,
            cursor_scope,
            provider_mailbox_id,
            gmail_history_id,
            graph_delta_link,
            imap_uidvalidity,
            imap_highest_uid,
            imap_uid_next,
            imap_highest_modseq,
            state,
            reset_reason,
            last_success_at,
            updated_at
          )
          VALUES (
            $15, $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, 'active', NULL, now(), now()
          )
          ON CONFLICT (account_id, provider, mailbox_key, cursor_type)
          DO UPDATE SET
            cursor_value = EXCLUDED.cursor_value,
            cursor_json = EXCLUDED.cursor_json,
            cursor_scope = EXCLUDED.cursor_scope,
            provider_mailbox_id = EXCLUDED.provider_mailbox_id,
            gmail_history_id = EXCLUDED.gmail_history_id,
            graph_delta_link = EXCLUDED.graph_delta_link,
            imap_uidvalidity = EXCLUDED.imap_uidvalidity,
            imap_highest_uid = EXCLUDED.imap_highest_uid,
            imap_uid_next = EXCLUDED.imap_uid_next,
            imap_highest_modseq = EXCLUDED.imap_highest_modseq,
            state = 'active',
            reset_reason = NULL,
            last_success_at = now(),
            updated_at = now()
        `,
        [
          input.accountId,
          input.cursor.provider,
          descriptor.mailboxKey,
          descriptor.cursorType,
          descriptor.cursorValue,
          input.cursor,
          descriptor.cursorScope,
          descriptor.providerMailboxId,
          descriptor.gmailHistoryId,
          descriptor.graphDeltaLink,
          descriptor.imapUidvalidity,
          descriptor.imapHighestUid,
          descriptor.imapUidNext,
          descriptor.imapHighestModseq,
          randomUUID(),
        ],
      );
    },

    async markCursorReset(input) {
      const descriptor = cursorDescriptor(input.provider);
      await client.query(
        `
          UPDATE sync_cursors
          SET state = 'reset_required',
              reset_reason = $5,
              updated_at = now()
          WHERE account_id = $1
            AND provider = $2
            AND mailbox_key = $3
            AND cursor_type = $4
        `,
        [
          input.accountId,
          input.provider,
          descriptor.mailboxKey,
          descriptor.cursorType,
          input.reason,
        ],
      );
    },
  };
}

function rowToCursor(row: SyncCursorRow): ProviderCursor | undefined {
  if (row.provider === "gmail") {
    const historyId =
      stringValue(row.gmail_history_id) ?? gmailCursorJson(row.cursor_json);
    return historyId
      ? { provider: "gmail", scope: "account", historyId }
      : undefined;
  }

  if (row.provider === "graph") {
    const deltaLink = stringValue(row.graph_delta_link);
    if (!deltaLink) {
      return undefined;
    }

    const folderId =
      stringValue(row.provider_mailbox_id) ??
      graphMailboxCursorJson(row.cursor_json) ??
      "inbox";

    return {
      provider: "graph",
      scope: "mailbox",
      mailbox: { provider: "graph", folderId },
      deltaLink,
    };
  }

  return undefined;
}

function cursorDescriptor(
  providerOrCursor: MailProvider | ProviderCursor,
  mailbox?: ProviderMailboxIdentity,
) {
  if (typeof providerOrCursor === "string") {
    if (providerOrCursor === "graph" && mailbox?.provider === "graph") {
      return {
        mailboxKey: mailbox.folderId,
        cursorType: "delta",
      };
    }

    if (providerOrCursor === "imap" && mailbox?.provider === "imap") {
      return {
        mailboxKey: mailbox.path,
        cursorType: "imap",
      };
    }

    return {
      mailboxKey: providerOrCursor === "graph" ? "inbox" : "",
      cursorType: providerOrCursor === "gmail" ? "history" : "delta",
    };
  }

  switch (providerOrCursor.provider) {
    case "gmail":
      return {
        mailboxKey: "",
        cursorType: "history",
        cursorValue: providerOrCursor.historyId,
        cursorScope: "account",
        providerMailboxId: null,
        gmailHistoryId: providerOrCursor.historyId,
        graphDeltaLink: null,
        imapUidvalidity: null,
        imapHighestUid: null,
        imapUidNext: null,
        imapHighestModseq: null,
      };
    case "graph":
      return {
        mailboxKey:
          providerOrCursor.scope === "mailbox" && providerOrCursor.mailbox
            ? providerOrCursor.mailbox.folderId
            : "",
        cursorType: "delta",
        cursorValue: providerOrCursor.deltaLink,
        cursorScope: providerOrCursor.scope,
        providerMailboxId:
          providerOrCursor.scope === "mailbox" && providerOrCursor.mailbox
            ? providerOrCursor.mailbox.folderId
            : null,
        gmailHistoryId: null,
        graphDeltaLink: providerOrCursor.deltaLink,
        imapUidvalidity: null,
        imapHighestUid: null,
        imapUidNext: null,
        imapHighestModseq: null,
      };
    case "imap":
      return {
        mailboxKey: providerOrCursor.mailbox.path,
        cursorType: "imap",
        cursorValue: providerOrCursor.highestUid ?? providerOrCursor.uidNext,
        cursorScope: "mailbox",
        providerMailboxId: providerOrCursor.mailbox.path,
        gmailHistoryId: null,
        graphDeltaLink: null,
        imapUidvalidity: providerOrCursor.uidvalidity,
        imapHighestUid: providerOrCursor.highestUid ?? null,
        imapUidNext: providerOrCursor.uidNext ?? null,
        imapHighestModseq: providerOrCursor.highestModseq ?? null,
      };
  }
}

function gmailCursorJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const historyId = (value as Record<string, unknown>).historyId;
  return stringValue(historyId);
}

function graphMailboxCursorJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const mailbox = (value as Record<string, unknown>).mailbox;
  if (!mailbox || typeof mailbox !== "object" || Array.isArray(mailbox)) {
    return undefined;
  }

  return stringValue((mailbox as Record<string, unknown>).folderId);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
