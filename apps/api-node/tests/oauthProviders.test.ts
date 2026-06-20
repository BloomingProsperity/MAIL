import { describe, expect, it } from "vitest";

import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";

describe("OAuth provider registry", () => {
  it("builds a Gmail authorization URL for offline mail sync", () => {
    const registry = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
    });

    const url = new URL(
      registry.get("gmail").buildAuthorizationUrl({
        redirectUri: "https://app.example.com/oauth/callback",
        state: "state_1",
        loginHint: "me@gmail.com",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/oauth/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state_1");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("login_hint")).toBe("me@gmail.com");
    expect(url.searchParams.get("scope")).toContain(
      "https://mail.google.com/",
    );
    expect(url.searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/gmail.modify",
    );
    expect(url.toString()).not.toContain("google-client-secret");
  });

  it("builds an Outlook authorization URL with IMAP/SMTP and offline scopes", () => {
    const registry = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
      microsoftTenant: "organizations",
    });

    const url = new URL(
      registry.get("outlook").buildAuthorizationUrl({
        redirectUri: "https://app.example.com/oauth/callback",
        state: "state_2",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("microsoft-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state_2");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain(
      "https://outlook.office.com/IMAP.AccessAsUser.All",
    );
    expect(url.searchParams.get("scope")).toContain(
      "https://outlook.office.com/SMTP.Send",
    );
    expect(url.searchParams.get("scope")).not.toContain(
      "https://graph.microsoft.com/Mail.ReadWrite",
    );
    expect(url.toString()).not.toContain("microsoft-client-secret");
  });

  it("throws a clear error when a provider client id is missing", () => {
    const registry = createOAuthProviderRegistry({
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
    });

    expect(() => registry.get("gmail")).toThrow(
      "gmail OAuth client is not configured",
    );
  });
});
