import type {
  NativeMailAdapter,
  ProviderMailbox,
  ProviderChange,
  ProviderSyncContinuation,
  ProviderCursor,
} from "./contract.js";

export interface GmailMessageStub {
  id: string;
  threadId?: string;
  historyId?: string;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: Array<{ message?: GmailMessageStub }>;
  messagesDeleted?: Array<{ message?: GmailMessageStub }>;
}

export interface GmailListMessagesResult {
  messages?: GmailMessageStub[];
  nextPageToken?: string;
}

export interface GmailListHistoryResult {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailLabelRecord {
  id?: string;
  name?: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
}

export interface GmailListLabelsResult {
  labels?: GmailLabelRecord[];
}

export interface GmailReadOnlyClient {
  listLabels(input: { accountId: string }): Promise<GmailListLabelsResult>;
  listMessages(input: {
    accountId: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
  }): Promise<GmailListMessagesResult>;
  getMessage(input: {
    accountId: string;
    messageId: string;
    format: "metadata" | "full";
  }): Promise<GmailMessageStub>;
  listHistory(input: {
    accountId: string;
    startHistoryId: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<GmailListHistoryResult>;
}

export interface GmailReadOnlyAdapterOptions {
  gmail: GmailReadOnlyClient;
  now?: () => string;
}

export class GmailHistoryResetError extends Error {
  readonly code = "gmail_history_expired";
}

export function createGmailReadOnlyAdapter(
  options: GmailReadOnlyAdapterOptions,
): NativeMailAdapter {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    provider: "gmail",
    async listMailboxes(input) {
      const labels = await options.gmail.listLabels({
        accountId: input.accountId,
      });

      return {
        mailboxes: (labels.labels ?? [])
          .filter((label): label is GmailLabelRecord & { id: string } =>
            typeof label.id === "string" && label.id.length > 0,
          )
          .map((label) => gmailMailbox(label)),
      };
    },
    async sync(input) {
      if (input.continuation?.provider === "gmail") {
        return syncContinuation({
          gmail: options.gmail,
          accountId: input.accountId,
          continuation: input.continuation,
          limit: input.limit,
          now,
        });
      }

      if (input.mailbox?.provider === "gmail") {
        return bootstrapRecentMessages({
          gmail: options.gmail,
          accountId: input.accountId,
          limit: input.limit,
          mailbox: input.mailbox,
        });
      }

      if (input.cursor?.provider === "gmail") {
        return syncHistory({
          gmail: options.gmail,
          accountId: input.accountId,
          cursor: input.cursor,
          limit: input.limit,
          now,
        });
      }

      return bootstrapRecentMessages({
        gmail: options.gmail,
        accountId: input.accountId,
        limit: input.limit,
      });
    },
  };
}

function gmailMailbox(
  label: GmailLabelRecord & { id: string },
): ProviderMailbox {
  return {
    identity: { provider: "gmail", labelId: label.id },
    displayName: label.name ?? label.id,
    role: gmailLabelRole(label),
    raw: label,
  };
}

function gmailLabelRole(label: GmailLabelRecord & { id: string }): string {
  const id = label.id.toUpperCase();
  if (id === "INBOX") {
    return "inbox";
  }
  if (id === "SENT") {
    return "sent";
  }
  if (id === "DRAFT") {
    return "drafts";
  }
  if (id === "TRASH") {
    return "trash";
  }
  if (id === "SPAM") {
    return "junk";
  }
  if (id === "CATEGORY_PRIMARY") {
    return "inbox";
  }
  if (id.startsWith("CATEGORY_")) {
    return "feed";
  }
  if (id === "STARRED") {
    return "starred";
  }
  if (id === "IMPORTANT") {
    return "important";
  }

  return "label";
}

async function bootstrapRecentMessages(input: {
  gmail: GmailReadOnlyClient;
  accountId: string;
  limit?: number;
  pageToken?: string;
  cursorHistoryId?: string;
  mailbox?: { provider: "gmail"; labelId: string };
}) {
  const list = await input.gmail.listMessages({
    accountId: input.accountId,
    maxResults: input.limit,
    ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    ...(input.mailbox ? { labelIds: [input.mailbox.labelId] } : {}),
  });
  const messageStubs = list.messages ?? [];
  const messages = await Promise.all(
    messageStubs.map((message) =>
      input.gmail.getMessage({
        accountId: input.accountId,
        messageId: message.id,
        format: "metadata",
      }),
    ),
  );

  const changes: ProviderChange[] = [
    ...(input.mailbox
      ? [
          {
            kind: "mailbox_changed" as const,
            mailbox: input.mailbox,
            raw: input.mailbox,
          },
        ]
      : []),
    ...messages.map((message) => ({
      kind: "message_upserted" as const,
      identity: gmailIdentity(message),
      raw: message,
    })),
  ];
  const cursorHistoryId = input.cursorHistoryId ?? messages[0]?.historyId;
  const continuation =
    list.nextPageToken && cursorHistoryId
      ? ({
          provider: "gmail",
          mode: "bootstrap",
          pageToken: list.nextPageToken,
          cursorHistoryId,
          ...(input.mailbox ? { mailbox: input.mailbox } : {}),
        } satisfies ProviderSyncContinuation)
      : undefined;
  const cursor =
    !continuation && cursorHistoryId
      ? ({
          provider: "gmail",
          scope: "account",
          historyId: cursorHistoryId,
        } satisfies ProviderCursor)
      : undefined;

  return {
    changes,
    ...(cursor ? { cursor } : {}),
    ...(continuation ? { continuation } : {}),
    hasMore: Boolean(list.nextPageToken),
  };
}

async function syncContinuation(input: {
  gmail: GmailReadOnlyClient;
  accountId: string;
  continuation: Extract<ProviderSyncContinuation, { provider: "gmail" }>;
  limit?: number;
  now: () => string;
}) {
  if (input.continuation.mode === "bootstrap") {
    return bootstrapRecentMessages({
      gmail: input.gmail,
      accountId: input.accountId,
      limit: input.limit,
      pageToken: input.continuation.pageToken,
      cursorHistoryId: input.continuation.cursorHistoryId,
      mailbox: input.continuation.mailbox,
    });
  }

  return syncHistory({
    gmail: input.gmail,
    accountId: input.accountId,
    cursor: {
      provider: "gmail",
      scope: "account",
      historyId: input.continuation.startHistoryId,
    },
    pageToken: input.continuation.pageToken,
    limit: input.limit,
    now: input.now,
  });
}

async function syncHistory(input: {
  gmail: GmailReadOnlyClient;
  accountId: string;
  cursor: Extract<ProviderCursor, { provider: "gmail" }>;
  pageToken?: string;
  limit?: number;
  now: () => string;
}) {
  let result: GmailListHistoryResult;
  try {
    result = await input.gmail.listHistory({
      accountId: input.accountId,
      startHistoryId: input.cursor.historyId,
      maxResults: input.limit,
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    });
  } catch (error) {
    if (isHttp404(error)) {
      throw new GmailHistoryResetError(
        "Gmail history cursor expired; full sync is required",
      );
    }

    throw error;
  }

  const changes: ProviderChange[] = [];
  for (const record of result.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      if (!added.message?.id) {
        continue;
      }

      changes.push({
        kind: "message_upserted",
        identity: gmailIdentity(added.message),
        raw: added.message,
      });
    }

    for (const deleted of record.messagesDeleted ?? []) {
      if (!deleted.message?.id) {
        continue;
      }

      changes.push({
        kind: "message_deleted",
        identity: gmailIdentity(deleted.message),
        deletedAt: input.now(),
        raw: deleted.message,
      });
    }
  }

  const continuation = result.nextPageToken
    ? ({
        provider: "gmail",
        mode: "history",
        startHistoryId: input.cursor.historyId,
        pageToken: result.nextPageToken,
      } satisfies ProviderSyncContinuation)
    : undefined;

  return {
    changes,
    ...(continuation
      ? { continuation }
      : {
          cursor: result.historyId
            ? ({
                provider: "gmail",
                scope: "account",
                historyId: result.historyId,
              } satisfies ProviderCursor)
            : input.cursor,
        }),
    hasMore: Boolean(result.nextPageToken),
  };
}

function gmailIdentity(message: GmailMessageStub) {
  return {
    provider: "gmail" as const,
    messageId: message.id,
    threadId: message.threadId,
    historyId: message.historyId,
  };
}

function isHttp404(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 404
  );
}
