import { describe, expect, it } from "vitest";

import { createPostgresAccountOnboardingStore } from "../src/accounts/postgres-onboarding-store";

describe("postgres account onboarding store", () => {
  it("creates an onboarding task and completes it with a connected account", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });

        if (text.includes("INSERT INTO onboarding_tasks")) {
          return {
            rows: [
              {
                id: "11111111-1111-1111-1111-111111111111",
                email: "support@qq.com",
                provider: "qq",
                auth_method: "password",
                status: "pending",
                error_message: null,
                payload: { accountId: "22222222-2222-2222-2222-222222222222" },
              },
            ],
          };
        }

        if (text.includes("INSERT INTO connected_accounts")) {
          return {
            rows: [
              {
                id: "22222222-2222-2222-2222-222222222222",
                email: "support@qq.com",
                provider: "qq",
                auth_method: "password",
                display_name: "Support",
                sync_state: "syncing",
                engine_provider: "emailengine",
              },
            ],
          };
        }

        if (text.includes("UPDATE onboarding_tasks")) {
          return {
            rows: [
              {
                id: "11111111-1111-1111-1111-111111111111",
                email: "support@qq.com",
                provider: "qq",
                auth_method: "password",
                status: "completed",
                error_message: null,
                payload: { accountId: "22222222-2222-2222-2222-222222222222" },
              },
            ],
          };
        }

        return { rows: [] };
      },
    };

    const store = createPostgresAccountOnboardingStore(client);
    await store.createTask({
      id: "11111111-1111-1111-1111-111111111111",
      email: "support@qq.com",
      provider: "qq",
      authMethod: "password",
      status: "pending",
      payload: { accountId: "22222222-2222-2222-2222-222222222222" },
    });
    const result = await store.completeTask({
      taskId: "11111111-1111-1111-1111-111111111111",
      account: {
        id: "22222222-2222-2222-2222-222222222222",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        displayName: "Support",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    });

    expect(queries[0].text).toMatch(/INSERT INTO onboarding_tasks/i);
    expect(queries[1].text).toMatch(/INSERT INTO connected_accounts/i);
    expect(queries[1].text).toMatch(/ON CONFLICT \(email, provider\)/i);
    expect(queries[2].text).toMatch(/UPDATE onboarding_tasks/i);
    expect(result).toEqual({
      task: {
        id: "11111111-1111-1111-1111-111111111111",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "22222222-2222-2222-2222-222222222222",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        displayName: "Support",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    });
  });

  it("marks an onboarding task failed with the error message", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              email: "support@qq.com",
              provider: "qq",
              auth_method: "password",
              status: "failed",
              error_message: "invalid credentials",
              payload: {},
            },
          ],
        };
      },
    };

    const store = createPostgresAccountOnboardingStore(client);
    const task = await store.failTask({
      taskId: "11111111-1111-1111-1111-111111111111",
      errorMessage: "invalid credentials",
    });

    expect(queries[0].text).toMatch(/UPDATE onboarding_tasks/i);
    expect(queries[0].values).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "invalid credentials",
    ]);
    expect(task).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      email: "support@qq.com",
      provider: "qq",
      authMethod: "password",
      status: "failed",
      errorMessage: "invalid credentials",
      payload: {},
    });
  });

  it("finds an existing connected account by email and provider", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              email: "support@qq.com",
              provider: "qq",
              auth_method: "password",
              display_name: "Support",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    };

    const store = createPostgresAccountOnboardingStore(client);
    const account = await store.findAccountByEmailProvider!({
      email: "support@qq.com",
      provider: "qq",
    });

    expect(queries[0].text).toMatch(/FROM connected_accounts/i);
    expect(queries[0].values).toEqual(["support@qq.com", "qq"]);
    expect(account).toEqual({
      id: "22222222-2222-2222-2222-222222222222",
      email: "support@qq.com",
      provider: "qq",
      authMethod: "password",
      displayName: "Support",
      syncState: "syncing",
      engineProvider: "emailengine",
    });
  });

  it("reserves a canonical account id before EmailEngine registration", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "22222222-2222-2222-2222-222222222222",
            },
          ],
        };
      },
    };

    const store = createPostgresAccountOnboardingStore(client);
    const accountId = await store.reserveAccountIdForEmailProvider!({
      email: "support@qq.com",
      provider: "qq",
      proposedAccountId: "99999999-9999-9999-9999-999999999999",
    });

    expect(queries[0].text).toMatch(/account_onboarding_account_keys/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(email, provider\)/i);
    expect(queries[0].values).toEqual([
      "support@qq.com",
      "qq",
      "99999999-9999-9999-9999-999999999999",
    ]);
    expect(accountId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("completes onboarding and enqueues initial sync in one transaction", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    let released = false;
    const pool = {
      async query() {
        throw new Error("pool.query should not run inside onboarding transaction");
      },
      async connect() {
        return {
          async query(text: string, values?: unknown[]) {
            queries.push({ text, values });

            if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
              return { rows: [] };
            }

            if (text.includes("INSERT INTO connected_accounts")) {
              return {
                rows: [
                  {
                    id: "22222222-2222-2222-2222-222222222222",
                    email: "support@qq.com",
                    provider: "qq",
                    auth_method: "password",
                    display_name: "Support",
                    sync_state: "syncing",
                    engine_provider: "emailengine",
                  },
                ],
              };
            }

            if (text.includes("UPDATE onboarding_tasks")) {
              return {
                rows: [
                  {
                    id: "11111111-1111-1111-1111-111111111111",
                    email: "support@qq.com",
                    provider: "qq",
                    auth_method: "password",
                    status: "completed",
                    error_message: null,
                    payload: {},
                  },
                ],
              };
            }

            if (text.includes("INSERT INTO sync_jobs")) {
              return {
                rows: [
                  {
                    id: "33333333-3333-3333-3333-333333333333",
                    job_type: "sync_account",
                    account_id: "22222222-2222-2222-2222-222222222222",
                    idempotency_key:
                      "job:initial-sync:22222222-2222-2222-2222-222222222222",
                    status: "queued",
                    created_at: "2026-06-14T00:00:00.000Z",
                  },
                ],
              };
            }

            return { rows: [] };
          },
          release() {
            released = true;
          },
        };
      },
    };

    const store = createPostgresAccountOnboardingStore(pool, {
      createId: () => "33333333-3333-3333-3333-333333333333",
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });
    const result = await store.completeTaskAndEnqueueInitialSync!({
      taskId: "11111111-1111-1111-1111-111111111111",
      account: {
        id: "99999999-9999-9999-9999-999999999999",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        displayName: "Support",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
      initialSync: {
        accountId: "99999999-9999-9999-9999-999999999999",
        provider: "qq",
        engineProvider: "emailengine",
        sourceTaskId: "11111111-1111-1111-1111-111111111111",
      },
    });

    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(/INSERT INTO connected_accounts/i),
      expect.stringMatching(/UPDATE onboarding_tasks/i),
      expect.stringMatching(/INSERT INTO sync_jobs/i),
      "COMMIT",
    ]);
    const syncInsert = queries.find((query) =>
      /INSERT INTO sync_jobs/i.test(query.text),
    );
    expect(syncInsert?.values?.[2]).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(syncInsert?.values?.[5]).toBe(
      "job:initial-sync:22222222-2222-2222-2222-222222222222",
    );
    expect(released).toBe(true);
    expect(result).toEqual({
      task: {
        id: "11111111-1111-1111-1111-111111111111",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "22222222-2222-2222-2222-222222222222",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        displayName: "Support",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
      syncJob: {
        id: "33333333-3333-3333-3333-333333333333",
        jobType: "sync_account",
        accountId: "22222222-2222-2222-2222-222222222222",
        idempotencyKey:
          "job:initial-sync:22222222-2222-2222-2222-222222222222",
        status: "queued",
        createdAt: "2026-06-14T00:00:00.000Z",
      },
    });
  });
});
