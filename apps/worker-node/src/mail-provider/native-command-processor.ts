import type { EngineCommandRecord } from "../engine-command-queue.js";
import type { EngineCommandTargetResolver } from "../engine-command-resolver.js";
import type { NativeEngineCommandProcessor } from "../engine-command-dispatcher.js";
import type { GmailMutationClient } from "../google/gmail-api-client.js";
import type { GraphMutationClient } from "../microsoft/graph-api-client.js";
import { NonRetryableQueueError } from "../queue-errors.js";
import type { NativeProvider } from "./contract.js";

export interface NativeEngineCommandProcessorOptions {
  targetResolver: EngineCommandTargetResolver;
  gmail?: GmailMutationClient;
  graph?: GraphMutationClient;
  imap?: ImapMutationClient;
}

export interface ImapMutationClient {
  updateFlags(input: {
    accountId: string;
    mailboxPath: string;
    uid: string;
    uidvalidity?: string;
    addFlags?: string[];
    removeFlags?: string[];
  }): Promise<void>;
  moveMessage(input: {
    accountId: string;
    sourceMailboxPath: string;
    uid: string;
    destinationMailboxPath: string;
  }): Promise<void>;
  applyLabels(input: {
    accountId: string;
    mailboxPath: string;
    uid: string;
    labels: string[];
  }): Promise<void>;
}

interface ImapMessageTarget {
  uid: string;
  mailboxPath: string;
  uidvalidity?: string;
}

export function createNativeEngineCommandProcessor(
  options: NativeEngineCommandProcessorOptions,
): NativeEngineCommandProcessor {
  return {
    async executeCommand(input) {
      switch (input.provider) {
        case "gmail":
          await dispatchGmail(options, input.command);
          return;
        case "graph":
          await dispatchGraph(options, input.command);
          return;
        case "imap":
          await dispatchImap(options, input.command);
          return;
      }
    },
  };
}

async function dispatchGmail(
  options: NativeEngineCommandProcessorOptions,
  command: EngineCommandRecord,
): Promise<void> {
  const gmail = requireClient(options.gmail, "gmail");
  const messageId = await resolveProviderMessageId(options, command, "gmail");

  switch (command.commandType) {
    case "mark_read":
      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        removeLabelIds: ["UNREAD"],
      });
      return;
    case "mark_unread":
      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        addLabelIds: ["UNREAD"],
      });
      return;
    case "star":
      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        addLabelIds: ["STARRED"],
      });
      return;
    case "unstar":
      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        removeLabelIds: ["STARRED"],
      });
      return;
    case "archive":
      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        removeLabelIds: ["INBOX"],
      });
      return;
    case "trash":
      await gmail.trashMessage({
        accountId: command.accountId,
        messageId,
      });
      return;
    case "move": {
      const mailboxId = requiredString(command.target.mailboxId, "target.mailboxId");
      const mailbox = await options.targetResolver.resolveMailboxTarget?.({
        accountId: command.accountId,
        mailboxId,
        provider: "gmail",
      });
      if (!mailbox?.providerMailboxId) {
        throw new NonRetryableQueueError(
          `native Gmail mailbox ref not found for command ${command.id}`,
        );
      }

      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        addLabelIds: [mailbox.providerMailboxId],
        removeLabelIds: ["INBOX"],
      });
      return;
    }
    case "apply_labels": {
      const labelTargets = await resolveLabelTargets(options, command);
      await gmail.modifyMessage({
        accountId: command.accountId,
        messageId,
        addLabelIds: labelTargets,
      });
      return;
    }
  }
}

async function dispatchGraph(
  options: NativeEngineCommandProcessorOptions,
  command: EngineCommandRecord,
): Promise<void> {
  const graph = requireClient(options.graph, "graph");
  const messageId = await resolveProviderMessageId(options, command, "graph");

  switch (command.commandType) {
    case "mark_read":
      await graph.updateMessage({
        accountId: command.accountId,
        messageId,
        patch: { isRead: true },
      });
      return;
    case "mark_unread":
      await graph.updateMessage({
        accountId: command.accountId,
        messageId,
        patch: { isRead: false },
      });
      return;
    case "star":
      await graph.updateMessage({
        accountId: command.accountId,
        messageId,
        patch: { flag: { flagStatus: "flagged" } },
      });
      return;
    case "unstar":
      await graph.updateMessage({
        accountId: command.accountId,
        messageId,
        patch: { flag: { flagStatus: "notFlagged" } },
      });
      return;
    case "move": {
      const mailboxId = requiredString(command.target.mailboxId, "target.mailboxId");
      const mailbox = await options.targetResolver.resolveMailboxTarget?.({
        accountId: command.accountId,
        mailboxId,
        provider: "graph",
      });
      if (!mailbox?.providerMailboxId) {
        throw new NonRetryableQueueError(
          `native Graph folder ref not found for command ${command.id}`,
        );
      }

      await graph.moveMessage({
        accountId: command.accountId,
        messageId,
        destinationId: mailbox.providerMailboxId,
      });
      return;
    }
    case "archive": {
      const mailbox = await options.targetResolver.resolveSpecialMailboxTarget?.({
        accountId: command.accountId,
        role: "archive",
        provider: "graph",
      });
      await graph.moveMessage({
        accountId: command.accountId,
        messageId,
        destinationId: mailbox?.providerMailboxId ?? "archive",
      });
      return;
    }
    case "trash":
      await graph.moveMessage({
        accountId: command.accountId,
        messageId,
        destinationId: "deleteditems",
      });
      return;
    case "apply_labels": {
      const labelTargets = await resolveLabelTargets(options, command);
      const current = await graph.getMessage({
        accountId: command.accountId,
        messageId,
        select: ["categories"],
      });
      await graph.updateMessage({
        accountId: command.accountId,
        messageId,
        patch: {
          categories: uniqueStrings([
            ...stringArray(current.categories),
            ...labelTargets,
          ]),
        },
      });
      return;
    }
  }
}

