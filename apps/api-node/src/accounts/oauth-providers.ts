export type OAuthProviderName = "gmail" | "outlook";
export type NativeProviderName = "gmail" | "graph";

export interface OAuthProvider {
  provider: OAuthProviderName;
  nativeProvider: NativeProviderName;
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scopes: string[];
  refreshCredentialKind: string;
  buildAuthorizationUrl(input: OAuthAuthorizationUrlInput): string;
}

export interface OAuthAuthorizationUrlInput {
  redirectUri: string;
  state: string;
  loginHint?: string;
}

export interface OAuthProviderRegistry {
  get(provider: OAuthProviderName): OAuthProvider;
}

export interface OAuthProviderRegistryOptions {
  googleClientId?: string;
  googleClientSecret?: string;
  googleAuthorizationUrl?: string;
  googleTokenUrl?: string;
  gmailProfileUrl?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftTenant?: string;
  microsoftAuthorizationUrl?: string;
  microsoftTokenUrl?: string;
  microsoftProfileUrl?: string;
}

const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];

const OUTLOOK_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Send.Shared",
];

export function createOAuthProviderRegistry(
  options: OAuthProviderRegistryOptions,
): OAuthProviderRegistry {
  return {
    get(provider) {
      if (provider === "gmail") {
        return gmailProvider(options);
      }

      if (provider === "outlook") {
        return outlookProvider(options);
      }

      throw new Error(`unsupported OAuth provider: ${String(provider)}`);
    },
  };
}

function gmailProvider(options: OAuthProviderRegistryOptions): OAuthProvider {
  const clientId = optional(options.googleClientId);
  if (!clientId) {
    throw new Error("gmail OAuth client is not configured");
  }

  const provider = {
    provider: "gmail",
    nativeProvider: "gmail",
    clientId,
    clientSecret: optional(options.googleClientSecret),
    authorizationUrl:
      options.googleAuthorizationUrl ??
      "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: options.googleTokenUrl ?? "https://oauth2.googleapis.com/token",
    profileUrl:
      options.gmailProfileUrl ??
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    scopes: GMAIL_SCOPES,
    refreshCredentialKind: "google_oauth_refresh_token",
  } satisfies Omit<OAuthProvider, "buildAuthorizationUrl">;

  return {
    ...provider,
    buildAuthorizationUrl(input) {
      const url = new URL(provider.authorizationUrl);
      url.searchParams.set("client_id", provider.clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", provider.scopes.join(" "));
      url.searchParams.set("state", input.state);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      if (input.loginHint) {
        url.searchParams.set("login_hint", input.loginHint);
      }
      return url.toString();
    },
  };
}

function outlookProvider(options: OAuthProviderRegistryOptions): OAuthProvider {
  const clientId = optional(options.microsoftClientId);
  if (!clientId) {
    throw new Error("outlook OAuth client is not configured");
  }

  const tenant = optional(options.microsoftTenant) ?? "common";
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const provider = {
    provider: "outlook",
    nativeProvider: "graph",
    clientId,
    clientSecret: optional(options.microsoftClientSecret),
    authorizationUrl: options.microsoftAuthorizationUrl ?? `${base}/authorize`,
    tokenUrl: options.microsoftTokenUrl ?? `${base}/token`,
    profileUrl: options.microsoftProfileUrl ?? "https://graph.microsoft.com/v1.0/me",
    scopes: OUTLOOK_SCOPES,
    refreshCredentialKind: "microsoft_oauth_refresh_token",
  } satisfies Omit<OAuthProvider, "buildAuthorizationUrl">;

  return {
    ...provider,
    buildAuthorizationUrl(input) {
      const url = new URL(provider.authorizationUrl);
      url.searchParams.set("client_id", provider.clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", provider.scopes.join(" "));
      url.searchParams.set("state", input.state);
      if (input.loginHint) {
        url.searchParams.set("login_hint", input.loginHint);
      }
      return url.toString();
    },
  };
}

function optional(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
