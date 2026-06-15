import type {
  AliasDeliveryJob,
  AliasDeliveryLogStatus,
  AliasRoutingStore,
} from "./alias-router.js";

export class TemporaryAliasDeliveryError extends Error {
  readonly deliveryStatus = "deferred";
}

export class PermanentAliasDeliveryError extends Error {
  readonly deliveryStatus = "bounced";
}

export interface AliasDeliveryTransport {
  deliver(input: {
    recipient: string;
    destinationEmail: string;
    sender?: string;
    rawMessageRef?: string;
    messageFingerprint: string;
  }): Promise<{ providerMessageId?: string }>;
}

export type AliasDeliveryRunResult =
  | { status: "idle" }
  | {
      status: "processed";
      jobId: string;
      deliveryStatus: "delivered";
    }
  | {
      status: "failed";
      jobId: string;
      deliveryStatus: "deferred" | "bounced";
      errorMessage: string;
    };

export interface RunAliasDeliveryOnceInput {
  store: Required<
    Pick<
      AliasRoutingStore,
      | "claimNextDeliveryJob"
      | "completeDeliveryJob"
      | "failDeliveryJob"
      | "recordDeliveryLog"
    >
  >;
  workerId: string;
  now: Date;
  leaseSeconds: number;
  transport: AliasDeliveryTransport;
  createId: () => string;
}

export interface RunAliasDeliveryBatchInput
  extends RunAliasDeliveryOnceInput {
  concurrency: number;
}

export async function runAliasDeliveryOnce(
  input: RunAliasDeliveryOnceInput,
): Promise<AliasDeliveryRunResult> {
  const job = await input.store.claimNextDeliveryJob({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
  });

  if (!job) {
    return { status: "idle" };
  }

  return processClaimedAliasDelivery(input, job);
}

export async function runAliasDeliveryBatch(
  input: RunAliasDeliveryBatchInput,
): Promise<AliasDeliveryRunResult[]> {
  const jobs: AliasDeliveryJob[] = [];
  const concurrency = normalizeConcurrency(input.concurrency);

  for (let index = 0; index < concurrency; index += 1) {
    const job = await input.store.claimNextDeliveryJob({
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
    jobs.map((job) => processClaimedAliasDelivery(input, job)),
  );
}

async function processClaimedAliasDelivery(
  input: RunAliasDeliveryOnceInput,
  job: AliasDeliveryJob,
): Promise<AliasDeliveryRunResult> {
  try {
    const result = await input.transport.deliver({
      recipient: job.recipient,
      destinationEmail: job.destinationEmail,
      ...(job.sender ? { sender: job.sender } : {}),
      ...(job.rawMessageRef ? { rawMessageRef: job.rawMessageRef } : {}),
      messageFingerprint: job.messageFingerprint,
    });
    await input.store.recordDeliveryLog({
      id: input.createId(),
      domainId: job.domainId,
      ...(job.aliasId ? { aliasId: job.aliasId } : {}),
      recipient: job.recipient,
      status: "delivered",
      detail: deliveredDetail(job.destinationEmail, result.providerMessageId),
      createdAt: input.now.toISOString(),
    });
    await input.store.completeDeliveryJob({
      jobId: job.id,
      workerId: input.workerId,
      now: input.now,
    });
    return {
      status: "processed",
      jobId: job.id,
      deliveryStatus: "delivered",
    };
  } catch (error) {
    const deliveryStatus = deliveryStatusFor(error);
    const errorMessage =
      error instanceof Error ? error.message : "unknown alias delivery error";
    await input.store.recordDeliveryLog({
      id: input.createId(),
      domainId: job.domainId,
      ...(job.aliasId ? { aliasId: job.aliasId } : {}),
      recipient: job.recipient,
      status: deliveryStatus,
      detail: errorMessage,
      createdAt: input.now.toISOString(),
    });
    await input.store.failDeliveryJob({
      jobId: job.id,
      workerId: input.workerId,
      errorMessage,
      now: input.now,
    });
    return {
      status: "failed",
      jobId: job.id,
      deliveryStatus,
      errorMessage,
    };
  }
}

function deliveryStatusFor(error: unknown): "deferred" | "bounced" {
  if (error instanceof PermanentAliasDeliveryError) {
    return "bounced";
  }

  return "deferred";
}

function deliveredDetail(
  destinationEmail: string,
  providerMessageId: string | undefined,
): string {
  return providerMessageId
    ? `delivered to ${destinationEmail} via ${providerMessageId}`
    : `delivered to ${destinationEmail}`;
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}
