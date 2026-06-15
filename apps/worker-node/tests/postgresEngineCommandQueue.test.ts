import { describe, expect, it } from "vitest";

import { createPostgresEngineCommandQueue } from "../src/postgres-engine-command-queue";

describe("postgres engine command queue", () => {
  it("claims due or expired commands with SKIP LOCKED, per-account serialization, and deterministic ordering", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const queue = createPostgresEngineCommandQueue({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            commandRow({
              status: "running",
              attempts: 2,
              lease_owner: "worker-a",
              lease_expires_at: "2026-06-13T08:01:00.000Z",
            }),
          ],
        };
      },
    });

    const claimed = await queue.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-13T08:00:00.000Z"),
      leaseSeconds: 60,
    });

    expect(queries[0].text).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(queries[0].text).toMatch(/error_message = NULL/i);
    expect(queries[0].text).toMatch(/NOT EXISTS/i);
    expect(queries[0].text).toMatch(/active_same_account/i);
    expect(queries[0].text).toMatch(
      /active_same_account\.lease_expires_at > \$1::timestamptz/i,
    );
    expect(queries[0].text).toMatch(
      /ORDER BY not_before ASC,\s*created_at ASC,\s*id ASC/i,
    );
    expect(queries[0].values).toEqual([
      "2026-06-13T08:00:00.000Z",
      "worker-a",
      "2026-06-13T08:01:00.000Z",
    ]);
    expect(claimed).toMatchObject({
      id: "cmd_1",
      status: "running",
      attempts: 2,
      leaseOwner: "worker-a",
      leaseExpiresAt: "2026-06-13T08:01:00.000Z",
    });
  });

  it("dead-letters exhausted commands and requeues retryable failures with backoff", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const queue = createPostgresEngineCommandQueue({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            commandRow({
              status: "dead_letter",
              attempts: 8,
              max_attempts: 8,
              lease_owner: null,
              lease_expires_at: null,
              error_message: "EmailEngine failed",
            }),
          ],
        };
      },
    });

    const failed = await queue.failCommand({
      commandId: "cmd_1",
      workerId: "worker-a",
      errorMessage: "EmailEngine failed",
      now: new Date("2026-06-13T08:00:00.000Z"),
    });

    expect(queries[0].text).toMatch(
      /CASE WHEN \$5 = FALSE OR attempts >= max_attempts/i,
    );
    expect(queries[0].text).toMatch(/dead_letter/i);
    expect(queries[0].text).toMatch(/POWER/i);
    expect(queries[0].text).toMatch(/LEAST/i);
    expect(queries[0].text).toMatch(/lease_owner = NULL/i);
    expect(queries[0].text).toMatch(/lease_expires_at = NULL/i);
    expect(failed).toMatchObject({
      id: "cmd_1",
      status: "dead_letter",
      attempts: 8,
      errorMessage: "EmailEngine failed",
    });
  });

  it("dead-letters non-retryable failures without waiting for max attempts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const queue = createPostgresEngineCommandQueue({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            commandRow({
              status: "dead_letter",
              attempts: 1,
              max_attempts: 8,
              lease_owner: null,
              lease_expires_at: null,
              error_message: "provider mailbox ref not found",
            }),
          ],
        };
      },
    });

    const failed = await queue.failCommand({
      commandId: "cmd_1",
      workerId: "worker-a",
      errorMessage: "provider mailbox ref not found",
      retryable: false,
      now: new Date("2026-06-13T08:00:00.000Z"),
    });

    expect(queries[0].text).toMatch(/\$5 = FALSE/i);
    expect(queries[0].text).toMatch(/attempts >= max_attempts/i);
    expect(queries[0].values).toEqual([
      "cmd_1",
      "worker-a",
      "provider mailbox ref not found",
      "2026-06-13T08:00:00.000Z",
      false,
    ]);
    expect(failed).toMatchObject({
      id: "cmd_1",
      status: "dead_letter",
      attempts: 1,
      errorMessage: "provider mailbox ref not found",
    });
  });

  it("clears stale error messages when completing a retried command", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const queue = createPostgresEngineCommandQueue({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            commandRow({
              status: "done",
              attempts: 2,
              lease_owner: null,
              lease_expires_at: null,
              error_message: null,
              updated_at: "2026-06-13T08:00:30.000Z",
              completed_at: "2026-06-13T08:00:30.000Z",
            }),
          ],
        };
      },
    });

    const completed = await queue.completeCommand({
      commandId: "cmd_1",
      workerId: "worker-a",
      now: new Date("2026-06-13T08:00:30.000Z"),
    });

    expect(queries[0].text).toMatch(/error_message = NULL/i);
    expect(completed).toMatchObject({
      id: "cmd_1",
      status: "done",
      completedAt: "2026-06-13T08:00:30.000Z",
    });
    expect(completed.errorMessage).toBeUndefined();
  });

  it("throws when complete or fail cannot find an owned command lease", async () => {
    const queue = createPostgresEngineCommandQueue({
      async query() {
        return { rows: [] };
      },
    });

    await expect(
      queue.completeCommand({
        commandId: "cmd_1",
        workerId: "worker-b",
        now: new Date("2026-06-13T08:00:00.000Z"),
      }),
    ).rejects.toThrow("engine command lease is not owned by worker-b");

    await expect(
      queue.failCommand({
        commandId: "cmd_1",
        workerId: "worker-b",
        errorMessage: "boom",
        now: new Date("2026-06-13T08:00:00.000Z"),
      }),
    ).rejects.toThrow("engine command lease is not owned by worker-b");
  });
});

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmd_1",
    command_type: "mark_read",
    account_id: "acc_1",
    target: { messageId: "msg_1" },
    payload: { action: "mark_read" },
    status: "queued",
    attempts: 1,
    max_attempts: 8,
    idempotency_key: "mail-action:acc_1:msg_1:mark_read",
    not_before: "2026-06-13T08:00:00.000Z",
    lease_owner: null,
    lease_expires_at: null,
    error_message: null,
    created_at: "2026-06-13T08:00:00.000Z",
    updated_at: "2026-06-13T08:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}
