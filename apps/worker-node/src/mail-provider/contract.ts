export type NativeProvider = "gmail" | "graph" | "imap";
export type MailProvider = NativeProvider | "emailengine";

export type ProviderMailboxIdentity =
  | {
      provider: "gmail";
      labelId: string;
    }
  | {
      provider: "graph";
      folderId: string;
    }
  | {
      provider: "imap";
      path: string;
      delimiter?: string;
    };

export type ProviderMessageIdentity =
  | {
      provider: "emailengine";
      messageId: string;
      emailId?: string;
      internetMessageId?: string;
      threadId?: string;
    }
  | {
      provider: "gmail";
      messageId: string;
      threadId?: string;
      historyId?: string;
    }
  | {
      provider: "graph";
      id: string;
      changeKey?: string;
      conversationId?: string;
    }
  | {
      provider: "imap";
      mailbox: Extract<ProviderMailboxIdentity, { provider: "imap" }>;
      uidvalidity: string;
      uid: string;
      modseq?: string;
    };

export interface ProviderMailbox {
  identity: ProviderMailboxIdentity;
  displayName?: string;
  role?: string;
  raw?: unknown;
}

export type ProviderCursor =
  | {
      provider: "gmail";
      scope: "account";
      historyId: string;
    }
  | {
      provider: "graph";
      scope: "account" | "mailbox";
      mailbox?: Extract<ProviderMailboxIdentity, { provider: "graph" }>;
      deltaLink: string;
    }
  | {
      provider: "imap";
      scope: "mailbox";
      mailbox: Extract<ProviderMailboxIdentity, { provider: "imap" }>;
      uidvalidity: string;
      highestUid?: string;
      uidNext?: string;
      highestModseq?: string;
    };

export type ProviderSyncContinuation =
  | {
      provider: "gmail";
      mode: "bootstrap";
      pageToken: string;
      cursorHistoryId?: string;
      mailbox?: Extract<ProviderMailboxIdentity, { provider: "gmail" }>;
    }
  | {
      provider: "gmail";
      mode: "history";
      startHistoryId: string;
      pageToken: string;
    }
  | {
      provider: "graph";
      folderId: string;
      deltaLink: string;
    };

export type ProviderChange =
  | {
      kind: "message_upserted";
      identity: ProviderMessageIdentity;
      raw?: unknown;
    }
  | {
      kind: "message_deleted";
      identity: ProviderMessageIdentity;
      deletedAt: string;
      raw?: unknown;
    }
  | {
      kind: "mailbox_changed";
      mailbox: ProviderMailboxIdentity;
      raw?: unknown;
    };

export interface NativeMailAdapter {
  provider: NativeProvider;
  listMailboxes?(input: {
    accountId: string;
  }): Promise<{
    mailboxes: ProviderMailbox[];
  }>;
  sync(input: {
    accountId: string;
    mailbox?: ProviderMailboxIdentity;
    cursor?: ProviderCursor;
    continuation?: ProviderSyncContinuation;
    limit?: number;
  }): Promise<{
    changes: ProviderChange[];
    cursor?: ProviderCursor;
    continuation?: ProviderSyncContinuation;
    hasMore: boolean;
  }>;
}

export function providerMessageKey(identity: ProviderMessageIdentity): string {
  switch (identity.provider) {
    case "emailengine":
      return `emailengine:${identity.messageId}`;
    case "gmail":
      return `gmail:${identity.messageId}`;
    case "graph":
      return `graph:${identity.id}`;
    case "imap":
      return `imap:${identity.mailbox.path}:${identity.uidvalidity}:${identity.uid}`;
  }
}

export function providerCursorKey(cursor: ProviderCursor): string {
  switch (cursor.provider) {
    case "gmail":
      return `gmail:${cursor.scope}:${cursor.historyId}`;
    case "graph":
      return cursor.scope === "mailbox" && cursor.mailbox
        ? `graph:mailbox:${cursor.mailbox.folderId}`
        : "graph:account";
    case "imap":
      return `imap:${cursor.mailbox.path}:${cursor.uidvalidity}`;
  }
}
