export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface AccessTokenProvider {
  getAccessToken(accountId: string): Promise<string>;
}

export interface OAuthRefreshClient {
  refreshAccessToken(input: {
    refreshToken: string;
  }): Promise<{ accessToken: string }>;
}

export const GOOGLE_OAUTH_REFRESH_TOKEN_KIND = "google_oauth_refresh_token";
export const MICROSOFT_OAUTH_REFRESH_TOKEN_KIND =
  "microsoft_oauth_refresh_token";

export function createDatabaseAccessTokenProvider(input: {
  client: Queryable;
  credentialKind: string;
  tokenClient: OAuthRefreshClient;
}): AccessTokenProvider {
  return {
    async getAccessToken(accountId) {
      const credential = await getCredential(input.client, {
        accountId,
        credentialKind: input.credentialKind,
      });
      if (!credential) {
        throw new Error(
          `missing ${input.credentialKind} credential for account ${accountId}`,
        );
      }

      const refreshToken = await getSecret(input.client, credential.secretRef);
      if (refreshToken.trim().length === 0) {
        throw new Error(
          `empty ${input.credentialKind} secret for account ${accountId}`,
        );
      }

      try {
        const token = await input.tokenClient.refreshAccessToken({
          refreshToken,
        });
        return token.accessToken;
      } catch (error) {
        throw new Error(
          `OAuth access token unavailable for account ${accountId}: ${redact(
            errorMessage(error),
            [refreshToken],
          )}`,
        );
      }
    },
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
    throw new Error(`secret ref not found: ${secretRef}`);
  }

  return value;
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
