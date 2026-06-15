export type SyncJobType = "sync_account" | "account_state";
export type SyncJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "dead_letter";

export interface SyncJobRecord {
  id: string;
  jobType: SyncJobType;
  accountId?: string;
  mailboxId?: string;
  triggerEventId?: string;
  idempotencyKey: string;
  status: SyncJobStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  payload: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface EnqueueJobInput {
  id: string;
  jobType: SyncJobType;
  accountId?: string;
  mailboxId?: string;
  triggerEventId?: string;
  idempotencyKey: string;
  maxAttempts?: number;
  notBefore: string;
  payload: unknown;
}

export interface ClaimNextInput {
  workerId: string;
  now: Date;
  leaseSeconds: number;
}

export interface CompleteJobInput {
  jobId: string;
  workerId: string;
  now: Date;
}

export interface FailJobInput {
  jobId: string;
  workerId: string;
  errorMessage: string;
  retryable?: boolean;
  now: Date;
}

export interface SyncJobQueue {
  enqueueJob(input: EnqueueJobInput): Promise<SyncJobRecord>;
  claimNext(input: ClaimNextInput): Promise<SyncJobRecord | undefined>;
  completeJob(input: CompleteJobInput): Promise<SyncJobRecord>;
  failJob(input: FailJobInput): Promise<SyncJobRecord>;
}

export interface InMemorySyncJobQueue extends SyncJobQueue {
  listJobs(): SyncJobRecord[];
}

export function createInMemorySyncJobQueue(
  initialJobs: SyncJobRecord[] = [],
): InMemorySyncJobQueue {
  const jobs = initialJobs.map((job) => ({ ...job }));

  return {
    async enqueueJob(input) {
      const existing = jobs.find(
        (job) => job.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        return { ...existing };
      }

      const job: SyncJobRecord = {
        id: input.id,
        jobType: input.jobType,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...(input.triggerEventId
          ? { triggerEventId: input.triggerEventId }
          : {}),
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 8,
        notBefore: input.notBefore,
        payload: input.payload,
        createdAt: input.notBefore,
        updatedAt: input.notBefore,
      };
      jobs.push(job);
      return { ...job };
    },

    async claimNext(input) {
      const candidate = jobs
        .map((job, index) => ({ index, job }))
        .filter(
          ({ job }) =>
          canClaim(job, input.now) &&
          !hasActiveSameAccountJob(jobs, job, input.now),
        )
        .sort((left, right) => compareClaimOrder(left.job, right.job))[0];
      if (!candidate) {
        return undefined;
      }

      const { index } = candidate;
      const job = jobs[index];
      const { errorMessage: _staleError, ...jobWithoutError } = job;
      const updated: SyncJobRecord = {
        ...jobWithoutError,
        status: "running",
        attempts: job.attempts + 1,
        leaseOwner: input.workerId,
        leaseExpiresAt: addSeconds(input.now, input.leaseSeconds).toISOString(),
        updatedAt: input.now.toISOString(),
      };
      jobs[index] = updated;
      return { ...updated };
    },

    async completeJob(input) {
      const { job, index } = findOwnedJob(jobs, input.jobId, input.workerId);
      const { errorMessage: _staleError, ...jobWithoutError } = job;
      const updated: SyncJobRecord = {
        ...jobWithoutError,
        status: "done",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        completedAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      };
      jobs[index] = updated;
      return { ...updated };
    },

    async failJob(input) {
      const { job, index } = findOwnedJob(jobs, input.jobId, input.workerId);
      const retryable =
        input.retryable !== false && job.attempts < job.maxAttempts;
      const updated: SyncJobRecord = {
        ...job,
        status: retryable ? "queued" : "dead_letter",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        notBefore: retryable
          ? addSeconds(input.now, backoffSeconds(job.attempts)).toISOString()
          : job.notBefore,
        errorMessage: input.errorMessage,
        updatedAt: input.now.toISOString(),
      };
      jobs[index] = updated;
      return { ...updated };
    },

    listJobs() {
      return jobs.map((job) => ({ ...job }));
    },
  };
}

function compareClaimOrder(left: SyncJobRecord, right: SyncJobRecord): number {
  return (
    compareTimestamp(left.notBefore, right.notBefore) ||
    compareTimestamp(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareTimestamp(left: string, right: string): number {
  return timestampValue(left) - timestampValue(right);
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function canClaim(job: SyncJobRecord, now: Date): boolean {
  if (job.status === "queued") {
    return Date.parse(job.notBefore) <= now.getTime();
  }

  return (
    job.status === "running" &&
    !!job.leaseExpiresAt &&
    Date.parse(job.leaseExpiresAt) <= now.getTime()
  );
}

function hasActiveSameAccountJob(
  jobs: SyncJobRecord[],
  candidate: SyncJobRecord,
  now: Date,
): boolean {
  if (!candidate.accountId) {
    return false;
  }

  return jobs.some(
    (job) =>
      job.id !== candidate.id &&
      job.accountId === candidate.accountId &&
      job.status === "running" &&
      !!job.leaseExpiresAt &&
      Date.parse(job.leaseExpiresAt) > now.getTime(),
  );
}

function findOwnedJob(
  jobs: SyncJobRecord[],
  jobId: string,
  workerId: string,
): { job: SyncJobRecord; index: number } {
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index === -1) {
    throw new Error(`job not found: ${jobId}`);
  }

  const job = jobs[index];
  if (job.leaseOwner !== workerId || job.status !== "running") {
    throw new Error(`job lease is not owned by ${workerId}`);
  }

  return { job, index };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 15 * 60);
}
