import { describe, expect, it } from "vitest";

import { createGoogleOAuthTokenClient } from "../src/google/oauth-token-client";

describe("Google OAuth token client", () => {
  it("refreshes an access token with a form-encoded POST body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGoogleOAuthTokenClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          token_type: "Bearer",
        });
      },
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    });

    const token = await client.refreshAccessToken({
      refreshToken: "refresh-token",
    });

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(String(calls[0].init?.body)).toBe(
      "client_id=client-id&client_secret=client-secret&refresh_token=refresh-token&grant_type=refresh_token",
    );
    expect(token).toEqual({
      accessToken: "access-token",
      expiresAt: "2026-06-12T11:00:00.000Z",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      tokenType: "Bearer",
    });
  });

  it("omits client_secret for public desktop-style clients", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGoogleOAuthTokenClient({
      clientId: "desktop-client-id",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          access_token: "access-token",
          expires_in: 120,
        });
      },
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    });

    await client.refreshAccessToken({ refreshToken: "refresh-token" });

    expect(String(calls[0].init?.body)).toBe(
      "client_id=desktop-client-id&refresh_token=refresh-token&grant_type=refresh_token",
    );
  });

  it("throws a sanitized error when Google rejects the refresh token", async () => {
    const client = createGoogleOAuthTokenClient({
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
      client.refreshAccessToken({
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow(
      "Google OAuth refresh failed: 400 invalid_grant refresh token rejected",
    );

    await expect(
      client.refreshAccessToken({
        refreshToken: "refresh-token",
      }),
    ).rejects.not.toThrow(/refresh-token|super-secret-client-secret/);
  });
});
