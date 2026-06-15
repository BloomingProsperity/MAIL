import type { ApiConfig } from "./http/router.js";
import type { ImapSmtpProviderPresetOverrides } from "./accounts/imap-smtp-onboarding.js";

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    apiName: "email-hub-api",
    emailEngineUrl: env.EMAILENGINE_URL ?? "http://emailengine:3000",
    emailEngineWebhookSecret:
      env.EMAILENGINE_WEBHOOK_SECRET ?? "dev-emailhub-secret",
  };
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
