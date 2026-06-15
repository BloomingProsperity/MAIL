import { describe, expect, it, vi } from "vitest";

import {
  createInMemorySyncJobQueue,
  type SyncJobRecord,
} from "../src/sync-job-queue";
import { createWorkerTickRunner } from "../src/worker-poller";

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

describe("worker poller", () => {
  it("skips overlapping ticks so configured concurrency stays bounded", async () => {
    const queue = createInMemorySyncJobQueue([
      job({ id: "job_1", accountId: "acc_1", idempotencyKey: "job:1" }),
      job({ id: "job_2", accountId: "acc_2", idempotencyKey: "job:2" }),
    ]);
    const handlerStarted = deferred<void>();
    const releaseHandler = deferred<void>();
    const handleJob = vi.fn(async () => {
      handlerStarted.resolve();
      await releaseHandler.promise;
    });
    const tick = createWorkerTickRunner({
      queue,
      workerId: "worker-a",
      clock: () => now,
      leaseSeconds: 30,
      concurrency: 1,
      handleJob,
    });

    const firstTick = tick();
    await handlerStarted.promise;

    await expect(tick()).resolves.toEqual([{ status: "skipped" }]);
    expect(handleJob).toHaveBeenCalledTimes(1);

    releaseHandler.resolve();

    await expect(firstTick).resolves.toEqual([
      {
        status: "processed",
        jobId: "job_1",
        accountId: "acc_1",
        jobType: "sync_account",
        triggerEventId: "event_1",
        idempotencyKey: "job:1",
      },
    ]);
    expect(queue.listJobs()[1]).toMatchObject({
      id: "job_2",
      status: "queued",
    });
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T | PromiseLike<T>): void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
