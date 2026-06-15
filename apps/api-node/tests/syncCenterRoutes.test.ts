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

describe("sync center routes", () => {
  it("lists account sync status through the sync center store", async () => {
    const calls: string[] = [];
    const syncCenterStore = {
      async listAccounts() {
        calls.push("listAccounts");
        return {
          items: [
            {
              accountId: "acc_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              syncState: "syncing",
              engineProvider: "emailengine",
              reauthRequired: false,
              nextAction: "none",
              accountUpdatedAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        };
      },
      async listReauthorizations() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/sync-center/accounts`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              accountId: "acc_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              syncState: "syncing",
              engineProvider: "emailengine",
              reauthRequired: false,
              nextAction: "none",
              accountUpdatedAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        });
        expect(calls).toEqual(["listAccounts"]);
      },
      { syncCenterStore },
    );
  });

  it("lists reauthorization tasks through the sync center store", async () => {
    const calls: string[] = [];
    const syncCenterStore = {
      async listAccounts() {
        throw new Error("not used");
      },
      async listReauthorizations() {
        calls.push("listReauthorizations");
        return {
          items: [
            {
              taskId: "task_1",
              email: "boss@gmail.com",
              provider: "gmail",
              authMethod: "oauth",
              status: "pending",
              source: "account_transfer_import",
              reauthRequired: true,
              loginHint: "boss@gmail.com",
              createdAt: "2026-06-13T08:00:00.000Z",
              updatedAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/sync-center/reauthorizations`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              taskId: "task_1",
              email: "boss@gmail.com",
              provider: "gmail",
              authMethod: "oauth",
              status: "pending",
              source: "account_transfer_import",
              reauthRequired: true,
              loginHint: "boss@gmail.com",
              createdAt: "2026-06-13T08:00:00.000Z",
              updatedAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        });
        expect(calls).toEqual(["listReauthorizations"]);
      },
      { syncCenterStore },
    );
  });

  it("lists account-scoped sync diagnostics across webhook and worker events", async () => {
    const calls: unknown[] = [];
    const operationalEventLogService = {
      async listEvents(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "event_webhook_1",
              occurredAt: "2026-06-14T03:59:58.000Z",
              service: "email-hub-api",
              level: "info",
              event: "emailengine_webhook_ingested",
              accountId: "acc_1",
              lane: "sync",
              jobId: "job_1",
              message: "EmailEngine webhook message_upserted ingested for acc_1",
              context: {
                mailEngineEventId: "mail_event_1",
                syncJobId: "job_1",
                syncJobType: "sync_account",
              },
            },
            {
              id: "event_1",
              occurredAt: "2026-06-14T04:00:00.000Z",
              service: "email-hub-worker",
              level: "error",
              event: "worker_result",
              accountId: "acc_1",
              lane: "sync",
              jobId: "job_1",
              message: "EmailEngine timeout",
              context: {
                workerId: "worker_1",
                result: {
                  status: "failed",
                  accountId: "acc_1",
                  jobId: "job_1",
                },
              },
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/sync-center/accounts/acc_1/diagnostics?limit=250`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              id: "event_webhook_1",
              occurredAt: "2026-06-14T03:59:58.000Z",
              service: "email-hub-api",
              level: "info",
              event: "emailengine_webhook_ingested",
              accountId: "acc_1",
              lane: "sync",
              jobId: "job_1",
              message: "EmailEngine webhook message_upserted ingested for acc_1",
              context: {
                mailEngineEventId: "mail_event_1",
                syncJobId: "job_1",
                syncJobType: "sync_account",
              },
            },
            {
              id: "event_1",
              occurredAt: "2026-06-14T04:00:00.000Z",
              service: "email-hub-worker",
              level: "error",
              event: "worker_result",
              accountId: "acc_1",
              lane: "sync",
              jobId: "job_1",
              message: "EmailEngine timeout",
              context: {
                workerId: "worker_1",
                result: {
                  status: "failed",
                  accountId: "acc_1",
                  jobId: "job_1",
                },
              },
            },
          ],
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            lane: "sync",
            limit: 200,
          },
        ]);
      },
      { operationalEventLogService },
    );
  });

  it("rejects invalid account diagnostic filters before querying events", async () => {
    const calls: unknown[] = [];
    const operationalEventLogService = {
      async listEvents(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const cases = [
          "/api/sync-center/accounts/acc_1/diagnostics?limit=0",
          "/api/sync-center/accounts/acc_1/diagnostics?limit=1x",
          "/api/sync-center/accounts/acc_1/diagnostics?level=verbose",
        ];

        for (const path of cases) {
          const response = await fetch(`${baseUrl}${path}`);

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_operational_event_query",
          });
        }
        expect(calls).toEqual([]);
      },
      { operationalEventLogService },
    );
  });

  it("returns 503 when account sync diagnostics are unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/sync-center/accounts/acc_1/diagnostics`,
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "sync_diagnostics_unavailable",
      });
    });
  });

  it("returns 503 when the sync center store is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const accounts = await fetch(`${baseUrl}/api/sync-center/accounts`);
      const reauth = await fetch(`${baseUrl}/api/sync-center/reauthorizations`);

      expect(accounts.status).toBe(503);
      expect(await accounts.json()).toEqual({
        error: "sync_center_unavailable",
      });
      expect(reauth.status).toBe(503);
      expect(await reauth.json()).toEqual({
        error: "sync_center_unavailable",
      });
    });
  });
});
