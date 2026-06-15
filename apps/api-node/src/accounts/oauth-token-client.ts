import type { OAuthProvider } from "./oauth-providers.js";

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
}

export interface ExchangeCodeInput {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
}

export interface OAuthTokenClient {
  exchangeCode(input: ExchangeCodeInput): Promise<OAuthTokenSet>;
}

export interface OAuthTokenClientOptions {
  fetchImpl?: typeof fetch;
}

export function createOAuthTokenClient(
  options: OAuthTokenClientOptions = {},
): OAuthTokenClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async exchangeCode(input) {
      const response = await fetchImpl(input.provider.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: tokenRequestBody(input),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          `OAuth token exchange failed: ${response.status} ${errorCode(body)}`,
        );
      }

      return tokenSet(body);
    },
  };
}

function tokenRequestBody(input: ExchangeCodeInput): string {
  const body = new URLSearchParams();
  body.set("client_id", input.provider.clientId);
  if (input.provider.clientSecret) {
    body.set("client_secret", input.provider.clientSecret);
  }
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUri);
  body.set("grant_type", "authorization_code");
  return body.toString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function tokenSet(value: unknown): OAuthTokenSet {
  const record = asRecord(value);
  const accessToken = readString(record.access_token);
  if (!accessToken) {
    throw new Error("OAuth token exchange failed: missing access_token");
  }

  return {
    accessToken,
    ...(readString(record.refresh_token)
      ? { refreshToken: readString(record.refresh_token) }
      : {}),
    ...(readNumber(record.expires_in) !== undefined
      ? { expiresIn: readNumber(record.expires_in) }
      : {}),
    ...(readString(record.scope) ? { scope: readString(record.scope) } : {}),
    ...(readString(record.token_type)
      ? { tokenType: readString(record.token_type) }
      : {}),
  };
}

function errorCode(value: unknown): string {
  return readString(asRecord(value).error) ?? "unknown_error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
