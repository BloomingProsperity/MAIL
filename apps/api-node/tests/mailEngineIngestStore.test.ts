import { describe, expect, it } from "vitest";

import { createInMemoryMailEngineIngestStore } from "../src/mail-engine/ingest-store";
import type { NormalizedMailEngineEvent } from "../src/mail-engine/webhook";

const event: NormalizedMailEngineEvent = {
  source: "emailengine_webhook",
  kind: "message_upserted",
  accountId: "acc_1",
  mailboxId: "INBOX",
  providerMessageId: "msg_1",
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
    resourceKey: "emailengine:acc_1:emailId:stable_email_1",
  },
  idempotencyKey: "emailengine:acc_1:message_upserted:msg_1",
};

describe("mail engine ingest store", () => {
  it("stores normalized webhook events and enqueues sync jobs", async () => {
    const store = createInMemoryMailEngineIngestStore();

    const result = await store.ingestWebhook({
      events: [event],
      rawPayload: { event: "messageNew" },
    });

    expect(result.duplicateCount).toBe(0);
    expect(result.events[0]).toMatchObject({
      kind: "message_upserted",
      accountId: "acc_1",
      providerMessageId: "msg_1",
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
        resourceKey: "emailengine:acc_1:emailId:stable_email_1",
      },
      duplicate: false,
    });
    expect(result.syncJobs[0]).toMatchObject({
      jobType: "sync_account",
      accountId: "acc_1",
      mailboxId: "INBOX",
      status: "queued",
      triggerEventId: result.events[0].id,
    });
    expect(store.listEvents()).toHaveLength(1);
    expect(store.listSyncJobs()).toHaveLength(1);
  });

  it("deduplicates repeated webhooks by idempotency key", async () => {
    const store = createInMemoryMailEngineIngestStore();

    const first = await store.ingestWebhook({
      events: [event],
      rawPayload: { event: "messageNew" },
    });
    const second = await store.ingestWebhook({
      events: [event],
      rawPayload: { event: "messageNew" },
    });

    expect(second.duplicateCount).toBe(1);
    expect(second.events[0]).toMatchObject({
      id: first.events[0].id,
      duplicate: true,
    });
    expect(second.syncJobs).toEqual([]);
    expect(store.listEvents()).toHaveLength(1);
    expect(store.listSyncJobs()).toHaveLength(1);
  });

  it("queues separate jobs for the same message when webhook event ids differ", async () => {
    const store = createInMemoryMailEngineIngestStore();
    const messageNew: NormalizedMailEngineEvent = {
      ...event,
      idempotencyKey: "emailengine:acc_1:event-id:evt_new",
    };
    const messageUpdated: NormalizedMailEngineEvent = {
      ...event,
      idempotencyKey: "emailengine:acc_1:event-id:evt_updated",
    };

    const first = await store.ingestWebhook({
      events: [messageNew],
      rawPayload: { event: "messageNew" },
    });
    const second = await store.ingestWebhook({
      events: [messageUpdated],
      rawPayload: { event: "messageUpdated" },
    });

    expect(first.duplicateCount).toBe(0);
    expect(second.duplicateCount).toBe(0);
    expect(store.listEvents()).toHaveLength(2);
    expect(store.listSyncJobs()).toHaveLength(2);
    expect(store.listSyncJobs().map((job) => job.idempotencyKey)).toEqual([
      "job:emailengine:acc_1:event-id:evt_new",
      "job:emailengine:acc_1:event-id:evt_updated",
    ]);
  });

  it("queues account deletion as account-state work instead of another mailbox sync", async () => {
    const store = createInMemoryMailEngineIngestStore();

    const result = await store.ingestWebhook({
      events: [
        {
          source: "emailengine_webhook",
          kind: "account_deleted",
          accountId: "acc_deleted",
          idempotencyKey: "emailengine:acc_deleted:event-id:evt_account_deleted",
        },
      ],
      rawPayload: { event: "accountDeleted" },
    });

    expect(result.events[0]).toMatchObject({
      kind: "account_deleted",
      accountId: "acc_deleted",
    });
    expect(result.syncJobs).toEqual([
      expect.objectContaining({
        jobType: "account_state",
        accountId: "acc_deleted",
        idempotencyKey: "job:emailengine:acc_deleted:event-id:evt_account_deleted",
        status: "queued",
      }),
    ]);
    expect(store.listSyncJobs()[0]).toMatchObject({
      jobType: "account_state",
    });
  });
});
