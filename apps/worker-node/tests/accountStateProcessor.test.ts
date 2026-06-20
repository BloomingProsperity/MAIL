import { describe, expect, it, vi } from "vitest";

import { createAccountStateJobHandler } from "../src/account-state-processor";
import type { SyncJobRecord } from "../src/sync-job-queue";

const baseJob: SyncJobRecord = {
  id: "job_state_1",
  jobType: "account_state",
  accountId: "acc_1",
  triggerEventId: "event_auth_failed",
  idempotencyKey: "job:event_auth_failed",
  status: "running",
  attempts: 1,
  maxAttempts: 8,
  notBefore: "2026-06-12T09:00:00.000Z",
  payload: { kind: "auth_failed", error: "Invalid login" },
  createdAt: "2026-06-12T09:00:00.000Z",
  updatedAt: "2026-06-12T09:00:00.000Z",
};

describe("account state processor", () => {
  it("marks auth_failed EmailEngine accounts as requiring reauthorization", async () => {
    const store = {
      markAccountReauthRequired: vi
        .fn()
        .mockResolvedValue({ taskId: "task_reauth_1" }),
      markAccountSyncing: vi.fn(),
    };
    const diagnostics = {
      record: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createAccountStateJobHandler({
      store,
      diagnostics,
      now: () => new Date("2026-06-12T09:01:00.000Z"),
    });

    await handler(baseJob);

    expect(store.markAccountReauthRequired).toHaveBeenCalledWith({
      accountId: "acc_1",
      reason: "auth_failed",
      at: "2026-06-12T09:01:00.000Z",
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      service: "email-hub-worker",
      level: "warn",
      event: "account_reauthorization_required",
      message: "Account acc_1 requires reauthorization after auth_failed",
      accountId: "acc_1",
      lane: "sync",
      jobId: "job_state_1",
      context: {
        reason: "auth_failed",
        taskId: "task_reauth_1",
        triggerEventId: "event_auth_failed",
      },
    });
  });

  it("marks sync_failed EmailEngine accounts as requiring reauthorization", async () => {
    const store = {
      markAccountReauthRequired: vi.fn().mockResolvedValue({}),
      markAccountSyncing: vi.fn(),
    };
    const handler = createAccountStateJobHandler({
      store,
      now: () => new Date("2026-06-12T09:02:00.000Z"),
    });

    await handler({
      ...baseJob,
      payload: { kind: "sync_failed" },
    });

    expect(store.markAccountReauthRequired).toHaveBeenCalledWith({
      accountId: "acc_1",
      reason: "sync_failed",
      at: "2026-06-12T09:02:00.000Z",
    });
  });

  it("marks EmailEngine-deleted accounts as requiring recovery instead of syncing them", async () => {
    const store = {
      markAccountReauthRequired: vi
        .fn()
        .mockResolvedValue({ taskId: "task_deleted_1" }),
      markAccountSyncing: vi.fn(),
    };
    const diagnostics = {
      record: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createAccountStateJobHandler({
      store,
      diagnostics,
      now: () => new Date("2026-06-12T09:03:00.000Z"),
    });

    await handler({
      ...baseJob,
      triggerEventId: "event_account_deleted",
      payload: { kind: "account_deleted" },
    });

    expect(store.markAccountReauthRequired).toHaveBeenCalledWith({
      accountId: "acc_1",
      reason: "account_deleted",
      at: "2026-06-12T09:03:00.000Z",
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      service: "email-hub-worker",
      level: "warn",
      event: "account_reauthorization_required",
      message: "Account acc_1 requires reauthorization after account_deleted",
      accountId: "acc_1",
      lane: "sync",
      jobId: "job_state_1",
      context: {
        reason: "account_deleted",
        taskId: "task_deleted_1",
        triggerEventId: "event_account_deleted",
      },
    });
  });

  it("rejects account_state jobs that do not identify an account", async () => {
    const handler = createAccountStateJobHandler({
      store: { markAccountReauthRequired: vi.fn(), markAccountSyncing: vi.fn() },
    });

    await expect(
      handler({
        ...baseJob,
        accountId: undefined,
      }),
    ).rejects.toThrow("account_state job job_state_1 is missing accountId");
  });

  it("clears reauthorization state after EmailEngine authentication succeeds", async () => {
    const store = {
      markAccountReauthRequired: vi.fn(),
      markAccountSyncing: vi.fn().mockResolvedValue(undefined),
    };
    const diagnostics = {
      record: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createAccountStateJobHandler({
      store,
      diagnostics,
      now: () => new Date("2026-06-12T09:04:00.000Z"),
    });

    await handler({
      ...baseJob,
      triggerEventId: "event_auth_success",
      payload: { kind: "auth_succeeded" },
    });

    expect(store.markAccountSyncing).toHaveBeenCalledWith({
      accountId: "acc_1",
      at: "2026-06-12T09:04:00.000Z",
    });
    expect(store.markAccountReauthRequired).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith({
      service: "email-hub-worker",
      level: "info",
      event: "account_reauthorization_cleared",
      message: "Account acc_1 returned to syncing after auth_succeeded",
      accountId: "acc_1",
      lane: "sync",
      jobId: "job_state_1",
      context: {
        reason: "auth_succeeded",
        triggerEventId: "event_auth_success",
      },
    });
  });
});
