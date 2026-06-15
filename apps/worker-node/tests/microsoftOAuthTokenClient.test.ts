import { describe, expect, it } from "vitest";

import { createMicrosoftOAuthTokenClient } from "../src/microsoft/oauth-token-client";

describe("Microsoft OAuth token client", () => {
  it("refreshes a Graph access token with a form-encoded POST body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createMicrosoftOAuthTokenClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      tokenUrl: "https://login.example/common/oauth2/v2.0/token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          scope: "offline_access https://graph.microsoft.com/Mail.Read",
          token_type: "Bearer",
        });
      },
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    });

    const token = await client.refreshAccessToken({
      refreshToken: "refresh-token",
    });

    expect(calls[0].url).toBe("https://login.example/common/oauth2/v2.0/token");
    expect(calls[0].init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(String(calls[0].init?.body)).toBe(
      "client_id=client-id&client_secret=client-secret&refresh_token=refresh-token&grant_type=refresh_token&scope=offline_access+https%3A%2F%2Fgraph.microsoft.com%2FMail.Read+https%3A%2F%2Fgraph.microsoft.com%2FMail.Send+https%3A%2F%2Fgraph.microsoft.com%2FMail.Send.Shared",
    );
    expect(token).toEqual({
      accessToken: "access-token",
      expiresAt: "2026-06-12T11:00:00.000Z",
      scope: "offline_access https://graph.microsoft.com/Mail.Read",
      tokenType: "Bearer",
    });
  });

  it("throws sanitized errors without leaking refresh tokens or client secrets", async () => {
    const client = createMicrosoftOAuthTokenClient({
      clientId: "client-id",
      clientSecret: "super-secret-client-secret",
      fetchImpl: async () =>
        Response.json(
          {
            error: "invalid_grant",
            error_description: "refresh-token was revoked",
          },
          { status: 400 },
        ),
    });

    await expect(
      client.refreshAccessToken({ refreshToken: "refresh-token" }),
    ).rejects.toThrow(
      "Microsoft OAuth refresh failed: 400 invalid_grant refresh token rejected",
    );
    await expect(
      client.refreshAccessToken({ refreshToken: "refresh-token" }),
    ).rejects.not.toThrow(/refresh-token|super-secret-client-secret/);
  });
});
