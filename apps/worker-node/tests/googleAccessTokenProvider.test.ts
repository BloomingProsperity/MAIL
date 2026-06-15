import { describe, expect, it } from "vitest";

import { createGoogleAccessTokenProvider } from "../src/google/access-token-provider";

describe("Google access token provider", () => {
  it("loads a refresh token through secret_ref and returns a fresh access token", async () => {
    const calls: unknown[] = [];
    const provider = createGoogleAccessTokenProvider({
      credentialStore: {
        async getCredential(input) {
          calls.push({ type: "credential.get", input });
          return {
            accountId: input.accountId,
            credentialKind: input.credentialKind,
            secretRef: "env:GMAIL_REFRESH_TOKEN_ACC_1",
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
            accessToken: "access-token",
            expiresAt: "2026-06-12T11:00:00.000Z",
          };
        },
      },
    });

    await expect(provider.getAccessToken("acc_1")).resolves.toBe("access-token");
    expect(calls).toEqual([
      {
        type: "credential.get",
        input: {
          accountId: "acc_1",
          credentialKind: "google_oauth_refresh_token",
        },
      },
      {
        type: "secret.get",
        secretRef: "env:GMAIL_REFRESH_TOKEN_ACC_1",
      },
      {
        type: "token.refresh",
        input: { refreshToken: "refresh-token-secret" },
      },
    ]);
  });

  it("throws a clear configuration error when the refresh credential is missing", async () => {
    const provider = createGoogleAccessTokenProvider({
      credentialStore: {
        async getCredential() {
          return undefined;
        },
      },
      secretStore: {
        async getSecret() {
          throw new Error("should not read secret without credential");
        },
      },
      tokenClient: {
        async refreshAccessToken() {
          throw new Error("should not refresh without credential");
        },
      },
    });

    await expect(provider.getAccessToken("acc_1")).rejects.toThrow(
      "missing google_oauth_refresh_token credential for account acc_1",
    );
  });

  it("does not leak refresh token values when token refresh fails", async () => {
    const provider = createGoogleAccessTokenProvider({
      credentialStore: {
        async getCredential(input) {
          return {
            accountId: input.accountId,
            credentialKind: input.credentialKind,
            secretRef: "env:GMAIL_REFRESH_TOKEN_ACC_1",
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
      "Google access token unavailable for account acc_1: provider rejected [redacted]",
    );

    await expect(provider.getAccessToken("acc_1")).rejects.not.toThrow(
      /refresh-token-secret/,
    );
  });

  it("rejects empty refresh tokens before calling Google OAuth", async () => {
    const provider = createGoogleAccessTokenProvider({
      credentialStore: {
        async getCredential(input) {
          return {
            accountId: input.accountId,
            credentialKind: input.credentialKind,
            secretRef: "env:GMAIL_REFRESH_TOKEN_ACC_1",
          };
        },
      },
      secretStore: {
        async getSecret() {
          return "";
        },
      },
      tokenClient: {
        async refreshAccessToken() {
          throw new Error("should not call Google with an empty refresh token");
        },
      },
    });

    await expect(provider.getAccessToken("acc_1")).rejects.toThrow(
      "empty google_oauth_refresh_token secret for account acc_1",
    );
  });
});
