import type { ApiConfig } from "./http/router.js";
import type { ImapSmtpProviderPresetOverrides } from "./accounts/imap-smtp-onboarding.js";

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const devSecretsAllowed =
    env.NODE_ENV === "production"
      ? false
      : env.EMAILHUB_ALLOW_DEV_SECRETS === "true" ||
        env.NODE_ENV === "development";
  const webhookSecret = readSharedSecret({
    env,
    key: "EMAILENGINE_WEBHOOK_SECRET",
    devSecretsAllowed,
  });
  const authServerSecret = readSharedSecret({
    env,
    key: "EMAILENGINE_AUTH_SERVER_SECRET",
    devSecretsAllowed,
  });
  const emailEngineServiceSecret = readSharedSecret({
    env,
    key: "EENGINE_SECRET",
    devSecretsAllowed,
  });
  const apiAccessToken = env.EMAILHUB_API_TOKEN?.trim() ?? "";
  const apiAccessTokenRequired =
    env.EMAILHUB_REQUIRE_API_TOKEN === "true" || env.NODE_ENV === "production";
  if (apiAccessTokenRequired && !isProductionApiToken(apiAccessToken)) {
    throw new Error(
      "EMAILHUB_API_TOKEN must be set to a non-default value when API token protection is required",
    );
  }

  const config: ApiConfig = {
    apiName: "email-hub-api",
    apiAccessTokenConfigured: apiAccessToken.length > 0,
    apiAccessTokenRequired,
    apiAccessAccountIds: readCsvList(env.EMAILHUB_API_TOKEN_ACCOUNT_IDS),
    maxAttachmentDownloadBytes: readBoundedIntegerValue(
      env.EMAILHUB_ATTACHMENT_DOWNLOAD_MAX_BYTES,
      25 * 1024 * 1024,
      1,
      1024 * 1024 * 1024,
    ),
    emailEngineUrl: env.EMAILENGINE_URL ?? "http://emailengine:3000",
    emailEngineWebhookSecret: webhookSecret,
    emailEngineWebhookSecretConfigured:
      typeof env.EMAILENGINE_WEBHOOK_SECRET === "string" &&
      env.EMAILENGINE_WEBHOOK_SECRET.trim().length > 0,
    emailEngineWebhookSecretUsesDefault:
      !env.EMAILENGINE_WEBHOOK_SECRET ||
      env.EMAILENGINE_WEBHOOK_SECRET === "dev-emailhub-secret",
    emailEngineWebhookMaxSkewMs:
      readBoundedIntegerValue(
        env.EMAILENGINE_WEBHOOK_MAX_SKEW_SECONDS,
        10 * 60,
        60,
        24 * 60 * 60,
      ) * 1000,
    emailEnginePreparedTokenConfigured:
      typeof env.EENGINE_PREPARED_TOKEN === "string" &&
      env.EENGINE_PREPARED_TOKEN.trim().length > 0,
    emailEngineAuthServerSecret: authServerSecret,
    emailEngineAuthServerSecretUsesDefault:
      !env.EMAILENGINE_AUTH_SERVER_SECRET ||
      authServerSecret === "dev-emailhub-secret",
    emailEngineServiceSecretUsesDefault:
      !env.EENGINE_SECRET || emailEngineServiceSecret === "dev-emailhub-secret",
    oauthProvidersConfigured: {
      gmail:
        typeof env.GOOGLE_OAUTH_CLIENT_ID === "string" &&
        env.GOOGLE_OAUTH_CLIENT_ID.trim().length > 0,
      outlook:
        typeof env.MICROSOFT_OAUTH_CLIENT_ID === "string" &&
        env.MICROSOFT_OAUTH_CLIENT_ID.trim().length > 0,
    },
  };
  if (apiAccessToken.length > 0) {
    Object.defineProperty(config, "apiAccessToken", {
      value: apiAccessToken,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  return config;
}

export function readPort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.API_PORT ?? "8080", 10);
  return Number.isFinite(parsed) ? parsed : 8080;
}

export function readImapSmtpProviderPresetOverrides(
  env: NodeJS.ProcessEnv = process.env,
): ImapSmtpProviderPresetOverrides {
  const protonBridgeHost = env.PROTON_BRIDGE_HOST?.trim();
  if (!protonBridgeHost) {
    return {};
  }

  return {
    proton_bridge: {
      imap: {
        host: protonBridgeHost,
        port: readPortValue(env.PROTON_BRIDGE_IMAP_PORT, 1143),
        secure: false,
      },
      smtp: {
        host: protonBridgeHost,
        port: readPortValue(env.PROTON_BRIDGE_SMTP_PORT, 1025),
        secure: false,
      },
    },
  };
}

function readPortValue(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function readBoundedIntegerValue(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readCsvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function isProductionApiToken(value: string): boolean {
  return value.length > 0 && value !== "dev-emailhub-token";
}

const DEV_EMAILENGINE_SECRET = "dev-emailhub-secret";

function readSharedSecret(input: {
  env: NodeJS.ProcessEnv;
  key:
    | "EMAILENGINE_WEBHOOK_SECRET"
    | "EMAILENGINE_AUTH_SERVER_SECRET"
    | "EENGINE_SECRET";
  devSecretsAllowed: boolean;
}): string {
  const value = input.env[input.key]?.trim() || DEV_EMAILENGINE_SECRET;
  if (!input.devSecretsAllowed && value === DEV_EMAILENGINE_SECRET) {
    throw new Error(
      `${input.key} must be set to a non-default value unless NODE_ENV=development or EMAILHUB_ALLOW_DEV_SECRETS=true outside production`,
    );
  }

  return value;
}
