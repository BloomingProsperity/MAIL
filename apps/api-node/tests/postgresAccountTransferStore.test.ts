import { describe, expect, it } from "vitest";

import { createPostgresAccountTransferStore } from "../src/accounts/postgres-account-transfer-store";

describe("postgres account transfer store", () => {
  it("lists transfer-safe account configuration without joining secrets", async () => {
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
              display_name: "Support",
              engine_provider: "emailengine",
            },
            {
              id: "22222222-2222-2222-2222-222222222222",
              email: "boss@gmail.com",
              provider: "gmail",
              auth_method: "oauth",
              display_name: "Boss",
              engine_provider: "native",
            },
          ],
        };
      },
    };

    const store = createPostgresAccountTransferStore(client);
    const accounts = await store.listTransferAccounts({
      accountIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(queries[0].text).toMatch(/FROM connected_accounts/i);
    expect(queries[0].text).toMatch(/WHERE id = ANY\(\$1::uuid\[\]\)/i);
    expect(queries[0].text).not.toMatch(/stored_secrets|account_credentials/i);
    expect(queries[0].values).toEqual([
      ["11111111-1111-1111-1111-111111111111"],
    ]);
    expect(accounts).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        displayName: "Support",
        engineProvider: "emailengine",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        email: "boss@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        displayName: "Boss",
        engineProvider: "native",
      },
    ]);
  });
});
