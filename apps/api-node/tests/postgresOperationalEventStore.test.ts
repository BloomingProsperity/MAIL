import { describe, expect, it } from "vitest";

import { createPostgresOperationalEventStore } from "../src/logging/postgres-operational-event-store";

describe("Postgres operational event store", () => {
  it("inserts durable diagnostic events for user-triggered backend actions", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresOperationalEventStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "event_1",
              occurred_at: "2026-06-14T04:00:00.000Z",
              service: "email-hub-api",
              level: "info",
              event: "sync_control_retry_failed",
              request_id: "req_1",
              account_id: "acc_1",
              lane: null,
              job_id: "job_1",
              message: "Requeued failed sync jobs",
              context: { retriedJobIds: ["job_1"] },
            },
          ],
        };
      },
    });

    const result = await store.record({
      id: "event_1",
      occurredAt: "2026-06-14T04:00:00.000Z",
      service: "email-hub-api",
      level: "info",
      event: "sync_control_retry_failed",
      requestId: "req_1",
      accountId: "acc_1",
      jobId: "job_1",
      message: "Requeued failed sync jobs",
      context: { retriedJobIds: ["job_1"] },
    });

    expect(queries[0].text).toMatch(/INSERT INTO operational_events/i);
    expect(queries[0].text).toMatch(/RETURNING/i);
    expect(queries[0].values).toEqual([
      "event_1",
      "2026-06-14T04:00:00.000Z",
      "email-hub-api",
      "info",
      "sync_control_retry_failed",
      "req_1",
      "acc_1",
      null,
      "job_1",
      "Requeued failed sync jobs",
      { retriedJobIds: ["job_1"] },
    ]);
    expect(result).toMatchObject({
      id: "event_1",
      service: "email-hub-api",
      event: "sync_control_retry_failed",
      accountId: "acc_1",
      jobId: "job_1",
    });
  });

  it("lists durable diagnostic events with operational filters newest first", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresOperationalEventStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "event_2",
              occurred_at: "2026-06-14T04:00:02.000Z",
              service: "email-hub-worker",
              level: "error",
              event: "worker_result",
              request_id: null,
              account_id: "acc_1",
              lane: "sync",
              job_id: "job_1",
              message: "EmailEngine timeout",
              context: { workerId: "worker_1", retryable: true },
            },
          ],
        };
      },
    });

    const result = await store.list({
      service: "email-hub-worker",
      level: "error",
      event: "worker_result",
      accountId: "acc_1",
      lane: "sync",
      jobId: "job_1",
      limit: 25,
    });

    expect(result).toEqual({
      items: [
        {
          id: "event_2",
          occurredAt: "2026-06-14T04:00:02.000Z",
          service: "email-hub-worker",
          level: "error",
          event: "worker_result",
          accountId: "acc_1",
          lane: "sync",
          jobId: "job_1",
          message: "EmailEngine timeout",
          context: { workerId: "worker_1", retryable: true },
        },
      ],
    });
    expect(queries[0].text).toMatch(/FROM operational_events/i);
    expect(queries[0].text).toMatch(/service = \$1/i);
    expect(queries[0].text).toMatch(/level = \$2/i);
    expect(queries[0].text).toMatch(/event = \$3/i);
    expect(queries[0].text).toMatch(/account_id = \$4/i);
    expect(queries[0].text).toMatch(/lane = \$5/i);
    expect(queries[0].text).toMatch(/job_id = \$6/i);
    expect(queries[0].text).toMatch(/ORDER BY occurred_at DESC, id DESC/i);
    expect(queries[0].text).toMatch(/LIMIT \$7/i);
    expect(queries[0].values).toEqual([
      "email-hub-worker",
      "error",
      "worker_result",
      "acc_1",
      "sync",
      "job_1",
      25,
    ]);
  });
});
