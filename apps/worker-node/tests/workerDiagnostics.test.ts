import { describe, expect, it } from "vitest";

import { recordWorkerResultDiagnostic } from "../src/logging/worker-diagnostics";

describe("worker diagnostic event mapping", () => {
  it("records retryable job failures as warning diagnostics with retry context", async () => {
    const records: unknown[] = [];

    await recordWorkerResultDiagnostic({
      recorder: {
        async record(input: unknown) {
          records.push(input);
        },
      },
      workerId: "worker_1",
      result: {
        status: "failed",
        laneName: "sync",
        accountId: "acc_1",
        jobId: "job_1",
        errorMessage: "EmailEngine timeout",
        finalJobStatus: "queued",
        attempts: 2,
        maxAttempts: 8,
        retryable: true,
        nextRunAt: "2026-06-14T04:02:00.000Z",
      },
    });

    expect(records).toEqual([
      {
        service: "email-hub-worker",
        level: "warn",
        event: "sync_job_retry_scheduled",
        accountId: "acc_1",
        lane: "sync",
        jobId: "job_1",
        message: "EmailEngine timeout; retry 2 of 8 scheduled",
        context: {
          workerId: "worker_1",
          result: {
            status: "failed",
            laneName: "sync",
            accountId: "acc_1",
            jobId: "job_1",
            errorMessage: "EmailEngine timeout",
            finalJobStatus: "queued",
            attempts: 2,
            maxAttempts: 8,
            retryable: true,
            nextRunAt: "2026-06-14T04:02:00.000Z",
          },
          attempts: 2,
          maxAttempts: 8,
          retryable: true,
          finalJobStatus: "queued",
          nextRunAt: "2026-06-14T04:02:00.000Z",
        },
      },
    ]);
  });

  it("records dead-lettered sync jobs as error diagnostics with final attempt context", async () => {
    const records: unknown[] = [];

    await recordWorkerResultDiagnostic({
      recorder: {
        async record(input: unknown) {
          records.push(input);
        },
      },
      workerId: "worker_1",
      result: {
        status: "failed",
        laneName: "sync",
        accountId: "acc_1",
        jobId: "job_dead",
        errorMessage: "mailbox path is not configured",
        finalJobStatus: "dead_letter",
        attempts: 1,
        maxAttempts: 8,
        retryable: false,
      },
    });

    expect(records).toEqual([
      {
        service: "email-hub-worker",
        level: "error",
        event: "sync_job_dead_lettered",
        accountId: "acc_1",
        lane: "sync",
        jobId: "job_dead",
        message: "mailbox path is not configured; job moved to dead letter",
        context: {
          workerId: "worker_1",
          result: {
            status: "failed",
            laneName: "sync",
            accountId: "acc_1",
            jobId: "job_dead",
            errorMessage: "mailbox path is not configured",
            finalJobStatus: "dead_letter",
            attempts: 1,
            maxAttempts: 8,
            retryable: false,
          },
          attempts: 1,
          maxAttempts: 8,
          retryable: false,
          finalJobStatus: "dead_letter",
        },
      },
    ]);
  });

  it("records engine command diagnostics with account-scoped command ids", async () => {
    const records: unknown[] = [];

    await recordWorkerResultDiagnostic({
      recorder: {
        async record(input: unknown) {
          records.push(input);
        },
      },
      workerId: "worker_1",
      result: {
        status: "failed",
        laneName: "engine_commands",
        accountId: "acc_1",
        commandId: "cmd_1",
        commandType: "mark_read",
        idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
        errorMessage: "provider message ref not found",
        finalCommandStatus: "dead_letter",
        attempts: 3,
        maxAttempts: 3,
        retryable: false,
      },
    });

    expect(records).toEqual([
      {
        service: "email-hub-worker",
        level: "error",
        event: "engine_command_dead_lettered",
        accountId: "acc_1",
        lane: "engine_commands",
        jobId: "cmd_1",
        message: "provider message ref not found; command moved to dead letter",
        context: {
          workerId: "worker_1",
          result: {
            status: "failed",
            laneName: "engine_commands",
            accountId: "acc_1",
            commandId: "cmd_1",
            commandType: "mark_read",
            idempotencyKey: "mail-action:acc_1:msg_1:mark_read",
            errorMessage: "provider message ref not found",
            finalCommandStatus: "dead_letter",
            attempts: 3,
            maxAttempts: 3,
            retryable: false,
          },
          attempts: 3,
          maxAttempts: 3,
          retryable: false,
          finalCommandStatus: "dead_letter",
        },
      },
    ]);
  });
});
