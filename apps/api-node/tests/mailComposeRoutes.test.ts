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

describe("mail compose routes", () => {
  it("creates a draft through the compose service", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft(input: unknown) {
        calls.push(input);
        return {
          id: "draft_1",
          accountId: "acc_1",
          to: [{ address: "lina@example.com", name: "Lina" }],
          cc: [],
          bcc: [],
          subject: "Launch confirmation",
          bodyText: "Looks good.",
          status: "draft",
          source: "manual",
          createdAt: "2026-06-13T08:00:00.000Z",
          updatedAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async sendDraft() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/compose/drafts`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              to: [{ address: "lina@example.com", name: "Lina" }],
              subject: "Launch confirmation",
              bodyText: "Looks good.",
              source: "manual",
            }),
          },
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({
          id: "draft_1",
          accountId: "acc_1",
          status: "draft",
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            to: [{ address: "lina@example.com", name: "Lina" }],
            cc: [],
            bcc: [],
            subject: "Launch confirmation",
            bodyText: "Looks good.",
            source: "manual",
          },
        ]);
      },
      { mailComposeService },
    );
  });

  it("passes Hermes original reply text through draft creation", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft(input: unknown) {
        calls.push(input);
        return {
          id: "draft_1",
          accountId: "acc_1",
          to: [{ address: "lina@example.com", name: "Lina" }],
          cc: [],
          bcc: [],
          subject: "Re: Launch confirmation",
          bodyText: "Hi Lina,\n\nConfirmed for Thursday.",
          status: "draft",
          source: "hermes_reply",
          hermesSkillRunId: "run_reply_1",
          hermesDraftText:
            "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
          createdAt: "2026-06-13T08:00:00.000Z",
          updatedAt: "2026-06-13T08:00:00.000Z",
        };
      },
      async sendDraft() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/compose/drafts`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              to: [{ address: "lina@example.com", name: "Lina" }],
              subject: "Re: Launch confirmation",
              bodyText: "Hi Lina,\n\nConfirmed for Thursday.",
              source: "hermes_reply",
              hermesSkillRunId: "run_reply_1",
              hermesDraftText:
                "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
            }),
          },
        );

        expect(response.status).toBe(201);
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            to: [{ address: "lina@example.com", name: "Lina" }],
            cc: [],
            bcc: [],
            subject: "Re: Launch confirmation",
            bodyText: "Hi Lina,\n\nConfirmed for Thursday.",
            source: "hermes_reply",
            hermesSkillRunId: "run_reply_1",
            hermesDraftText:
              "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
          },
        ]);
      },
      { mailComposeService },
    );
  });

  it("sends an existing draft through the compose service", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft() {
        throw new Error("not used");
      },
      async sendDraft(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          draftId: "draft_1",
          action: "draft_send_queued",
          draft: {
            id: "draft_1",
            accountId: "acc_1",
            status: "sent",
            providerQueueId: "queue_1",
            providerMessageId: "<message@example.com>",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/compose/drafts/draft_1/send`,
          { method: "POST" },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          accountId: "acc_1",
          draftId: "draft_1",
          action: "draft_send_queued",
          draft: {
            id: "draft_1",
            accountId: "acc_1",
            status: "sent",
            providerQueueId: "queue_1",
            providerMessageId: "<message@example.com>",
          },
        });
        expect(calls).toEqual([{ accountId: "acc_1", draftId: "draft_1" }]);
      },
      { mailComposeService },
    );
  });

  it("schedules an existing draft for later delivery", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft() {
        throw new Error("not used");
      },
      async sendDraft() {
        throw new Error("not used");
      },
      async scheduleDraft(input: unknown) {
        calls.push(input);
        return {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T12:30:00.000Z",
          status: "scheduled",
          canEdit: true,
          canSendNow: true,
          canDelete: true,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/compose/drafts/draft_1/schedule`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scheduledAt: "2026-06-13T12:30:00.000Z",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T12:30:00.000Z",
          status: "scheduled",
          canEdit: true,
          canSendNow: true,
          canDelete: true,
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            draftId: "draft_1",
            scheduledAt: "2026-06-13T12:30:00.000Z",
          },
        ]);
      },
      { mailComposeService },
    );
  });

  it("lists scheduled drafts from the outbox", async () => {
    const mailComposeService = {
      async createDraft() {
        throw new Error("not used");
      },
      async sendDraft() {
        throw new Error("not used");
      },
      async listOutbox(input: unknown) {
        return {
          accountId: (input as { accountId: string }).accountId,
          items: [
            {
              id: "schedule_1",
              accountId: "acc_1",
              draftId: "draft_1",
              scheduledAt: "2026-06-13T12:30:00.000Z",
              status: "scheduled",
              canEdit: true,
              canSendNow: true,
              canDelete: true,
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/acc_1/outbox`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          accountId: "acc_1",
          items: [
            {
              id: "schedule_1",
              accountId: "acc_1",
              draftId: "draft_1",
              scheduledAt: "2026-06-13T12:30:00.000Z",
              status: "scheduled",
              canEdit: true,
              canSendNow: true,
              canDelete: true,
            },
          ],
        });
      },
      { mailComposeService },
    );
  });

  it("sends a scheduled draft immediately through the compose service", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft() {
        throw new Error("not used");
      },
      async sendDraft() {
        throw new Error("not used");
      },
      async sendScheduledNow(input: unknown) {
        calls.push(input);
        return {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T12:30:00.000Z",
          status: "sent",
          canEdit: false,
          canSendNow: false,
          canDelete: false,
          providerQueueId: "queue_1",
          providerMessageId: "<message@example.com>",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/outbox/schedule_1/send-now`,
          { method: "POST" },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          status: "sent",
          providerQueueId: "queue_1",
          providerMessageId: "<message@example.com>",
        });
        expect(calls).toEqual([{ accountId: "acc_1", scheduledId: "schedule_1" }]);
      },
      { mailComposeService },
    );
  });

  it("reschedules an outbox item through the compose service", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft() {
        throw new Error("not used");
      },
      async sendDraft() {
        throw new Error("not used");
      },
      async rescheduleScheduledSend(input: unknown) {
        calls.push(input);
        return {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T15:45:00.000Z",
          status: "scheduled",
          canEdit: true,
          canSendNow: true,
          canDelete: true,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/outbox/schedule_1`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scheduledAt: "2026-06-13T15:45:00.000Z",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T15:45:00.000Z",
          status: "scheduled",
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            scheduledId: "schedule_1",
            scheduledAt: "2026-06-13T15:45:00.000Z",
          },
        ]);
      },
      { mailComposeService },
    );
  });

  it("cancels an outbox item through the compose service", async () => {
    const calls: unknown[] = [];
    const mailComposeService = {
      async createDraft() {
        throw new Error("not used");
      },
      async sendDraft() {
        throw new Error("not used");
      },
      async cancelScheduledSend(input: unknown) {
        calls.push(input);
        return {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T12:30:00.000Z",
          status: "cancelled",
          canEdit: false,
          canSendNow: false,
          canDelete: false,
          cancelledAt: "2026-06-13T08:00:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/outbox/schedule_1`,
          { method: "DELETE" },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          status: "cancelled",
          canDelete: false,
        });
        expect(calls).toEqual([{ accountId: "acc_1", scheduledId: "schedule_1" }]);
      },
      { mailComposeService },
    );
  });

  it("rejects invalid draft creation requests before provider calls", async () => {
    const mailComposeService = {
      async createDraft() {
        throw new Error("should not be called");
      },
      async sendDraft() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/acc_1/compose/drafts`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              to: [],
              subject: "Launch confirmation",
              bodyText: "Looks good.",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_mail_compose_request",
        });
      },
      { mailComposeService },
    );
  });

  it("returns 503 when compose is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/acc_1/compose/drafts`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: [{ address: "lina@example.com" }],
            bodyText: "Looks good.",
          }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "mail_compose_unavailable",
      });
    });
  });
});
