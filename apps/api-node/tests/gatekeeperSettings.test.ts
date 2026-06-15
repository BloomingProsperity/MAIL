import { describe, expect, it } from "vitest";

import { createGatekeeperSettingsService } from "../src/gatekeeper/settings";
import { createPostgresGatekeeperSettingsStore } from "../src/gatekeeper/postgres-settings-store";

describe("Gatekeeper settings service", () => {
  it("returns the default off mode when an account has no settings row", async () => {
    const store = {
      async getSettings() {
        return undefined;
      },
      async setMode() {
        throw new Error("not used");
      },
    };
    const service = createGatekeeperSettingsService({ store });

    await expect(
      service.getSettings({ accountId: "account_1" }),
    ).resolves.toEqual({
      accountId: "account_1",
      mode: "off_accept_all",
    });
  });

  it("updates the account mode only after validating the mode vocabulary", async () => {
    const calls: unknown[] = [];
    const store = {
      async getSettings() {
        throw new Error("not used");
      },
      async setMode(input: unknown) {
        calls.push(input);
        return {
          accountId: "account_1",
          mode: "before_inbox",
          updatedAt: "2026-06-14T03:00:00.000Z",
        };
      },
    };
    const service = createGatekeeperSettingsService({ store });

    const result = await service.updateSettings({
      accountId: "account_1",
      mode: "before_inbox",
    });

    expect(result).toEqual({
      accountId: "account_1",
      mode: "before_inbox",
      updatedAt: "2026-06-14T03:00:00.000Z",
    });
    expect(calls).toEqual([
      {
        accountId: "account_1",
        mode: "before_inbox",
      },
    ]);
    await expect(
      service.updateSettings({ accountId: "account_1", mode: "random" as never }),
    ).rejects.toThrow("invalid gatekeeper settings request");
  });
});

describe("Postgres Gatekeeper settings store", () => {
  it("reads and upserts per-account Gatekeeper mode", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT account_id")) {
          return {
            rows: [
              {
                account_id: "account_1",
                mode: "inside_email",
                updated_at: "2026-06-14T03:00:00.000Z",
              },
            ],
          };
        }
        if (text.includes("INSERT INTO gatekeeper_settings")) {
          return {
            rows: [
              {
                account_id: "account_1",
                mode: "before_inbox",
                updated_at: "2026-06-14T03:05:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresGatekeeperSettingsStore(client);

    await expect(store.getSettings({ accountId: "account_1" })).resolves.toEqual({
      accountId: "account_1",
      mode: "inside_email",
      updatedAt: "2026-06-14T03:00:00.000Z",
    });
    await expect(
      store.setMode({ accountId: "account_1", mode: "before_inbox" }),
    ).resolves.toEqual({
      accountId: "account_1",
      mode: "before_inbox",
      updatedAt: "2026-06-14T03:05:00.000Z",
    });

    expect(queries[0].text).toMatch(/FROM gatekeeper_settings/i);
    expect(queries[0].values).toEqual(["account_1"]);
    expect(queries[1].text).toMatch(/ON CONFLICT \(account_id\) DO UPDATE/i);
    expect(queries[1].values).toEqual(["account_1", "before_inbox"]);
  });
});
