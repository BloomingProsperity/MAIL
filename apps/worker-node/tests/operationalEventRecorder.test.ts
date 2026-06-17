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
        endpointUrl: "/oauth/callback?code=raw-code&state=state_1",
        inputMode: "preset",
        message: "subject should not be logged",
        subject: "Reset your password",
        bodyText: "Private body",
        providerPayload: { id: "provider-message" },
        prompt: "Summarize this mailbox",
        output: "Private model output",
        error: new Error("cookie raw-cookie leaked"),
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
        endpointUrl: "/oauth/callback?code=%5Bredacted%5D&state=state_1",
        inputMode: "preset",
        message: "[redacted]",
        error: {
          name: "Error",
          message: "[redacted]",
        },
      },
    ]);
    expect(JSON.stringify(queries[0].values)).not.toContain("raw-");
    expect(JSON.stringify(queries[0].values)).not.toContain("Private body");
    expect(JSON.stringify(queries[0].values)).not.toContain("provider-message");
    expect(JSON.stringify(queries[0].values)).not.toContain("Summarize this mailbox");
  });
});
