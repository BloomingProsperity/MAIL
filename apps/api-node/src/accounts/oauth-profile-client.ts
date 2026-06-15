import type { OAuthProvider } from "./oauth-providers.js";

export interface OAuthAccountProfile {
  email: string;
  displayName?: string;
}

export interface OAuthProfileInput {
  provider: OAuthProvider;
  accessToken: string;
}

export interface OAuthProfileClient {
  getProfile(input: OAuthProfileInput): Promise<OAuthAccountProfile>;
}

export interface OAuthProfileClientOptions {
  fetchImpl?: typeof fetch;
}

export function createOAuthProfileClient(
  options: OAuthProfileClientOptions = {},
): OAuthProfileClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async getProfile(input) {
      const response = await fetchImpl(input.provider.profileUrl, {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
        },
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          `OAuth profile lookup failed: ${response.status} ${input.provider.provider}`,
        );
      }

      return profileFromBody(input.provider.provider, body);
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function profileFromBody(
  provider: OAuthProvider["provider"],
  body: unknown,
): OAuthAccountProfile {
  const record = asRecord(body);
  const email =
    provider === "gmail"
      ? readString(record.emailAddress)
      : readString(record.mail) ?? readString(record.userPrincipalName);
  if (!email) {
    throw new Error(`OAuth profile lookup failed: missing email for ${provider}`);
  }

  return {
    email,
    ...(readString(record.displayName)
      ? { displayName: readString(record.displayName) }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
