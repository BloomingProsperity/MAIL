import { describe, expect, it } from "vitest";

import { createPostgresOAuthOnboardingStore } from "../src/accounts/postgres-oauth-onboarding-store";

describe("postgres OAuth onboarding store", () => {
  it("creates an OAuth session task with state in redacted payload", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "task_1",
              email: "pending@gmail.oauth",
              provider: "gmail",
              auth_method: "oauth",
              status: "pending",
              error_message: null,
              payload: {
                state: "state_1",
                redirectUri: "https://app.example.com/oauth/callback",
              },
            },
          ],
        };
      },
    };

    const store = createPostgresOAuthOnboardingStore(client);
    await store.createSession({
      task: {
        id: "task_1",
        email: "pending@gmail.oauth",
        provider: "gmail",
        authMethod: "oauth",
        status: "pending",
        payload: {
          state: "state_1",
          redirectUri: "https://app.example.com/oauth/callback",
        },
      },
      session: {
        taskId: "task_1",
        provider: "gmail",
        state: "state_1",
        redirectUri: "https://app.example.com/oauth/callback",
      },
    });

    expect(queries[0].text).toMatch(/INSERT INTO onboarding_tasks/i);
    expect(queries[0].values).toEqual([
      "task_1",
      "pending@gmail.oauth",
      "gmail",
      "oauth",
      "pending",
      {
        state: "state_1",
        redirectUri: "https://app.example.com/oauth/callback",
      },
    ]);
  });

  it("reads a pending OAuth session by state", async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              id: "task_1",
              provider: "gmail",
              payload: {
                state: "state_1",
                redirectUri: "https://app.example.com/oauth/callback",
                loginHint: "me@gmail.com",
              },
            },
          ],
        };
      },
    };

    const store = createPostgresOAuthOnboardingStore(client);

    await expect(store.getSessionByState("state_1")).resolves.toEqual({
      taskId: "task_1",
      provider: "gmail",
      state: "state_1",
      redirectUri: "https://app.example.com/oauth/callback",
      loginHint: "me@gmail.com",
    });
  });

  it("completes OAuth onboarding in one transaction without storing token in account credentials", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });

        if (text.includes("INSERT INTO connected_accounts")) {
          return {
            rows: [
              {
                id: "acc_1",
                email: "me@gmail.com",
                provider: "gmail",
                auth_method: "oauth",
                display_name: "Me",
                sync_state: "syncing",
                engine_provider: "native",
              },
            ],
          };
        }

        if (text.includes("UPDATE onboarding_tasks")) {
          return {
            rows: [
              {
                id: "task_1",
                email: "me@gmail.com",
                provider: "gmail",
                auth_method: "oauth",
                status: "completed",
                error_message: null,
                payload: {},
              },
            ],
          };
        }

        return { rows: [] };
      },
    };

    const store = createPostgresOAuthOnboardingStore(client);
    const result = await store.completeOAuthAccount({
      taskId: "task_1",
      taskEmail: "me@gmail.com",
      secret: {
        secretRef: "db:secret_1",
        secretValue: "refresh-token-secret",
      },
      account: {
        id: "acc_1",
        email: "me@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        displayName: "Me",
        syncState: "syncing",
        engineProvider: "native",
      },
      credential: {
        accountId: "acc_1",
        credentialKind: "google_oauth_refresh_token",
        secretRef: "db:secret_1",
      },
      providerSettings: {
        accountId: "acc_1",
        provider: "gmail",
        nativeProvider: "gmail",
        capabilities: { read: true },
        settings: { scopes: "gmail.readonly" },
      },
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "INSERT",
      "INSERT",
      "UPDATE",
      "COMMIT",
    ]);
    const credentialInsert = queries.find((query) =>
      query.text.includes("INSERT INTO account_credentials"),
    );
    expect(credentialInsert?.values).toEqual([
      "acc_1",
      "google_oauth_refresh_token",
      "db:secret_1",
    ]);
    expect(JSON.stringify(credentialInsert?.values)).not.toContain(
      "refresh-token-secret",
    );
    expect(result.account).toMatchObject({
      id: "acc_1",
      email: "me@gmail.com",
      engineProvider: "native",
    });
  });
});
