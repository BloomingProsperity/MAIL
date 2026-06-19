import { describe, expect, it } from "vitest";

import { createOAuthTokenClient } from "../src/accounts/oauth-token-client";
import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";

describe("OAuth token client", () => {
  it("exchanges an authorization code with a form-encoded token request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const registry = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
    const client = createOAuthTokenClient({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          id_token: "header.payload.signature",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly openid email",
          token_type: "Bearer",
        });
      },
    });

    const token = await client.exchangeCode({
      provider: registry.get("gmail"),
      code: "code_1",
      redirectUri: "https://app.example.com/oauth/callback",
    });

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(String(calls[0].init?.body)).toBe(
      "client_id=google-client-id&client_secret=google-client-secret&code=code_1&redirect_uri=https%3A%2F%2Fapp.example.com%2Foauth%2Fcallback&grant_type=authorization_code",
    );
    expect(token).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "header.payload.signature",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/gmail.readonly openid email",
      tokenType: "Bearer",
    });
  });

  it("throws sanitized token errors without leaking code or client secret", async () => {
    const registry = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
    const client = createOAuthTokenClient({
      fetchImpl: async () =>
        Response.json(
          {
            error: "invalid_grant",
            error_description: "code_1 was already used",
          },
          { status: 400 },
        ),
    });

    await expect(
      client.exchangeCode({
        provider: registry.get("gmail"),
        code: "code_1",
        redirectUri: "https://app.example.com/oauth/callback",
      }),
    ).rejects.toThrow("OAuth token exchange failed: 400 invalid_grant");

    await expect(
      client.exchangeCode({
        provider: registry.get("gmail"),
        code: "code_1",
        redirectUri: "https://app.example.com/oauth/callback",
      }),
    ).rejects.not.toThrow(/code_1|google-client-secret/);
  });
});
