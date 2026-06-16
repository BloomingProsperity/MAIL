import { describe, expect, it, vi } from "vitest";

import { createEngineCommandDispatcher } from "../src/engine-command-dispatcher";
import type { EngineCommandRecord } from "../src/engine-command-queue";
import { EmailEngineRequestError } from "../src/mail-engine/email-engine-client";
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

function emailEnginePlan(overrides = {}) {
  return {
    accountId: "acc_1",
    email: "support@qq.com",
    provider: "qq",
    authMethod: "password",
    engineProvider: "emailengine" as const,
    capabilities: {},
    settings: {},
    ...overrides,
  };
}

describe("engine command dispatcher", () => {
  it("marks EmailEngine messages read using the provider message id", async () => {
    const updateMessage = vi.fn().mockResolvedValue({ ok: true });
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
      },
      emailEngine: {
        updateMessage,
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await dispatcher(baseCommand);

    expect(updateMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "ee_msg_1",
      flags: { add: ["\\Seen"] },
    });
  });

  it.each([
    ["mark_unread", { flags: { delete: ["\\Seen"] } }],
    ["star", { flags: { add: ["\\Flagged"] } }],
    ["unstar", { flags: { delete: ["\\Flagged"] } }],
  ] as const)("dispatches %s as an EmailEngine flag mutation", async (action, body) => {
    const updateMessage = vi.fn().mockResolvedValue({ ok: true });
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
      },
      emailEngine: {
        updateMessage,
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await dispatcher({
      ...baseCommand,
      commandType: action,
      payload: { action },
    });

    expect(updateMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "ee_msg_1",
      ...body,
    });
  });

  it("moves EmailEngine messages using the provider mailbox path", async () => {
    const moveMessage = vi.fn().mockResolvedValue({ id: "ee_msg_2" });
    const resolveMailboxTarget = vi.fn().mockResolvedValue({
      providerMailboxId: "Projects/Acme",
    });
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
        resolveMailboxTarget,
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage,
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await dispatcher({
      ...baseCommand,
      commandType: "move",
      target: { messageId: "msg_local", mailboxId: "mailbox_project" },
      payload: { action: "move", mailboxId: "mailbox_project" },
    });

    expect(resolveMailboxTarget).toHaveBeenCalledWith({
      accountId: "acc_1",
      mailboxId: "mailbox_project",
      provider: "emailengine",
    });
    expect(moveMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "ee_msg_1",
      path: "Projects/Acme",
    });
  });

  it("archives EmailEngine messages through the configured archive mailbox", async () => {
    const moveMessage = vi.fn().mockResolvedValue({ id: "ee_msg_2" });
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(
          emailEnginePlan({ settings: { archivePath: "Archive" } }),
        ),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage,
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await dispatcher({ ...baseCommand, commandType: "archive" });

    expect(moveMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "ee_msg_1",
      path: "Archive",
    });
  });

  it("trashes EmailEngine messages without force deleting them", async () => {
    const deleteMessage = vi.fn().mockResolvedValue({ deleted: true });
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage,
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await dispatcher({ ...baseCommand, commandType: "trash" });

    expect(deleteMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "ee_msg_1",
      force: false,
    });
  });

  it("applies label commands using resolved provider label paths", async () => {
    const updateMessage = vi.fn().mockResolvedValue({ ok: true });
    const resolveLabelTargets = vi.fn().mockResolvedValue([
      "Label_123",
      "Project/Acme",
    ]);
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
        resolveLabelTargets,
      },
      emailEngine: {
        updateMessage,
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await dispatcher({
      ...baseCommand,
      commandType: "apply_labels",
      target: { messageId: "msg_local", labelIds: ["label_1", "label_2"] },
      payload: { action: "apply_labels", labelIds: ["label_1", "label_2"] },
    });

    expect(resolveLabelTargets).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "emailengine",
      labelIds: ["label_1", "label_2"],
    });
    expect(updateMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "ee_msg_1",
      labels: { add: ["Label_123", "Project/Acme"] },
    });
  });

  it("marks missing connected accounts as non-retryable command failures", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(undefined),
      },
      targetResolver: {},
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(dispatcher(baseCommand)).rejects.toBeInstanceOf(
      NonRetryableQueueError,
    );
    await expect(dispatcher(baseCommand)).rejects.toThrow(
      "connected account not found for engine command: acc_1",
    );
  });

  it("marks native accounts without a native provider as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(
          emailEnginePlan({
            engineProvider: "native",
            nativeProvider: undefined,
          }),
        ),
      },
      targetResolver: {},
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(dispatcher(baseCommand)).rejects.toBeInstanceOf(
      NonRetryableQueueError,
    );
    await expect(dispatcher(baseCommand)).rejects.toThrow(
      "native account acc_1 is missing nativeProvider",
    );
  });

  it("marks missing provider message refs as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue(undefined),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(dispatcher(baseCommand)).rejects.toBeInstanceOf(
      NonRetryableQueueError,
    );
    await expect(dispatcher(baseCommand)).rejects.toThrow(
      "provider message ref not found for engine command cmd_1",
    );
  });

  it("marks missing provider mailbox refs as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
        resolveMailboxTarget: vi.fn().mockResolvedValue(undefined),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(
      dispatcher({
        ...baseCommand,
        commandType: "move",
        target: { messageId: "msg_local", mailboxId: "mailbox_missing" },
        payload: { action: "move", mailboxId: "mailbox_missing" },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks missing archive mailbox targets as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
        resolveSpecialMailboxTarget: vi.fn().mockResolvedValue(undefined),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(
      dispatcher({
        ...baseCommand,
        commandType: "archive",
        payload: { action: "archive" },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks unresolved provider label targets as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
        resolveLabelTargets: vi.fn().mockResolvedValue(["Label_123"]),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(
      dispatcher({
        ...baseCommand,
        commandType: "apply_labels",
        target: { messageId: "msg_local", labelIds: ["label_1", "label_2"] },
        payload: { action: "apply_labels", labelIds: ["label_1", "label_2"] },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks commands missing a message target as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {},
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(
      dispatcher({
        ...baseCommand,
        target: {},
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks move commands missing a mailbox target as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(
      dispatcher({
        ...baseCommand,
        commandType: "move",
        target: { messageId: "msg_local" },
        payload: { action: "move" },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it("marks label commands without label ids as non-retryable", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(emailEnginePlan()),
      },
      targetResolver: {
        resolveMessageTarget: vi.fn().mockResolvedValue({
          providerMessageId: "ee_msg_1",
        }),
      },
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(
      dispatcher({
        ...baseCommand,
        commandType: "apply_labels",
        target: { messageId: "msg_local", labelIds: [] },
        payload: { action: "apply_labels" },
      }),
    ).rejects.toBeInstanceOf(NonRetryableQueueError);
  });

  it.each([
    ["mark_read", "updateMessage"],
    ["mark_unread", "updateMessage"],
    ["star", "updateMessage"],
    ["unstar", "updateMessage"],
    ["apply_labels", "updateMessage"],
    ["move", "moveMessage"],
    ["archive", "moveMessage"],
    ["trash", "deleteMessage"],
  ] as const)(
    "treats EmailEngine MessageNotFound during %s as an already-converged command",
    async (commandType, failingMethod) => {
      const emailEngine = {
        updateMessage: vi.fn().mockResolvedValue({ ok: true }),
        moveMessage: vi.fn().mockResolvedValue({ ok: true }),
        deleteMessage: vi.fn().mockResolvedValue({ ok: true }),
      };
      emailEngine[failingMethod].mockRejectedValue(
        new EmailEngineRequestError(404, "MessageNotFound", "missing"),
      );
      const dispatcher = createEngineCommandDispatcher({
        accountSettingsStore: {
          getAccountSyncPlan: vi.fn().mockResolvedValue(
            emailEnginePlan({ settings: { archivePath: "Archive" } }),
          ),
        },
        targetResolver: {
          resolveMessageTarget: vi.fn().mockResolvedValue({
            providerMessageId: "ee_msg_1",
          }),
          resolveMailboxTarget: vi.fn().mockResolvedValue({
            providerMailboxId: "Projects/Acme",
          }),
          resolveLabelTargets: vi.fn().mockResolvedValue(["Label_123"]),
        },
        emailEngine,
        nativeCommandProcessor: { executeCommand: vi.fn() },
      });
      const commandTarget =
        commandType === "move"
          ? { messageId: "msg_local", mailboxId: "mailbox_project" }
          : commandType === "apply_labels"
            ? { messageId: "msg_local", labelIds: ["label_1"] }
            : { messageId: "msg_local" };

      await expect(
        dispatcher({
          ...baseCommand,
          commandType,
          target: commandTarget,
          payload: { action: commandType },
        }),
      ).resolves.toBeUndefined();
    },
  );

  it("routes native accounts through the native command boundary", async () => {
    const executeCommand = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          engineProvider: "native",
          nativeProvider: "gmail",
          capabilities: {},
          settings: {},
        }),
      },
      targetResolver: {},
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand },
    });

    await dispatcher(baseCommand);

    expect(executeCommand).toHaveBeenCalledWith({
      command: baseCommand,
      provider: "gmail",
    });
  });

  it("throws for paused accounts so the queue can retry later", async () => {
    const dispatcher = createEngineCommandDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(
          emailEnginePlan({ syncState: "paused" }),
        ),
      },
      targetResolver: {},
      emailEngine: {
        updateMessage: vi.fn(),
        moveMessage: vi.fn(),
        deleteMessage: vi.fn(),
      },
      nativeCommandProcessor: { executeCommand: vi.fn() },
    });

    await expect(dispatcher(baseCommand)).rejects.toThrow(
      "account acc_1 is paused; engine command cmd_1 will retry",
    );
  });
});
