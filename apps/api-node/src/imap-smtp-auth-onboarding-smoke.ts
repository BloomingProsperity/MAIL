import {
  buildImapSmtpOnboardingSmokePayload,
  runImapSmtpOnboardingAuthSmoke,
} from "./accounts/imap-smtp-onboarding-smoke.js";
import { writeSmokeFailureReport } from "./cli/smoke-report.js";

const apiBaseUrl =
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
const email =
  process.env.EMAILHUB_AUTH_SMOKE_MAIL_EMAIL ??
  "emailhub-auth-smoke@example.com";
const provider =
  process.env.EMAILHUB_AUTH_SMOKE_MAIL_PROVIDER ?? "custom_domain";
const displayName =
  process.env.EMAILHUB_AUTH_SMOKE_MAIL_DISPLAY_NAME ??
  "Authenticated Smoke Mailbox";
const username = process.env.EMAILHUB_AUTH_SMOKE_MAIL_USERNAME ?? email;
const secret =
  process.env.EMAILHUB_AUTH_SMOKE_MAIL_SECRET ?? "emailhub-auth-secret";
const rejectedSecret =
  process.env.EMAILHUB_AUTH_SMOKE_REJECTED_SECRET ?? `${secret}-wrong`;

try {
  const payload = buildImapSmtpOnboardingSmokePayload({
    email,
    provider,
    displayName,
    imap: {
      host: process.env.EMAILHUB_AUTH_SMOKE_IMAP_HOST ?? "greenmail-auth-test",
      port: readPort("EMAILHUB_AUTH_SMOKE_IMAP_PORT", 3143),
      secure: readBoolean("EMAILHUB_AUTH_SMOKE_IMAP_SECURE", false),
      username: process.env.EMAILHUB_AUTH_SMOKE_IMAP_USERNAME ?? username,
      secret: process.env.EMAILHUB_AUTH_SMOKE_IMAP_SECRET ?? secret,
    },
    smtp: {
      host: process.env.EMAILHUB_AUTH_SMOKE_SMTP_HOST ?? "greenmail-auth-test",
      port: readPort("EMAILHUB_AUTH_SMOKE_SMTP_PORT", 3025),
      secure: readBoolean("EMAILHUB_AUTH_SMOKE_SMTP_SECURE", false),
      username: process.env.EMAILHUB_AUTH_SMOKE_SMTP_USERNAME ?? username,
      secret: process.env.EMAILHUB_AUTH_SMOKE_SMTP_SECRET ?? secret,
    },
  });
  const rejectedPayload = buildImapSmtpOnboardingSmokePayload({
    ...payload,
    imap: {
      ...payload.imap!,
      secret: process.env.EMAILHUB_AUTH_SMOKE_REJECTED_IMAP_SECRET ?? rejectedSecret,
    },
    smtp: {
      ...payload.smtp!,
      secret: process.env.EMAILHUB_AUTH_SMOKE_REJECTED_SMTP_SECRET ?? rejectedSecret,
    },
  });
  const result = await runImapSmtpOnboardingAuthSmoke({
    apiBaseUrl,
    payload,
    rejectedPayload,
    connectionTestAttempts: readPort("EMAILHUB_AUTH_SMOKE_ATTEMPTS", 12),
    connectionTestRetryMs: readPort("EMAILHUB_AUTH_SMOKE_RETRY_MS", 2000),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        smoke: "imap_smtp_onboarding_auth",
        apiBaseUrl,
        email: result.email,
        provider: result.provider,
        accountId: result.accountId,
        syncJobId: result.syncJobId,
        syncJobStatus: result.syncJobStatus,
        rejectedInvalidCredentials: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  writeSmokeFailureReport({
    smoke: "imap_smtp_onboarding_auth",
    fields: {
      apiBaseUrl,
      email,
      provider,
    },
    secrets: [
      secret,
      rejectedSecret,
      process.env.EMAILHUB_API_TOKEN,
      process.env.EMAILHUB_AUTH_SMOKE_IMAP_SECRET,
      process.env.EMAILHUB_AUTH_SMOKE_SMTP_SECRET,
      process.env.EMAILHUB_AUTH_SMOKE_REJECTED_IMAP_SECRET,
      process.env.EMAILHUB_AUTH_SMOKE_REJECTED_SMTP_SECRET,
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
