import type { Queryable } from "../accounts/oauth-access-token.js";
import {
  GOOGLE_OAUTH_REFRESH_TOKEN_KIND,
  MICROSOFT_OAUTH_REFRESH_TOKEN_KIND,
} from "../accounts/oauth-access-token.js";
import {
  createGoogleOAuthRefreshClient,
  createMicrosoftOAuthRefreshClient,
  type OAuthRefreshClient,
} from "../accounts/oauth-token-clients.js";
import { MICROSOFT_OUTLOOK_IMAP_SMTP_SCOPE } from "../accounts/oauth-scopes.js";

export type EmailEngineAuthServerProto = "imap" | "smtp" | "api";

export interface EmailEngineAuthServerCredentials {
  user: string;
  accessToken: string;
}

export interface EmailEngineAuthServerService {
  resolveCredentials(input: {
    accountId: string;
    proto: EmailEngineAuthServerProto;
  }): Promise<EmailEngineAuthServerCredentials>;
}

export class InvalidEmailEngineAuthServerRequestError extends Error {
  readonly code = "invalid_emailengine_auth_server_request";
  readonly statusCode: number;

  constructor(message = "invalid_emailengine_auth_server_request", statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createPostgresEmailEngineAuthServerService(input: {
  client: Queryable;
  google: OAuthRefreshClient;
  microsoft: OAuthRefreshClient;
}): EmailEngineAuthServerService {
  return {
    async resolveCredentials(request) {
      if (!isEmailEngineAuthServerProto(request.proto)) {
        throw new InvalidEmailEngineAuthServerRequestError(
          "unsupported EmailEngine auth server protocol",
        );
      }

      const account = await getOAuthAccount(input.client, request.accountId);
      if (!account) {
        throw new InvalidEmailEngineAuthServerRequestError(
          "EmailEngine auth server account was not found",
          404,
        );
      }

      const provider = providerConfig(account.provider);
      const credential = await getCredential(input.client, {
        accountId: request.accountId,
        credentialKind: provider.credentialKind,
      });
      if (!credential) {
        throw new InvalidEmailEngineAuthServerRequestError(
          "EmailEngine auth server OAuth credential was not found",
          404,
        );
      }

      const refreshToken = await getSecret(input.client, credential.secretRef);
      if (refreshToken.trim().length === 0) {
        throw new InvalidEmailEngineAuthServerRequestError(
          "EmailEngine auth server OAuth credential is empty",
          404,
        );
      }

      try {
        const token = await provider.client(input).refreshAccessToken({
          refreshToken,
        });
        return {
          user: account.email,
          accessToken: token.accessToken,
        };
      } catch (error) {
        throw new Error(
          `EmailEngine auth server token refresh failed for account ${request.accountId}: ${redact(
            errorMessage(error),
            [refreshToken],
          )}`,
        );
      }
    },
  };
}

export function createConfiguredEmailEngineAuthServerService(input: {
  client: Queryable;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): EmailEngineAuthServerService {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const googleClientId = optionalEnv(env.GOOGLE_OAUTH_CLIENT_ID);
  const microsoftClientId = optionalEnv(env.MICROSOFT_OAUTH_CLIENT_ID);

  return createPostgresEmailEngineAuthServerService({
    client: input.client,
    google: googleClientId
      ? createGoogleOAuthRefreshClient({
          clientId: googleClientId,
          clientSecret: optionalEnv(env.GOOGLE_OAUTH_CLIENT_SECRET),
          tokenUrl: optionalEnv(env.GOOGLE_OAUTH_TOKEN_URL),
          fetchImpl,
        })
      : missingOAuthRefreshClient(
          "GOOGLE_OAUTH_CLIENT_ID missing; cannot serve Gmail tokens to EmailEngine",
        ),
    microsoft: microsoftClientId
      ? createMicrosoftOAuthRefreshClient({
          clientId: microsoftClientId,
          clientSecret: optionalEnv(env.MICROSOFT_OAUTH_CLIENT_SECRET),
          tokenUrl: optionalEnv(env.MICROSOFT_OAUTH_TOKEN_URL),
          scope:
            optionalEnv(env.MICROSOFT_EMAILENGINE_SCOPE) ??
            MICROSOFT_OUTLOOK_IMAP_SMTP_SCOPE,
          fetchImpl,
        })
      : missingOAuthRefreshClient(
          "MICROSOFT_OAUTH_CLIENT_ID missing; cannot serve Outlook tokens to EmailEngine",
        ),
  });
}

export function isEmailEngineAuthServerProto(
  value: unknown,
): value is EmailEngineAuthServerProto {
  return value === "imap" || value === "smtp" || value === "api";
}

async function getOAuthAccount(
  client: Queryable,
  accountId: string,
): Promise<{ email: string; provider: "gmail" | "outlook" } | undefined> {
  const result = await client.query<{
    email: string;
    provider: string;
  }>(
    `
      SELECT email, provider
      FROM connected_accounts
      WHERE id = $1
        AND auth_method = 'oauth'
      LIMIT 1
    `,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  if (row.provider !== "gmail" && row.provider !== "outlook") {
    throw new InvalidEmailEngineAuthServerRequestError(
      "EmailEngine auth server only supports Gmail and Outlook OAuth accounts",
      400,
    );
  }

  return {
    email: row.email,
    provider: row.provider,
  };
}

async function getCredential(
  client: Queryable,
  input: { accountId: string; credentialKind: string },
): Promise<{ secretRef: string } | undefined> {
  const result = await client.query<{ secret_ref: string }>(
    `
      SELECT secret_ref
      FROM account_credentials
      WHERE account_id = $1
        AND credential_kind = $2
      LIMIT 1
    `,
    [input.accountId, input.credentialKind],
  );

  return result.rows[0] ? { secretRef: result.rows[0].secret_ref } : undefined;
}

async function getSecret(client: Queryable, secretRef: string): Promise<string> {
  const result = await client.query<{ secret_value: string }>(
    `
      SELECT secret_value
      FROM stored_secrets
      WHERE secret_ref = $1
      LIMIT 1
    `,
    [secretRef],
  );
  const value = result.rows[0]?.secret_value;
  if (!value) {
    throw new InvalidEmailEngineAuthServerRequestError(
      "EmailEngine auth server OAuth secret was not found",
      404,
    );
  }

  return value;
}

function providerConfig(provider: "gmail" | "outlook"): {
  credentialKind: string;
  client: (input: {
    google: OAuthRefreshClient;
    microsoft: OAuthRefreshClient;
  }) => OAuthRefreshClient;
} {
  return provider === "gmail"
    ? {
        credentialKind: GOOGLE_OAUTH_REFRESH_TOKEN_KIND,
        client: (input) => input.google,
      }
    : {
        credentialKind: MICROSOFT_OAUTH_REFRESH_TOKEN_KIND,
        client: (input) => input.microsoft,
      };
}

function missingOAuthRefreshClient(message: string): OAuthRefreshClient {
  return {
    async refreshAccessToken() {
      throw new Error(message);
    },
  };
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function redact(message: string, secrets: string[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[redacted]");
    }
  }

  return redacted;
}
