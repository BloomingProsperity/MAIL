import { buildImapSmtpOnboardingSmokePayload } from "./accounts/imap-smtp-onboarding-smoke.js";
import { createApiTokenFetch } from "./api-token-fetch.js";
import { runEmailEngineSendSmoke } from "./mail-engine/real-roundtrip-smoke.js";
import { resolveSmokeMailboxEmail } from "./mail-engine/smoke-defaults.js";

const apiBaseUrl =
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
const email = resolveSmokeMailboxEmail({
  env: process.env,
  envKey: "EMAILHUB_SMOKE_MAIL_EMAIL",
  prefix: "emailhub-send",
});
const provider = process.env.EMAILHUB_SMOKE_MAIL_PROVIDER ?? "custom_domain";
const displayName =
  process.env.EMAILHUB_SMOKE_MAIL_DISPLAY_NAME ?? "Smoke Mailbox";
const username = process.env.EMAILHUB_SMOKE_MAIL_USERNAME ?? email;
const secret = process.env.EMAILHUB_SMOKE_MAIL_SECRET ?? "smoke-secret";
const recipientEmail = resolveSmokeMailboxEmail({
  env: process.env,
  envKey: "EMAILHUB_SMOKE_RECIPIENT_EMAIL",
  prefix: "emailhub-recipient",
});
const recipientProvider =
  process.env.EMAILHUB_SMOKE_RECIPIENT_PROVIDER ?? provider;
const recipientDisplayName =
  process.env.EMAILHUB_SMOKE_RECIPIENT_DISPLAY_NAME ?? "Smoke Recipient";
const recipientUsername =
  process.env.EMAILHUB_SMOKE_RECIPIENT_USERNAME ?? recipientEmail;
const recipientSecret =
  process.env.EMAILHUB_SMOKE_RECIPIENT_SECRET ?? secret;

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
  const recipientPayload = buildImapSmtpOnboardingSmokePayload({
    email: recipientEmail,
    provider: recipientProvider,
    displayName: recipientDisplayName,
    imap: {
      host:
        process.env.EMAILHUB_SMOKE_RECIPIENT_IMAP_HOST ??
        process.env.EMAILHUB_SMOKE_IMAP_HOST ??
        "greenmail-test",
      port: readPort(
        "EMAILHUB_SMOKE_RECIPIENT_IMAP_PORT",
        readPort("EMAILHUB_SMOKE_IMAP_PORT", 3143),
      ),
      secure: readBoolean(
        "EMAILHUB_SMOKE_RECIPIENT_IMAP_SECURE",
        readBoolean("EMAILHUB_SMOKE_IMAP_SECURE", false),
      ),
      username:
        process.env.EMAILHUB_SMOKE_RECIPIENT_IMAP_USERNAME ??
        recipientUsername,
      secret:
        process.env.EMAILHUB_SMOKE_RECIPIENT_IMAP_SECRET ?? recipientSecret,
    },
    smtp: {
      host:
        process.env.EMAILHUB_SMOKE_RECIPIENT_SMTP_HOST ??
        process.env.EMAILHUB_SMOKE_SMTP_HOST ??
        "greenmail-test",
      port: readPort(
        "EMAILHUB_SMOKE_RECIPIENT_SMTP_PORT",
        readPort("EMAILHUB_SMOKE_SMTP_PORT", 3025),
      ),
      secure: readBoolean(
        "EMAILHUB_SMOKE_RECIPIENT_SMTP_SECURE",
        readBoolean("EMAILHUB_SMOKE_SMTP_SECURE", false),
      ),
      username:
        process.env.EMAILHUB_SMOKE_RECIPIENT_SMTP_USERNAME ??
        recipientUsername,
      secret:
        process.env.EMAILHUB_SMOKE_RECIPIENT_SMTP_SECRET ?? recipientSecret,
    },
  });

  const result = await runEmailEngineSendSmoke({
    apiBaseUrl,
    payload,
    recipientPayload,
    fetchImpl: createApiTokenFetch(fetch, process.env.EMAILHUB_API_TOKEN),
    initialSyncReadyAttempts: readPort(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_INITIAL_SYNC_ATTEMPTS",
      180,
    ),
    initialSyncReadyPollMs: readPort(
      "EMAILHUB_REAL_WEBHOOK_SMOKE_INITIAL_SYNC_POLL_MS",
      2000,
    ),
    reuseExistingReadyAccount: readBoolean(
      "EMAILHUB_SEND_SMOKE_REUSE_EXISTING_ACCOUNT",
      readBoolean("EMAILHUB_REAL_WEBHOOK_SMOKE_REUSE_EXISTING_ACCOUNT", false),
    ),
    pollAttempts: readPort("EMAILHUB_SEND_SMOKE_ATTEMPTS", 60),
    pollMs: readPort("EMAILHUB_SEND_SMOKE_POLL_MS", 2000),
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(
    JSON.stringify(
      {
        ok: false,
        smoke: "emailengine_send",
        apiBaseUrl,
        email,
        recipientEmail,
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
