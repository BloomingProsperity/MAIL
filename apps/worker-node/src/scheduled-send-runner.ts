import type { NativeProvider } from "./mail-provider/contract.js";

export interface MailAddress {
  address: string;
  name?: string;
}

export type ScheduledSendEngineProvider = "emailengine" | "native";
export type ScheduledSendTransportKey = "emailengine" | NativeProvider;
export type MailThreadingAction = "reply" | "reply_all";

export interface MailThreading {
  action: MailThreadingAction;
  inReplyTo?: string;
  references: string[];
  emailEngineMessageId?: string;
  gmailThreadId?: string;
  graphMessageId?: string;
}

export interface ScheduledSendJob {
  id: string;
  accountId: string;
  draftId: string;
  engineProvider: ScheduledSendEngineProvider;
  nativeProvider?: NativeProvider;
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  threading?: MailThreading;
  scheduledAt: string;
  attempts: number;
}

export interface ScheduledSendStore {
  claimNextScheduledSend(input: {
    workerId: string;
    now: Date;
    leaseSeconds: number;
  }): Promise<ScheduledSendJob | undefined>;
  markScheduledSendSent(input: {
    accountId: string;
    scheduledId: string;
    draftId: string;
    providerQueueId?: string;
    providerMessageId?: string;
    sentAt: string;
  }): Promise<void>;
  markScheduledSendFailed(input: {
    accountId: string;
    scheduledId: string;
    draftId: string;
    errorMessage: string;
    now: Date;
  }): Promise<void>;
}

export interface ScheduledSendTransport {
  submitMessage(input: {
    accountId: string;
    draftId: string;
    idempotencyKey: string;
    from?: MailAddress;
    to: MailAddress[];
    cc: MailAddress[];
    bcc: MailAddress[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
    threading?: MailThreading;
  }): Promise<{
    queueId?: string;
    messageId?: string;
    sendAt?: string;
  }>;
}

export type ScheduledSendRunResult =
  | { status: "idle" }
  | { status: "processed"; scheduledId: string }
  | { status: "failed"; scheduledId: string; errorMessage: string };

export interface RunScheduledSendOnceInput {
  store: ScheduledSendStore;
  workerId: string;
  now: Date;
  leaseSeconds: number;
  transport?: ScheduledSendTransport;
  transports?: Partial<Record<ScheduledSendTransportKey, ScheduledSendTransport>>;
}

export interface RunScheduledSendBatchInput
  extends RunScheduledSendOnceInput {
  concurrency: number;
}

export async function runScheduledSendOnce(
  input: RunScheduledSendOnceInput,
): Promise<ScheduledSendRunResult> {
  const job = await input.store.claimNextScheduledSend({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
  });

  if (!job) {
    return { status: "idle" };
  }

  return processScheduledSend(input, job);
}

export async function runScheduledSendBatch(
  input: RunScheduledSendBatchInput,
): Promise<ScheduledSendRunResult[]> {
  const jobs: ScheduledSendJob[] = [];
  const concurrency = normalizeConcurrency(input.concurrency);

  for (let index = 0; index < concurrency; index += 1) {
    const job = await input.store.claimNextScheduledSend({
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

  return Promise.all(jobs.map((job) => processScheduledSend(input, job)));
}

async function processScheduledSend(
  input: RunScheduledSendOnceInput,
  job: ScheduledSendJob,
): Promise<ScheduledSendRunResult> {
  try {
    const transport = transportForJob(input, job);
    const result = await transport.submitMessage({
      accountId: job.accountId,
      draftId: job.draftId,
      idempotencyKey: `compose:${job.draftId}:schedule:${job.id}:send`,
      ...(job.from ? { from: job.from } : {}),
      to: job.to,
      cc: job.cc,
      bcc: job.bcc,
      subject: job.subject,
      ...(job.bodyText ? { bodyText: job.bodyText } : {}),
      ...(job.bodyHtml ? { bodyHtml: job.bodyHtml } : {}),
      ...(job.threading ? { threading: job.threading } : {}),
    });

    await input.store.markScheduledSendSent({
      accountId: job.accountId,
      scheduledId: job.id,
      draftId: job.draftId,
      ...(result.queueId ? { providerQueueId: result.queueId } : {}),
      ...(result.messageId ? { providerMessageId: result.messageId } : {}),
      sentAt: result.sendAt ?? input.now.toISOString(),
    });

    return { status: "processed", scheduledId: job.id };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "unknown scheduled send error";
    await input.store.markScheduledSendFailed({
      accountId: job.accountId,
      scheduledId: job.id,
      draftId: job.draftId,
      errorMessage,
      now: input.now,
    });
    return { status: "failed", scheduledId: job.id, errorMessage };
  }
}

function transportForJob(
  input: RunScheduledSendOnceInput,
  job: ScheduledSendJob,
): ScheduledSendTransport {
  const key = transportKeyForJob(job);
  const selected = input.transports?.[key] ?? input.transport;
  if (!selected) {
    throw new Error(`scheduled send transport is unavailable for ${key}`);
  }

  return selected;
}

function transportKeyForJob(job: ScheduledSendJob): ScheduledSendTransportKey {
  if (job.engineProvider !== "native") {
    return "emailengine";
  }
  if (!job.nativeProvider) {
    throw new Error(`native scheduled send ${job.id} is missing nativeProvider`);
  }

  return job.nativeProvider;
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}
