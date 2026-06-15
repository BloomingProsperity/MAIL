import { describe, expect, it } from "vitest";

import {
  createInMemoryEngineCommandQueue,
  type EngineCommandRecord,
} from "../src/engine-command-queue";

const now = new Date("2026-06-12T09:00:00.000Z");

function command(
  overrides: Partial<EngineCommandRecord> = {},
): EngineCommandRecord {
  return {
    id: "cmd_1",
    commandType: "mark_read",
    accountId: "acc_1",
    target: { messageId: "msg_1" },
    payload: { action: "mark_read" },
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
    notBefore: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("engine command queue", () => {
  it("claims one due command with a lease", async () => {
    const queue = createInMemoryEngineCommandQueue([command()]);

    const claimed = await queue.claimNext({
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
    });

    expect(claimed).toMatchObject({
      id: "cmd_1",
      status: "running",
      attempts: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: "2026-06-12T09:00:30.000Z",
    });
    await expect(
      queue.claimNext({ workerId: "worker-b", now, leaseSeconds: 30 }),
    ).resolves.toBeUndefined();
  });

  it("keeps provider mutations serial per account while other accounts run", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        id: "cmd_running",
        status: "running",
        attempts: 1,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
      }),
      command({
        id: "cmd_same_account",
        accountId: "acc_1",
        idempotencyKey: "mail-action:acc_1:msg_2:star",
        commandType: "star",
        target: { messageId: "msg_2" },
        payload: { action: "star" },
      }),
      command({
        id: "cmd_other_account",
        accountId: "acc_2",
        idempotencyKey: "mail-action:acc_2:msg_3:star",
        commandType: "star",
        target: { messageId: "msg_3" },
        payload: { action: "star" },
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-b",
      now,
      leaseSeconds: 30,
    });

    expect(claimed?.id).toBe("cmd_other_account");
    expect(queue.listCommands()[1]).toMatchObject({
      id: "cmd_same_account",
      status: "queued",
    });
  });

  it("claims the earliest due command first when the backlog is out of insertion order", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        id: "cmd_later",
        accountId: "acc_later",
        idempotencyKey: "mail-action:acc_later:msg_2:star",
        notBefore: "2026-06-12T09:00:20.000Z",
        createdAt: "2026-06-12T09:00:20.000Z",
      }),
      command({
        id: "cmd_earlier",
        accountId: "acc_earlier",
        idempotencyKey: "mail-action:acc_earlier:msg_1:star",
        notBefore: "2026-06-12T09:00:00.000Z",
        createdAt: "2026-06-12T09:00:00.000Z",
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-12T09:00:30.000Z"),
      leaseSeconds: 30,
    });

    expect(claimed?.id).toBe("cmd_earlier");
  });

  it("reclaims expired leases and dead-letters exhausted commands", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        status: "running",
        attempts: 2,
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
      status: "running",
      attempts: 3,
      leaseOwner: "worker-b",
    });

    const failed = await queue.failCommand({
      commandId: "cmd_1",
      workerId: "worker-b",
      errorMessage: "EmailEngine mutation failed",
      now,
    });

    expect(failed).toMatchObject({
      status: "dead_letter",
      attempts: 3,
      errorMessage: "EmailEngine mutation failed",
    });
  });

  it("clears stale error messages when a retry is claimed", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        status: "queued",
        attempts: 1,
        errorMessage: "EmailEngine temporarily unavailable",
        notBefore: now.toISOString(),
      }),
    ]);

    const claimed = await queue.claimNext({
      workerId: "worker-b",
      now,
      leaseSeconds: 30,
    });

    expect(claimed).toMatchObject({
      id: "cmd_1",
      status: "running",
      attempts: 2,
      leaseOwner: "worker-b",
    });
    expect(claimed?.errorMessage).toBeUndefined();
    expect(queue.listCommands()[0].errorMessage).toBeUndefined();
  });

  it("requeues retryable failures with exponential backoff", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        status: "running",
        attempts: 1,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
      }),
    ]);

    const failed = await queue.failCommand({
      commandId: "cmd_1",
      workerId: "worker-a",
      errorMessage: "temporarily unavailable",
      now,
    });

    expect(failed).toMatchObject({
      status: "queued",
      attempts: 1,
      notBefore: "2026-06-12T09:00:30.000Z",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  });

  it("dead-letters non-retryable failures immediately", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        status: "running",
        attempts: 1,
        maxAttempts: 8,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
      }),
    ]);

    const failed = await queue.failCommand({
      commandId: "cmd_1",
      workerId: "worker-a",
      errorMessage: "provider mailbox ref not found",
      retryable: false,
      now,
    });

    expect(failed).toMatchObject({
      status: "dead_letter",
      attempts: 1,
      notBefore: now.toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      errorMessage: "provider mailbox ref not found",
    });
  });

  it("clears stale error messages when a retried command completes", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({
        status: "running",
        attempts: 2,
        leaseOwner: "worker-a",
        leaseExpiresAt: "2026-06-12T09:00:30.000Z",
        errorMessage: "EmailEngine temporarily unavailable",
      }),
    ]);

    const completed = await queue.completeCommand({
      commandId: "cmd_1",
      workerId: "worker-a",
      now,
    });

    expect(completed).toMatchObject({
      status: "done",
      completedAt: now.toISOString(),
    });
    expect(completed.errorMessage).toBeUndefined();
    expect(queue.listCommands()[0].errorMessage).toBeUndefined();
  });
});
