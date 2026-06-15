import { describe, expect, it } from "vitest";

import { createPostgresBootstrapSyncJobStore } from "../src/accounts/bootstrap-sync-job-store";

describe("postgres bootstrap sync job store", () => {
  it("enqueues EmailEngine initial bootstrap jobs for completed onboarding", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: null,
              trigger_event_id: null,
              idempotency_key: "job:initial-sync:acc_1",
              status: "queued",
              created_at: "2026-06-12T09:00:00.000Z",
            },
          ],
        };
      },
    };

    const store = createPostgresBootstrapSyncJobStore(client, {
      createId: () => "job_1",
      now: () => new Date("2026-06-12T09:00:00.000Z"),
    });
    const job = await store.enqueueInitialSync({
      accountId: "acc_1",
      provider: "qq",
      engineProvider: "emailengine",
      sourceTaskId: "task_1",
    });

    expect(queries[0].text).toMatch(/INSERT INTO sync_jobs/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(idempotency_key\)/i);
    expect(queries[0].values).toEqual([
      "job_1",
      "sync_account",
      "acc_1",
      null,
      null,
      "job:initial-sync:acc_1",
      "2026-06-12T09:00:00.000Z",
      {
        source: "account_onboarding",
        kind: "initial_bootstrap",
        provider: "qq",
        engineProvider: "emailengine",
        sourceTaskId: "task_1",
      },
    ]);
    expect(job).toEqual({
      id: "job_1",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "job:initial-sync:acc_1",
      status: "queued",
      createdAt: "2026-06-12T09:00:00.000Z",
    });
  });

  it("enqueues native mailbox discovery jobs before native folder bootstrap", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              job_type: "sync_account",
              account_id: "acc_1",
              mailbox_id: null,
              trigger_event_id: null,
              idempotency_key: "job:initial-sync:acc_1",
              status: "queued",
              created_at: "2026-06-12T09:00:00.000Z",
            },
          ],
        };
      },
    };

    const store = createPostgresBootstrapSyncJobStore(client, {
      createId: () => "job_1",
      now: () => new Date("2026-06-12T09:00:00.000Z"),
    });

    await store.enqueueInitialSync({
      accountId: "acc_1",
      provider: "gmail",
      engineProvider: "native",
      sourceTaskId: "task_1",
    });

    expect(queries[0].values?.[7]).toEqual({
      source: "account_onboarding",
      kind: "native_folder_discovery",
      provider: "gmail",
      engineProvider: "native",
      sourceTaskId: "task_1",
    });
  });
});
