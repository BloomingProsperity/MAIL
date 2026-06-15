import type {
  AttachmentTextJobRecord,
  ClaimAttachmentTextJobInput,
  CompleteAttachmentTextJobInput,
  FailAttachmentTextJobInput,
} from "./postgres-attachment-text-extraction-store.js";

export interface AttachmentTextExtractionRunnerStore {
  claimNext(
    input: ClaimAttachmentTextJobInput,
  ): Promise<AttachmentTextJobRecord | undefined>;
  completeJob(
    input: CompleteAttachmentTextJobInput,
  ): Promise<AttachmentTextJobRecord>;
  failJob(input: FailAttachmentTextJobInput): Promise<AttachmentTextJobRecord>;
}

export interface AttachmentDownloadClient {
  downloadAttachment(input: {
    accountId: string;
    provider: string;
    providerAttachmentId: string;
    messageId: string;
  }): Promise<{
    bytes: Uint8Array | ArrayBuffer;
    contentType?: string;
  }>;
}

export interface AttachmentTextExtractor {
  extractText(input: {
    bytes: Uint8Array;
    filename: string;
    contentType: string;
    byteSize: number;
  }): Promise<{ text: string }>;
}

export class NonRetryableAttachmentTextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableAttachmentTextExtractionError";
  }
}

export type AttachmentTextExtractionRunResult =
  | { status: "idle" }
  | { status: "processed"; jobId: string; messageId: string }
  | {
      status: "failed";
      jobId: string;
      errorMessage: string;
      retryable: boolean;
    };

export interface RunAttachmentTextExtractionOnceInput {
  store: AttachmentTextExtractionRunnerStore;
  workerId: string;
  now: Date;
  leaseSeconds: number;
  downloader: AttachmentDownloadClient;
  extractor: AttachmentTextExtractor;
}

export interface RunAttachmentTextExtractionBatchInput
  extends RunAttachmentTextExtractionOnceInput {
  concurrency: number;
}

export async function runAttachmentTextExtractionOnce(
  input: RunAttachmentTextExtractionOnceInput,
): Promise<AttachmentTextExtractionRunResult> {
  const job = await input.store.claimNext({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
  });

  if (!job) {
    return { status: "idle" };
  }

  return processAttachmentTextExtraction(input, job);
}

export async function runAttachmentTextExtractionBatch(
  input: RunAttachmentTextExtractionBatchInput,
): Promise<AttachmentTextExtractionRunResult[]> {
  const jobs: AttachmentTextJobRecord[] = [];
  const concurrency = normalizeConcurrency(input.concurrency);

  for (let index = 0; index < concurrency; index += 1) {
    const job = await input.store.claimNext({
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
    jobs.map((job) => processAttachmentTextExtraction(input, job)),
  );
}

async function processAttachmentTextExtraction(
  input: RunAttachmentTextExtractionOnceInput,
  job: AttachmentTextJobRecord,
): Promise<AttachmentTextExtractionRunResult> {
  try {
    const attachment = await input.downloader.downloadAttachment({
      accountId: job.accountId,
      provider: job.provider,
      providerAttachmentId: job.providerAttachmentId,
      messageId: job.messageId,
    });
    const extracted = await input.extractor.extractText({
      bytes: toUint8Array(attachment.bytes),
      filename: job.filename,
      contentType: attachment.contentType ?? job.contentType,
      byteSize: job.byteSize,
    });

    await input.store.completeJob({
      jobId: job.id,
      workerId: input.workerId,
      extractedText: extracted.text,
      now: input.now,
    });

    return {
      status: "processed",
      jobId: job.id,
      messageId: job.messageId,
    };
  } catch (error) {
    const retryable = !(error instanceof NonRetryableAttachmentTextExtractionError);
    const errorMessage = sanitizeErrorMessage(error);

    await input.store.failJob({
      jobId: job.id,
      workerId: input.workerId,
      errorMessage,
      now: input.now,
      retryable,
    });

    return {
      status: "failed",
      jobId: job.id,
      errorMessage,
      retryable,
    };
  }
}

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }

  return new Uint8Array(bytes);
}

function sanitizeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "unknown attachment text extraction error";

  return message
    .replace(
      /\b(?:token|password|secret|authorization|auth|cookie|code)=[^\s,;]+/gi,
      "[redacted]",
    )
    .slice(0, 500);
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}
