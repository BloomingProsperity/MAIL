import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";

let server: Server | undefined;

async function withApi(
  test: (baseUrl: string) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      ...overrides,
    } as any),
  );

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }

  await test(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("mail action routes", () => {
  it("applies a message organization action through the service", async () => {
    const calls: unknown[] = [];
    const mailActionService = {
      async applyAction(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          messageId: "msg_1",
          action: "star",
          state: {
            unread: true,
            starred: true,
            archived: false,
            deleted: false,
            mailboxIds: ["mailbox_inbox"],
            labelIds: [],
          },
          command: {
            id: "cmd_1",
            commandType: "star",
            accountId: "acc_1",
            messageId: "msg_1",
            idempotencyKey: "mail-action:acc_1:msg_1:star",
            status: "queued",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/messages/msg_1/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "star" }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          accountId: "acc_1",
          messageId: "msg_1",
          action: "star",
          state: { starred: true },
          command: { status: "queued" },
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            messageId: "msg_1",
            action: "star",
          },
        ]);
      },
      { mailActionService },
    );
  });

  it("parses move and label payloads without raw provider ids", async () => {
    const calls: unknown[] = [];
    const mailActionService = {
      async applyAction(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          messageId: "msg_1",
          action: "move",
          state: {
            unread: true,
            starred: false,
            archived: false,
            deleted: false,
            mailboxIds: ["mailbox_archive"],
            labelIds: ["label_work"],
          },
          command: { id: "cmd_1", status: "queued" },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const move = await fetch(
          `${baseUrl}/api/accounts/acc_1/messages/msg_1/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "move",
              mailboxId: "mailbox_archive",
            }),
          },
        );
        const labels = await fetch(
          `${baseUrl}/api/accounts/acc_1/messages/msg_1/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "apply_labels",
              labelIds: ["label_work"],
            }),
          },
        );

        expect(move.status).toBe(202);
        expect(labels.status).toBe(202);
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            messageId: "msg_1",
            action: "move",
            mailboxId: "mailbox_archive",
          },
          {
            accountId: "acc_1",
            messageId: "msg_1",
            action: "apply_labels",
            labelIds: ["label_work"],
          },
        ]);
      },
      { mailActionService },
    );
  });

  it("parses Spark done undo payloads without raw provider ids", async () => {
    const calls: unknown[] = [];
    const mailActionService = {
      async applyAction(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          messageId: "msg_1",
          action: "undo_done",
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
            accountId: "acc_1",
            messageId: "msg_1",
            idempotencyKey: "mail-action:acc_1:msg_1:undo_done:undo_1",
            status: "queued",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/messages/msg_1/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "undo_done",
              undoToken: "undo_1",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          action: "undo_done",
          state: { archived: false, doneAt: null },
          command: { commandType: "move", status: "queued" },
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            messageId: "msg_1",
            action: "undo_done",
            undoToken: "undo_1",
          },
        ]);
      },
      { mailActionService },
    );
  });

  it("applies Smart Inbox card bulk done through explicit visible message ids", async () => {
    const calls: unknown[] = [];
    const mailActionService = {
      async applyAction() {
        throw new Error("single action should not be called");
      },
      async applyBulkAction(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          bucket: "P2",
          action: "done",
          requestedCount: 2,
          attemptedCount: 2,
          succeededCount: 2,
          failedCount: 0,
          succeeded: [
            { messageId: "msg_1", undoToken: "undo_1" },
            { messageId: "msg_2", undoToken: "undo_2" },
          ],
          failed: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/smart-inbox/cards/P2/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "done",
              messageIds: ["msg_1", "msg_2"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          accountId: "acc_1",
          bucket: "P2",
          action: "done",
          succeededCount: 2,
          failedCount: 0,
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            bucket: "P2",
            action: "done",
            messageIds: ["msg_1", "msg_2"],
          },
        ]);
      },
      { mailActionService },
    );
  });

  it("rejects invalid Smart Inbox card bulk payloads before hitting the service", async () => {
    const mailActionService = {
      async applyAction() {
        throw new Error("single action should not be called");
      },
      async applyBulkAction() {
        throw new Error("bulk action should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/smart-inbox/cards/P2/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "archive",
              messageIds: ["msg_1"],
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_mail_action_request",
        });
      },
      { mailActionService },
    );
  });

  it("rejects invalid action requests before hitting the service", async () => {
    const mailActionService = {
      async applyAction() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/messages/msg_1/actions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "move" }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_mail_action_request",
        });
      },
      { mailActionService },
    );
  });

  it("returns 503 when mail actions are unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/acc_1/messages/msg_1/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark_read" }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "mail_actions_unavailable",
      });
    });
  });
});
