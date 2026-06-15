import { describe, expect, it } from "vitest";

import { runSyncQueueStressCheck } from "../src/sync-queue-stress";

describe("sync queue stress diagnostics", () => {
  it("drains a large multi-account backlog without duplicate claims or same-account overlap", async () => {
    const result = await runSyncQueueStressCheck({
      accountCount: 8,
      jobsPerAccount: 25,
      workerCount: 32,
      leaseSeconds: 30,
      workDelayMs: 1,
      startedAt: new Date("2026-06-14T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      accountCount: 8,
      jobsPerAccount: 25,
      workerCount: 32,
      totalJobs: 200,
      completedJobs: 200,
      duplicateClaims: [],
      maxConcurrentPerAccount: 1,
      maxAttempts: 1,
    });
    expect(result.perAccountCompleted).toEqual({
      acc_001: 25,
      acc_002: 25,
      acc_003: 25,
      acc_004: 25,
      acc_005: 25,
      acc_006: 25,
      acc_007: 25,
      acc_008: 25,
    });
    expect(result.idleWorkers).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks the stress check unhealthy when a queue duplicate-claims the same job", async () => {
    const result = await runSyncQueueStressCheck({
      accountCount: 2,
      jobsPerAccount: 2,
      workerCount: 4,
      leaseSeconds: 30,
      workDelayMs: 1,
      startedAt: new Date("2026-06-14T04:00:00.000Z"),
      injectDuplicateClaimForTest: true,
    });

    expect(result.ok).toBe(false);
    expect(result.duplicateClaims).toEqual(["job_acc_001_001"]);
  });
});
