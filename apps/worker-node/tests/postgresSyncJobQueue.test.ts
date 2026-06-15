import { describe, expect, it } from "vitest";

import { createPostgresSyncJobQueue } from "../src/postgres-sync-job-queue";

describe("postgres sync job queue", () => {
  it("claims due or expired jobs with SKIP LOCKED, per-account serialization, and deterministic ordering", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: "INBOX",
              trigger_event_id: "event_1",
              idempotency_key: "job:event_1",
              status: "running",
              attempts: 1,
              max_attempts: 8,
              not_before: "2026-06-12T09:00:00.000Z",
              lease_owner: "worker-a",
              lease_expires_at: "2026-06-12T09:00:30.000Z",
              payload: {},
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T09:00:00.000Z",
            },
          ],
        };
      },
    };

    const queue = createPostgresSyncJobQueue(client);
    const claimed = await queue.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-12T09:00:00.000Z"),
      leaseSeconds: 30,
    });

    expect(queries[0].text).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(queries[0].text).toMatch(/lease_owner/i);
    expect(queries[0].text).toMatch(/lease_expires_at/i);
    expect(queries[0].text).toMatch(/error_message = NULL/i);
    expect(queries[0].text).toMatch(/NOT EXISTS/i);
    expect(queries[0].text).toMatch(/active_same_account/i);
    expect(queries[0].text).toMatch(/pg_try_advisory_xact_lock/i);
    expect(queries[0].text).toMatch(/hashtextextended/i);
    expect(queries[0].text).toMatch(
      /active_same_account\.lease_expires_at > \$1::timestamptz/i,
    );
    expect(queries[0].text).toMatch(
      /ORDER BY not_before ASC,\s*created_at ASC,\s*id ASC/i,
    );
    expect(claimed).toMatchObject({
      id: "job_1",
      status: "running",
      leaseOwner: "worker-a",
    });
  });

  it("dead-letters exhausted jobs and requeues retryable jobs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: null,
              trigger_event_id: "event_1",
              idempotency_key: "job:event_1",
              status: "dead_letter",
              attempts: 8,
              max_attempts: 8,
              not_before: "2026-06-12T09:00:00.000Z",
              lease_owner: null,
              lease_expires_at: null,
              payload: {},
              error_message: "boom",
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T09:00:00.000Z",
            },
          ],
        };
      },
    };

    const queue = createPostgresSyncJobQueue(client);
    const failed = await queue.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "boom",
      now: new Date("2026-06-12T09:00:00.000Z"),
    });

    expect(queries[0].text).toMatch(
      /CASE WHEN \$5 = FALSE OR attempts >= max_attempts/i,
    );
    expect(queries[0].text).toMatch(/POWER/i);
    expect(queries[0].text).toMatch(/LEAST/i);
    expect(queries[0].text).toMatch(/dead_letter/i);
    expect(failed.status).toBe("dead_letter");
  });

  it("dead-letters non-retryable failures without waiting for max attempts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: null,
              trigger_event_id: "event_1",
              idempotency_key: "job:event_1",
              status: "dead_letter",
              attempts: 1,
              max_attempts: 8,
              not_before: "2026-06-12T09:00:00.000Z",
              lease_owner: null,
              lease_expires_at: null,
              payload: {},
              error_message: "mailbox path is not configured",
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T09:00:00.000Z",
            },
          ],
        };
      },
    };

    const queue = createPostgresSyncJobQueue(client);
    const failed = await queue.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "mailbox path is not configured",
      retryable: false,
      now: new Date("2026-06-12T09:00:00.000Z"),
    });

    expect(queries[0].text).toMatch(/\$5 = FALSE/i);
    expect(queries[0].text).toMatch(/attempts >= max_attempts/i);
    expect(queries[0].values).toEqual([
      "job_1",
      "worker-a",
      "mailbox path is not configured",
      "2026-06-12T09:00:00.000Z",
      false,
    ]);
    expect(failed).toMatchObject({
      status: "dead_letter",
      attempts: 1,
      errorMessage: "mailbox path is not configured",
    });
  });

  it("clears stale error messages when completing a retried job", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const queue = createPostgresSyncJobQueue({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: null,
              trigger_event_id: "event_1",
              idempotency_key: "job:event_1",
              status: "done",
              attempts: 2,
              max_attempts: 8,
              not_before: "2026-06-12T09:00:00.000Z",
              lease_owner: null,
              lease_expires_at: null,
              payload: {},
              error_message: null,
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T09:00:30.000Z",
              completed_at: "2026-06-12T09:00:30.000Z",
            },
          ],
        };
      },
    });

    const completed = await queue.completeJob({
      jobId: "job_1",
      workerId: "worker-a",
      now: new Date("2026-06-12T09:00:30.000Z"),
    });

    expect(queries[0].text).toMatch(/error_message = NULL/i);
    expect(completed).toMatchObject({
      id: "job_1",
      status: "done",
      completedAt: "2026-06-12T09:00:30.000Z",
    });
    expect(completed.errorMessage).toBeUndefined();
  });

  it("enqueues continuation jobs with NULL trigger_event_id and idempotency", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_next",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: null,
              trigger_event_id: null,
              idempotency_key: "native-continuation:acc_1:gmail:page-2",
              status: "queued",
              attempts: 0,
              max_attempts: 8,
              not_before: "2026-06-12T09:00:00.000Z",
              lease_owner: null,
              lease_expires_at: null,
              payload: { kind: "native_continuation" },
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T09:00:00.000Z",
              completed_at: null,
            },
          ],
        };
      },
    };

    const queue = createPostgresSyncJobQueue(client);
    const queued = await queue.enqueueJob({
      id: "job_next",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "native-continuation:acc_1:gmail:page-2",
      notBefore: "2026-06-12T09:00:00.000Z",
      payload: { kind: "native_continuation" },
    });

    expect(queries[0].text).toMatch(/INSERT INTO sync_jobs/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(idempotency_key\)/i);
    expect(queries[0].values).toEqual([
      "job_next",
      "sync_account",
      "acc_1",
      null,
      null,
      "native-continuation:acc_1:gmail:page-2",
      8,
      "2026-06-12T09:00:00.000Z",
      { kind: "native_continuation" },
    ]);
    expect(queued).toMatchObject({
      id: "job_next",
      status: "queued",
    });
    expect(queued.triggerEventId).toBeUndefined();
  });

  it("throws when complete or fail cannot find an owned lease", async () => {
    const client = {
      async query() {
        return { rows: [] };
      },
    };
    const queue = createPostgresSyncJobQueue(client);

    await expect(
      queue.completeJob({
        jobId: "job_1",
        workerId: "worker-b",
        now: new Date("2026-06-12T09:00:00.000Z"),
      }),
    ).rejects.toThrow("job lease is not owned by worker-b");

    await expect(
      queue.failJob({
        jobId: "job_1",
        workerId: "worker-b",
        errorMessage: "boom",
        now: new Date("2026-06-12T09:00:00.000Z"),
      }),
    ).rejects.toThrow("job lease is not owned by worker-b");
  });
});
