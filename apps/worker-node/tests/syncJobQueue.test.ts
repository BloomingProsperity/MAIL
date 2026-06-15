import { describe, expect, it } from "vitest";

import {
  createInMemorySyncJobQueue,
  type SyncJobRecord,
} from "../src/sync-job-queue";

const now = new Date("2026-06-12T09:00:00.000Z");

function job(overrides: Partial<SyncJobRecord> = {}): SyncJobRecord {
  return {
    id: "job_1",
    jobType: "sync_account",
    accountId: "acc_1",
    mailboxId: "INBOX",
    triggerEventId: "event_1",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    notBefore: now.toISOString(),
    payload: {},
    idempotencyKey: "job:event_1",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("sync job queue", () => {
  it("claims a due queued job and protects it with a lease", async () => {
    const queue = createInMemorySyncJobQueue([job()]);

    const claimed = await queue.claimNext({
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
    });

    expect(claimed).toMatchObject({
      id: "job_1",
      status: "running",
      attempts: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: "2026-06-12T09:00:30.000Z",
    });
    expect(
      await queue.claimNext({ workerId: "worker-b", now, leaseSeconds: 30 }),
    ).toBeUndefined();
  });

  it("keeps one active job per account while other accounts can still run", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        id: "job_running_acc_1",
        status: "running",
        attempts: 1,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
        idempotencyKey: "job:running-acc-1",
      }),
      job({
        id: "job_queued_same_account",
        accountId: "acc_1",
        idempotencyKey: "job:queued-same-account",
      }),
      job({
        id: "job_queued_other_account",
        accountId: "acc_2",
        idempotencyKey: "job:queued-other-account",
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-b",
      now,
      leaseSeconds: 30,
    });

    expect(claimed?.id).toBe("job_queued_other_account");
    expect(queue.listJobs()[1]).toMatchObject({
      id: "job_queued_same_account",
      status: "queued",
    });
  });

  it("claims the earliest due job first when the backlog is out of insertion order", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        id: "job_later",
        accountId: "acc_later",
        idempotencyKey: "job:later",
        notBefore: "2026-06-12T09:00:20.000Z",
        createdAt: "2026-06-12T09:00:20.000Z",
      }),
      job({
        id: "job_earlier",
        accountId: "acc_earlier",
        idempotencyKey: "job:earlier",
        notBefore: "2026-06-12T09:00:00.000Z",
        createdAt: "2026-06-12T09:00:00.000Z",
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-12T09:00:30.000Z"),
      leaseSeconds: 30,
    });

    expect(claimed?.id).toBe("job_earlier");
  });

  it("enqueues continuation jobs idempotently without a trigger event", async () => {
    const queue = createInMemorySyncJobQueue([]);

    const first = await queue.enqueueJob({
      id: "job_next",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "native-continuation:acc_1:gmail:page-2",
      notBefore: now.toISOString(),
      payload: { kind: "native_continuation" },
    });
    const duplicate = await queue.enqueueJob({
      id: "job_duplicate",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "native-continuation:acc_1:gmail:page-2",
      notBefore: now.toISOString(),
      payload: { kind: "native_continuation" },
    });

    expect(first).toMatchObject({
      id: "job_next",
      status: "queued",
    });
    expect(first.triggerEventId).toBeUndefined();
    expect(duplicate.id).toBe("job_next");
    expect(queue.listJobs()).toHaveLength(1);
  });

  it("allows another worker to reclaim an expired lease", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        status: "running",
        attempts: 1,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T08:59:59.000Z",
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-b",
      now,
      leaseSeconds: 30,
    });

    expect(claimed).toMatchObject({
      id: "job_1",
      status: "running",
      attempts: 2,
      leaseOwner: "worker-b",
    });
  });

  it("clears stale error messages when a retry is claimed", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        status: "queued",
        attempts: 1,
        errorMessage: "provider temporarily unavailable",
        notBefore: now.toISOString(),
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-b",
      now,
      leaseSeconds: 30,
    });

    expect(claimed).toMatchObject({
      id: "job_1",
      status: "running",
      attempts: 2,
      leaseOwner: "worker-b",
    });
    expect(claimed?.errorMessage).toBeUndefined();
    expect(queue.listJobs()[0].errorMessage).toBeUndefined();
  });

  it("requeues failed jobs through maxAttempts, then dead-letters on the exhausted attempt", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        status: "running",
        attempts: 1,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
      }),
    ]);

    const retry = await queue.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "provider temporarily unavailable",
      now,
    });

    expect(retry).toMatchObject({
      status: "queued",
      attempts: 1,
      notBefore: "2026-06-12T09:00:30.000Z",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });

    await queue.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-12T09:00:31.000Z"),
      leaseSeconds: 30,
    });
    const retryAgain = await queue.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "provider still unavailable",
      now: new Date("2026-06-12T09:00:32.000Z"),
    });

    expect(retryAgain).toMatchObject({
      status: "queued",
      attempts: 2,
      notBefore: "2026-06-12T09:01:32.000Z",
      errorMessage: "provider still unavailable",
    });

    await queue.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-12T09:01:33.000Z"),
      leaseSeconds: 30,
    });
    const dead = await queue.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "provider exhausted",
      now: new Date("2026-06-12T09:01:34.000Z"),
    });

    expect(dead).toMatchObject({
      status: "dead_letter",
      attempts: 3,
      errorMessage: "provider exhausted",
    });
  });

  it("dead-letters non-retryable failures immediately", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        status: "running",
        attempts: 1,
        maxAttempts: 8,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
      }),
    ]);

    const failed = await queue.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "mailbox path is not configured",
      retryable: false,
      now,
    });

    expect(failed).toMatchObject({
      status: "dead_letter",
      attempts: 1,
      notBefore: now.toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      errorMessage: "mailbox path is not configured",
    });
  });

  it("clears stale error messages when a retried job completes", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        status: "running",
        attempts: 2,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
        errorMessage: "provider temporarily unavailable",
      }),
    ]);

    const completed = await queue.completeJob({
      jobId: "job_1",
      workerId: "worker-a",
      now,
    });

    expect(completed).toMatchObject({
      status: "done",
      completedAt: now.toISOString(),
    });
    expect(completed.errorMessage).toBeUndefined();
    expect(queue.listJobs()[0].errorMessage).toBeUndefined();
  });

  it("marks a running job done only for its lease owner", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        status: "running",
        attempts: 1,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
      }),
    ]);

    await expect(
      queue.completeJob({
        jobId: "job_1",
        workerId: "worker-b",
        now,
      }),
    ).rejects.toThrow("job lease is not owned by worker-b");

    await expect(
      queue.completeJob({
        jobId: "job_1",
        workerId: "worker-a",
        now,
      }),
    ).resolves.toMatchObject({
      status: "done",
      completedAt: now.toISOString(),
    });
  });
});
