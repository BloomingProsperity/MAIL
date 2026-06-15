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
      markAccountReauthRequired: vi.fn().mockResolvedValue(undefined),
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
        triggerEventId: "event_auth_failed",
      },
    });
  });

  it("rejects account_state jobs that do not identify an account", async () => {
    const handler = createAccountStateJobHandler({
      store: { markAccountReauthRequired: vi.fn() },
    });

    await expect(
      handler({
        ...baseJob,
        accountId: undefined,
      }),
    ).rejects.toThrow("account_state job job_state_1 is missing accountId");
  });
});
