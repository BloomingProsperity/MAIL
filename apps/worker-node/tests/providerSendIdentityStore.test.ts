import { describe, expect, it } from "vitest";

import { createPostgresProviderSendIdentityStore } from "../src/provider-send-identity-store";

describe("Postgres provider send identity store", () => {
  it("upserts discovered identities and disables stale provider identities", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresProviderSendIdentityStore({
      async query(text, values) {
        queries.push({ text, values });
        if (text.includes("RETURNING id")) {
          return { rows: [{ id: `row_${queries.length}` }] };
        }
        return { rows: [] };
      },
    });

    const result = await store.replaceDiscoveredIdentities({
      accountId: "acc_1",
      provider: "gmail",
      discoveredAt: "2026-06-15T10:00:00.000Z",
      identities: [
        {
          providerIdentityId: "me@gmail.com",
          email: "ME@GMAIL.COM",
          displayName: "Me",
          identityType: "account",
          verificationState: "verified",
          enabled: true,
          isDefault: true,
          capabilities: { isPrimary: true },
        },
        {
          providerIdentityId: "support@example.com",
          email: "support@example.com",
          displayName: "Support",
          identityType: "alias",
          verificationState: "verified",
          enabled: true,
          capabilities: { isPrimary: false },
        },
      ],
    });

    expect(result).toEqual({ upserted: 2, disabled: 1 });
    expect(queries[0].text).toBe("BEGIN");
    expect(queries[1].text).toMatch(/INSERT INTO provider_send_identities/i);
    expect(queries[1].text).toMatch(
      /ON CONFLICT \(account_id, provider, provider_identity_id\)/i,
    );
    expect(queries[1].values).toEqual([
      "acc_1",
      "gmail",
      "me@gmail.com",
      "ME@GMAIL.COM",
      "Me",
      "account",
      "verified",
      true,
      true,
      { isPrimary: true },
      "2026-06-15T10:00:00.000Z",
    ]);
    expect(queries[3].text).toMatch(/UPDATE provider_send_identities/i);
    expect(queries[3].text).toMatch(
      /provider_identity_id <> ALL\(\$4::text\[\]\)/i,
    );
    expect(queries[3].values).toEqual([
      "acc_1",
      "gmail",
      "2026-06-15T10:00:00.000Z",
      ["me@gmail.com", "support@example.com"],
    ]);
    expect(queries[4].text).toBe("COMMIT");
  });

  it("rolls back when an upsert fails", async () => {
    const queries: string[] = [];
    const store = createPostgresProviderSendIdentityStore({
      async query(text) {
        queries.push(text);
        if (text.includes("INSERT INTO provider_send_identities")) {
          throw new Error("database unavailable");
        }
        return { rows: [] };
      },
    });

    await expect(
      store.replaceDiscoveredIdentities({
        accountId: "acc_1",
        provider: "gmail",
        discoveredAt: "2026-06-15T10:00:00.000Z",
        identities: [
          {
            providerIdentityId: "me@gmail.com",
            email: "me@gmail.com",
            identityType: "account",
            verificationState: "verified",
          },
        ],
      }),
    ).rejects.toThrow("database unavailable");
    expect(queries).toEqual([
      "BEGIN",
      expect.stringMatching(/INSERT INTO provider_send_identities/i),
      "ROLLBACK",
    ]);
  });

  it("pins discovery replacement transactions to a checked-out database client", async () => {
    const poolQueries: string[] = [];
    const txQueries: string[] = [];
    let released = false;
    const store = createPostgresProviderSendIdentityStore({
      async query(text) {
        poolQueries.push(text);
        return { rows: [] };
      },
      async connect() {
        return {
          async query(text) {
            txQueries.push(text);
            return text.includes("RETURNING id")
              ? { rows: [{ id: "identity_1" }] }
              : { rows: [] };
          },
          release() {
            released = true;
          },
        };
      },
    });

    await store.replaceDiscoveredIdentities({
      accountId: "acc_1",
      provider: "gmail",
      discoveredAt: "2026-06-15T10:00:00.000Z",
      identities: [
        {
          providerIdentityId: "support@example.com",
          email: "support@example.com",
          identityType: "alias",
          verificationState: "verified",
        },
      ],
    });

    expect(poolQueries).toEqual([]);
    expect(txQueries[0]).toBe("BEGIN");
    expect(txQueries.at(-1)).toBe("COMMIT");
    expect(released).toBe(true);
  });
});
