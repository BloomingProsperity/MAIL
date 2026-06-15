import { describe, expect, it } from "vitest";

import { createPostgresOperationalEventRecorder } from "../src/logging/operational-events";

describe("worker operational event recorder", () => {
  it("persists sanitized worker diagnostics for later API queries", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const recorder = createPostgresOperationalEventRecorder(
      {
        async query(text: string, values?: unknown[]) {
          queries.push({ text, values });
          return { rows: [] };
        },
      },
      {
        createId: () => "event_1",
        now: () => "2026-06-14T04:00:00.000Z",
      },
    );

    await recorder.record({
      service: "email-hub-worker",
      level: "error",
      event: "worker_result",
      accountId: "acc_1",
      lane: "sync",
      jobId: "job_1",
      message: "EmailEngine timeout",
      context: {
        workerId: "worker_1",
        callbackUrl: "/oauth/callback?code=raw-code&state=state_1",
        refreshToken: "raw-refresh-token",
        nested: { apiKey: "raw-api-key" },
      },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/INSERT INTO operational_events/i);
    expect(queries[0].values).toEqual([
      "event_1",
      "2026-06-14T04:00:00.000Z",
      "email-hub-worker",
      "error",
      "worker_result",
      null,
      "acc_1",
      "sync",
      "job_1",
      "EmailEngine timeout",
      {
        workerId: "worker_1",
        callbackUrl: "/oauth/callback?code=%5Bredacted%5D&state=state_1",
        refreshToken: "[redacted]",
        nested: { apiKey: "[redacted]" },
      },
    ]);
    expect(JSON.stringify(queries[0].values)).not.toContain("raw-");
  });
});
