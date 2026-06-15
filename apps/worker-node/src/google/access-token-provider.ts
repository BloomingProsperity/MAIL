import type { AccountCredentialStore } from "../credentials/account-credential-store.js";
import type { SecretStore } from "../secrets/secret-store.js";
import type { GmailAccessTokenProvider } from "./gmail-api-client.js";
import type { GoogleOAuthTokenClient } from "./oauth-token-client.js";

export const GOOGLE_OAUTH_REFRESH_TOKEN_KIND = "google_oauth_refresh_token";

export interface GoogleAccessTokenProviderOptions {
  credentialStore: AccountCredentialStore;
  secretStore: SecretStore;
  tokenClient: GoogleOAuthTokenClient;
  credentialKind?: string;
}

export function createGoogleAccessTokenProvider(
  options: GoogleAccessTokenProviderOptions,
): GmailAccessTokenProvider {
  const credentialKind =
    options.credentialKind ?? GOOGLE_OAUTH_REFRESH_TOKEN_KIND;

  return {
    async getAccessToken(accountId) {
      const credential = await options.credentialStore.getCredential({
        accountId,
        credentialKind,
      });
      if (!credential) {
        throw new Error(
          `missing ${credentialKind} credential for account ${accountId}`,
        );
      }

      const refreshToken = await options.secretStore.getSecret(
        credential.secretRef,
      );
      if (refreshToken.trim().length === 0) {
        throw new Error(
          `empty ${credentialKind} secret for account ${accountId}`,
        );
      }

      try {
        const token = await options.tokenClient.refreshAccessToken({
          refreshToken,
        });
        return token.accessToken;
      } catch (error) {
        throw new Error(
          `Google access token unavailable for account ${accountId}: ${redact(
            errorMessage(error),
            [refreshToken],
          )}`,
        );
      }
    },
  };
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
