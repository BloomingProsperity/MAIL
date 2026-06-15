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

describe("sync control routes", () => {
  it("queues manual sync through the sync control service", async () => {
    const calls: unknown[] = [];
    const syncControlService = {
      async requestManualSync(input: unknown) {
        calls.push(input);
        return {
          accountId: "acc_1",
          action: "manual_sync_queued",
          job: {
            id: "job_manual",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:manual-sync:acc_1:manual_1",
            status: "queued",
            createdAt: "2026-06-13T08:00:00.000Z",
          },
        };
      },
      async pause() {
        throw new Error("not used");
      },
      async resume() {
        throw new Error("not used");
      },
      async retryFailed() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/sync-center/accounts/acc_1/resync`,
          { method: "POST" },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          accountId: "acc_1",
          action: "manual_sync_queued",
          job: {
            id: "job_manual",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:manual-sync:acc_1:manual_1",
            status: "queued",
            createdAt: "2026-06-13T08:00:00.000Z",
          },
        });
        expect(calls).toEqual([{ accountId: "acc_1" }]);
      },
      { syncControlService },
    );
  });

  it("pauses, resumes, and retries failed jobs through the sync control service", async () => {
    const calls: unknown[] = [];
    const operationalEvents: unknown[] = [];
    const syncControlService = {
      async requestManualSync() {
        throw new Error("not used");
      },
      async pause(input: unknown) {
        calls.push(["pause", input]);
        return {
          accountId: "acc_1",
          action: "sync_paused",
          account: { accountId: "acc_1", syncState: "paused" },
        };
      },
      async resume(input: unknown) {
        calls.push(["resume", input]);
        return {
          accountId: "acc_1",
          action: "sync_resumed",
          account: { accountId: "acc_1", syncState: "syncing" },
        };
      },
      async retryFailed(input: unknown) {
        calls.push(["retry", input]);
        return {
          accountId: "acc_1",
          action: "failed_sync_requeued",
          retriedJobCount: 2,
          retriedJobIds: ["job_1", "job_2"],
        };
      },
    };
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_event_1",
          occurredAt: "2026-06-14T04:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const pause = await fetch(
          `${baseUrl}/api/sync-center/accounts/acc_1/pause`,
          { method: "POST" },
        );
        const resume = await fetch(
          `${baseUrl}/api/sync-center/accounts/acc_1/resume`,
          { method: "POST" },
        );
        const retry = await fetch(
          `${baseUrl}/api/sync-center/accounts/acc_1/retry-failed`,
          { method: "POST" },
        );

        expect(pause.status).toBe(202);
        expect(await pause.json()).toEqual({
          accountId: "acc_1",
          action: "sync_paused",
          account: { accountId: "acc_1", syncState: "paused" },
        });
        expect(resume.status).toBe(202);
        expect(await resume.json()).toEqual({
          accountId: "acc_1",
          action: "sync_resumed",
          account: { accountId: "acc_1", syncState: "syncing" },
        });
        expect(retry.status).toBe(202);
        expect(await retry.json()).toEqual({
          accountId: "acc_1",
          action: "failed_sync_requeued",
          retriedJobCount: 2,
          retriedJobIds: ["job_1", "job_2"],
        });
        expect(calls).toEqual([
          ["pause", { accountId: "acc_1" }],
          ["resume", { accountId: "acc_1" }],
          ["retry", { accountId: "acc_1" }],
        ]);
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "info",
            event: "sync_control_retry_failed",
            accountId: "acc_1",
            message: "Requeued 2 failed sync jobs",
            context: {
              action: "failed_sync_requeued",
              retriedJobCount: 2,
              retriedJobIds: ["job_1", "job_2"],
            },
          },
        ]);
      },
      { syncControlService, operationalEventLogService },
    );
  });

  it("returns 503 when sync control is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/sync-center/accounts/acc_1/resync`,
        { method: "POST" },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "sync_control_unavailable",
      });
    });
  });

  it("does not fail a retry action when diagnostic event recording fails", async () => {
    const syncControlService = {
      async requestManualSync() {
        throw new Error("not used");
      },
      async pause() {
        throw new Error("not used");
      },
      async resume() {
        throw new Error("not used");
      },
      async retryFailed() {
        return {
          accountId: "acc_1",
          action: "failed_sync_requeued",
          retriedJobCount: 1,
          retriedJobIds: ["job_1"],
        };
      },
    };
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent() {
        throw new Error("operational event table is temporarily unavailable");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/sync-center/accounts/acc_1/retry-failed`,
          { method: "POST" },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          accountId: "acc_1",
          action: "failed_sync_requeued",
          retriedJobCount: 1,
          retriedJobIds: ["job_1"],
        });
      },
      { syncControlService, operationalEventLogService },
    );
  });
});
