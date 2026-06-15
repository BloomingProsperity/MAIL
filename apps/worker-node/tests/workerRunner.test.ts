import { describe, expect, it, vi } from "vitest";

import {
  createInMemorySyncJobQueue,
  type SyncJobRecord,
} from "../src/sync-job-queue";
import { NonRetryableQueueError } from "../src/queue-errors";
import { runWorkerBatch, runWorkerOnce } from "../src/worker-runner";

const now = new Date("2026-06-12T09:00:00.000Z");

function job(overrides: Partial<SyncJobRecord> = {}): SyncJobRecord {
  return {
    id: "job_1",
    jobType: "sync_account",
    accountId: "acc_1",
    triggerEventId: "event_1",
    idempotencyKey: "job:event_1",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    notBefore: now.toISOString(),
    payload: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("worker runner", () => {
  it("claims one due job, runs the handler, and completes it", async () => {
    const queue = createInMemorySyncJobQueue([job()]);
    const handleJob = vi.fn().mockResolvedValue(undefined);

    const result = await runWorkerOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleJob,
    });

    expect(result).toEqual({
      status: "processed",
      jobId: "job_1",
      accountId: "acc_1",
      jobType: "sync_account",
      triggerEventId: "event_1",
      idempotencyKey: "job:event_1",
    });
    expect(handleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job_1",
        status: "running",
      }),
    );
    expect(queue.listJobs()[0]).toMatchObject({
      status: "done",
      completedAt: now.toISOString(),
    });
  });

  it("returns account and job context for sync diagnostics", async () => {
    const queue = createInMemorySyncJobQueue([
      job({
        id: "job_diagnostic",
        accountId: "acc_diagnostic",
        jobType: "sync_account",
        triggerEventId: "event_diagnostic",
        idempotencyKey: "job:event_diagnostic",
      }),
    ]);

    await expect(
      runWorkerOnce({
        queue,
        workerId: "worker-a",
        now,
        leaseSeconds: 30,
        handleJob: async () => undefined,
      }),
    ).resolves.toEqual({
      status: "processed",
      jobId: "job_diagnostic",
      accountId: "acc_diagnostic",
      jobType: "sync_account",
      triggerEventId: "event_diagnostic",
      idempotencyKey: "job:event_diagnostic",
    });
  });

  it("fails the job when the handler throws", async () => {
    const queue = createInMemorySyncJobQueue([job()]);

    const result = await runWorkerOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleJob: async () => {
        throw new Error("EmailEngine unavailable");
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      jobId: "job_1",
      accountId: "acc_1",
      jobType: "sync_account",
      triggerEventId: "event_1",
      errorMessage: "EmailEngine unavailable",
      finalJobStatus: "queued",
      attempts: 1,
      maxAttempts: 3,
      retryable: true,
      nextRunAt: "2026-06-12T09:00:30.000Z",
    });
    expect(queue.listJobs()[0]).toMatchObject({
      status: "queued",
      errorMessage: "EmailEngine unavailable",
    });
  });

  it("dead-letters a job immediately when the handler throws a non-retryable error", async () => {
    const queue = createInMemorySyncJobQueue([job({ maxAttempts: 8 })]);

    const result = await runWorkerOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleJob: async () => {
        throw new NonRetryableQueueError("mailbox path is not configured");
      },
    });

    expect(result).toEqual({
      status: "failed",
      jobId: "job_1",
      accountId: "acc_1",
      jobType: "sync_account",
      triggerEventId: "event_1",
      idempotencyKey: "job:event_1",
      errorMessage: "mailbox path is not configured",
      finalJobStatus: "dead_letter",
      attempts: 1,
      maxAttempts: 8,
      retryable: false,
    });
    expect(queue.listJobs()[0]).toMatchObject({
      status: "dead_letter",
      attempts: 1,
      errorMessage: "mailbox path is not configured",
    });
  });

  it("marks exhausted retryable failures as dead letters with attempt context", async () => {
    const queue = createInMemorySyncJobQueue([
      job({ attempts: 2, maxAttempts: 3 }),
    ]);

    const result = await runWorkerOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleJob: async () => {
        throw new Error("EmailEngine still unavailable");
      },
    });

    expect(result).toEqual({
      status: "failed",
      jobId: "job_1",
      accountId: "acc_1",
      jobType: "sync_account",
      triggerEventId: "event_1",
      idempotencyKey: "job:event_1",
      errorMessage: "EmailEngine still unavailable",
      finalJobStatus: "dead_letter",
      attempts: 3,
      maxAttempts: 3,
      retryable: false,
    });
    expect(queue.listJobs()[0]).toMatchObject({
      status: "dead_letter",
      attempts: 3,
      errorMessage: "EmailEngine still unavailable",
    });
  });

  it("returns idle when no job is available", async () => {
    const queue = createInMemorySyncJobQueue([]);

    await expect(
      runWorkerOnce({
        queue,
        workerId: "worker-a",
        now,
        leaseSeconds: 30,
        handleJob: async () => undefined,
      }),
    ).resolves.toEqual({ status: "idle" });
  });

  it("runs different-account jobs concurrently up to the batch limit", async () => {
    const queue = createInMemorySyncJobQueue([
      job({ id: "job_1", accountId: "acc_1", idempotencyKey: "job:1" }),
      job({ id: "job_2", accountId: "acc_2", idempotencyKey: "job:2" }),
      job({ id: "job_3", accountId: "acc_3", idempotencyKey: "job:3" }),
    ]);
    const releaseHandlers = deferred<void>();
    const twoHandlersStarted = deferred<void>();
    const startedJobIds: string[] = [];
    const handleJob = vi.fn(async (claimedJob: SyncJobRecord) => {
      startedJobIds.push(claimedJob.id);
      if (startedJobIds.length === 2) {
        twoHandlersStarted.resolve();
      }
      await releaseHandlers.promise;
    });

    const batch = runWorkerBatch({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      concurrency: 2,
      handleJob,
    });

    await expect(
      Promise.race([
        twoHandlersStarted.promise.then(() => "started"),
        sleep(100).then(() => "timed-out"),
      ]),
    ).resolves.toBe("started");

    expect(startedJobIds).toEqual(["job_1", "job_2"]);
    expect(
      queue.listJobs().filter((queuedJob) => queuedJob.status === "running"),
    ).toHaveLength(2);

    releaseHandlers.resolve();

    await expect(batch).resolves.toEqual([
      {
        status: "processed",
        jobId: "job_1",
        accountId: "acc_1",
        jobType: "sync_account",
        triggerEventId: "event_1",
        idempotencyKey: "job:1",
      },
      {
        status: "processed",
        jobId: "job_2",
        accountId: "acc_2",
        jobType: "sync_account",
        triggerEventId: "event_1",
        idempotencyKey: "job:2",
      },
    ]);
    expect(queue.listJobs()[2]).toMatchObject({
      id: "job_3",
      status: "queued",
    });
  });

  it("returns a single idle result when a batch finds no work", async () => {
    const queue = createInMemorySyncJobQueue([]);

    await expect(
      runWorkerBatch({
        queue,
        workerId: "worker-a",
        now,
        leaseSeconds: 30,
        concurrency: 4,
        handleJob: async () => undefined,
      }),
    ).resolves.toEqual([{ status: "idle" }]);
  });

  it("falls back to one concurrent job when the batch limit is invalid", async () => {
    const queue = createInMemorySyncJobQueue([job()]);

    await expect(
      runWorkerBatch({
        queue,
        workerId: "worker-a",
        now,
        leaseSeconds: 30,
        concurrency: Number.NaN,
        handleJob: async () => undefined,
      }),
    ).resolves.toEqual([
      {
        status: "processed",
        jobId: "job_1",
        accountId: "acc_1",
        jobType: "sync_account",
        triggerEventId: "event_1",
        idempotencyKey: "job:event_1",
      },
    ]);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
