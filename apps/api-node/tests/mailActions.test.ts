import { describe, expect, it } from "vitest";

import {
  createMailActionService,
  InvalidMailActionRequestError,
  type MailActionStore,
} from "../src/mail-actions/mail-actions";

describe("mail action service", () => {
  it("archives a visible message through the action store", async () => {
    const calls: unknown[] = [];
    const service = createMailActionService({
      store: createStore({
        async applyAction(input) {
          calls.push(input);
          return {
            accountId: input.accountId,
            messageId: input.messageId,
            action: input.action,
            state: {
              unread: false,
              starred: true,
              archived: true,
              deleted: false,
              mailboxIds: [],
              labelIds: [],
            },
            command: {
              id: "cmd_1",
              commandType: "archive",
              accountId: input.accountId,
              messageId: input.messageId,
              idempotencyKey: "mail-action:acc_1:msg_1:archive",
              status: "queued",
            },
          };
        },
      }),
    });

    const result = await service.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "archive",
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        messageId: "msg_1",
        action: "archive",
      },
    ]);
    expect(result).toMatchObject({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "archive",
      state: { archived: true, deleted: false },
      command: {
        commandType: "archive",
        status: "queued",
      },
    });
  });

  it("requires a target mailbox for move actions", async () => {
    const calls: unknown[] = [];
    const service = createMailActionService({
      store: createStore({
        async applyAction(input) {
          calls.push(input);
          throw new Error("not expected");
        },
      }),
    });

    await expect(
      service.applyAction({
        accountId: "acc_1",
        messageId: "msg_1",
        action: "move",
      }),
    ).rejects.toBeInstanceOf(InvalidMailActionRequestError);
    expect(calls).toEqual([]);
  });

  it("accepts Spark done without exposing provider archive details", async () => {
    const calls: unknown[] = [];
    const service = createMailActionService({
      store: createStore({
        async applyAction(input) {
          calls.push(input);
          return {
            accountId: input.accountId,
            messageId: input.messageId,
            action: input.action,
            state: {
              unread: false,
              starred: false,
              archived: true,
              deleted: false,
              mailboxIds: [],
              labelIds: [],
              doneAt: "2026-06-13T10:00:00.000Z",
              undoToken: "undo_1",
              undoExpiresAt: "2026-06-13T10:00:05.000Z",
            },
            command: {
              id: "cmd_1",
              commandType: "archive",
              accountId: input.accountId,
              messageId: input.messageId,
              idempotencyKey: "mail-action:acc_1:msg_1:done",
              status: "queued",
            },
          };
        },
      }),
    });

    const result = await service.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "done",
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        messageId: "msg_1",
        action: "done",
      },
    ]);
    expect(result).toMatchObject({
      action: "done",
      state: {
        archived: true,
        doneAt: "2026-06-13T10:00:00.000Z",
        undoToken: "undo_1",
      },
      command: {
        commandType: "archive",
      },
    });
  });

  it("requires an undo token for short-window done undo", async () => {
    const calls: unknown[] = [];
    const service = createMailActionService({
      store: createStore({
        async applyAction(input) {
          calls.push(input);
          throw new Error("not expected");
        },
      }),
    });

    await expect(
      service.applyAction({
        accountId: "acc_1",
        messageId: "msg_1",
        action: "undo_done",
      }),
    ).rejects.toBeInstanceOf(InvalidMailActionRequestError);
    expect(calls).toEqual([]);
  });

  it("accepts an explicit undone action after the undo window", async () => {
    const calls: unknown[] = [];
    const service = createMailActionService({
      store: createStore({
        async applyAction(input) {
          calls.push(input);
          return {
            accountId: input.accountId,
            messageId: input.messageId,
            action: input.action,
            state: {
              unread: false,
              starred: false,
              archived: false,
              deleted: false,
              mailboxIds: ["mailbox_inbox"],
              labelIds: [],
              doneAt: null,
              undoToken: null,
              undoExpiresAt: null,
            },
            command: {
              id: "cmd_1",
              commandType: "move",
              accountId: input.accountId,
              messageId: input.messageId,
              idempotencyKey: "mail-action:acc_1:msg_1:undone",
              status: "queued",
            },
          };
        },
      }),
    });

    await service.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "undone",
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        messageId: "msg_1",
        action: "undone",
      },
    ]);
  });

  it("applies Smart Inbox card bulk done only to explicit message ids and reports misses", async () => {
    const calls: unknown[] = [];
    const service = createMailActionService({
      store: createStore({
        async applyAction(input) {
          calls.push(input);
          if (input.messageId === "msg_hidden") {
            throw new Error("message was not found");
          }
          return {
            accountId: input.accountId,
            messageId: input.messageId,
            action: input.action,
            state: {
              unread: false,
              starred: false,
              archived: true,
              deleted: false,
              mailboxIds: [],
              labelIds: [],
              doneAt: "2026-06-13T10:00:00.000Z",
              undoToken: `undo_${input.messageId}`,
              undoExpiresAt: "2026-06-13T10:00:05.000Z",
            },
            command: {
              id: `cmd_${input.messageId}`,
              commandType: "archive",
              accountId: input.accountId,
              messageId: input.messageId,
              idempotencyKey: `mail-action:${input.accountId}:${input.messageId}:done`,
              status: "queued",
            },
          };
        },
      }),
    });

    const result = await service.applyBulkAction({
      accountId: "acc_1",
      bucket: "P2",
      action: "done",
      messageIds: ["msg_1", "msg_2", "msg_1", "msg_hidden"],
    });

    expect(calls).toEqual([
      { accountId: "acc_1", messageId: "msg_1", action: "done" },
      { accountId: "acc_1", messageId: "msg_2", action: "done" },
      { accountId: "acc_1", messageId: "msg_hidden", action: "done" },
    ]);
    expect(result).toMatchObject({
      accountId: "acc_1",
      bucket: "P2",
      action: "done",
      requestedCount: 4,
      attemptedCount: 3,
      succeededCount: 2,
      failedCount: 1,
      succeeded: [
        { messageId: "msg_1", undoToken: "undo_msg_1" },
        { messageId: "msg_2", undoToken: "undo_msg_2" },
      ],
      failed: [
        {
          messageId: "msg_hidden",
          error: "message_not_visible",
        },
      ],
    });
  });

  it("caps Smart Inbox card bulk actions to bounded visible batches", async () => {
    const service = createMailActionService({
      store: createStore({
        async applyAction() {
          throw new Error("not expected");
        },
      }),
    });

    await expect(
      service.applyBulkAction({
        accountId: "acc_1",
        bucket: "P2",
        action: "done",
        messageIds: Array.from({ length: 51 }, (_, index) => `msg_${index}`),
      }),
    ).rejects.toBeInstanceOf(InvalidMailActionRequestError);
  });

  it("requires at least one label for apply-label actions", async () => {
    const service = createMailActionService({
      store: createStore({}),
    });

    await expect(
      service.applyAction({
        accountId: "acc_1",
        messageId: "msg_1",
        action: "apply_labels",
        labelIds: [],
      }),
    ).rejects.toBeInstanceOf(InvalidMailActionRequestError);
  });
});

function createStore(overrides: Partial<MailActionStore>): MailActionStore {
  return {
    async applyAction() {
      throw new Error("not used");
    },
    ...overrides,
  };
}
