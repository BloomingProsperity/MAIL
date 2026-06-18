import { describe, expect, it } from "vitest";

import { createMicrosoftOAuthRefreshClient } from "../src/native-send/oauth-token-clients";

describe("native OAuth refresh clients", () => {
  it("refreshes Microsoft tokens with Mail.Send.Shared for shared mailbox sends", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createMicrosoftOAuthRefreshClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          scope:
            "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
          token_type: "Bearer",
        });
      },
      now: () => new Date("2026-06-15T10:00:00.000Z"),
    });

    const token = await client.refreshAccessToken({
      refreshToken: "refresh-token",
    });

    expect(calls[0].url).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    expect(String(calls[0].init?.body)).toBe(
      "client_id=client-id&client_secret=client-secret&refresh_token=refresh-token&grant_type=refresh_token&scope=offline_access+https%3A%2F%2Fgraph.microsoft.com%2FMail.ReadWrite+https%3A%2F%2Fgraph.microsoft.com%2FMail.Send+https%3A%2F%2Fgraph.microsoft.com%2FMail.Send.Shared",
    );
    expect(token).toMatchObject({
      accessToken: "access-token",
      scope:
        "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
      tokenType: "Bearer",
    });
  });
});
