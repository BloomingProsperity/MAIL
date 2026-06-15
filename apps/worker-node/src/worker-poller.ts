import type { SyncJobQueue, SyncJobRecord } from "./sync-job-queue.js";
import {
  runWorkerBatch,
  type WorkerRunResult,
} from "./worker-runner.js";

export type WorkerTickResult = WorkerRunResult | { status: "skipped" };

export interface CreateWorkerTickRunnerInput {
  queue: SyncJobQueue;
  workerId: string;
  clock(): Date;
  leaseSeconds: number;
  concurrency: number;
  handleJob(job: SyncJobRecord): Promise<void>;
}

export function createWorkerTickRunner(input: CreateWorkerTickRunnerInput) {
  let running = false;

  return async (): Promise<WorkerTickResult[]> => {
    if (running) {
      return [{ status: "skipped" }];
    }

    running = true;
    try {
      return await runWorkerBatch({
        queue: input.queue,
        workerId: input.workerId,
        now: input.clock(),
        leaseSeconds: input.leaseSeconds,
        concurrency: input.concurrency,
        handleJob: input.handleJob,
      });
    } finally {
      running = false;
    }
  };
}
