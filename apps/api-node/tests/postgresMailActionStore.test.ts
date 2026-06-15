import { describe, expect, it } from "vitest";

import { createPostgresMailActionStore } from "../src/mail-actions/postgres-mail-action-store";

describe("Postgres mail action store", () => {
  it("marks a message read and writes an idempotent engine command in one transaction", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = poolLike(queries, [
      [],
      [{ id: "msg_1", unread: false, starred: true, archived: false, deleted: false }],
      [{ id: "cmd_1", command_type: "mark_read", account_id: "acc_1", idempotency_key: "mail-action:acc_1:msg_1:mark_read", status: "queued" }],
      [{ mailbox_ids: ["mailbox_inbox"], label_ids: [] }],
      [],
    ]);
    const store = createPostgresMailActionStore(pool, {
      createId: () => "cmd_1",
    });

    const result = await store.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "mark_read",
    });

    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(/UPDATE message_state[\s\S]*unread = FALSE/i),
      expect.stringMatching(/INSERT INTO engine_commands/i),
      expect.stringMatching(/FROM message_locations/i),
      "COMMIT",
    ]);
    expect(queries[1].values).toEqual(["acc_1", "msg_1"]);
    expect(queries[2].values).toEqual([
      "cmd_1",
      "mark_read",
      "acc_1",
      { messageId: "msg_1" },
      { action: "mark_read" },
      "mail-action:acc_1:msg_1:mark_read",
    ]);
    expect(result).toMatchObject({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "mark_read",
      state: {
        unread: false,
        starred: true,
        archived: false,
        deleted: false,
        mailboxIds: ["mailbox_inbox"],
      },
      command: {
        id: "cmd_1",
        commandType: "mark_read",
        idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
        status: "queued",
      },
    });
  });

  it("moves a message to exactly the target mailbox and queues provider move", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = poolLike(queries, [
      [],
      [{ id: "msg_1", unread: true, starred: false, archived: false, deleted: false }],
      [],
      [],
      [{ id: "cmd_1", command_type: "move", account_id: "acc_1", idempotency_key: "mail-action:acc_1:msg_1:move:mailbox_archive", status: "queued" }],
      [{ mailbox_ids: ["mailbox_archive"], label_ids: [] }],
      [],
    ]);
    const store = createPostgresMailActionStore(pool, {
      createId: () => "cmd_1",
    });

    await store.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "move",
      mailboxId: "mailbox_archive",
    });

    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(/SELECT[\s\S]*FROM messages[\s\S]*JOIN message_state/i),
      expect.stringMatching(/DELETE FROM message_locations/i),
      expect.stringMatching(/INSERT INTO message_locations/i),
      expect.stringMatching(/INSERT INTO engine_commands/i),
      expect.stringMatching(/FROM message_locations/i),
      "COMMIT",
    ]);
    expect(queries[2].values).toEqual(["acc_1", "msg_1"]);
    expect(queries[3].values).toEqual(["msg_1", "mailbox_archive", "acc_1"]);
    expect(queries[4].values).toEqual([
      "cmd_1",
      "move",
      "acc_1",
      { messageId: "msg_1", mailboxId: "mailbox_archive" },
      { action: "move", mailboxId: "mailbox_archive" },
      "mail-action:acc_1:msg_1:move:mailbox_archive",
    ]);
  });

  it("marks a message done with a short undo token and queues provider archive", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["undo_1", "cmd_1"];
    const pool = poolLike(queries, [
      [],
      [
        {
          id: "msg_1",
          unread: false,
          starred: false,
          archived: true,
          deleted: false,
          done_at: "2026-06-13T10:00:00.000Z",
          last_action_token: "undo_1",
          undo_expires_at: "2026-06-13T10:00:05.000Z",
        },
      ],
      [],
      [
        {
          id: "cmd_1",
          command_type: "archive",
          account_id: "acc_1",
          idempotency_key: "mail-action:acc_1:msg_1:done",
          status: "queued",
        },
      ],
      [{ mailbox_ids: [], label_ids: [] }],
      [],
    ]);
    const store = createPostgresMailActionStore(pool, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "done",
    });

    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(
        /UPDATE message_state[\s\S]*archived = TRUE[\s\S]*done_at = now\(\)[\s\S]*last_action_token/i,
      ),
      expect.stringMatching(/DELETE FROM message_locations/i),
      expect.stringMatching(/INSERT INTO engine_commands/i),
      expect.stringMatching(/FROM message_locations/i),
      "COMMIT",
    ]);
    expect(queries[1].values).toEqual(["acc_1", "msg_1", "undo_1"]);
    expect(queries[3].values).toEqual([
      "cmd_1",
      "archive",
      "acc_1",
      { messageId: "msg_1" },
      { action: "done", undoToken: "undo_1" },
      "mail-action:acc_1:msg_1:done",
    ]);
    expect(result).toMatchObject({
      action: "done",
      state: {
        archived: true,
        doneAt: "2026-06-13T10:00:00.000Z",
        undoToken: "undo_1",
        undoExpiresAt: "2026-06-13T10:00:05.000Z",
      },
      command: {
        commandType: "archive",
      },
    });
  });

  it("undoes done only with the matching live token and queues provider move to inbox", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = poolLike(queries, [
      [],
      [
        {
          id: "msg_1",
          unread: false,
          starred: false,
          archived: false,
          deleted: false,
          done_at: null,
          last_action_token: null,
          undo_expires_at: null,
        },
      ],
      [{ id: "mailbox_inbox" }],
      [],
      [
        {
          id: "cmd_1",
          command_type: "move",
          account_id: "acc_1",
          idempotency_key: "mail-action:acc_1:msg_1:undo_done:undo_1",
          status: "queued",
        },
      ],
      [{ mailbox_ids: ["mailbox_inbox"], label_ids: [] }],
      [],
    ]);
    const store = createPostgresMailActionStore(pool, {
      createId: () => "cmd_1",
    });

    const result = await store.applyAction({
      accountId: "acc_1",
      messageId: "msg_1",
      action: "undo_done",
      undoToken: "undo_1",
    });

    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(
        /UPDATE message_state[\s\S]*archived = FALSE[\s\S]*done_at = NULL[\s\S]*last_action_token = NULL/i,
      ),
      expect.stringMatching(/SELECT[\s\S]*FROM mailboxes[\s\S]*role = 'inbox'/i),
      expect.stringMatching(/INSERT INTO message_locations/i),
      expect.stringMatching(/INSERT INTO engine_commands/i),
      expect.stringMatching(/FROM message_locations/i),
      "COMMIT",
    ]);
    expect(queries[1].values).toEqual(["acc_1", "msg_1", "undo_1"]);
    expect(queries[3].values).toEqual(["msg_1", "mailbox_inbox", "acc_1"]);
    expect(queries[4].values).toEqual([
      "cmd_1",
      "move",
      "acc_1",
      { messageId: "msg_1", mailboxId: "mailbox_inbox" },
      { action: "undo_done", undoToken: "undo_1", mailboxId: "mailbox_inbox" },
      "mail-action:acc_1:msg_1:undo_done:undo_1",
    ]);
    expect(result).toMatchObject({
      action: "undo_done",
      state: {
        archived: false,
        doneAt: null,
        undoToken: null,
      },
      command: {
        commandType: "move",
      },
    });
  });

  it("rolls back when the message is not visible for the account", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = poolLike(queries, [[], [], []]);
    const store = createPostgresMailActionStore(pool, {
      createId: () => "cmd_1",
    });

    await expect(
      store.applyAction({
        accountId: "acc_1",
        messageId: "missing",
        action: "trash",
      }),
    ).rejects.toThrow("message was not found");
    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(/UPDATE message_state[\s\S]*deleted_at/i),
      "ROLLBACK",
    ]);
  });
});

function poolLike(
  queries: Array<{ text: string; values?: unknown[] }>,
  rows: Array<Array<Record<string, unknown>>>,
) {
  return {
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          queries.push({ text: normalizeSql(text), values });
          return { rows: rows.shift() ?? [] };
        },
        release() {},
      };
    },
    async query(text: string, values?: unknown[]) {
      queries.push({ text: normalizeSql(text), values });
      return { rows: rows.shift() ?? [] };
    },
  };
}

function normalizeSql(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
