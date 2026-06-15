import { describe, expect, it } from "vitest";

import { createPostgresSyncControlStore } from "../src/sync-center/postgres-sync-control-store";

describe("postgres sync control store", () => {
  it("enqueues manual sync jobs without touching credentials", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_manual",
              job_type: "sync_account",
              account_id: "acc_1",
              idempotency_key: "job:manual-sync:acc_1:manual_1",
              status: "queued",
              created_at: "2026-06-13T08:00:00.000Z",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncControlStore(client);
    const result = await store.enqueueManualSync({
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
    });

    expect(queries[0].text).toMatch(/INSERT INTO sync_jobs/i);
    expect(queries[0].text).not.toMatch(/stored_secrets|account_credentials/i);
    expect(queries[0].values).toEqual([
      "manual_1",
      "sync_account",
      "acc_1",
      "job:manual-sync:acc_1:manual_1",
      "2026-06-13T08:00:00.000Z",
      {
        source: "sync_control",
        kind: "manual_resync",
        provider: "qq",
        engineProvider: "emailengine",
      },
    ]);
    expect(result).toEqual({
      id: "job_manual",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "job:manual-sync:acc_1:manual_1",
      status: "queued",
      createdAt: "2026-06-13T08:00:00.000Z",
    });
  });

  it("returns an existing active sync job instead of enqueueing duplicate manual resyncs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_running",
              job_type: "sync_account",
              account_id: "acc_1",
              idempotency_key: "job:manual-sync:acc_1:older",
              status: "running",
              created_at: "2026-06-13T07:58:00.000Z",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncControlStore(client);
    const result = await store.enqueueManualSync({
      account: {
        accountId: "acc_1",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
      jobId: "manual_2",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/active_sync_job/i);
    expect(queries[0].text).toMatch(/status IN \('queued', 'running'\)/i);
    expect(queries[0].text).toMatch(/WHERE NOT EXISTS/i);
    expect(queries[0].text).toMatch(/SELECT 1 FROM active_sync_job/i);
    expect(queries[0].text).toMatch(/UNION ALL/i);
    expect(queries[0].values).toEqual([
      "manual_2",
      "sync_account",
      "acc_1",
      "job:manual-sync:acc_1:manual_2",
      "2026-06-13T08:00:00.000Z",
      {
        source: "sync_control",
        kind: "manual_resync",
        provider: "qq",
        engineProvider: "emailengine",
      },
    ]);
    expect(result).toEqual({
      id: "job_running",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "job:manual-sync:acc_1:older",
      status: "running",
      createdAt: "2026-06-13T07:58:00.000Z",
    });
  });

  it("pauses and resumes connected account sync_state", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "acc_1",
              email: "support@qq.com",
              provider: "qq",
              auth_method: "password",
              sync_state: text.includes("paused") ? "paused" : "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncControlStore(client);
    await store.pauseAccount("acc_1");
    await store.resumeAccount("acc_1");

    expect(queries[0].text).toMatch(/UPDATE connected_accounts/i);
    expect(queries[0].text).toMatch(/sync_state = 'paused'/i);
    expect(queries[0].values).toEqual(["acc_1"]);
    expect(queries[1].text).toMatch(/UPDATE connected_accounts/i);
    expect(queries[1].text).toMatch(/sync_state = 'syncing'/i);
    expect(queries[1].values).toEqual(["acc_1"]);
  });

  it("requeues failed or dead-letter sync jobs for the account", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [{ id: "job_1" }, { id: "job_2" }] };
      },
    };

    const store = createPostgresSyncControlStore(client);
    const result = await store.retryFailedSync({
      accountId: "acc_1",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE sync_jobs/i);
    expect(queries[0].text).toMatch(/status IN \('failed', 'dead_letter'\)/i);
    expect(queries[0].text).toMatch(/attempts = 0/i);
    expect(queries[0].text).toMatch(/error_message = NULL/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "2026-06-13T08:00:00.000Z",
    ]);
    expect(result).toEqual({
      accountId: "acc_1",
      retriedJobCount: 2,
      retriedJobIds: ["job_1", "job_2"],
    });
  });

  it("does not requeue old failed sync jobs while the account already has active sync work", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresSyncControlStore(client);
    const result = await store.retryFailedSync({
      accountId: "acc_1",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/NOT EXISTS/i);
    expect(queries[0].text).toMatch(/active_same_account/i);
    expect(queries[0].text).toMatch(
      /active_same_account\.status IN \('queued', 'running'\)/i,
    );
    expect(queries[0].text).toMatch(
      /active_same_account\.account_id = sync_jobs\.account_id/i,
    );
    expect(result).toEqual({
      accountId: "acc_1",
      retriedJobCount: 0,
      retriedJobIds: [],
    });
  });
});
