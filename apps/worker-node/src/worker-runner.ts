import type { SyncJobQueue, SyncJobRecord } from "./sync-job-queue.js";
import { isNonRetryableQueueError } from "./queue-errors.js";

export type WorkerRunResult =
  | { status: "idle" }
  | (WorkerJobContext & { status: "processed"; jobId: string })
  | (WorkerJobContext & {
      status: "failed";
      jobId: string;
      errorMessage: string;
      finalJobStatus: SyncJobRecord["status"];
      attempts: number;
      maxAttempts: number;
      retryable: boolean;
      nextRunAt?: string;
    });

export interface WorkerJobContext {
  accountId?: string;
  jobType: string;
  triggerEventId?: string;
  idempotencyKey: string;
}

export interface RunWorkerOnceInput {
  queue: SyncJobQueue;
  workerId: string;
  now: Date;
  leaseSeconds: number;
  handleJob(job: SyncJobRecord): Promise<void>;
}

export interface RunWorkerBatchInput extends RunWorkerOnceInput {
  concurrency: number;
}

export async function runWorkerOnce(
  input: RunWorkerOnceInput,
): Promise<WorkerRunResult> {
  const job = await input.queue.claimNext({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
  });

  if (!job) {
    return { status: "idle" };
  }

  return processClaimedJob(input, job);
}

export async function runWorkerBatch(
  input: RunWorkerBatchInput,
): Promise<WorkerRunResult[]> {
  const jobs: SyncJobRecord[] = [];
  const concurrency = normalizeConcurrency(input.concurrency);

  for (let index = 0; index < concurrency; index += 1) {
    const job = await input.queue.claimNext({
      workerId: input.workerId,
      now: input.now,
      leaseSeconds: input.leaseSeconds,
    });

    if (!job) {
      break;
    }

    jobs.push(job);
  }

  if (jobs.length === 0) {
    return [{ status: "idle" }];
  }

  return Promise.all(jobs.map((job) => processClaimedJob(input, job)));
}

async function processClaimedJob(
  input: RunWorkerOnceInput,
  job: SyncJobRecord,
): Promise<WorkerRunResult> {
  try {
    await input.handleJob(job);
    await input.queue.completeJob({
      jobId: job.id,
      workerId: input.workerId,
      now: input.now,
    });
    return { status: "processed", jobId: job.id, ...jobContext(job) };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "unknown worker error";
    const failedJob = await input.queue.failJob({
      jobId: job.id,
      workerId: input.workerId,
      errorMessage,
      retryable: !isNonRetryableQueueError(error),
      now: input.now,
    });
    return {
      status: "failed",
      jobId: job.id,
      errorMessage,
      finalJobStatus: failedJob.status,
      attempts: failedJob.attempts,
      maxAttempts: failedJob.maxAttempts,
      retryable: failedJob.status !== "dead_letter",
      ...(failedJob.status === "queued" ? { nextRunAt: failedJob.notBefore } : {}),
      ...jobContext(job),
    };
  }
}

function jobContext(job: SyncJobRecord): WorkerJobContext {
  return {
    ...(job.accountId ? { accountId: job.accountId } : {}),
    jobType: job.jobType,
    ...(job.triggerEventId ? { triggerEventId: job.triggerEventId } : {}),
    idempotencyKey: job.idempotencyKey,
  };
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}
