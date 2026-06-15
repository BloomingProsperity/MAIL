export interface GoogleOAuthTokenClientOptions {
  clientId: string;
  clientSecret?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface RefreshAccessTokenInput {
  refreshToken: string;
}

export interface RefreshedAccessToken {
  accessToken: string;
  expiresAt: string;
  scope?: string;
  tokenType?: string;
}

export interface GoogleOAuthTokenClient {
  refreshAccessToken(input: RefreshAccessTokenInput): Promise<RefreshedAccessToken>;
}

const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function createGoogleOAuthTokenClient(
  options: GoogleOAuthTokenClientOptions,
): GoogleOAuthTokenClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
  const now = options.now ?? (() => new Date());

  return {
    async refreshAccessToken(input) {
      const response = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: refreshTokenBody({
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          refreshToken: input.refreshToken,
        }),
      });

      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(
          `Google OAuth refresh failed: ${response.status} ${errorCode(
            body,
          )} refresh token rejected`,
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
}): string {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);
  if (input.clientSecret) {
    body.set("client_secret", input.clientSecret);
  }
  body.set("refresh_token", input.refreshToken);
  body.set("grant_type", "refresh_token");
  return body.toString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function tokenFromResponse(
  value: unknown,
  now: Date,
): RefreshedAccessToken {
  const record = asRecord(value);
  const accessToken = readString(record.access_token);
  if (!accessToken) {
    throw new Error("Google OAuth refresh failed: missing access_token");
  }

  const expiresIn = readNumber(record.expires_in);
  return {
    accessToken,
    expiresAt: new Date(now.getTime() + Math.max(0, expiresIn) * 1000).toISOString(),
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
