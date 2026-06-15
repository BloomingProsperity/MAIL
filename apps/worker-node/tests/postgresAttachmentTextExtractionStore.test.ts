import { describe, expect, it } from "vitest";

import { createPostgresAttachmentTextExtractionStore } from "../src/search/postgres-attachment-text-extraction-store";

describe("postgres attachment text extraction store", () => {
  it("claims due or expired extraction jobs with SKIP LOCKED and account serialization", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAttachmentTextExtractionStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              account_id: "acc_1",
              message_id: "msg_1",
              provider: "emailengine",
              provider_attachment_id: "att_pdf",
              filename: "signed-contract.pdf",
              content_type: "application/pdf",
              byte_size: "45000",
              status: "running",
              attempts: 1,
              max_attempts: 5,
              not_before: "2026-06-14T08:00:00.000Z",
              lease_owner: "worker-a",
              lease_expires_at: "2026-06-14T08:01:00.000Z",
              error_message: null,
              created_at: "2026-06-14T08:00:00.000Z",
              updated_at: "2026-06-14T08:00:00.000Z",
              completed_at: null,
            },
          ],
        };
      },
    });

    const job = await store.claimNext({
      workerId: "worker-a",
      now: new Date("2026-06-14T08:00:00.000Z"),
      leaseSeconds: 60,
    });

    expect(queries[0].text).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(queries[0].text).toMatch(/active_same_account/i);
    expect(queries[0].text).toMatch(/attempts = attempts \+ 1/i);
    expect(queries[0].values).toEqual([
      "2026-06-14T08:00:00.000Z",
      "worker-a",
      "2026-06-14T08:01:00.000Z",
    ]);
    expect(job).toMatchObject({
      id: "job_1",
      accountId: "acc_1",
      messageId: "msg_1",
      providerAttachmentId: "att_pdf",
      filename: "signed-contract.pdf",
      status: "running",
      leaseOwner: "worker-a",
    });
  });

  it("completes a leased job and merges extracted text into search_documents", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAttachmentTextExtractionStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              account_id: "acc_1",
              message_id: "msg_1",
              provider: "emailengine",
              provider_attachment_id: "att_pdf",
              filename: "signed-contract.pdf",
              content_type: "application/pdf",
              byte_size: "45000",
              status: "done",
              attempts: 1,
              max_attempts: 5,
              not_before: "2026-06-14T08:00:00.000Z",
              lease_owner: null,
              lease_expires_at: null,
              error_message: null,
              extracted_text: "signed contract payment terms",
              created_at: "2026-06-14T08:00:00.000Z",
              updated_at: "2026-06-14T08:02:00.000Z",
              completed_at: "2026-06-14T08:02:00.000Z",
            },
          ],
        };
      },
    });

    const completed = await store.completeJob({
      jobId: "job_1",
      workerId: "worker-a",
      extractedText: "signed contract payment terms",
      now: new Date("2026-06-14T08:02:00.000Z"),
    });

    expect(queries[0].text).toMatch(/UPDATE attachment_text_extraction_jobs/i);
    expect(queries[0].text).toMatch(/INSERT INTO search_documents/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(message_id\) DO UPDATE/i);
    expect(queries[0].text).toMatch(/to_tsvector\('simple'/i);
    expect(queries[0].values).toEqual([
      "job_1",
      "worker-a",
      "signed contract payment terms",
      "2026-06-14T08:02:00.000Z",
    ]);
    expect(completed).toMatchObject({
      id: "job_1",
      status: "done",
      extractedText: "signed contract payment terms",
      completedAt: "2026-06-14T08:02:00.000Z",
    });
  });

  it("requeues retryable failures and dead-letters exhausted jobs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAttachmentTextExtractionStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "job_1",
              account_id: "acc_1",
              message_id: "msg_1",
              provider: "emailengine",
              provider_attachment_id: "att_pdf",
              filename: "signed-contract.pdf",
              content_type: "application/pdf",
              byte_size: "45000",
              status: "queued",
              attempts: 1,
              max_attempts: 5,
              not_before: "2026-06-14T08:00:30.000Z",
              lease_owner: null,
              lease_expires_at: null,
              error_message: "parser failed",
              created_at: "2026-06-14T08:00:00.000Z",
              updated_at: "2026-06-14T08:00:00.000Z",
              completed_at: null,
            },
          ],
        };
      },
    });

    const failed = await store.failJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "parser failed",
      now: new Date("2026-06-14T08:00:00.000Z"),
    });

    expect(queries[0].text).toMatch(/CASE WHEN \$5 = FALSE OR attempts >= max_attempts/i);
    expect(queries[0].text).toMatch(/POWER/i);
    expect(queries[0].text).toMatch(/dead_letter/i);
    expect(queries[0].values).toEqual([
      "job_1",
      "worker-a",
      "parser failed",
      "2026-06-14T08:00:00.000Z",
      true,
    ]);
    expect(failed).toMatchObject({
      status: "queued",
      errorMessage: "parser failed",
    });
  });
});
