import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";

let server: Server | undefined;
const DIAGNOSTICS_TOKEN = "diagnostics-secret";
const diagnosticsHeaders = { authorization: `Bearer ${DIAGNOSTICS_TOKEN}` };
const diagnosticsConfig = {
  apiAccessToken: DIAGNOSTICS_TOKEN,
  apiAccessTokenConfigured: true,
};

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

describe("operational event diagnostics routes", () => {
  it("lists durable API and worker diagnostic events with filters", async () => {
    const calls: unknown[] = [];
    const operationalEventLogService = {
      async listEvents(input: unknown) {
        calls.push(input);
        return {
          items: [
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
              context: { workerId: "worker_1" },
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/diagnostics/events?service=email-hub-worker&level=error&event=worker_result&accountId=acc_1&lane=sync&jobId=job_1&requestId=req_1&limit=250`,
          { headers: diagnosticsHeaders },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
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
              context: { workerId: "worker_1" },
            },
          ],
        });
        expect(calls).toEqual([
          {
            service: "email-hub-worker",
            level: "error",
            event: "worker_result",
            accountId: "acc_1",
            lane: "sync",
            jobId: "job_1",
            requestId: "req_1",
            limit: 200,
          },
        ]);
      },
      { ...diagnosticsConfig, operationalEventLogService },
    );
  });

  it("returns 503 until durable operational diagnostics are wired", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/diagnostics/events`, {
          headers: diagnosticsHeaders,
        });

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: "operational_events_unavailable",
        });
      },
      diagnosticsConfig,
    );
  });

  it("requires an explicit API token before listing operational diagnostics", async () => {
    const calls: unknown[] = [];
    const operationalEventLogService = {
      async listEvents(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const noToken = await fetch(`${baseUrl}/api/diagnostics/events`);
        const wrongToken = await fetch(`${baseUrl}/api/diagnostics/events`, {
          headers: { authorization: "Bearer wrong-secret" },
        });
        const validToken = await fetch(`${baseUrl}/api/diagnostics/events`, {
          headers: diagnosticsHeaders,
        });

        expect(noToken.status).toBe(401);
        expect(await noToken.json()).toEqual({ error: "api_unauthorized" });
        expect(wrongToken.status).toBe(401);
        expect(await wrongToken.json()).toEqual({ error: "api_unauthorized" });
        expect(validToken.status).toBe(200);
        expect(await validToken.json()).toEqual({ items: [] });
        expect(calls).toEqual([{}]);
      },
      { ...diagnosticsConfig, operationalEventLogService },
    );
  });

  it("rejects operational diagnostics when no API token is configured", async () => {
    const calls: unknown[] = [];
    const operationalEventLogService = {
      async listEvents(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/diagnostics/events`, {
          headers: diagnosticsHeaders,
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "api_unauthorized" });
        expect(calls).toEqual([]);
      },
      { operationalEventLogService },
    );
  });

  it("rejects malformed operational event filters before hitting the store", async () => {
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
          "/api/diagnostics/events?limit=0",
          "/api/diagnostics/events?limit=1x",
          `/api/diagnostics/events?event=${"x".repeat(257)}`,
          "/api/diagnostics/events?level=verbose",
        ];

        for (const path of cases) {
          const response = await fetch(`${baseUrl}${path}`, {
            headers: diagnosticsHeaders,
          });

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_operational_event_query",
          });
        }
        expect(calls).toEqual([]);
      },
      { ...diagnosticsConfig, operationalEventLogService },
    );
  });
});
