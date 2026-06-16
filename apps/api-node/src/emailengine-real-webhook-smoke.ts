import { randomUUID } from "node:crypto";

import { buildImapSmtpOnboardingSmokePayload } from "./accounts/imap-smtp-onboarding-smoke.js";
import { runEmailEngineRealWebhookSmoke } from "./mail-engine/real-webhook-smoke.js";

const apiBaseUrl =
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
const email =
  process.env.EMAILHUB_SMOKE_MAIL_EMAIL ??
  `emailhub-smoke-${randomUUID()}@example.com`;
const provider = process.env.EMAILHUB_SMOKE_MAIL_PROVIDER ?? "custom_domain";
const displayName =
  process.env.EMAILHUB_SMOKE_MAIL_DISPLAY_NAME ?? "Smoke Mailbox";
const username = process.env.EMAILHUB_SMOKE_MAIL_USERNAME ?? email;
const secret = process.env.EMAILHUB_SMOKE_MAIL_SECRET ?? "smoke-secret";

try {
  const payload = buildImapSmtpOnboardingSmokePayload({
    email,
    provider,
    displayName,
    imap: {
      host: process.env.EMAILHUB_SMOKE_IMAP_HOST ?? "greenmail-test",
      port: readPort("EMAILHUB_SMOKE_IMAP_PORT", 3143),
      secure: readBoolean("EMAILHUB_SMOKE_IMAP_SECURE", false),
      username: process.env.EMAILHUB_SMOKE_IMAP_USERNAME ?? username,
      secret: process.env.EMAILHUB_SMOKE_IMAP_SECRET ?? secret,
    },
    smtp: {
      host: process.env.EMAILHUB_SMOKE_SMTP_HOST ?? "greenmail-test",
      port: readPort("EMAILHUB_SMOKE_SMTP_PORT", 3025),
      secure: readBoolean("EMAILHUB_SMOKE_SMTP_SECURE", false),
      username: process.env.EMAILHUB_SMOKE_SMTP_USERNAME ?? username,
      secret: process.env.EMAILHUB_SMOKE_SMTP_SECRET ?? secret,
    },
  });

  const result = await runEmailEngineRealWebhookSmoke({
    apiBaseUrl,
    payload,
    deliverySmtp: {
      host: process.env.EMAILHUB_SMOKE_DELIVERY_SMTP_HOST ?? "127.0.0.1",
      port: readPort("EMAILHUB_SMOKE_DELIVERY_SMTP_PORT", 3025),
      secure: readBoolean("EMAILHUB_SMOKE_DELIVERY_SMTP_SECURE", false),
      from:
        process.env.EMAILHUB_SMOKE_DELIVERY_FROM ??
        "emailhub-smoke@example.com",
    },
    pollAttempts: readPort("EMAILHUB_REAL_WEBHOOK_SMOKE_ATTEMPTS", 30),
    pollMs: readPort("EMAILHUB_REAL_WEBHOOK_SMOKE_POLL_MS", 2000),
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(
    JSON.stringify(
      {
        ok: false,
        smoke: "emailengine_real_webhook",
        apiBaseUrl,
        email,
        provider,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

function readPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return port;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
