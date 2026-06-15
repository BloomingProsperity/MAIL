import { describe, expect, it } from "vitest";

import { createPostgresSendIdentityStore } from "../src/mail-compose/postgres-send-identity-store";

describe("Postgres send identity store", () => {
  it("lists account, verified routed domain, and provider-native identities", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSendIdentityStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "account:acc_1",
              account_id: "acc_1",
              address: "me@example.com",
              name: "Me",
              source: "account",
              is_default: true,
              verified: true,
            },
            {
              id: "alias:alias_1",
              account_id: "acc_1",
              address: "support@demo.site",
              name: null,
              source: "domain_alias",
              is_default: false,
              verified: true,
            },
            {
              id: "provider:identity_1",
              account_id: "acc_1",
              address: "team@example.com",
              name: "Team Inbox",
              source: "provider_native",
              is_default: false,
              verified: true,
              provider: "graph",
              provider_identity_id: "shared-mailbox/team",
              identity_type: "shared_mailbox",
            },
          ],
        };
      },
    });

    const identities = await store.listSendIdentities({ accountId: "acc_1" });

    expect(queries[0].text).toMatch(/connected_accounts/i);
    expect(queries[0].text).toMatch(/aliases\.enabled = TRUE/i);
    expect(queries[0].text).toMatch(/domains\.verification_status = 'verified'/i);
    expect(queries[0].text).toMatch(/destinations\.verified = TRUE/i);
    expect(queries[0].text).toMatch(/provider_send_identities/i);
    expect(queries[0].text).toMatch(/verification_state = 'verified'/i);
    expect(queries[0].text).toMatch(/provider_send_identities\.enabled = TRUE/i);
    expect(queries[0].text).toMatch(/lower\(provider_send_identities\.email\) <> lower\(connected_accounts\.email\)/i);
    expect(queries[0].values).toEqual(["acc_1"]);
    expect(identities).toEqual([
      {
        id: "account:acc_1",
        accountId: "acc_1",
        from: { address: "me@example.com", name: "Me" },
        source: "account",
        isDefault: true,
        verified: true,
      },
      {
        id: "alias:alias_1",
        accountId: "acc_1",
        from: { address: "support@demo.site" },
        source: "domain_alias",
        isDefault: false,
        verified: true,
      },
      {
        id: "provider:identity_1",
        accountId: "acc_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        source: "provider_native",
        isDefault: false,
        verified: true,
        provider: "graph",
        providerIdentityId: "shared-mailbox/team",
        identityType: "shared_mailbox",
      },
    ]);
  });
});
