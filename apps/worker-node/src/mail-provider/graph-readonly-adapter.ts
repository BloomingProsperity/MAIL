import type {
  NativeMailAdapter,
  ProviderMailbox,
  ProviderChange,
  ProviderCursor,
  ProviderMessageIdentity,
} from "./contract.js";

export interface GraphMessageRecord extends Record<string, unknown> {
  id?: string;
  changeKey?: string;
  conversationId?: string;
  "@removed"?: {
    reason?: string;
  };
}

export interface GraphDeltaMessagesInput {
  accountId: string;
  folderId: string;
  deltaLink?: string;
  maxPageSize?: number;
}

export interface GraphDeltaMessagesResult {
  messages: GraphMessageRecord[];
  nextLink?: string;
  deltaLink?: string;
}

export interface GraphMailFolderRecord extends Record<string, unknown> {
  id?: string;
  displayName?: string;
  wellKnownName?: string;
}

export interface GraphListMailFoldersResult {
  folders: GraphMailFolderRecord[];
}

export interface GraphReadOnlyClient {
  deltaMessages(input: GraphDeltaMessagesInput): Promise<GraphDeltaMessagesResult>;
  listMailFolders(input: {
    accountId: string;
  }): Promise<GraphListMailFoldersResult>;
}

export interface GraphReadOnlyAdapterOptions {
  graph: GraphReadOnlyClient;
  defaultFolderId?: string;
  now?: () => string;
}

export function createGraphReadOnlyAdapter(
  options: GraphReadOnlyAdapterOptions,
): NativeMailAdapter {
  const defaultFolderId = options.defaultFolderId ?? "inbox";
  const now = options.now ?? (() => new Date().toISOString());

  return {
    provider: "graph",
    async listMailboxes(input) {
      const folders = await options.graph.listMailFolders({
        accountId: input.accountId,
      });

      return {
        mailboxes: folders.folders
          .filter((folder): folder is GraphMailFolderRecord & { id: string } =>
            typeof folder.id === "string" && folder.id.length > 0,
          )
          .map((folder) => graphMailbox(folder)),
      };
    },
    async sync(input) {
      const cursor =
        input.cursor?.provider === "graph" ? input.cursor : undefined;
      const mailbox =
        input.mailbox?.provider === "graph" ? input.mailbox : undefined;
      const folderId = graphFolderId(cursor) ?? mailbox?.folderId ?? defaultFolderId;
      const result = await options.graph.deltaMessages({
        accountId: input.accountId,
        folderId,
        ...(cursor ? { deltaLink: cursor.deltaLink } : {}),
        ...(Number.isInteger(input.limit) && input.limit! > 0
          ? { maxPageSize: input.limit }
          : {}),
      });

      const changes: ProviderChange[] = mailbox
        ? [
            {
              kind: "mailbox_changed",
              mailbox,
              raw: mailbox,
            },
          ]
        : [];
      for (const message of result.messages) {
        if (!message.id) {
          continue;
        }

        if (message["@removed"]) {
          changes.push({
            kind: "message_deleted",
            identity: graphIdentity(message),
            deletedAt: now(),
            raw: message,
          });
          continue;
        }

        changes.push({
          kind: "message_upserted",
          identity: graphIdentity(message),
          raw: message,
        });
      }

      return {
        changes,
        cursor: graphCursor({
          folderId,
          link: result.nextLink ?? result.deltaLink,
        }),
        hasMore: Boolean(result.nextLink),
      };
    },
  };
}

function graphMailbox(
  folder: GraphMailFolderRecord & { id: string },
): ProviderMailbox {
  return {
    identity: { provider: "graph", folderId: folder.id },
    displayName: folder.displayName ?? folder.id,
    role: graphFolderRole(folder),
    raw: folder,
  };
}

function graphFolderRole(
  folder: GraphMailFolderRecord & { id: string },
): string {
  const marker = (
    folder.wellKnownName ??
    folder.id ??
    folder.displayName ??
    ""
  ).toLowerCase();

  if (marker === "inbox") {
    return "inbox";
  }
  if (marker === "sentitems" || marker === "sent") {
    return "sent";
  }
  if (marker === "drafts") {
    return "drafts";
  }
  if (marker === "deleteditems" || marker === "trash") {
    return "trash";
  }
  if (marker === "junkemail" || marker === "junk") {
    return "junk";
  }
  if (marker === "archive") {
    return "archive";
  }

  return "label";
}

function graphFolderId(
  cursor: Extract<ProviderCursor, { provider: "graph" }> | undefined,
): string | undefined {
  return cursor?.mailbox?.folderId;
}

function graphCursor(input: {
  folderId: string;
  link?: string;
}): Extract<ProviderCursor, { provider: "graph" }> | undefined {
  if (!input.link) {
    return undefined;
  }

  return {
    provider: "graph",
    scope: "mailbox",
    mailbox: { provider: "graph", folderId: input.folderId },
    deltaLink: input.link,
  };
}

function graphIdentity(message: GraphMessageRecord): ProviderMessageIdentity {
  return {
    provider: "graph",
    id: message.id!,
    ...(message.changeKey ? { changeKey: message.changeKey } : {}),
    ...(message.conversationId
      ? { conversationId: message.conversationId }
      : {}),
  };
}
