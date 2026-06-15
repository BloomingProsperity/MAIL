export interface FollowUpReminderJob {
  id: string;
  accountId: string;
  messageId: string;
  kind: string;
  dueAt: string;
  title?: string;
  note?: string;
}

export interface FollowUpReminderStore {
  claimNextDueFollowUp(input: {
    workerId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<FollowUpReminderJob | undefined>;
  promoteDueFollowUp(input: {
    followUpId: string;
    messageId: string;
    now: Date;
  }): Promise<void>;
}

export type FollowUpReminderRunResult =
  | { status: "idle" }
  | { status: "processed"; followUpId: string; messageId: string };

export interface RunFollowUpReminderOnceInput {
  store: FollowUpReminderStore;
  workerId: string;
  now: Date;
  leaseSeconds: number;
}

export interface RunFollowUpReminderBatchInput
  extends RunFollowUpReminderOnceInput {
  concurrency: number;
}

export async function runFollowUpReminderOnce(
  input: RunFollowUpReminderOnceInput,
): Promise<FollowUpReminderRunResult> {
  const job = await input.store.claimNextDueFollowUp({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
  });

  if (!job) {
    return { status: "idle" };
  }

  await input.store.promoteDueFollowUp({
    followUpId: job.id,
    messageId: job.messageId,
    now: input.now,
  });

  return {
    status: "processed",
    followUpId: job.id,
    messageId: job.messageId,
  };
}

export async function runFollowUpReminderBatch(
  input: RunFollowUpReminderBatchInput,
): Promise<FollowUpReminderRunResult[]> {
  const jobs: FollowUpReminderJob[] = [];
  const concurrency = normalizeConcurrency(input.concurrency);

  for (let index = 0; index < concurrency; index += 1) {
    const job = await input.store.claimNextDueFollowUp({
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

  return Promise.all(
    jobs.map(async (job) => {
      await input.store.promoteDueFollowUp({
        followUpId: job.id,
        messageId: job.messageId,
        now: input.now,
      });
      return {
        status: "processed" as const,
        followUpId: job.id,
        messageId: job.messageId,
      };
    }),
  );
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}
