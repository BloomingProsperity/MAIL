import { describe, expect, it } from "vitest";

import { createPostgresMailEngineIngestStore } from "../src/mail-engine/postgres-ingest-store";
import type { NormalizedMailEngineEvent } from "../src/mail-engine/webhook";

const event: NormalizedMailEngineEvent = {
  source: "emailengine_webhook",
  kind: "message_upserted",
  accountId: "acc_1",
  mailboxId: "INBOX",
  providerMessageId: "msg_1",
  providerThreadId: "thread_1",
  providerEmailId: "stable_email_1",
  rfcMessageId: "<message-1@example.com>",
  providerUid: "12345",
  providerPath: "INBOX",
  resourceKey: "emailengine:acc_1:emailId:stable_email_1",
  resourceIdentity: {
    emailengineMessageId: "msg_1",
    emailengineEmailId: "stable_email_1",
    internetMessageId: "<message-1@example.com>",
    imapUid: "12345",
    mailboxPath: "INBOX",
    threadId: "thread_1",
    resourceKey: "emailengine:acc_1:emailId:stable_email_1",
  },
  idempotencyKey: "emailengine:acc_1:message_upserted:msg_1",
};

describe("postgres ingest store", () => {
  it("inserts a new mail engine event and queues a sync job", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });

        if (text.includes("INSERT INTO mail_engine_events")) {
          return {
            rows: [
              {
                id: "event_1",
                source: "emailengine_webhook",
                kind: "message_upserted",
                account_id: "acc_1",
                mailbox_id: "INBOX",
                provider_message_id: "msg_1",
                provider_thread_id: "thread_1",
                provider_email_id: "stable_email_1",
                rfc_message_id: "<message-1@example.com>",
                provider_uid: "12345",
                provider_path: "INBOX",
                resource_key: "emailengine:acc_1:emailId:stable_email_1",
                resource_identity: {
                  emailengineMessageId: "msg_1",
                  emailengineEmailId: "stable_email_1",
                  internetMessageId: "<message-1@example.com>",
                  imapUid: "12345",
                  mailboxPath: "INBOX",
                  threadId: "thread_1",
                  resourceKey: "emailengine:acc_1:emailId:stable_email_1",
                },
                idempotency_key: "emailengine:acc_1:message_upserted:msg_1",
                raw_payload: { event: "messageNew" },
                received_at: "2026-06-12T09:00:00.000Z",
              },
            ],
          };
        }

        if (text.includes("INSERT INTO sync_jobs")) {
          return {
            rows: [
              {
                id: "job_1",
                job_type: "sync_account",
                account_id: "acc_1",
                mailbox_id: "INBOX",
                trigger_event_id: "event_1",
                status: "queued",
                idempotency_key: "job:emailengine:acc_1:message_upserted:msg_1",
                created_at: "2026-06-12T09:00:00.000Z",
              },
            ],
          };
        }

        return { rows: [] };
      },
    };

    const store = createPostgresMailEngineIngestStore(client);
    const result = await store.ingestWebhook({
      events: [event],
      rawPayload: { event: "messageNew" },
    });

    expect(queries[0].text).toMatch(
      /ON CONFLICT \(idempotency_key\) DO NOTHING/i,
    );
    expect(queries[0].text).toMatch(/resource_key/i);
    expect(queries[0].text).toMatch(/resource_identity/i);
    expect(queries[0].values).toContain(
      "emailengine:acc_1:emailId:stable_email_1",
    );
    expect(queries[0].values).toContainEqual({
      emailengineMessageId: "msg_1",
      emailengineEmailId: "stable_email_1",
      internetMessageId: "<message-1@example.com>",
      imapUid: "12345",
      mailboxPath: "INBOX",
      threadId: "thread_1",
      resourceKey: "emailengine:acc_1:emailId:stable_email_1",
    });
    expect(queries[1].text).toMatch(/INSERT INTO sync_jobs/i);
    expect(queries[1].text).toMatch(/idempotency_key/i);
    expect(queries[1].values?.[6]).toMatchObject({
      resourceIdentity: {
        emailengineMessageId: "msg_1",
        emailengineEmailId: "stable_email_1",
        internetMessageId: "<message-1@example.com>",
        imapUid: "12345",
        mailboxPath: "INBOX",
        threadId: "thread_1",
        resourceKey: "emailengine:acc_1:emailId:stable_email_1",
      },
    });
    expect(result.events[0]).toMatchObject({
      id: "event_1",
      duplicate: false,
      accountId: "acc_1",
      providerEmailId: "stable_email_1",
      rfcMessageId: "<message-1@example.com>",
      providerUid: "12345",
      providerPath: "INBOX",
      resourceKey: "emailengine:acc_1:emailId:stable_email_1",
      resourceIdentity: {
        emailengineMessageId: "msg_1",
        emailengineEmailId: "stable_email_1",
      },
    });
    expect(result.syncJobs[0]).toMatchObject({
      id: "job_1",
      jobType: "sync_account",
      idempotencyKey: "job:emailengine:acc_1:message_upserted:msg_1",
      triggerEventId: "event_1",
    });
  });

  it("retries idempotent sync job creation for duplicate webhook events", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });

        if (text.includes("INSERT INTO mail_engine_events")) {
          return { rows: [] };
        }

        if (text.includes("FROM mail_engine_events")) {
          return {
            rows: [
              {
                id: "event_1",
                source: "emailengine_webhook",
                kind: "message_upserted",
                account_id: "acc_1",
                mailbox_id: "INBOX",
                provider_message_id: "msg_1",
                provider_thread_id: "thread_1",
                provider_email_id: "stable_email_1",
                rfc_message_id: "<message-1@example.com>",
                provider_uid: "12345",
                provider_path: "INBOX",
                resource_key: "emailengine:acc_1:emailId:stable_email_1",
                resource_identity: {
                  emailengineMessageId: "msg_1",
                  emailengineEmailId: "stable_email_1",
                  internetMessageId: "<message-1@example.com>",
                  imapUid: "12345",
                  mailboxPath: "INBOX",
                  threadId: "thread_1",
                  resourceKey: "emailengine:acc_1:emailId:stable_email_1",
                },
                idempotency_key: "emailengine:acc_1:message_upserted:msg_1",
                raw_payload: { event: "messageNew" },
                received_at: "2026-06-12T09:00:00.000Z",
              },
            ],
          };
        }

        if (text.includes("INSERT INTO sync_jobs")) {
          return { rows: [] };
        }

        return { rows: [] };
      },
    };

    const store = createPostgresMailEngineIngestStore(client);
    const result = await store.ingestWebhook({
      events: [event],
      rawPayload: { event: "messageNew" },
    });

    expect(result.duplicateCount).toBe(1);
    expect(result.events[0]).toMatchObject({
      id: "event_1",
      duplicate: true,
      resourceKey: "emailengine:acc_1:emailId:stable_email_1",
      resourceIdentity: {
        emailengineEmailId: "stable_email_1",
      },
    });
    expect(result.syncJobs).toEqual([]);
    expect(queries.some((query) => query.text.includes("INSERT INTO sync_jobs"))).toBe(
      true,
    );
  });

  it("repairs a missing sync job when EmailEngine retries an already stored event", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });

        if (text.includes("INSERT INTO mail_engine_events")) {
          return { rows: [] };
        }

        if (text.includes("FROM mail_engine_events")) {
          return {
            rows: [
              {
                id: "event_1",
                source: "emailengine_webhook",
                kind: "message_upserted",
                account_id: "acc_1",
                mailbox_id: "INBOX",
                provider_message_id: "msg_1",
                provider_thread_id: "thread_1",
                provider_email_id: "stable_email_1",
                rfc_message_id: "<message-1@example.com>",
                provider_uid: "12345",
                provider_path: "INBOX",
                resource_key: "emailengine:acc_1:emailId:stable_email_1",
                resource_identity: {
                  emailengineMessageId: "msg_1",
                  emailengineEmailId: "stable_email_1",
                  internetMessageId: "<message-1@example.com>",
                  imapUid: "12345",
                  mailboxPath: "INBOX",
                  threadId: "thread_1",
                  resourceKey: "emailengine:acc_1:emailId:stable_email_1",
                },
                idempotency_key: "emailengine:acc_1:message_upserted:msg_1",
                raw_payload: { event: "messageNew" },
                received_at: "2026-06-12T09:00:00.000Z",
              },
            ],
          };
        }

        if (text.includes("INSERT INTO sync_jobs")) {
          return {
            rows: [
              {
                id: "job_repaired",
                job_type: "sync_account",
                account_id: "acc_1",
                mailbox_id: "INBOX",
                trigger_event_id: "event_1",
                status: "queued",
                idempotency_key: "job:emailengine:acc_1:message_upserted:msg_1",
                created_at: "2026-06-12T09:00:01.000Z",
              },
            ],
          };
        }

        return { rows: [] };
      },
    };

    const store = createPostgresMailEngineIngestStore(client);
    const result = await store.ingestWebhook({
      events: [event],
      rawPayload: { event: "messageNew" },
    });

    expect(result.duplicateCount).toBe(1);
    expect(result.events[0]).toMatchObject({
      id: "event_1",
      duplicate: true,
    });
    expect(result.syncJobs).toEqual([
      {
        id: "job_repaired",
        jobType: "sync_account",
        accountId: "acc_1",
        mailboxId: "INBOX",
        triggerEventId: "event_1",
        status: "queued",
        idempotencyKey: "job:emailengine:acc_1:message_upserted:msg_1",
        createdAt: "2026-06-12T09:00:01.000Z",
      },
    ]);
  });
});
