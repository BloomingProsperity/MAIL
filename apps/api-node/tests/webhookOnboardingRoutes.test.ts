import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiHandler } from "../src/http/router";
import {
  createInMemoryMailEngineIngestStore,
  type InMemoryMailEngineIngestStore,
} from "../src/mail-engine/ingest-store";

let server: Server | undefined;

async function withApi(
  test: (
    baseUrl: string,
    store: InMemoryMailEngineIngestStore,
  ) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const store = createInMemoryMailEngineIngestStore();
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      mailEngineIngestStore: store,
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

  await test(`http://127.0.0.1:${address.port}`, store);
}

function sign(body: string): string {
  return createHmac("sha256", "webhook-secret").update(body).digest("base64url");
}

function webhookBody(payload: Record<string, unknown>): string {
  return JSON.stringify({
    date: new Date().toISOString(),
    ...payload,
  });
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

describe("API webhook and onboarding routes", () => {
  it("rejects unsigned EmailEngine webhooks", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        body: JSON.stringify({ event: "messageNew", account: "acc_1" }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "invalid_emailengine_signature",
      });
    });
  });

  it("accepts signed EmailEngine webhooks, stores events, and queues sync jobs", async () => {
    await withApi(
      async (baseUrl, store) => {
        const body = webhookBody({
          event: "messageDeleted",
          account: "acc_1",
          data: { id: "msg_1" },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

        expect(response.status).toBe(202);
        const payload = await response.json();

        expect(payload).toMatchObject({
          events: [
            {
              source: "emailengine_webhook",
              kind: "message_deleted",
              accountId: "acc_1",
              providerMessageId: "msg_1",
              idempotencyKey: expect.stringMatching(
                /^emailengine:acc_1:messageDeleted:msg_1:/,
              ),
            },
          ],
          duplicateCount: 0,
        });
        expect(payload.storedEvents[0]).toMatchObject({
          kind: "message_deleted",
          accountId: "acc_1",
          providerMessageId: "msg_1",
          duplicate: false,
        });
        expect(payload.syncJobs[0]).toMatchObject({
          jobType: "sync_account",
          accountId: "acc_1",
          status: "queued",
        });
        expect(store.listEvents()).toHaveLength(1);
        expect(store.listSyncJobs()).toHaveLength(1);
      },
      {
        apiAccessToken: "api-secret",
        apiAccessTokenConfigured: true,
        apiAccessTokenRequired: true,
      },
    );
  });

  it("records EmailEngine webhook ingest diagnostics without storing raw payload secrets", async () => {
    const operationalEvents: unknown[] = [];
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_webhook_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const body = webhookBody({
          event: "authenticationError",
          account: "acc_2",
          data: { secret: "raw-webhook-secret" },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-request-id": "req_webhook_1",
          },
          body,
        });

        expect(response.status).toBe(202);
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "info",
            event: "emailengine_webhook_ingested",
            requestId: "req_webhook_1",
            accountId: "acc_2",
            lane: "sync",
            jobId: expect.any(String),
            message: "EmailEngine webhook auth_failed ingested for acc_2",
            context: {
              duplicate: false,
              mailEngineEventId: expect.any(String),
              mailEngineEventKind: "auth_failed",
              mailEngineIdempotencyKey: expect.stringMatching(
                /^emailengine:acc_2:authenticationError:authenticationError:/,
              ),
              syncJobId: expect.any(String),
              syncJobType: "account_state",
            },
          },
        ]);
        expect(JSON.stringify(operationalEvents)).not.toContain(
          "raw-webhook-secret",
        );
      },
      { operationalEventLogService },
    );
  });

  it("records EmailEngine webhook resource identity so real smoke can match the delivered Message-ID", async () => {
    const operationalEvents: unknown[] = [];
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_webhook_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const body = webhookBody({
          event: "messageNew",
          account: "acc_1",
          path: "INBOX",
          data: {
            id: "ee_msg_1",
            emailId: "ee_email_1",
            threadId: "thread_1",
            messageId:
              "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
            secret: "raw-webhook-secret",
          },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-request-id": "req_webhook_msg_1",
          },
          body,
        });

        expect(response.status).toBe(202);
        expect(operationalEvents).toEqual([
          expect.objectContaining({
            event: "emailengine_webhook_ingested",
            accountId: "acc_1",
            lane: "sync",
            context: expect.objectContaining({
              mailEngineEventKind: "message_upserted",
              rfcMessageId:
                "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
              providerMessageId: "ee_msg_1",
              resourceIdentity: {
                emailengineMessageId: "ee_msg_1",
                emailengineEmailId: "ee_email_1",
                internetMessageId:
                  "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                mailboxPath: "INBOX",
                threadId: "thread_1",
                resourceKey: "emailengine:acc_1:emailId:ee_email_1",
              },
            }),
          }),
        ]);
        expect(JSON.stringify(operationalEvents)).not.toContain(
          "raw-webhook-secret",
        );
      },
      { operationalEventLogService },
    );
  });

  it("does not enqueue duplicate jobs for repeated signed webhooks", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageNew",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = () =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

      expect((await request()).status).toBe(202);
      const duplicateResponse = await request();

      expect(duplicateResponse.status).toBe(202);
      expect(await duplicateResponse.json()).toMatchObject({
        duplicateCount: 1,
        syncJobs: [],
      });
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("rejects signed EmailEngine webhooks outside the freshness window before ingesting", async () => {
    await withApi(
      async (baseUrl, store) => {
        const body = webhookBody({
          date: "2026-06-17T09:50:00.000Z",
          event: "messageNew",
          account: "acc_1",
          data: { id: "msg_1" },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: "stale_emailengine_webhook",
        });
        expect(store.listEvents()).toHaveLength(0);
        expect(store.listSyncJobs()).toHaveLength(0);
      },
      {
        now: () => new Date("2026-06-17T10:00:01.000Z"),
        emailEngineWebhookMaxSkewMs: 10 * 60 * 1000,
      },
    );
  });

  it("rejects signed EmailEngine webhooks without a valid payload date", async () => {
    await withApi(async (baseUrl, store) => {
      const body = JSON.stringify({
        event: "messageNew",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ee-wh-signature": sign(body),
        },
        body,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_emailengine_webhook_date",
      });
      expect(store.listEvents()).toHaveLength(0);
      expect(store.listSyncJobs()).toHaveLength(0);
    });
  });

  it("rejects oversized EmailEngine webhooks before ingesting them", async () => {
    await withApi(
      async (baseUrl, store) => {
        const body = webhookBody({
          event: "messageNew",
          account: "acc_1",
          data: { id: "msg_1" },
          padding: "x".repeat(256),
        });

        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          error: "request_body_too_large",
        });
        expect(store.listEvents()).toHaveLength(0);
        expect(store.listSyncJobs()).toHaveLength(0);
      },
      { maxRequestBodyBytes: 64 },
    );
  });

  it("queues later updates for the same EmailEngine message when webhook ids differ", async () => {
    await withApi(async (baseUrl, store) => {
      const messageNew = webhookBody({
        event: "messageNew",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const messageUpdated = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: {
          id: "msg_1",
          changes: { flags: { added: ["\\Seen"], value: ["\\Seen"] } },
        },
      });

      const first = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ee-wh-signature": sign(messageNew),
          "x-ee-wh-event-id": "evt_new",
        },
        body: messageNew,
      });
      const second = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ee-wh-signature": sign(messageUpdated),
          "x-ee-wh-event-id": "evt_updated",
        },
        body: messageUpdated,
      });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(await second.json()).toMatchObject({
        duplicateCount: 0,
        syncJobs: [
          {
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: expect.stringMatching(
              /^job:emailengine:acc_1:messageUpdated:msg_1:/,
            ),
          },
        ],
      });
      expect(store.listEvents()).toHaveLength(2);
      expect(store.listSyncJobs()).toHaveLength(2);
    });
  });

  it("deduplicates repeated webhook deliveries with the same EmailEngine event id", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = () =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-ee-wh-event-id": "evt_same",
          },
          body,
        });

      expect((await request()).status).toBe(202);
      const duplicate = await request();

      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toMatchObject({
        duplicateCount: 1,
        syncJobs: [],
      });
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("deduplicates replayed signed webhook bodies even when the unsigned event id header changes", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = (eventId: string) =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-ee-wh-event-id": eventId,
          },
          body,
        });

      expect((await request("evt_original")).status).toBe(202);
      const replay = await request("evt_replayed");

      expect(replay.status).toBe(202);
      expect(await replay.json()).toMatchObject({
        duplicateCount: 1,
        syncJobs: [],
      });
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("deduplicates a burst of concurrent repeated webhook deliveries", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = () =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-ee-wh-event-id": "evt_burst",
          },
          body,
        });

      const responses = await Promise.all(
        Array.from({ length: 64 }, () => request()),
      );
      const payloads = await Promise.all(
        responses.map(async (response) => ({
          status: response.status,
          body: await response.json(),
        })),
      );

      expect(payloads.every((payload) => payload.status === 202)).toBe(true);
      expect(
        payloads.reduce(
          (total, payload) => total + payload.body.duplicateCount,
          0,
        ),
      ).toBe(63);
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("starts IMAP/SMTP account onboarding through the account service", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "completed",
          },
          account: {
            id: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "support@qq.com",
            provider: "qq",
            displayName: "Support",
            imap: {
              host: "imap.qq.com",
              port: 993,
              secure: true,
              username: "support@qq.com",
              secret: "imap-auth-code",
            },
            smtp: {
              host: "smtp.qq.com",
              port: 465,
              secure: true,
              username: "support@qq.com",
              secret: "smtp-auth-code",
            },
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "completed",
          },
          account: {
            id: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
        });
        expect(calls).toEqual([
          {
            email: "support@qq.com",
            provider: "qq",
            displayName: "Support",
            imap: {
              host: "imap.qq.com",
              port: 993,
              secure: true,
              username: "support@qq.com",
              secret: "imap-auth-code",
            },
            smtp: {
              host: "smtp.qq.com",
              port: 465,
              secure: true,
              username: "support@qq.com",
              secret: "smtp-auth-code",
            },
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("starts iCloud onboarding with provider preset credentials", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_icloud",
            email: "me@icloud.com",
            provider: "icloud",
            authMethod: "password",
            status: "completed",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "me@icloud.com",
            provider: "icloud",
            displayName: "iCloud Mail",
            username: "me@icloud.com",
            secret: "apple-app-specific-password",
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_icloud",
            email: "me@icloud.com",
            provider: "icloud",
            authMethod: "password",
            status: "completed",
          },
        });
        expect(calls).toEqual([
          {
            email: "me@icloud.com",
            provider: "icloud",
            displayName: "iCloud Mail",
            username: "me@icloud.com",
            secret: "apple-app-specific-password",
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("starts preset IMAP/SMTP onboarding without manual server settings", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_163",
            email: "archive@163.com",
            provider: "163",
            authMethod: "password",
            status: "completed",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "archive@163.com",
            provider: "163",
            displayName: "NetEase 163",
            secret: "netease-auth-code",
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_163",
            email: "archive@163.com",
            provider: "163",
            authMethod: "password",
            status: "completed",
          },
        });
        expect(calls).toEqual([
          {
            email: "archive@163.com",
            provider: "163",
            displayName: "NetEase 163",
            secret: "netease-auth-code",
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("rejects invalid IMAP/SMTP onboarding requests before calling the service", async () => {
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "qq",
            imap: { host: "imap.qq.com", port: 993, secure: true },
            smtp: { host: "smtp.qq.com", port: 465, secure: true },
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_imap_smtp_account",
          detail: "email is required",
        });
      },
      { accountOnboardingService },
    );
  });

  it("explains IMAP/SMTP onboarding cannot run until EmailEngine token is configured", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "support@qq.com",
          provider: "qq",
          secret: "qq-auth-code",
        }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "emailengine_configuration_required",
        capability: "imap_smtp_onboarding",
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
      });
    });
  });

  it("tests IMAP/SMTP credentials without starting onboarding", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("should not start onboarding");
      },
      async testImapSmtpConnection(input: unknown) {
        calls.push(input);
        return {
          provider: "qq",
          ok: true,
          checks: {
            imap: { ok: true },
            smtp: { ok: true },
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/imap-smtp/test`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "support@qq.com",
              provider: "qq",
              secret: "qq-auth-code",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          provider: "qq",
          ok: true,
          checks: {
            imap: { ok: true },
            smtp: { ok: true },
          },
        });
        expect(calls).toEqual([
          {
            email: "support@qq.com",
            provider: "qq",
            secret: "qq-auth-code",
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("explains IMAP/SMTP connection tests cannot run until EmailEngine token is configured", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/accounts/imap-smtp/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "support@qq.com",
          provider: "qq",
          secret: "qq-auth-code",
        }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "emailengine_configuration_required",
        capability: "imap_smtp_onboarding",
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
      });
    });
  });

  it("rejects invalid IMAP/SMTP connection tests before calling the service", async () => {
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("should not be called");
      },
      async testImapSmtpConnection() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/imap-smtp/test`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              provider: "qq",
              secret: "qq-auth-code",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_imap_smtp_connection_test",
          detail: "email is required",
        });
      },
      { accountOnboardingService },
    );
  });
});
