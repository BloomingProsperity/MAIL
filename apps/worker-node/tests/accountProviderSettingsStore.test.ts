import { describe, expect, it } from "vitest";

import { createPostgresAccountProviderSettingsStore } from "../src/account-provider-settings-store";

describe("postgres account provider settings store", () => {
  it("reads a native Gmail sync plan from connected account and provider settings", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              email: "me@gmail.com",
              account_provider: "gmail",
              auth_method: "oauth",
              engine_provider: "native",
              settings_provider: "gmail",
              native_provider: "gmail",
              capabilities: { read: true, history: true },
              settings: { scopes: ["gmail.readonly"], syncMode: "history" },
            },
          ],
        };
      },
    };

    const store = createPostgresAccountProviderSettingsStore(client);
    const plan = await store.getAccountSyncPlan(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(queries[0].text).toMatch(/FROM connected_accounts/i);
    expect(queries[0].text).toMatch(/LEFT JOIN account_provider_settings/i);
    expect(queries[0].values).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(plan).toEqual({
      accountId: "11111111-1111-1111-1111-111111111111",
      email: "me@gmail.com",
      provider: "gmail",
      authMethod: "oauth",
      engineProvider: "native",
      nativeProvider: "gmail",
      capabilities: { read: true, history: true },
      settings: { scopes: ["gmail.readonly"], syncMode: "history" },
    });
  });

  it("defaults missing provider settings to EmailEngine without inventing native settings", async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              email: "support@qq.com",
              account_provider: "qq",
              auth_method: "password",
              engine_provider: "emailengine",
              settings_provider: null,
              native_provider: null,
              capabilities: null,
              settings: null,
            },
          ],
        };
      },
    };

    const store = createPostgresAccountProviderSettingsStore(client);
    const plan = await store.getAccountSyncPlan(
      "22222222-2222-2222-2222-222222222222",
    );

    expect(plan).toEqual({
      accountId: "22222222-2222-2222-2222-222222222222",
      email: "support@qq.com",
      provider: "qq",
      authMethod: "password",
      engineProvider: "emailengine",
      capabilities: {},
      settings: {},
    });
  });

  it("returns undefined when the local account does not exist", async () => {
    const client = {
      async query() {
        return { rows: [] };
      },
    };

    const store = createPostgresAccountProviderSettingsStore(client);

    await expect(store.getAccountSyncPlan("missing")).resolves.toBeUndefined();
  });

  it("exposes paused sync state for worker dispatch guards", async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              id: "33333333-3333-3333-3333-333333333333",
              email: "paused@qq.com",
              account_provider: "qq",
              auth_method: "password",
              sync_state: "paused",
              engine_provider: "emailengine",
              settings_provider: null,
              native_provider: null,
              capabilities: null,
              settings: null,
            },
          ],
        };
      },
    };

    const store = createPostgresAccountProviderSettingsStore(client);

    await expect(
      store.getAccountSyncPlan("33333333-3333-3333-3333-333333333333"),
    ).resolves.toMatchObject({
      accountId: "33333333-3333-3333-3333-333333333333",
      syncState: "paused",
    });
  });

  it("marks an account as reauthorization required without touching credentials", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresAccountProviderSettingsStore(client);

    await store.markAccountReauthRequired({
      accountId: "44444444-4444-4444-4444-444444444444",
      reason: "auth_failed",
      at: "2026-06-12T09:01:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE connected_accounts/i);
    expect(queries[0].text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries[0].text).not.toMatch(/secret|token|password/i);
    expect(queries[0].values).toEqual([
      "44444444-4444-4444-4444-444444444444",
      "2026-06-12T09:01:00.000Z",
    ]);
  });
});
