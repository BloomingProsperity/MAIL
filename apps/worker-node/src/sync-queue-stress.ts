import { pathToFileURL } from "node:url";

import {
  createInMemorySyncJobQueue,
  type SyncJobRecord,
} from "./sync-job-queue.js";

export interface SyncQueueStressOptions {
  accountCount?: number;
  jobsPerAccount?: number;
  workerCount?: number;
  leaseSeconds?: number;
  workDelayMs?: number;
  startedAt?: Date;
  injectDuplicateClaimForTest?: boolean;
}

export interface SyncQueueStressResult {
  ok: boolean;
  accountCount: number;
  jobsPerAccount: number;
  workerCount: number;
  totalJobs: number;
  completedJobs: number;
  idleWorkers: number;
  duplicateClaims: string[];
  maxConcurrentPerAccount: number;
  maxAttempts: number;
  perAccountCompleted: Record<string, number>;
  durationMs: number;
}

interface WorkerState {
  idleWorkers: number;
  activeByAccount: Map<string, number>;
  seenClaims: Set<string>;
  duplicateClaims: Set<string>;
  maxConcurrentPerAccount: number;
  perAccountCompleted: Record<string, number>;
}

const DEFAULT_STARTED_AT = new Date("2026-06-14T04:00:00.000Z");

export async function runSyncQueueStressCheck(
  options: SyncQueueStressOptions = {},
): Promise<SyncQueueStressResult> {
  const accountCount = positiveInteger(options.accountCount, 12);
  const jobsPerAccount = positiveInteger(options.jobsPerAccount, 50);
  const workerCount = positiveInteger(options.workerCount, 32);
  const leaseSeconds = positiveInteger(options.leaseSeconds, 30);
  const workDelayMs = nonNegativeInteger(options.workDelayMs, 0);
  const startedAt = options.startedAt ?? DEFAULT_STARTED_AT;
  const jobs = createStressJobs({
    accountCount,
    jobsPerAccount,
    startedAt,
  });
  const queue = createInMemorySyncJobQueue(jobs);
  const state: WorkerState = {
    idleWorkers: 0,
    activeByAccount: new Map(),
    seenClaims: new Set(),
    duplicateClaims: new Set(),
    maxConcurrentPerAccount: 0,
    perAccountCompleted: {},
  };
  const startedMs = Date.now();

  await Promise.all(
    Array.from({ length: workerCount }, (_, index) =>
      drainQueueWorker({
        workerId: `stress_worker_${index + 1}`,
        queue,
        state,
        now: startedAt,
        leaseSeconds,
        workDelayMs,
        injectDuplicateClaimForTest:
          options.injectDuplicateClaimForTest === true && index === 0,
      }),
    ),
  );

  const finalJobs = queue.listJobs();
  const completedJobs = finalJobs.filter((job) => job.status === "done").length;
  const maxAttempts = finalJobs.reduce(
    (max, job) => Math.max(max, job.attempts),
    0,
  );
  const duplicateClaims = [...state.duplicateClaims].sort();
  const totalJobs = accountCount * jobsPerAccount;

  return {
    ok:
      completedJobs === totalJobs &&
      duplicateClaims.length === 0 &&
      state.maxConcurrentPerAccount <= 1,
    accountCount,
    jobsPerAccount,
    workerCount,
    totalJobs,
    completedJobs,
    idleWorkers: state.idleWorkers,
    duplicateClaims,
    maxConcurrentPerAccount: state.maxConcurrentPerAccount,
    maxAttempts,
    perAccountCompleted: sortRecord(state.perAccountCompleted),
    durationMs: Date.now() - startedMs,
  };
}

function createStressJobs(input: {
  accountCount: number;
  jobsPerAccount: number;
  startedAt: Date;
}): SyncJobRecord[] {
  const notBefore = input.startedAt.toISOString();
  const jobs: SyncJobRecord[] = [];

  for (let accountIndex = 1; accountIndex <= input.accountCount; accountIndex += 1) {
    const accountId = accountIdForIndex(accountIndex);
    for (let jobIndex = 1; jobIndex <= input.jobsPerAccount; jobIndex += 1) {
      const jobId = `job_${accountId}_${String(jobIndex).padStart(3, "0")}`;
      jobs.push({
        id: jobId,
        jobType: "sync_account",
        accountId,
        mailboxId: "INBOX",
        triggerEventId: `event_${jobId}`,
        idempotencyKey: `stress:${jobId}`,
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        notBefore,
        payload: {
          source: "sync-queue-stress",
          accountId,
          jobIndex,
        },
        createdAt: notBefore,
        updatedAt: notBefore,
      });
    }
  }

  return jobs;
}

async function drainQueueWorker(input: {
  workerId: string;
  queue: ReturnType<typeof createInMemorySyncJobQueue>;
  state: WorkerState;
  now: Date;
  leaseSeconds: number;
  workDelayMs: number;
  injectDuplicateClaimForTest: boolean;
}): Promise<void> {
  let injectedDuplicate = false;

  for (;;) {
    const job = await input.queue.claimNext({
      workerId: input.workerId,
      now: input.now,
      leaseSeconds: input.leaseSeconds,
    });

    if (!job) {
      input.state.idleWorkers += 1;
      return;
    }

    recordClaim(input.state, job);
    if (input.injectDuplicateClaimForTest && !injectedDuplicate) {
      recordClaim(input.state, job);
      injectedDuplicate = true;
    }

    const accountId = job.accountId ?? "unassigned";
    const active = (input.state.activeByAccount.get(accountId) ?? 0) + 1;
    input.state.activeByAccount.set(accountId, active);
    input.state.maxConcurrentPerAccount = Math.max(
      input.state.maxConcurrentPerAccount,
      active,
    );

    await sleep(input.workDelayMs);

    await input.queue.completeJob({
      jobId: job.id,
      workerId: input.workerId,
      now: input.now,
    });

    input.state.activeByAccount.set(accountId, active - 1);
    input.state.perAccountCompleted[accountId] =
      (input.state.perAccountCompleted[accountId] ?? 0) + 1;
  }
}

function recordClaim(state: WorkerState, job: SyncJobRecord): void {
  if (state.seenClaims.has(job.id)) {
    state.duplicateClaims.add(job.id);
    return;
  }

  state.seenClaims.add(job.id);
}

function accountIdForIndex(index: number): string {
  return `acc_${String(index).padStart(3, "0")}`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const result = await runSyncQueueStressCheck({
    accountCount: readNumberArg("accounts"),
    jobsPerAccount: readNumberArg("jobs-per-account"),
    workerCount: readNumberArg("workers"),
    leaseSeconds: readNumberArg("lease-seconds"),
    workDelayMs: readNumberArg("work-delay-ms"),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sync queue stress check failed: ${message}\n`);
    process.exitCode = 1;
  });
}
