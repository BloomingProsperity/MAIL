import { describe, expect, it } from "vitest";

import { createPostgresAccountCredentialStore } from "../src/credentials/account-credential-store";

describe("postgres account credential store", () => {
  it("reads a credential secret reference without exposing secret material", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "11111111-1111-1111-1111-111111111111",
              credential_kind: "google_oauth_refresh_token",
              secret_ref: "env:GMAIL_REFRESH_TOKEN_ACC_1",
              expires_at: null,
            },
          ],
        };
      },
    };

    const store = createPostgresAccountCredentialStore(client);
    const credential = await store.getCredential({
      accountId: "11111111-1111-1111-1111-111111111111",
      credentialKind: "google_oauth_refresh_token",
    });

    expect(queries[0].text).toMatch(/FROM account_credentials/i);
    expect(queries[0].text).toMatch(/secret_ref/i);
    expect(queries[0].text).not.toMatch(/secret_value|access_token|refresh_token_value/i);
    expect(queries[0].values).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "google_oauth_refresh_token",
    ]);
    expect(credential).toEqual({
      accountId: "11111111-1111-1111-1111-111111111111",
      credentialKind: "google_oauth_refresh_token",
      secretRef: "env:GMAIL_REFRESH_TOKEN_ACC_1",
    });
  });

  it("returns undefined when the requested credential is missing", async () => {
    const store = createPostgresAccountCredentialStore({
      async query() {
        return { rows: [] };
      },
    });

    await expect(
      store.getCredential({
        accountId: "missing-account",
        credentialKind: "google_oauth_refresh_token",
      }),
    ).resolves.toBeUndefined();
  });
});
