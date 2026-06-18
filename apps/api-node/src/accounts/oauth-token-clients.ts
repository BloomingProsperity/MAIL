import { MICROSOFT_GRAPH_MAIL_SCOPE } from "./oauth-scopes.js";

export interface RefreshedAccessToken {
  accessToken: string;
  expiresAt: string;
  scope?: string;
  tokenType?: string;
}

export interface OAuthRefreshClient {
  refreshAccessToken(input: {
    refreshToken: string;
  }): Promise<RefreshedAccessToken>;
}

export interface OAuthRefreshClientOptions {
  clientId: string;
  clientSecret?: string;
  tokenUrl: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export function createGoogleOAuthRefreshClient(input: {
  clientId: string;
  clientSecret?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): OAuthRefreshClient {
  return createOAuthRefreshClient({
    ...input,
    tokenUrl: input.tokenUrl ?? GOOGLE_TOKEN_URL,
  });
}

export function createMicrosoftOAuthRefreshClient(input: {
  clientId: string;
  clientSecret?: string;
  tokenUrl?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): OAuthRefreshClient {
  return createOAuthRefreshClient({
    ...input,
    tokenUrl: input.tokenUrl ?? MICROSOFT_TOKEN_URL,
    scope: input.scope ?? MICROSOFT_GRAPH_MAIL_SCOPE,
  });
}

function createOAuthRefreshClient(
  options: OAuthRefreshClientOptions,
): OAuthRefreshClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    async refreshAccessToken(input) {
      const response = await fetchImpl(options.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: refreshTokenBody({
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          refreshToken: input.refreshToken,
          scope: options.scope,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          `OAuth refresh failed: ${response.status} ${errorCode(body)}`,
        );
      }

      return tokenFromResponse(body, now());
    },
  };
}

function refreshTokenBody(input: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
}): string {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  if (input.clientSecret) {
    body.set("client_secret", input.clientSecret);
  }
  body.set("refresh_token", input.refreshToken);
  body.set("grant_type", "refresh_token");
  if (input.scope) {
    body.set("scope", input.scope);
  }

  return body.toString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function tokenFromResponse(value: unknown, now: Date): RefreshedAccessToken {
  const record = asRecord(value);
  const accessToken = readString(record.access_token);
  if (!accessToken) {
    throw new Error("OAuth refresh failed: missing access_token");
  }

  const expiresIn = readNumber(record.expires_in);
  return {
    accessToken,
    expiresAt: new Date(
      now.getTime() + Math.max(0, expiresIn) * 1000,
    ).toISOString(),
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

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