async function dispatchImap(
  options: NativeEngineCommandProcessorOptions,
  command: EngineCommandRecord,
): Promise<void> {
  const imap = requireClient(options.imap, "imap");
  const message = await resolveImapMessageTarget(options, command);

  switch (command.commandType) {
    case "mark_read":
      await imap.updateFlags({
        accountId: command.accountId,
        mailboxPath: message.mailboxPath,
        uid: message.uid,
        uidvalidity: message.uidvalidity,
        removeFlags: ["\\Seen"],
      });
      return;
    case "mark_unread":
      await imap.updateFlags({
        accountId: command.accountId,
        mailboxPath: message.mailboxPath,
        uid: message.uid,
        uidvalidity: message.uidvalidity,
        addFlags: ["\\Seen"],
      });
      return;
    case "star":
      await imap.updateFlags({
        accountId: command.accountId,
        mailboxPath: message.mailboxPath,
        uid: message.uid,
        uidvalidity: message.uidvalidity,
        addFlags: ["\\Flagged"],
      });
      return;
    case "unstar":
      await imap.updateFlags({
        accountId: command.accountId,
        mailboxPath: message.mailboxPath,
        uid: message.uid,
        uidvalidity: message.uidvalidity,
        removeFlags: ["\\Flagged"],
      });
      return;
    case "move": {
      const mailboxId = requiredString(command.target.mailboxId, "target.mailboxId");
      const destination = await options.targetResolver.resolveMailboxTarget?.({
        accountId: command.accountId,
        mailboxId,
        provider: "imap",
      });
      if (!destination?.providerMailboxId) {
        throw new NonRetryableQueueError(
          `native IMAP mailbox ref not found for command ${command.id}`,
        );
      }

      await imap.moveMessage({
        accountId: command.accountId,
        sourceMailboxPath: message.mailboxPath,
        uid: message.uid,
        destinationMailboxPath: destination.providerMailboxId,
      });
      return;
    }
    case "archive":
    case "trash": {
      const destination = await options.targetResolver.resolveSpecialMailboxTarget?.({
        accountId: command.accountId,
        role: command.commandType === "trash" ? "trash" : "archive",
        provider: "imap",
      });
      if (!destination?.providerMailboxId) {
        throw new NonRetryableQueueError(
          `native IMAP ${command.commandType} mailbox ref not found for command ${command.id}`,
        );
      }

      await imap.moveMessage({
        accountId: command.accountId,
        sourceMailboxPath: message.mailboxPath,
        uid: message.uid,
        destinationMailboxPath: destination.providerMailboxId,
      });
      return;
    }
    case "apply_labels": {
      const labelTargets = await resolveLabelTargets(options, command);
      await imap.applyLabels({
        accountId: command.accountId,
        mailboxPath: message.mailboxPath,
        uid: message.uid,
        labels: labelTargets,
      });
      return;
    }
  }
}

async function resolveProviderMessageId(
  options: NativeEngineCommandProcessorOptions,
  command: EngineCommandRecord,
  provider: Extract<NativeProvider, "gmail" | "graph">,
): Promise<string> {
  const localMessageId = requiredString(command.target.messageId, "target.messageId");
  const target = await options.targetResolver.resolveMessageTarget?.({
    accountId: command.accountId,
    messageId: localMessageId,
    provider,
  });
  if (!target?.providerMessageId) {
    throw new NonRetryableQueueError(
      `native ${provider} message ref not found for command ${command.id}`,
    );
  }

  return target.providerMessageId;
}

async function resolveImapMessageTarget(
  options: NativeEngineCommandProcessorOptions,
  command: EngineCommandRecord,
): Promise<ImapMessageTarget> {
  const localMessageId = requiredString(command.target.messageId, "target.messageId");
  const target = await options.targetResolver.resolveMessageTarget?.({
    accountId: command.accountId,
    messageId: localMessageId,
    provider: "imap",
  });
  if (!target?.providerMessageId || !target.providerMailboxId) {
    throw new NonRetryableQueueError(
      `native IMAP message ref not found for command ${command.id}`,
    );
  }

  return {
    uid: target.providerMessageId,
    mailboxPath: target.providerMailboxId,
    ...(target.providerUidvalidity
      ? { uidvalidity: target.providerUidvalidity }
      : {}),
  };
}

async function resolveLabelTargets(
  options: NativeEngineCommandProcessorOptions,
  command: EngineCommandRecord,
): Promise<string[]> {
  const labelIds = requiredStringArray(command.target.labelIds, "target.labelIds");
  const labels = await options.targetResolver.resolveLabelTargets?.({ labelIds });
  if (!labels || labels.length !== labelIds.length) {
    throw new NonRetryableQueueError(
      `native label refs not found for command ${command.id}`,
    );
  }

  return labels;
}

function requireClient<T>(client: T | undefined, provider: string): T {
  if (!client) {
    throw new NonRetryableQueueError(
      `native ${provider} command client is not configured`,
    );
  }

  return client;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NonRetryableQueueError(`${name} is required`);
  }

  return value.trim();
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new NonRetryableQueueError(`${name} is required`);
  }
  const values = value.map((item) => requiredString(item, name));
  if (values.length === 0) {
    throw new NonRetryableQueueError(`${name} is required`);
  }

  return values;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
