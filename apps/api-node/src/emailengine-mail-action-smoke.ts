import { buildImapSmtpOnboardingSmokePayload } from "./accounts/imap-smtp-onboarding-smoke.js";
import { createApiTokenFetch } from "./api-token-fetch.js";
import { writeSmokeFailureReport } from "./cli/smoke-report.js";
import { runEmailEngineMailActionSmoke } from "./mail-engine/real-roundtrip-smoke.js";
import { resolveSmokeMailboxEmail } from "./mail-engine/smoke-defaults.js";

const apiBaseUrl =
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
const email = resolveSmokeMailboxEmail({
  env: process.env,
  envKey: "EMAILHUB_SMOKE_MAIL_EMAIL",
  prefix: "emailhub-action",
});
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

  const result = await runEmailEngineMailActionSmoke({
    apiBaseUrl,
    payload,
    fetchImpl: createApiTokenFetch(fetch, process.env.EMAILHUB_API_TOKEN),
    deliverySmtp: {
      host: process.env.EMAILHUB_SMOKE_DELIVERY_SMTP_HOST ?? "127.0.0.1",
      port: readPort("EMAILHUB_SMOKE_DELIVERY_SMTP_PORT", 3025),
      secure: readBoolean("EMAILHUB_SMOKE_DELIVERY_SMTP_SECURE", false),
      from:
        process.env.EMAILHUB_SMOKE_DELIVERY_FROM ??
        "emailhub-smoke@example.com",
    },
    initialSyncReadyAttempts: readPort(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_INITIAL_SYNC_ATTEMPTS",
      180,
    ),
    initialSyncReadyPollMs: readPort(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_INITIAL_SYNC_POLL_MS",
      2000,
    ),
    reuseExistingReadyAccount: readBoolean(
      "EMAILHUB_MAIL_ACTION_SMOKE_REUSE_EXISTING_ACCOUNT",
      readBoolean("EMAILHUB_REAL_WEBHOOK_SMOKE_REUSE_EXISTING_ACCOUNT", false),
    ),
    pollAttempts: readPort("EMAILHUB_MAIL_ACTION_SMOKE_ATTEMPTS", 60),
    pollMs: readPort("EMAILHUB_MAIL_ACTION_SMOKE_POLL_MS", 2000),
    workerDiagnosticAttempts: readPort(
      "EMAILHUB_MAIL_ACTION_SMOKE_WORKER_DIAGNOSTIC_ATTEMPTS",
      60,
    ),
    workerDiagnosticPollMs: readPort(
      "EMAILHUB_MAIL_ACTION_SMOKE_WORKER_DIAGNOSTIC_POLL_MS",
      2000,
    ),
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  writeSmokeFailureReport({
    smoke: "emailengine_mail_action",
    fields: {
      apiBaseUrl,
      email,
      provider,
    },
    secrets: [
      secret,
      process.env.EMAILHUB_API_TOKEN,
      process.env.EMAILHUB_SMOKE_IMAP_SECRET,
      process.env.EMAILHUB_SMOKE_SMTP_SECRET,
    ],
    error,
  });
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
