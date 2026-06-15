import { describe, expect, it } from "vitest";

import { createPostgresSendIdentityVerifier } from "../src/postgres-send-identity-verifier";

describe("Postgres send identity verifier", () => {
  it("allows a currently verified provider-native send identity", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const verifier = createPostgresSendIdentityVerifier({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [{ "?column?": 1 }] };
      },
    });

    await expect(
      verifier.ensureAllowedSender({
        accountId: "acc_1",
        from: { address: "team@example.com", name: "Team Inbox" },
      }),
    ).resolves.toBeUndefined();

    expect(queries[0].text).toMatch(/account_identity/i);
    expect(queries[0].text).toMatch(/alias_identities/i);
    expect(queries[0].text).toMatch(/provider_send_identities/i);
    expect(queries[0].text).toMatch(/verification_state = 'verified'/i);
    expect(queries[0].text).toMatch(/provider_send_identities\.enabled = TRUE/i);
    expect(queries[0].values).toEqual(["acc_1", "team@example.com"]);
  });

  it("rejects senders that are no longer verified for the account", async () => {
    const verifier = createPostgresSendIdentityVerifier({
      async query() {
        return { rows: [] };
      },
    });

    await expect(
      verifier.ensureAllowedSender({
        accountId: "acc_1",
        from: { address: "support@demo.site" },
      }),
    ).rejects.toThrow("from address is not allowed");
  });
});
