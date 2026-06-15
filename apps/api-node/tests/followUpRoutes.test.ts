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
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("follow-up reminder routes", () => {
  it("creates a message follow-up through the follow-up service", async () => {
    const calls: unknown[] = [];
    const followUpService = {
      async createFollowUp(input: unknown) {
        calls.push(input);
        return followUp();
      },
      async listFollowUps() {
        throw new Error("not used");
      },
      async updateFollowUp() {
        throw new Error("not used");
      },
      async cancelFollowUp() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/messages/msg_1/follow-ups`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dueAt: "2026-06-14T09:00:00.000Z",
              kind: "waiting_on_them",
              title: "Check whether Lina replied",
              note: "From Hermes follow-up suggestion",
              source: "hermes_followup",
              hermesSkillRunId: "run_1",
            }),
          },
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual(followUp());
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            messageId: "msg_1",
            dueAt: "2026-06-14T09:00:00.000Z",
            kind: "waiting_on_them",
            title: "Check whether Lina replied",
            note: "From Hermes follow-up suggestion",
            source: "hermes_followup",
            hermesSkillRunId: "run_1",
          },
        ]);
      },
      { followUpService },
    );
  });

  it("lists account follow-ups for the Tasks view", async () => {
    const calls: unknown[] = [];
    const followUpService = {
      async createFollowUp() {
        throw new Error("not used");
      },
      async listFollowUps(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          status: "open",
          items: [followUp()],
        };
      },
      async updateFollowUp() {
        throw new Error("not used");
      },
      async cancelFollowUp() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/follow-ups?accountId=acc_1&status=open&limit=25`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          accountId: "acc_1",
          status: "open",
          items: [followUp()],
        });
        expect(calls).toEqual([
          { accountId: "acc_1", status: "open", limit: 25 },
        ]);
      },
      { followUpService },
    );
  });

  it("updates and cancels follow-ups through local ids", async () => {
    const calls: unknown[] = [];
    const followUpService = {
      async createFollowUp() {
        throw new Error("not used");
      },
      async listFollowUps() {
        throw new Error("not used");
      },
      async updateFollowUp(input: unknown) {
        calls.push(["patch", input]);
        return { ...followUp(), status: "done", completedAt: "2026-06-14T10:00:00.000Z" };
      },
      async cancelFollowUp(input: unknown) {
        calls.push(["delete", input]);
        return { ...followUp(), status: "cancelled", cancelledAt: "2026-06-14T10:05:00.000Z" };
      },
    };

    await withApi(
      async (baseUrl) => {
        const patch = await fetch(`${baseUrl}/api/follow-ups/fu_1`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "done",
            note: "Handled by user",
          }),
        });
        const del = await fetch(`${baseUrl}/api/follow-ups/fu_1`, {
          method: "DELETE",
        });

        expect(patch.status).toBe(200);
        expect(del.status).toBe(200);
        expect(calls).toEqual([
          ["patch", { id: "fu_1", status: "done", note: "Handled by user" }],
          ["delete", { id: "fu_1" }],
        ]);
      },
      { followUpService },
    );
  });
});

function followUp() {
  return {
    id: "fu_1",
    accountId: "acc_1",
    messageId: "msg_1",
    kind: "waiting_on_them",
    status: "open",
    dueAt: "2026-06-14T09:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
    source: "hermes_followup",
    hermesSkillRunId: "run_1",
    createdAt: "2026-06-13T09:00:00.000Z",
    updatedAt: "2026-06-13T09:00:00.000Z",
  };
}
