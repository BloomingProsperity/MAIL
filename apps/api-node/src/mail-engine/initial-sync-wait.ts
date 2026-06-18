import { safeSmokeBodySummary, safeSmokeText } from "./smoke-error.js";

const DEFAULT_RETRY_AWARE_DELAY_MAX_MS = 30_000;

interface InitialSyncJobSummary {
  status?: string;
  attempts?: number;
  maxAttempts?: number;
  notBefore?: string;
  errorMessage?: string;
}

export async function waitForInitialSyncReady(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  syncJobId: string;
  attempts: number;
  pollMs: number;
  delayMs: (ms: number) => Promise<void>;
  errorPrefix: string;
  now?: () => Date;
  retryAwareDelayMaxMs?: number;
}): Promise<void> {
  const attempts = Math.max(0, input.attempts);
  if (attempts === 0) {
    return;
  }

  let latest: InitialSyncJobSummary | undefined;
  const now = input.now ?? (() => new Date());

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    latest = await readInitialSyncJobSummary(input);
    if (latest?.status === "done") {
      return;
    }
    if (latest?.status === "failed" || latest?.status === "dead_letter") {
      throw new Error(
        `${input.errorPrefix} initial sync job ${input.syncJobId} for ${input.accountId} reached ${formatJobSummary(
          latest,
        )}`,
      );
    }
    if (attempt < attempts) {
      await input.delayMs(
        retryAwareDelayMs({
          latest,
          pollMs: input.pollMs,
          now: now(),
          maxDelayMs:
            input.retryAwareDelayMaxMs ?? DEFAULT_RETRY_AWARE_DELAY_MAX_MS,
        }),
      );
    }
  }

  throw new Error(
    `${input.errorPrefix} initial sync job ${input.syncJobId} for ${input.accountId} did not reach done after ${attempts} polls; ${formatJobSummary(
      latest,
    )}`,
  );
}

async function readInitialSyncJobSummary(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  syncJobId: string;
  errorPrefix: string;
}): Promise<InitialSyncJobSummary | undefined> {
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/sync-center/accounts`,
  );
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `${input.errorPrefix} sync center returned ${response.status}: ${safeSmokeBodySummary(
        body,
      )}`,
    );
  }

  const account = readArray(asRecord(body).items)
    .map(asRecord)
    .find((item) => readString(item.accountId) === input.accountId);
  const latestSyncJob = asRecord(account?.latestSyncJob);
  if (readString(latestSyncJob.id) !== input.syncJobId) {
    return undefined;
  }

  return {
    status: readString(latestSyncJob.status),
    attempts: readNumber(latestSyncJob.attempts),
    maxAttempts: readNumber(latestSyncJob.maxAttempts),
    notBefore: readString(latestSyncJob.notBefore),
    errorMessage: safeSmokeText(readString(latestSyncJob.errorMessage)),
  };
}

function retryAwareDelayMs(input: {
  latest: InitialSyncJobSummary | undefined;
  pollMs: number;
  now: Date;
  maxDelayMs: number;
}): number {
  const pollMs = Math.max(0, input.pollMs);
  if (input.latest?.status !== "queued" || !input.latest.notBefore) {
    return pollMs;
  }

  const notBefore = Date.parse(input.latest.notBefore);
  if (!Number.isFinite(notBefore)) {
    return pollMs;
  }

  const waitMs = notBefore - input.now.getTime();
  if (waitMs <= pollMs) {
    return pollMs;
  }

  const maxDelayMs = Math.max(pollMs, input.maxDelayMs);
  const graceMs = Math.min(1_000, pollMs);
  return Math.min(waitMs + graceMs, maxDelayMs);
}

function formatJobSummary(summary: InitialSyncJobSummary | undefined): string {
  if (!summary) {
    return "latest status missing";
  }

  const parts = [`latest status ${summary.status ?? "missing"}`];
  if (summary.attempts !== undefined && summary.maxAttempts !== undefined) {
    parts.push(`attempts ${summary.attempts}/${summary.maxAttempts}`);
  }
  if (summary.notBefore) {
    parts.push(`next retry ${summary.notBefore}`);
  }
  if (summary.errorMessage) {
    parts.push(`error ${summary.errorMessage}`);
  }

  return parts.join("; ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
