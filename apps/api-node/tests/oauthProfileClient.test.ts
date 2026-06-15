import { describe, expect, it } from "vitest";

import { createOAuthProfileClient } from "../src/accounts/oauth-profile-client";
import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";

describe("OAuth profile client", () => {
  it("reads the Gmail account email from Gmail profile", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const registry = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
    const client = createOAuthProfileClient({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ emailAddress: "me@gmail.com" });
      },
    });

    const profile = await client.getProfile({
      provider: registry.get("gmail"),
      accessToken: "access-token",
    });

    expect(calls[0]).toEqual({
      url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      init: {
        headers: {
          Authorization: "Bearer access-token",
        },
      },
    });
    expect(profile).toEqual({ email: "me@gmail.com" });
  });

  it("reads the Outlook account email from Microsoft Graph profile", async () => {
    const registry = createOAuthProviderRegistry({
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
    });
    const client = createOAuthProfileClient({
      fetchImpl: async () =>
        Response.json({
          mail: null,
          userPrincipalName: "me@outlook.com",
          displayName: "Me",
        }),
    });

    await expect(
      client.getProfile({
        provider: registry.get("outlook"),
        accessToken: "access-token",
      }),
    ).resolves.toEqual({
      email: "me@outlook.com",
      displayName: "Me",
    });
  });
});
