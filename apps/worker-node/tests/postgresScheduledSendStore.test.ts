import { describe, expect, it } from "vitest";

import { createPostgresScheduledSendStore } from "../src/postgres-scheduled-send-store";

describe("Postgres scheduled send store", () => {
  it("claims one due scheduled send with a lease and draft payload", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresScheduledSendStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "schedule_1",
              account_id: "acc_1",
              draft_id: "draft_1",
              engine_provider: "emailengine",
              native_provider: null,
              scheduled_at: "2026-06-13T12:30:00.000Z",
              attempts: 1,
              from_address: "support@demo.site",
              from_name: "Support",
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com", name: "Lina" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              thread_action: "reply",
              thread_in_reply_to: "<source@example.com>",
              thread_references: ["<root@example.com>", "<source@example.com>"],
              thread_emailengine_message_id: "emailengine_msg_1",
              thread_gmail_thread_id: "gmail_thread_1",
              thread_graph_message_id: "graph_msg_1",
              attachment_manifest: [
                {
                  id: "attachment_1",
                  source: "message_attachment",
                  attachmentId: "attachment_1",
                  filename: "proposal.pdf",
                  contentType: "application/pdf",
                  byteSize: 2048,
                  inline: false,
                  providerAttachmentId: "ee_attachment_1",
                  contentBase64: "Zm9yd2FyZA==",
                },
                {
                  id: "upload_1",
                  source: "uploaded_file",
                  attachmentId: "upload_1",
                  filename: "brief.txt",
                  contentType: "text/plain",
                  byteSize: 5,
                  inline: false,
                  contentBase64: "aGVsbG8=",
                },
              ],
            },
          ],
        };
      },
    });

    const job = await store.claimNextScheduledSend({
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
    });

    expect(queries[0].text).toMatch(/WITH candidate AS/i);
    expect(queries[0].text).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(queries[0].text).toMatch(/status IN \('scheduled', 'failed'\)/i);
    expect(queries[0].text).toMatch(/not_before <= \$1::timestamptz/i);
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/JOIN connected_accounts/i);
    expect(queries[0].text).toMatch(/LEFT JOIN account_provider_settings/i);
    expect(queries[0].text).toMatch(/claimed_draft\.thread_action/i);
    expect(queries[0].text).toMatch(/claimed_draft\.attachment_manifest/i);
    expect(queries[0].values).toEqual([
      "2026-06-13T12:30:00.000Z",
      "worker-a",
      "2026-06-13T12:30:30.000Z",
    ]);
    expect(job).toMatchObject({
      id: "schedule_1",
      accountId: "acc_1",
      draftId: "draft_1",
      engineProvider: "emailengine",
      from: { address: "support@demo.site", name: "Support" },
      subject: "Launch confirmation",
      bodyText: "Looks good.",
      attempts: 1,
      threading: {
        action: "reply",
        inReplyTo: "<source@example.com>",
        references: ["<root@example.com>", "<source@example.com>"],
        emailEngineMessageId: "emailengine_msg_1",
        gmailThreadId: "gmail_thread_1",
        graphMessageId: "graph_msg_1",
      },
      attachments: [
        {
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          inline: false,
          providerAttachmentId: "ee_attachment_1",
          contentBase64: "Zm9yd2FyZA==",
        },
        {
          filename: "brief.txt",
          contentType: "text/plain",
          byteSize: 5,
          inline: false,
          contentBase64: "aGVsbG8=",
        },
      ],
    });
  });

  it("reclaims expired sending leases with sending drafts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresScheduledSendStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "schedule_1",
              account_id: "acc_1",
              draft_id: "draft_1",
              engine_provider: "emailengine",
              native_provider: null,
              scheduled_at: "2026-06-13T12:30:00.000Z",
              attempts: 2,
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com", name: "Lina" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
            },
          ],
        };
      },
    });

    const job = await store.claimNextScheduledSend({
      workerId: "worker-b",
      now: new Date("2026-06-13T12:31:00.000Z"),
      leaseSeconds: 45,
    });

    expect(queries[0].text).toMatch(/status = 'sending'/i);
    expect(queries[0].text).toMatch(/lease_expires_at <= \$1::timestamptz/i);
    expect(queries[0].text).toMatch(/email_drafts\.status IN \('scheduled', 'sending'\)/i);
    expect(queries[0].values).toEqual([
      "2026-06-13T12:31:00.000Z",
      "worker-b",
      "2026-06-13T12:31:45.000Z",
    ]);
    expect(job).toMatchObject({
      id: "schedule_1",
      accountId: "acc_1",
      draftId: "draft_1",
      attempts: 2,
    });
  });

  it("claims native scheduled sends with their native provider for worker routing", async () => {
    const store = createPostgresScheduledSendStore({
      async query() {
        return {
          rows: [
            {
              id: "schedule_native_1",
              account_id: "acc_native_1",
              draft_id: "draft_native_1",
              engine_provider: "native",
              native_provider: "gmail",
              scheduled_at: "2026-06-13T12:30:00.000Z",
              attempts: 1,
              subject: "Native launch confirmation",
              to_emails: [{ address: "lina@example.com", name: "Lina" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
            },
          ],
        };
      },
    });

    const job = await store.claimNextScheduledSend({
      workerId: "worker-native",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
    });

    expect(job).toMatchObject({
      id: "schedule_native_1",
      accountId: "acc_native_1",
      draftId: "draft_native_1",
      engineProvider: "native",
      nativeProvider: "gmail",
    });
  });

  it("marks a scheduled send and its draft sent after provider submission", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresScheduledSendStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    await store.markScheduledSendSent({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      draftId: "draft_1",
      providerQueueId: "queue_1",
      providerMessageId: "<message@example.com>",
      sentAt: "2026-06-13T12:30:01.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE scheduled_sends/i);
    expect(queries[0].text).toMatch(/status = 'sent'/i);
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/provider_queue_id = \$4/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "draft_1",
      "queue_1",
      "<message@example.com>",
      "2026-06-13T12:30:01.000Z",
    ]);
  });

  it("requeues retryable failures and releases the lease", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresScheduledSendStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    await store.markScheduledSendFailed({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      draftId: "draft_1",
      errorMessage: "SMTP transient failure",
      now: new Date("2026-06-13T12:31:00.000Z"),
    });

    expect(queries[0].text).toMatch(/status = CASE/i);
    expect(queries[0].text).toMatch(/WHEN attempts >= max_attempts THEN 'dead_letter'/i);
    expect(queries[0].text).toMatch(/ELSE 'failed'/i);
    expect(queries[0].text).toMatch(/lease_owner = NULL/i);
    expect(queries[0].text).toMatch(/lease_expires_at = NULL/i);
    expect(queries[0].text).toMatch(/LEAST\(\s*60 \* POWER/i);
    expect(queries[0].text).toMatch(/WHEN failed_schedule.status = 'dead_letter' THEN 'failed'/i);
    expect(queries[0].text).toMatch(/ELSE 'scheduled'/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "draft_1",
      "SMTP transient failure",
      "2026-06-13T12:31:00.000Z",
    ]);
  });
});
