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

describe("Hermes retention maintenance routes", () => {
  it("returns Hermes retention maintenance status", async () => {
    const calls: string[] = [];
    const hermesRetentionMaintenanceService = {
      async getStatus() {
        calls.push("status");
        return {
          generatedAt: "2026-06-17T12:00:00.000Z",
          retentionMs: 2592000000,
          retentionDays: 30,
          cleanupLimit: 500,
          cutoff: "2026-05-18T12:00:00.000Z",
          tables: [
            {
              table: "hermes_skill_runs",
              timestampColumn: "created_at",
              expiredRows: 12,
              scanLimit: 500,
              scanLimited: false,
            },
          ],
          expiredRows: 12,
          scanLimited: false,
        };
      },
      async cleanup() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/maintenance/hermes-retention`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          retentionDays: 30,
          cleanupLimit: 500,
          expiredRows: 12,
          tables: [{ table: "hermes_skill_runs", expiredRows: 12 }],
        });
      },
      { hermesRetentionMaintenanceService },
    );
    expect(calls).toEqual(["status"]);
  });

  it("runs bounded Hermes retention cleanup", async () => {
    const calls: unknown[] = [];
    const hermesRetentionMaintenanceService = {
      async getStatus() {
        throw new Error("not used");
      },
      async cleanup(input: unknown) {
        calls.push(input);
        return {
          generatedAt: "2026-06-17T12:00:00.000Z",
          retentionMs: 1209600000,
          retentionDays: 14,
          cleanupLimit: 25,
          cutoff: "2026-06-03T12:00:00.000Z",
          cleanup: {
            messageTranslations: 1,
            messageSummaries: 2,
            actionPlans: 3,
            feedback: 4,
            auditEvents: 5,
            skillRuns: 6,
            deleted: 21,
          },
          after: {
            generatedAt: "2026-06-17T12:00:00.000Z",
            retentionMs: 1209600000,
            retentionDays: 14,
            cleanupLimit: 25,
            cutoff: "2026-06-03T12:00:00.000Z",
            tables: [],
            expiredRows: 0,
            scanLimited: false,
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/maintenance/hermes-retention/cleanup`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ retentionDays: 14, limit: 25 }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          cleanup: { deleted: 21, skillRuns: 6 },
          after: { expiredRows: 0 },
        });
      },
      { hermesRetentionMaintenanceService },
    );
    expect(calls).toEqual([{ retentionDays: 14, limit: 25 }]);
  });

  it("rejects invalid Hermes retention cleanup requests", async () => {
    const hermesRetentionMaintenanceService = {
      async getStatus() {
        throw new Error("not used");
      },
      async cleanup() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/maintenance/hermes-retention/cleanup`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ retentionDays: 0, limit: 10001 }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_retention_maintenance_request",
        });
      },
      { hermesRetentionMaintenanceService },
    );
  });

  it("returns 503 until Hermes retention maintenance is wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/maintenance/hermes-retention`,
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_retention_maintenance_unavailable",
      });
    });
  });
});
