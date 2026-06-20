import { describe, expect, it } from "vitest";

import {
  createConfiguredEmailEngineAuthServerService,
  createPostgresEmailEngineAuthServerService,
} from "../src/mail-engine/email-engine-auth-server";

describe("EmailEngine auth server service", () => {
  it("resolves Gmail OAuth credentials from stored refresh token refs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const service = createPostgresEmailEngineAuthServerService({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("FROM connected_accounts")) {
            return { rows: [{ email: "me@gmail.com", provider: "gmail" }] };
          }
          if (text.includes("FROM account_credentials")) {
            return { rows: [{ secret_ref: "db:secret_1" }] };
          }
          if (text.includes("FROM stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-secret" }] };
          }
          return { rows: [] };
        },
      },
      google: {
        async refreshAccessToken(input) {
          expect(input).toEqual({ refreshToken: "refresh-token-secret" });
          return {
            accessToken: "access-token",
            expiresAt: "2026-06-16T01:00:00.000Z",
          };
        },
      },
      microsoft: {
        async refreshAccessToken() {
          throw new Error("should not refresh Microsoft token");
        },
      },
    });

    await expect(
      service.resolveCredentials({ accountId: "acc_1", proto: "imap" }),
    ).resolves.toEqual({
      user: "me@gmail.com",
      accessToken: "access-token",
    });
    expect(queries[1].values).toEqual([
      "acc_1",
      "google_oauth_refresh_token",
    ]);
  });

  it("resolves Outlook OAuth credentials with the Microsoft refresh client", async () => {
    const service = createPostgresEmailEngineAuthServerService({
      client: {
        async query(text) {
          if (text.includes("FROM connected_accounts")) {
            return { rows: [{ email: "me@outlook.com", provider: "outlook" }] };
          }
          if (text.includes("FROM account_credentials")) {
            return { rows: [{ secret_ref: "db:secret_1" }] };
          }
          if (text.includes("FROM stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-secret" }] };
          }
          return { rows: [] };
        },
      },
      google: {
        async refreshAccessToken() {
          throw new Error("should not refresh Google token");
        },
      },
      microsoft: {
        async refreshAccessToken(input) {
          expect(input).toEqual({ refreshToken: "refresh-token-secret" });
          return {
            accessToken: "graph-access-token",
            expiresAt: "2026-06-16T01:00:00.000Z",
          };
        },
      },
    });

    await expect(
      service.resolveCredentials({ accountId: "acc_1", proto: "api" }),
    ).resolves.toEqual({
      user: "me@outlook.com",
      accessToken: "graph-access-token",
    });
  });

  it("redacts refresh tokens from refresh failures", async () => {
    const service = createPostgresEmailEngineAuthServerService({
      client: {
        async query(text) {
          if (text.includes("FROM connected_accounts")) {
            return { rows: [{ email: "me@gmail.com", provider: "gmail" }] };
          }
          if (text.includes("FROM account_credentials")) {
            return { rows: [{ secret_ref: "db:secret_1" }] };
          }
          if (text.includes("FROM stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-secret" }] };
          }
          return { rows: [] };
        },
      },
      google: {
        async refreshAccessToken() {
          throw new Error("Google rejected refresh-token-secret");
        },
      },
      microsoft: {
        async refreshAccessToken() {
          throw new Error("should not refresh Microsoft token");
        },
      },
    });

    await expect(
      service.resolveCredentials({ accountId: "acc_1", proto: "smtp" }),
    ).rejects.toThrow("Google rejected [redacted]");
  });

  it("uses Outlook IMAP/SMTP scopes for configured EmailEngine Microsoft token refresh", async () => {
    const tokenRequests: string[] = [];
    const service = createConfiguredEmailEngineAuthServerService({
      env: {
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
        MICROSOFT_OAUTH_TOKEN_URL: "https://login.example/token",
      },
      fetchImpl: async (_url, init) => {
        tokenRequests.push(String(init?.body));
        return Response.json({
          access_token: "outlook-imap-smtp-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      },
      client: {
        async query(text) {
          if (text.includes("FROM connected_accounts")) {
            return { rows: [{ email: "me@outlook.com", provider: "outlook" }] };
          }
          if (text.includes("FROM account_credentials")) {
            return { rows: [{ secret_ref: "db:secret_1" }] };
          }
          if (text.includes("FROM stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-secret" }] };
          }
          return { rows: [] };
        },
      },
    });

    await expect(
      service.resolveCredentials({ accountId: "acc_1", proto: "imap" }),
    ).resolves.toEqual({
      user: "me@outlook.com",
      accessToken: "outlook-imap-smtp-access-token",
    });
    expect(tokenRequests[0]).toContain(
      "scope=offline_access+https%3A%2F%2Foutlook.office.com%2FIMAP.AccessAsUser.All+https%3A%2F%2Foutlook.office.com%2FSMTP.Send",
    );
    expect(tokenRequests[0]).not.toContain("graph.microsoft.com");
  });
});
