import { describe, expect, it, vi } from "vitest";

import { createNativeEngineCommandProcessor } from "../src/mail-provider/native-command-processor";
import type { EngineCommandRecord } from "../src/engine-command-queue";
import { NonRetryableQueueError } from "../src/queue-errors";

const baseCommand: EngineCommandRecord = {
  id: "cmd_1",
  commandType: "mark_read",
  accountId: "acc_1",
  target: { messageId: "msg_local" },
  payload: { action: "mark_read" },
  status: "running",
  attempts: 1,
  maxAttempts: 8,
  idempotencyKey: "mail-action:acc_1:msg_local:mark_read",
  notBefore: "2026-06-12T09:00:00.000Z",
  leaseOwner: "worker-a",
  leaseExpiresAt: "2026-06-12T09:01:00.000Z",
  createdAt: "2026-06-12T09:00:00.000Z",
  updatedAt: "2026-06-12T09:00:00.000Z",
};

describe("native engine command processor", () => {
  it.each([
    ["mark_read", { removeLabelIds: ["UNREAD"] }],
    ["mark_unread", { addLabelIds: ["UNREAD"] }],
    ["star", { addLabelIds: ["STARRED"] }],
    ["unstar", { removeLabelIds: ["STARRED"] }],
    ["archive", { removeLabelIds: ["INBOX"] }],
  ] as const)("dispatches Gmail %s through messages.modify", async (action, labels) => {
    const modifyMessage = vi.fn().mockResolvedValue({ id: "gm_msg_1" });
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
      },
      gmail: {
        modifyMessage,
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "gmail",
      command: {
        ...baseCommand,
        commandType: action,
        payload: { action },
      },
    });

    expect(modifyMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "gm_msg_1",
      ...labels,
    });
  });

  it("moves Gmail messages by adding the target label and removing INBOX", async () => {
    const modifyMessage = vi.fn().mockResolvedValue({ id: "gm_msg_1" });
    const resolveMailboxTarget = vi.fn().mockResolvedValue({
      providerMailboxId: "Label_123",
    });
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
        resolveMailboxTarget,
      },
      gmail: {
        modifyMessage,
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "gmail",
      command: {
        ...baseCommand,
        commandType: "move",
        target: { messageId: "msg_local", mailboxId: "mailbox_1" },
        payload: { action: "move", mailboxId: "mailbox_1" },
      },
    });

    expect(resolveMailboxTarget).toHaveBeenCalledWith({
      accountId: "acc_1",
      mailboxId: "mailbox_1",
      provider: "gmail",
    });
    expect(modifyMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "gm_msg_1",
      addLabelIds: ["Label_123"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("trashes Gmail messages through messages.trash", async () => {
    const trashMessage = vi.fn().mockResolvedValue({ id: "gm_msg_1" });
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage,
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "gmail",
      command: { ...baseCommand, commandType: "trash" },
    });

    expect(trashMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "gm_msg_1",
    });
  });

  it("applies Gmail labels using resolved provider label ids", async () => {
    const modifyMessage = vi.fn().mockResolvedValue({ id: "gm_msg_1" });
    const resolveLabelTargets = vi.fn().mockResolvedValue(["Label_123"]);
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
        resolveLabelTargets,
      },
      gmail: {
        modifyMessage,
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "gmail",
      command: {
        ...baseCommand,
        commandType: "apply_labels",
        target: { messageId: "msg_local", labelIds: ["label_1"] },
        payload: { action: "apply_labels", labelIds: ["label_1"] },
      },
    });

    expect(resolveLabelTargets).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "gmail",
      labelIds: ["label_1"],
    });
    expect(modifyMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "gm_msg_1",
      addLabelIds: ["Label_123"],
    });
  });

  it.each([
    ["mark_read", { isRead: true }],
    ["mark_unread", { isRead: false }],
    ["star", { flag: { flagStatus: "flagged" } }],
    ["unstar", { flag: { flagStatus: "notFlagged" } }],
  ] as const)("dispatches Graph %s through message PATCH", async (action, patch) => {
    const updateMessage = vi.fn().mockResolvedValue({ id: "graph_msg_1" });
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "graph_msg_1",
        }),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage,
        moveMessage: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "graph",
      command: {
        ...baseCommand,
        commandType: action,
        payload: { action },
      },
    });

    expect(updateMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "graph_msg_1",
      patch,
    });
  });

  it("moves Graph messages to the resolved folder id", async () => {
    const moveMessage = vi.fn().mockResolvedValue({ id: "graph_msg_2" });
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "graph_msg_1",
        }),
        resolveMailboxTarget: vi.fn().mockResolvedValue({
          providerMailboxId: "archive",
        }),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage,
      },
    });

    await processor.executeCommand({
      provider: "graph",
      command: {
        ...baseCommand,
        commandType: "move",
        target: { messageId: "msg_local", mailboxId: "mailbox_archive" },
        payload: { action: "move", mailboxId: "mailbox_archive" },
      },
    });

    expect(moveMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "graph_msg_1",
      destinationId: "archive",
    });
  });

  it("trashes Graph messages by moving them to deleteditems", async () => {
    const moveMessage = vi.fn().mockResolvedValue({ id: "graph_msg_2" });
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "graph_msg_1",
        }),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage,
      },
    });

    await processor.executeCommand({
      provider: "graph",
      command: { ...baseCommand, commandType: "trash" },
    });

    expect(moveMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "graph_msg_1",
      destinationId: "deleteditems",
    });
  });

  it("appends Graph categories without dropping existing categories", async () => {
    const getMessage = vi.fn().mockResolvedValue({
      id: "graph_msg_1",
      categories: ["Existing"],
    });
    const updateMessage = vi.fn().mockResolvedValue({ id: "graph_msg_1" });
    const resolveLabelTargets = vi.fn().mockResolvedValue(["Project/Acme"]);
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "graph_msg_1",
        }),
        resolveLabelTargets,
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
      graph: {
        getMessage,
        updateMessage,
        moveMessage: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "graph",
      command: {
        ...baseCommand,
        commandType: "apply_labels",
        target: { messageId: "msg_local", labelIds: ["label_1"] },
        payload: { action: "apply_labels", labelIds: ["label_1"] },
      },
    });

    expect(resolveLabelTargets).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "graph",
      labelIds: ["label_1"],
    });
    expect(getMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "graph_msg_1",
      select: ["categories"],
    });
    expect(updateMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "graph_msg_1",
      patch: { categories: ["Existing", "Project/Acme"] },
    });
  });

  it.each([
    ["mark_read", { addFlags: ["\\Seen"] }],
    ["mark_unread", { removeFlags: ["\\Seen"] }],
    ["star", { addFlags: ["\\Flagged"] }],
    ["unstar", { removeFlags: ["\\Flagged"] }],
  ] as const)("dispatches IMAP %s through flag updates", async (action, flags) => {
    const updateFlags = vi.fn().mockResolvedValue(undefined);
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "42",
          providerMailboxId: "INBOX",
          providerUidvalidity: "987",
        }),
      },
      imap: {
        updateFlags,
        moveMessage: vi.fn(),
        applyLabels: vi.fn(),
      },
    });

    await processor.executeCommand({
      provider: "imap",
      command: {
        ...baseCommand,
        commandType: action,
        payload: { action },
      },
    });

    expect(updateFlags).toHaveBeenCalledWith({
      accountId: "acc_1",
      mailboxPath: "INBOX",
      uid: "42",
      uidvalidity: "987",
      ...flags,
    });
  });

  it.each([
    ["move", "mailbox_archive", "Archive"],
    ["archive", undefined, "Archive"],
    ["trash", undefined, "Trash"],
  ] as const)(
    "dispatches IMAP %s through provider mailbox moves",
    async (action, mailboxId, destinationMailboxPath) => {
      const moveMessage = vi.fn().mockResolvedValue(undefined);
      const resolveMailboxTarget = vi.fn().mockResolvedValue({
        providerMailboxId: destinationMailboxPath,
      });
      const resolveSpecialMailboxTarget = vi.fn().mockImplementation(
        async (input: { role: string }) => ({
          providerMailboxId: input.role === "trash" ? "Trash" : "Archive",
        }),
      );
      const processor = createNativeEngineCommandProcessor({
        targetResolver: {
          resolveMessageTarget: vi.fn().mockResolvedValue({
            providerMessageId: "42",
            providerMailboxId: "INBOX",
          }),
          resolveMailboxTarget,
          resolveSpecialMailboxTarget,
        },
        imap: {
          updateFlags: vi.fn(),
          moveMessage,
          applyLabels: vi.fn(),
        },
      });

      await processor.executeCommand({
        provider: "imap",
        command: {
          ...baseCommand,
          commandType: action,
          target: {
            messageId: "msg_local",
            ...(mailboxId ? { mailboxId } : {}),
          },
          payload: {
            action,
            ...(mailboxId ? { mailboxId } : {}),
          },
        },
      });

      if (action === "move") {
        expect(resolveMailboxTarget).toHaveBeenCalledWith({
          accountId: "acc_1",
          mailboxId: "mailbox_archive",
          provider: "imap",
        });
      } else {
        expect(resolveSpecialMailboxTarget).toHaveBeenCalledWith({
          accountId: "acc_1",
          role: action === "trash" ? "trash" : "archive",
          provider: "imap",
        });
      }
      expect(moveMessage).toHaveBeenCalledWith({
        accountId: "acc_1",
        sourceMailboxPath: "INBOX",
        uid: "42",
        destinationMailboxPath,
      });
    },
  );

  it("dispatches IMAP label application through resolved local label names", async () => {
    const applyLabels = vi.fn().mockResolvedValue(undefined);
    const resolveLabelTargets = vi.fn().mockResolvedValue(["Project/Acme"]);
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "42",
          providerMailboxId: "INBOX",
        }),
        resolveLabelTargets,
      },
      imap: {
        updateFlags: vi.fn(),
        moveMessage: vi.fn(),
        applyLabels,
      },
    });

    await processor.executeCommand({
      provider: "imap",
      command: {
        ...baseCommand,
        commandType: "apply_labels",
        target: { messageId: "msg_local", labelIds: ["label_1"] },
        payload: { action: "apply_labels", labelIds: ["label_1"] },
      },
    });

    expect(resolveLabelTargets).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "imap",
      labelIds: ["label_1"],
    });
    expect(applyLabels).toHaveBeenCalledWith({
      accountId: "acc_1",
      mailboxPath: "INBOX",
      uid: "42",
      labels: ["Project/Acme"],
    });
  });

  it.each(["gmail", "graph"] as const)(
    "marks missing native %s command clients as non-retryable",
    async (provider) => {
      const processor = createNativeEngineCommandProcessor({
        targetResolver: {
          resolveMessageTarget: vi.fn().mockResolvedValue({
            providerMessageId: "provider_msg_1",
          }),
        },
      });

      await expect(
        processor.executeCommand({
          provider,
          command: baseCommand,
        }),
      ).rejects.toBeInstanceOf(NonRetryableQueueError);
    },
  );

  it("marks missing native IMAP command clients as non-retryable", async () => {
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "42",
          providerMailboxId: "INBOX",
        }),
      },
    });

    await expect(
      processor.executeCommand({
        provider: "imap",
        command: baseCommand,
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it.each(["gmail", "graph"] as const)(
    "marks missing native %s message refs as non-retryable",
    async (provider) => {
      const processor = createNativeEngineCommandProcessor({
        targetResolver: {
          resolveMessageTarget: vi.fn().mockResolvedValue(undefined),
        },
        gmail: {
          modifyMessage: vi.fn(),
          trashMessage: vi.fn(),
        },
        graph: {
          getMessage: vi.fn(),
          updateMessage: vi.fn(),
          moveMessage: vi.fn(),
        },
      });

      await expect(
        processor.executeCommand({
          provider,
          command: baseCommand,
        }),
      ).rejects.toBeInstanceOf(NonRetryableQueueError);
    },
  );

  it("marks incomplete native IMAP message refs as non-retryable", async () => {
    const updateFlags = vi.fn().mockResolvedValue(undefined);
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "42",
        }),
      },
      imap: {
        updateFlags,
        moveMessage: vi.fn(),
        applyLabels: vi.fn(),
      },
    });

    await expect(
      processor.executeCommand({
        provider: "imap",
        command: baseCommand,
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
    expect(updateFlags).not.toHaveBeenCalled();
  });

  it("marks missing Gmail mailbox refs as non-retryable", async () => {
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
        resolveMailboxTarget: vi.fn().mockResolvedValue(undefined),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
    });

    await expect(
      processor.executeCommand({
        provider: "gmail",
        command: {
          ...baseCommand,
          commandType: "move",
          target: { messageId: "msg_local", mailboxId: "mailbox_missing" },
          payload: { action: "move", mailboxId: "mailbox_missing" },
        },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks missing Graph folder refs as non-retryable", async () => {
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "graph_msg_1",
        }),
        resolveMailboxTarget: vi.fn().mockResolvedValue(undefined),
      },
      graph: {
        getMessage: vi.fn(),
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
      },
    });

    await expect(
      processor.executeCommand({
        provider: "graph",
        command: {
          ...baseCommand,
          commandType: "move",
          target: { messageId: "msg_local", mailboxId: "folder_missing" },
          payload: { action: "move", mailboxId: "folder_missing" },
        },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks unresolved native label refs as non-retryable", async () => {
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
        resolveLabelTargets: vi.fn().mockResolvedValue(["Project/Acme"]),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
    });

    await expect(
      processor.executeCommand({
        provider: "gmail",
        command: {
          ...baseCommand,
          commandType: "apply_labels",
          target: { messageId: "msg_local", labelIds: ["label_1", "label_2"] },
          payload: { action: "apply_labels", labelIds: ["label_1", "label_2"] },
        },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it.each([
    ["target.messageId", { ...baseCommand, target: {} }],
    [
      "target.mailboxId",
      {
        ...baseCommand,
        commandType: "move" as const,
        target: { messageId: "msg_local" },
        payload: { action: "move" },
      },
    ],
    [
      "target.labelIds",
      {
        ...baseCommand,
        commandType: "apply_labels" as const,
        target: { messageId: "msg_local", labelIds: [] },
        payload: { action: "apply_labels" },
      },
    ],
  ])("marks invalid native command %s payloads as non-retryable", async (_, command) => {
    const processor = createNativeEngineCommandProcessor({
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "gm_msg_1",
        }),
      },
      gmail: {
        modifyMessage: vi.fn(),
        trashMessage: vi.fn(),
      },
    });

    await expect(
      processor.executeCommand({
        provider: "gmail",
        command,
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });
});
