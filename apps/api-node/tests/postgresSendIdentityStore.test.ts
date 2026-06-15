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

  it("lists explicit Graph send identity candidates with verification state", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSendIdentityStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "provider:identity_1",
              account_id: "acc_1",
              address: "team@example.com",
              name: "Team Inbox",
              provider: "graph",
              provider_identity_id: "team@example.com",
              identity_type: "shared_mailbox",
              verification_state: "pending",
              enabled: false,
              account_email: "me@example.com",
              verification_error: null,
            },
          ],
        };
      },
    });

    const candidates = await store.listProviderSendIdentityCandidates?.({
      accountId: "acc_1",
    });

    expect(queries[0].text).toMatch(/explicitCandidate/i);
    expect(queries[0].text).toMatch(/provider_send_identities\.provider = 'graph'/i);
    expect(queries[0].values).toEqual(["acc_1"]);
    expect(candidates).toEqual([
      {
        id: "provider:identity_1",
        accountId: "acc_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        source: "provider_native",
        isDefault: false,
        verified: false,
        provider: "graph",
        providerIdentityId: "team@example.com",
        identityType: "shared_mailbox",
        verificationState: "pending",
        enabled: false,
        verificationRecipient: { address: "me@example.com" },
      },
    ]);
  });

  it("upserts explicit Graph candidates as pending and disabled", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSendIdentityStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "provider:identity_1",
              account_id: "acc_1",
              address: "team@example.com",
              name: "Team Inbox",
              provider: "graph",
              provider_identity_id: "team@example.com",
              identity_type: "shared_mailbox",
              verification_state: "pending",
              enabled: false,
              account_email: "me@example.com",
              verification_error: null,
            },
          ],
        };
      },
    });

    const candidate = await store.upsertProviderSendIdentityCandidate?.({
      accountId: "acc_1",
      provider: "graph",
      from: { address: "team@example.com", name: "Team Inbox" },
      identityType: "shared_mailbox",
      now: "2026-06-15T20:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/account_provider_settings/i);
    expect(queries[0].text).toMatch(/native_provider = 'graph'/i);
    expect(queries[0].text).toMatch(/verification_state[\s\S]*'pending'/i);
    expect(queries[0].text).toMatch(/enabled[\s\S]*FALSE/i);
    expect(queries[0].text).toMatch(/explicitCandidate/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "team@example.com",
      "Team Inbox",
      "shared_mailbox",
      "2026-06-15T20:00:00.000Z",
    ]);
    expect(candidate).toMatchObject({
      verificationState: "pending",
      enabled: false,
      verified: false,
    });
  });

  it("marks explicit Graph candidates verified or failed after test sends", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSendIdentityStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "provider:identity_1",
              account_id: "acc_1",
              address: "team@example.com",
              name: "Team Inbox",
              provider: "graph",
              provider_identity_id: "team@example.com",
              identity_type: "shared_mailbox",
              verification_state: values?.[2],
              enabled: values?.[3],
              account_email: "me@example.com",
              verification_error: values?.[4],
            },
          ],
        };
      },
    });

    const failed =
      await store.markProviderSendIdentityCandidateVerification?.({
        accountId: "acc_1",
        candidateId: "provider:identity_1",
        verificationState: "failed",
        enabled: false,
        verificationError: "ErrorSendAsDenied",
        now: "2026-06-15T20:10:00.000Z",
      });

    expect(queries[0].text).toMatch(/verification_state = \$3/i);
    expect(queries[0].text).toMatch(/verificationError/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "provider:identity_1",
      "failed",
      false,
      "ErrorSendAsDenied",
      "2026-06-15T20:10:00.000Z",
    ]);
    expect(failed).toMatchObject({
      verificationState: "failed",
      enabled: false,
      verified: false,
      verificationError: "ErrorSendAsDenied",
    });
  });
});
