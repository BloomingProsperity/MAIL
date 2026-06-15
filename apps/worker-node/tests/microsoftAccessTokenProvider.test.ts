import { describe, expect, it } from "vitest";

import { createMicrosoftAccessTokenProvider } from "../src/microsoft/access-token-provider";

describe("Microsoft access token provider", () => {
  it("loads a Microsoft refresh token through secret_ref and returns a Graph token", async () => {
    const calls: unknown[] = [];
    const provider = createMicrosoftAccessTokenProvider({
      credentialStore: {
        async getCredential(input) {
          calls.push({ type: "credential.get", input });
          return {
            accountId: input.accountId,
            credentialKind: input.credentialKind,
            secretRef: "db:outlook_secret",
          };
        },
      },
      secretStore: {
        async getSecret(secretRef) {
          calls.push({ type: "secret.get", secretRef });
          return "refresh-token-secret";
        },
      },
      tokenClient: {
        async refreshAccessToken(input) {
          calls.push({ type: "token.refresh", input });
          return {
            accessToken: "graph-access-token",
            expiresAt: "2026-06-12T11:00:00.000Z",
          };
        },
      },
    });

    await expect(provider.getAccessToken("acc_1")).resolves.toBe(
      "graph-access-token",
    );
    expect(calls).toEqual([
      {
        type: "credential.get",
        input: {
          accountId: "acc_1",
          credentialKind: "microsoft_oauth_refresh_token",
        },
      },
      { type: "secret.get", secretRef: "db:outlook_secret" },
      { type: "token.refresh", input: { refreshToken: "refresh-token-secret" } },
    ]);
  });

  it("does not leak Microsoft refresh token values when refresh fails", async () => {
    const provider = createMicrosoftAccessTokenProvider({
      credentialStore: {
        async getCredential(input) {
          return {
            accountId: input.accountId,
            credentialKind: input.credentialKind,
            secretRef: "db:outlook_secret",
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "refresh-token-secret";
        },
      },
      tokenClient: {
        async refreshAccessToken() {
          throw new Error("provider rejected refresh-token-secret");
        },
      },
    });

    await expect(provider.getAccessToken("acc_1")).rejects.toThrow(
      "Microsoft access token unavailable for account acc_1: provider rejected [redacted]",
    );
    await expect(provider.getAccessToken("acc_1")).rejects.not.toThrow(
      /refresh-token-secret/,
    );
  });
});
