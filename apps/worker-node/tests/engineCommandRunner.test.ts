import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryEngineCommandQueue,
  type EngineCommandRecord,
} from "../src/engine-command-queue";
import { runEngineCommandBatch, runEngineCommandOnce } from "../src/engine-command-runner";
import { NonRetryableQueueError } from "../src/queue-errors";

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

describe("engine command runner", () => {
  it("claims, handles, and completes one command", async () => {
    const queue = createInMemoryEngineCommandQueue([command()]);
    const handleCommand = vi.fn().mockResolvedValue(undefined);

    const result = await runEngineCommandOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleCommand,
    });

    expect(result).toEqual({
      status: "processed",
      commandId: "cmd_1",
      accountId: "acc_1",
      commandType: "mark_read",
      idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
    });
    expect(handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cmd_1", status: "running" }),
    );
    expect(queue.listCommands()[0]).toMatchObject({
      status: "done",
      completedAt: now.toISOString(),
    });
  });

  it("fails the command when provider execution throws", async () => {
    const queue = createInMemoryEngineCommandQueue([command()]);

    const result = await runEngineCommandOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleCommand: async () => {
        throw new Error("EmailEngine unavailable");
      },
    });

    expect(result).toEqual({
      status: "failed",
      commandId: "cmd_1",
      accountId: "acc_1",
      commandType: "mark_read",
      idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
      errorMessage: "EmailEngine unavailable",
      finalCommandStatus: "queued",
      attempts: 1,
      maxAttempts: 3,
      retryable: true,
      nextRunAt: "2026-06-12T09:00:30.000Z",
    });
    expect(queue.listCommands()[0]).toMatchObject({
      status: "queued",
      errorMessage: "EmailEngine unavailable",
    });
  });

  it("dead-letters a command immediately when provider execution is non-retryable", async () => {
    const queue = createInMemoryEngineCommandQueue([command({ maxAttempts: 8 })]);

    const result = await runEngineCommandOnce({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      handleCommand: async () => {
        throw new NonRetryableQueueError("provider mailbox ref not found");
      },
    });

    expect(result).toEqual({
      status: "failed",
      commandId: "cmd_1",
      accountId: "acc_1",
      commandType: "mark_read",
      idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
      errorMessage: "provider mailbox ref not found",
      finalCommandStatus: "dead_letter",
      attempts: 1,
      maxAttempts: 8,
      retryable: false,
    });
    expect(queue.listCommands()[0]).toMatchObject({
      status: "dead_letter",
      attempts: 1,
      errorMessage: "provider mailbox ref not found",
    });
  });

  it("runs different-account commands concurrently up to the batch limit", async () => {
    const queue = createInMemoryEngineCommandQueue([
      command({ id: "cmd_1", accountId: "acc_1", idempotencyKey: "cmd:1" }),
      command({ id: "cmd_2", accountId: "acc_2", idempotencyKey: "cmd:2" }),
      command({ id: "cmd_3", accountId: "acc_3", idempotencyKey: "cmd:3" }),
    ]);
    const startedIds: string[] = [];
    const handleCommand = vi.fn(async (claimed: EngineCommandRecord) => {
      startedIds.push(claimed.id);
    });

    const result = await runEngineCommandBatch({
      queue,
      workerId: "worker-a",
      now,
      leaseSeconds: 30,
      concurrency: 2,
      handleCommand,
    });

    expect(result).toEqual([
      {
        status: "processed",
        commandId: "cmd_1",
        accountId: "acc_1",
        commandType: "mark_read",
        idempotencyKey: "cmd:1",
      },
      {
        status: "processed",
        commandId: "cmd_2",
        accountId: "acc_2",
        commandType: "mark_read",
        idempotencyKey: "cmd:2",
      },
    ]);
    expect(startedIds).toEqual(["cmd_1", "cmd_2"]);
    expect(queue.listCommands()[2]).toMatchObject({
      id: "cmd_3",
      status: "queued",
    });
  });
});
