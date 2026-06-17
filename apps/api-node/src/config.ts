import type { ApiConfig } from "./http/router.js";
import type { ImapSmtpProviderPresetOverrides } from "./accounts/imap-smtp-onboarding.js";

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const webhookSecret = env.EMAILENGINE_WEBHOOK_SECRET ?? "dev-emailhub-secret";
  const authServerSecret =
    env.EMAILENGINE_AUTH_SERVER_SECRET ?? "dev-emailhub-secret";
  const emailEngineServiceSecret =
    env.EENGINE_SECRET ?? "dev-emailhub-secret";
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

function isProductionApiToken(value: string): boolean {
  return value.length > 0 && value !== "dev-emailhub-token";
}
