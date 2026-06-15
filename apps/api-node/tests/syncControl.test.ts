import { describe, expect, it } from "vitest";

import { createSyncControlService } from "../src/sync-center/sync-control";

describe("sync control service", () => {
  it("enqueues a manual sync job for a syncing account", async () => {
    const calls: unknown[] = [];
    const service = createSyncControlService({
      store: {
        async getAccount(accountId) {
          expect(accountId).toBe("acc_1");
          return {
            accountId: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          };
        },
        async enqueueManualSync(input) {
          calls.push(input);
          return {
            id: "job_manual",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:manual-sync:acc_1:manual_1",
            status: "queued",
            createdAt: "2026-06-13T08:00:00.000Z",
          };
        },
        async pauseAccount() {
          throw new Error("not used");
        },
        async resumeAccount() {
          throw new Error("not used");
        },
        async retryFailedSync() {
          throw new Error("not used");
        },
      },
      createId: () => "manual_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const result = await service.requestManualSync({ accountId: "acc_1" });

    expect(calls).toEqual([
      {
        account: {
          accountId: "acc_1",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          syncState: "syncing",
          engineProvider: "emailengine",
        },
        jobId: "manual_1",
        now: "2026-06-13T08:00:00.000Z",
      },
    ]);
    expect(result).toEqual({
      accountId: "acc_1",
      action: "manual_sync_queued",
      job: {
        id: "job_manual",
        jobType: "sync_account",
        accountId: "acc_1",
        idempotencyKey: "job:manual-sync:acc_1:manual_1",
        status: "queued",
        createdAt: "2026-06-13T08:00:00.000Z",
      },
    });
  });

  it("rejects manual sync for accounts that require reauthorization", async () => {
    const service = createSyncControlService({
      store: {
        async getAccount() {
          return {
            accountId: "acc_1",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            syncState: "reauth_required",
            engineProvider: "native",
          };
        },
        async enqueueManualSync() {
          throw new Error("should not enqueue");
        },
        async pauseAccount() {
          throw new Error("not used");
        },
        async resumeAccount() {
          throw new Error("not used");
        },
        async retryFailedSync() {
          throw new Error("not used");
        },
      },
      createId: () => "manual_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    await expect(
      service.requestManualSync({ accountId: "acc_1" }),
    ).rejects.toThrow("account requires reauthorization");
  });

  it("pauses and resumes account sync state", async () => {
    const actions: unknown[] = [];
    const service = createSyncControlService({
      store: {
        async getAccount() {
          return {
            accountId: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          };
        },
        async enqueueManualSync() {
          throw new Error("not used");
        },
        async pauseAccount(accountId) {
          actions.push(["pause", accountId]);
          return {
            accountId,
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "paused",
            engineProvider: "emailengine",
          };
        },
        async resumeAccount(accountId) {
          actions.push(["resume", accountId]);
          return {
            accountId,
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          };
        },
        async retryFailedSync() {
          throw new Error("not used");
        },
      },
      createId: () => "manual_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    await expect(service.pause({ accountId: "acc_1" })).resolves.toMatchObject({
      action: "sync_paused",
      account: { accountId: "acc_1", syncState: "paused" },
    });
    await expect(service.resume({ accountId: "acc_1" })).resolves.toMatchObject({
      action: "sync_resumed",
      account: { accountId: "acc_1", syncState: "syncing" },
    });
    expect(actions).toEqual([
      ["pause", "acc_1"],
      ["resume", "acc_1"],
    ]);
  });

  it("requeues failed sync jobs for an account", async () => {
    const service = createSyncControlService({
      store: {
        async getAccount() {
          return {
            accountId: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          };
        },
        async enqueueManualSync() {
          throw new Error("not used");
        },
        async pauseAccount() {
          throw new Error("not used");
        },
        async resumeAccount() {
          throw new Error("not used");
        },
        async retryFailedSync(input) {
          expect(input).toEqual({
            accountId: "acc_1",
            now: "2026-06-13T08:00:00.000Z",
          });
          return {
            accountId: "acc_1",
            retriedJobCount: 2,
            retriedJobIds: ["job_1", "job_2"],
          };
        },
      },
      createId: () => "manual_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    await expect(service.retryFailed({ accountId: "acc_1" })).resolves.toEqual({
      accountId: "acc_1",
      action: "failed_sync_requeued",
      retriedJobCount: 2,
      retriedJobIds: ["job_1", "job_2"],
    });
  });
});
