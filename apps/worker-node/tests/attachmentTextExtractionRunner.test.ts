import { describe, expect, it } from "vitest";

import {
  NonRetryableAttachmentTextExtractionError,
  runAttachmentTextExtractionBatch,
  runAttachmentTextExtractionOnce,
  type AttachmentDownloadClient,
  type AttachmentTextExtractionRunnerStore,
  type AttachmentTextExtractor,
} from "../src/search/attachment-text-extraction-runner";
import type { AttachmentTextJobRecord } from "../src/search/postgres-attachment-text-extraction-store";

describe("attachment text extraction runner", () => {
  it("downloads a claimed attachment, extracts text, and completes the job", async () => {
    const store = createStore([job()]);
    const downloads: unknown[] = [];
    const extractionInputs: unknown[] = [];

    const result = await runAttachmentTextExtractionOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-14T08:00:00.000Z"),
      leaseSeconds: 60,
      downloader: {
        async downloadAttachment(input) {
          downloads.push(input);
          return {
            bytes: new Uint8Array([37, 80, 68, 70]),
            contentType: "application/pdf",
          };
        },
      },
      extractor: {
        async extractText(input) {
          extractionInputs.push(input);
          return { text: "signed contract payment terms" };
        },
      },
    });

    expect(result).toEqual({
      status: "processed",
      jobId: "job_1",
      messageId: "msg_1",
    });
    expect(downloads).toEqual([
      {
        accountId: "acc_1",
        provider: "emailengine",
        providerAttachmentId: "att_pdf",
        messageId: "msg_1",
      },
    ]);
    expect(extractionInputs).toEqual([
      {
        bytes: new Uint8Array([37, 80, 68, 70]),
        filename: "signed-contract.pdf",
        contentType: "application/pdf",
        byteSize: 45000,
      },
    ]);
    expect(store.completed).toEqual([
      {
        jobId: "job_1",
        workerId: "worker-a",
        extractedText: "signed contract payment terms",
        now: new Date("2026-06-14T08:00:00.000Z"),
      },
    ]);
    expect(store.failed).toEqual([]);
  });

  it("returns idle without downloading when no extraction job is due", async () => {
    const result = await runAttachmentTextExtractionBatch({
      store: createStore([]),
      workerId: "worker-a",
      now: new Date("2026-06-14T08:00:00.000Z"),
      leaseSeconds: 60,
      concurrency: 4,
      downloader: failDownloader(),
      extractor: failExtractor(),
    });

    expect(result).toEqual([{ status: "idle" }]);
  });

  it("marks retryable download or parser failures through the store", async () => {
    const store = createStore([job()]);

    const result = await runAttachmentTextExtractionOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-14T08:00:00.000Z"),
      leaseSeconds: 60,
      downloader: {
        async downloadAttachment() {
          throw new Error("provider timeout token=secret");
        },
      },
      extractor: failExtractor(),
    });

    expect(result).toEqual({
      status: "failed",
      jobId: "job_1",
      errorMessage: "provider timeout [redacted]",
      retryable: true,
    });
    expect(store.failed).toEqual([
      {
        jobId: "job_1",
        workerId: "worker-a",
        errorMessage: "provider timeout [redacted]",
        now: new Date("2026-06-14T08:00:00.000Z"),
        retryable: true,
      },
    ]);
  });

  it("marks unsupported attachments as non-retryable failures", async () => {
    const store = createStore([job({ contentType: "application/zip" })]);

    const result = await runAttachmentTextExtractionOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-14T08:00:00.000Z"),
      leaseSeconds: 60,
      downloader: {
        async downloadAttachment() {
          return {
            bytes: Buffer.from("zip bytes"),
            contentType: "application/zip",
          };
        },
      },
      extractor: {
        async extractText() {
          throw new NonRetryableAttachmentTextExtractionError(
            "unsupported content type application/zip",
          );
        },
      },
    });

    expect(result).toEqual({
      status: "failed",
      jobId: "job_1",
      errorMessage: "unsupported content type application/zip",
      retryable: false,
    });
    expect(store.failed).toEqual([
      {
        jobId: "job_1",
        workerId: "worker-a",
        errorMessage: "unsupported content type application/zip",
        now: new Date("2026-06-14T08:00:00.000Z"),
        retryable: false,
      },
    ]);
  });

  it("claims and processes up to the requested concurrency", async () => {
    const store = createStore([job({ id: "job_1" }), job({ id: "job_2" })]);

    const results = await runAttachmentTextExtractionBatch({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-14T08:00:00.000Z"),
      leaseSeconds: 60,
      concurrency: 2,
      downloader: {
        async downloadAttachment() {
          return { bytes: new Uint8Array([1, 2, 3]) };
        },
      },
      extractor: {
        async extractText() {
          return { text: "invoice total 42" };
        },
      },
    });

    expect(results.map((result) => result.status)).toEqual([
      "processed",
      "processed",
    ]);
    expect(store.completed.map((input) => input.jobId)).toEqual([
      "job_1",
      "job_2",
    ]);
  });
});

function createStore(jobs: AttachmentTextJobRecord[]) {
  const queue = [...jobs];
  return {
    completed: [] as Array<{
      jobId: string;
      workerId: string;
      extractedText: string;
      now: Date;
    }>,
    failed: [] as Array<{
      jobId: string;
      workerId: string;
      errorMessage: string;
      now: Date;
      retryable?: boolean;
    }>,
    async claimNext() {
      return queue.shift();
    },
    async completeJob(input) {
      this.completed.push(input);
      return {
        ...job({ id: input.jobId }),
        status: "done",
        extractedText: input.extractedText,
      };
    },
    async failJob(input) {
      this.failed.push(input);
      return {
        ...job({ id: input.jobId }),
        status: input.retryable === false ? "dead_letter" : "queued",
        errorMessage: input.errorMessage,
      };
    },
  } satisfies AttachmentTextExtractionRunnerStore & {
    completed: Array<{
      jobId: string;
      workerId: string;
      extractedText: string;
      now: Date;
    }>;
    failed: Array<{
      jobId: string;
      workerId: string;
      errorMessage: string;
      now: Date;
      retryable?: boolean;
    }>;
  };
}

function job(
  overrides: Partial<AttachmentTextJobRecord> = {},
): AttachmentTextJobRecord {
  return {
    id: "job_1",
    accountId: "acc_1",
    messageId: "msg_1",
    provider: "emailengine",
    providerAttachmentId: "att_pdf",
    filename: "signed-contract.pdf",
    contentType: "application/pdf",
    byteSize: 45000,
    status: "running",
    attempts: 1,
    maxAttempts: 5,
    notBefore: "2026-06-14T08:00:00.000Z",
    leaseOwner: "worker-a",
    leaseExpiresAt: "2026-06-14T08:01:00.000Z",
    createdAt: "2026-06-14T08:00:00.000Z",
    updatedAt: "2026-06-14T08:00:00.000Z",
    ...overrides,
  };
}

function failDownloader(): AttachmentDownloadClient {
  return {
    async downloadAttachment() {
      throw new Error("should not download");
    },
  };
}

function failExtractor(): AttachmentTextExtractor {
  return {
    async extractText() {
      throw new Error("should not extract");
    },
  };
}
