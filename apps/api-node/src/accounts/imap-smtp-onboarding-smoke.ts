import { setTimeout as delay } from "node:timers/promises";

import { createApiTokenFetch } from "../api-token-fetch.js";
import type { ImapSmtpOnboardingInput } from "./imap-smtp-onboarding.js";

export interface RunImapSmtpOnboardingSmokeInput {
  apiBaseUrl: string;
  payload: ImapSmtpOnboardingInput;
  fetchImpl?: typeof fetch;
  connectionTestAttempts?: number;
  connectionTestRetryMs?: number;
}

export interface ImapSmtpOnboardingSmokeResult {
  email: string;
  provider: string;
  accountId: string;
  syncJobId: string;
  syncJobStatus: string;
}

interface HttpJsonResponse {
  status: number;
  body: unknown;
}

export function buildImapSmtpOnboardingSmokePayload(
  input: ImapSmtpOnboardingInput,
): ImapSmtpOnboardingInput {
  if (!input.email?.trim()) {
    throw new Error("EMAILHUB_SMOKE_MAIL_EMAIL is required");
  }
  if (!input.provider?.trim()) {
    throw new Error("EMAILHUB_SMOKE_MAIL_PROVIDER is required");
  }
  if (!input.imap || !input.smtp) {
    throw new Error("IMAP and SMTP smoke endpoints are required");
  }

  return {
    email: input.email.trim(),
    provider: input.provider.trim(),
    ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
    imap: normalizeEndpoint("IMAP", input.imap),
    smtp: normalizeEndpoint("SMTP", input.smtp),
  };
}

export async function runImapSmtpOnboardingSmoke(
  input: RunImapSmtpOnboardingSmokeInput,
): Promise<ImapSmtpOnboardingSmokeResult> {
  const fetchImpl =
    input.fetchImpl ?? createApiTokenFetch(fetch, process.env.EMAILHUB_API_TOKEN);
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const payload = buildImapSmtpOnboardingSmokePayload(input.payload);

  const connectionTest = await runConnectionTestWithRetry({
    apiBaseUrl,
    payload,
    fetchImpl,
    attempts: input.connectionTestAttempts ?? 12,
    retryMs: input.connectionTestRetryMs ?? 2000,
  });
  assertConnectionTest(connectionTest);

  const onboarding = await postJson(
    fetchImpl,
    `${apiBaseUrl}/api/accounts/imap-smtp`,
    payload,
  );
  const onboardingBody = asRecord(onboarding.body);
  if (onboarding.status !== 202) {
    throw new Error(
      `IMAP/SMTP smoke onboarding returned ${onboarding.status}: ${JSON.stringify(
        onboarding.body,
      )}`,
    );
  }
  assertCompletedTask(onboardingBody);
  const account = readRequiredRecord(onboardingBody, "account");
  const syncJob = readOptionalRecord(onboardingBody, "syncJob");
  if (!syncJob) {
    throw new Error("IMAP/SMTP smoke did not return an initial sync job");
  }
  const accountId = readRequiredString(account, "id");
  const syncJobId = readRequiredString(syncJob, "id");
  const syncJobStatus = readRequiredString(syncJob, "status");

  if (readRequiredString(account, "email") !== payload.email) {
    throw new Error("IMAP/SMTP smoke onboarded a different email address");
  }
  if (readRequiredString(account, "provider") !== payload.provider) {
    throw new Error("IMAP/SMTP smoke onboarded a different provider");
  }
  if (readRequiredString(account, "engineProvider") !== "emailengine") {
    throw new Error("IMAP/SMTP smoke did not create an EmailEngine account");
  }
  if (readRequiredString(syncJob, "accountId") !== accountId) {
    throw new Error("IMAP/SMTP smoke initial sync job targets a different account");
  }
  if (readRequiredString(syncJob, "jobType") !== "sync_account") {
    throw new Error("IMAP/SMTP smoke did not enqueue a sync_account job");
  }

  await assertSyncCenterAccount({
    apiBaseUrl,
    fetchImpl,
    accountId,
    syncJobId,
  });

  return {
    email: payload.email,
    provider: payload.provider,
    accountId,
    syncJobId,
    syncJobStatus,
  };
}

async function runConnectionTestWithRetry(input: {
  apiBaseUrl: string;
  payload: ImapSmtpOnboardingInput;
  fetchImpl: typeof fetch;
  attempts: number;
  retryMs: number;
}): Promise<HttpJsonResponse> {
  const attempts = Math.max(1, input.attempts);
  let latest: HttpJsonResponse | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    latest = await postJson(
      input.fetchImpl,
      `${input.apiBaseUrl}/api/accounts/imap-smtp/test`,
      input.payload,
    );

    if (latest.status === 200 && asRecord(latest.body).ok === true) {
      return latest;
    }

    if (attempt < attempts) {
      await delay(input.retryMs);
    }
  }

  return latest!;
}

function assertConnectionTest(response: HttpJsonResponse): void {
  const body = asRecord(response.body);
  if (response.status !== 200 || body.ok !== true) {
    throw new Error(
      `IMAP/SMTP smoke connection test failed: ${response.status} ${JSON.stringify(
        response.body,
      )}`,
    );
  }
}

function assertCompletedTask(body: Record<string, unknown>): void {
  const task = readRequiredRecord(body, "task");
  if (readRequiredString(task, "status") !== "completed") {
    throw new Error("IMAP/SMTP smoke onboarding task did not complete");
  }
}

async function assertSyncCenterAccount(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  syncJobId: string;
}): Promise<void> {
  const response = await getJson(
    input.fetchImpl,
    `${input.apiBaseUrl}/api/sync-center/accounts`,
  );
  if (response.status !== 200) {
    throw new Error(
      `IMAP/SMTP smoke sync center returned ${response.status}: ${JSON.stringify(
        response.body,
      )}`,
    );
  }

  const items = readArray(asRecord(response.body).items);
  const account = items
    .map(asRecord)
    .find((item) => item.accountId === input.accountId);

  if (!account) {
    throw new Error("IMAP/SMTP smoke account is missing from sync center");
  }

  const latestSyncJob = readRequiredRecord(account, "latestSyncJob");
  readRequiredString(latestSyncJob, "id");
  if (
    !["queued", "running", "done", "failed"].includes(
      readRequiredString(latestSyncJob, "status"),
    )
  ) {
    throw new Error("IMAP/SMTP smoke sync center returned an invalid job status");
  }
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<HttpJsonResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
): Promise<HttpJsonResponse> {
  const response = await fetchImpl(url);

  return { status: response.status, body: await response.json() };
}

function normalizeEndpoint(
  name: "IMAP" | "SMTP",
  endpoint: NonNullable<ImapSmtpOnboardingInput["imap"]>,
) {
  const host = endpoint.host?.trim();
  const username = endpoint.username?.trim();
  const secret = endpoint.secret?.trim();

  if (!host) {
    throw new Error(`${name} smoke host is required`);
  }
  if (!Number.isInteger(endpoint.port) || endpoint.port <= 0) {
    throw new Error(`${name} smoke port is required`);
  }
  if (!username) {
    throw new Error(`${name} smoke username is required`);
  }
  if (!secret) {
    throw new Error(`${name} smoke secret is required`);
  }

  return {
    host,
    port: endpoint.port,
    secure: endpoint.secure,
    username,
    secret,
  };
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readRequiredRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`IMAP/SMTP smoke response is missing ${key}`);
  }

  return value as Record<string, unknown>;
}

function readOptionalRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`IMAP/SMTP smoke response has invalid ${key}`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`IMAP/SMTP smoke response is missing ${key}`);
  }

  return value;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
