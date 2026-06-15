import { describe, expect, it } from "vitest";

import { createPostgresSyncCenterStore } from "../src/sync-center/postgres-sync-center-store";

describe("postgres sync center store", () => {
  it("lists account sync status with latest job without reading credentials", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "11111111-1111-1111-1111-111111111111",
              email: "support@qq.com",
              provider: "qq",
              auth_method: "password",
              display_name: "Support",
              sync_state: "syncing",
              engine_provider: "emailengine",
              account_updated_at: "2026-06-13T08:00:00.000Z",
              job_id: "job_1",
              job_type: "sync_account",
              job_status: "running",
              attempts: 2,
              max_attempts: 8,
              not_before: "2026-06-13T08:01:00.000Z",
              lease_expires_at: "2026-06-13T08:06:00.000Z",
              error_message: null,
              job_updated_at: "2026-06-13T08:02:00.000Z",
              completed_at: null,
            },
            {
              account_id: "22222222-2222-2222-2222-222222222222",
              email: "boss@gmail.com",
              provider: "gmail",
              auth_method: "oauth",
              display_name: "Boss",
              sync_state: "reauth_required",
              engine_provider: "native",
              account_updated_at: "2026-06-13T07:00:00.000Z",
              job_id: "job_2",
              job_type: "sync_account",
              job_status: "dead_letter",
              attempts: 8,
              max_attempts: 8,
              not_before: "2026-06-13T07:30:00.000Z",
              lease_expires_at: null,
              error_message: "invalid_grant",
              job_updated_at: "2026-06-13T07:31:00.000Z",
              completed_at: null,
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCenterStore(client);
    const result = await store.listAccounts();

    expect(queries[0].text).toMatch(/FROM connected_accounts/i);
    expect(queries[0].text).toMatch(/latest_sync_job/i);
    expect(queries[0].text).toMatch(/sync_jobs/i);
    expect(queries[0].text).not.toMatch(/stored_secrets|account_credentials/i);
    expect(result).toEqual({
      items: [
        {
          accountId: "11111111-1111-1111-1111-111111111111",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          displayName: "Support",
          syncState: "syncing",
          engineProvider: "emailengine",
          reauthRequired: false,
          nextAction: "wait_for_sync",
          accountUpdatedAt: "2026-06-13T08:00:00.000Z",
          latestSyncJob: {
            id: "job_1",
            jobType: "sync_account",
            status: "running",
            attempts: 2,
            maxAttempts: 8,
            notBefore: "2026-06-13T08:01:00.000Z",
            leaseExpiresAt: "2026-06-13T08:06:00.000Z",
            updatedAt: "2026-06-13T08:02:00.000Z",
          },
        },
        {
          accountId: "22222222-2222-2222-2222-222222222222",
          email: "boss@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          displayName: "Boss",
          syncState: "reauth_required",
          engineProvider: "native",
          reauthRequired: true,
          nextAction: "reauthorize",
          accountUpdatedAt: "2026-06-13T07:00:00.000Z",
          latestSyncJob: {
            id: "job_2",
            jobType: "sync_account",
            status: "dead_letter",
            attempts: 8,
            maxAttempts: 8,
            notBefore: "2026-06-13T07:30:00.000Z",
            errorMessage: "invalid_grant",
            updatedAt: "2026-06-13T07:31:00.000Z",
          },
        },
      ],
    });
  });

  it("lists pending reauthorization tasks with redacted payload fields", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              task_id: "task_1",
              email: "boss@gmail.com",
              provider: "gmail",
              auth_method: "oauth",
              status: "pending",
              error_message: null,
              payload: {
                source: "account_transfer_import",
                transferVersion: 1,
                reauthRequired: true,
                displayName: "Boss",
                loginHint: "boss@gmail.com",
                refreshToken: "must-not-leak",
                secret: "must-not-leak",
              },
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCenterStore(client);
    const result = await store.listReauthorizations();

    expect(queries[0].text).toMatch(/FROM onboarding_tasks/i);
    expect(queries[0].text).toMatch(/reauthRequired/i);
    expect(queries[0].text).not.toMatch(/stored_secrets|account_credentials/i);
    expect(result).toEqual({
      items: [
        {
          taskId: "task_1",
          email: "boss@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          status: "pending",
          source: "account_transfer_import",
          displayName: "Boss",
          transferVersion: 1,
          reauthRequired: true,
          loginHint: "boss@gmail.com",
          createdAt: "2026-06-13T08:00:00.000Z",
          updatedAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });
});
