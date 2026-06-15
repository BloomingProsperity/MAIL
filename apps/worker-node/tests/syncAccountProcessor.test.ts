import { describe, expect, it, vi } from "vitest";

import { createSyncAccountJobHandler } from "../src/mail-engine/sync-account-processor";
import type { SyncJobRecord } from "../src/sync-job-queue";

const baseJob: SyncJobRecord = {
  id: "job_1",
  jobType: "sync_account",
  accountId: "acc_1",
  triggerEventId: "event_1",
  idempotencyKey: "job:event_1",
  status: "running",
  attempts: 1,
  maxAttempts: 8,
  notBefore: "2026-06-12T09:00:00.000Z",
  payload: {},
  createdAt: "2026-06-12T09:00:00.000Z",
  updatedAt: "2026-06-12T09:00:00.000Z",
};

describe("sync account processor", () => {
  it("bootstraps mailbox message pages and queues follow-up cursors", async () => {
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([
        { path: "INBOX", name: "Inbox" },
        { path: "Sent", name: "Sent" },
      ]),
      listMessages: vi
        .fn()
        .mockResolvedValueOnce({
          messages: [
            { id: "msg_inbox_1", subject: "Inbox one", path: "INBOX" },
            { id: "msg_inbox_2", subject: "Inbox two", path: "INBOX" },
          ],
          nextPageCursor: "cursor-inbox-2",
        })
        .mockResolvedValueOnce({
          messages: [{ id: "msg_sent_1", subject: "Sent one", path: "Sent" }],
        }),
      getMessage: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      recordMessageDeleted: vi.fn(),
    };
    const continuationQueue = {
      enqueueJob: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createSyncAccountJobHandler({
      emailEngine,
      mirrorStore,
      continuationQueue,
      createId: () => "job_continue_1",
      now: () => new Date("2026-06-12T09:01:00.000Z"),
    });

    await handler({
      ...baseJob,
      payload: { kind: "initial_bootstrap" },
    });

    expect(emailEngine.listMessages).toHaveBeenCalledWith({
      accountId: "acc_1",
      path: "INBOX",
      pageSize: 50,
    });
    expect(emailEngine.listMessages).toHaveBeenCalledWith({
      accountId: "acc_1",
      path: "Sent",
      pageSize: 50,
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_inbox_1", subject: "Inbox one", path: "INBOX" },
      mailboxPath: "INBOX",
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_inbox_2", subject: "Inbox two", path: "INBOX" },
      mailboxPath: "INBOX",
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_sent_1", subject: "Sent one", path: "Sent" },
      mailboxPath: "Sent",
    });
    expect(continuationQueue.enqueueJob).toHaveBeenCalledWith({
      id: "job_continue_1",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey:
        "emailengine-continuation:acc_1:INBOX:cursor-inbox-2:50",
      maxAttempts: 8,
      notBefore: "2026-06-12T09:01:00.000Z",
      payload: {
        kind: "emailengine_mailbox_continuation",
        mailboxPath: "INBOX",
        cursor: "cursor-inbox-2",
        pageSize: 50,
      },
    });
    expect(emailEngine.getMessage).not.toHaveBeenCalled();
  });

  it("runs mailbox page bootstrap for manual resync jobs", async () => {
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([{ path: "INBOX", name: "Inbox" }]),
      listMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "msg_manual_1", subject: "Manual resync", path: "INBOX" }],
      }),
      getMessage: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      recordMessageDeleted: vi.fn(),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: { kind: "manual_resync", limit: 25 },
    });

    expect(emailEngine.listMessages).toHaveBeenCalledWith({
      accountId: "acc_1",
      path: "INBOX",
      pageSize: 25,
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_manual_1", subject: "Manual resync", path: "INBOX" },
      mailboxPath: "INBOX",
    });
    expect(emailEngine.getMessage).not.toHaveBeenCalled();
  });

  it("continues an EmailEngine mailbox page from a cursor", async () => {
    const emailEngine = {
      listMailboxes: vi.fn(),
      listMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "msg_3", subject: "Page two", path: "INBOX" }],
        nextPageCursor: "cursor-inbox-3",
      }),
      getMessage: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn(),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      recordMessageDeleted: vi.fn(),
    };
    const continuationQueue = {
      enqueueJob: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createSyncAccountJobHandler({
      emailEngine,
      mirrorStore,
      continuationQueue,
      createId: () => "job_continue_2",
      now: () => new Date("2026-06-12T09:02:00.000Z"),
    });

    await handler({
      ...baseJob,
      payload: {
        kind: "emailengine_mailbox_continuation",
        mailboxPath: "INBOX",
        cursor: "cursor-inbox-2",
        pageSize: 25,
      },
    });

    expect(emailEngine.listMailboxes).not.toHaveBeenCalled();
    expect(emailEngine.listMessages).toHaveBeenCalledWith({
      accountId: "acc_1",
      path: "INBOX",
      cursor: "cursor-inbox-2",
      pageSize: 25,
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_3", subject: "Page two", path: "INBOX" },
      mailboxPath: "INBOX",
    });
    expect(continuationQueue.enqueueJob).toHaveBeenCalledWith({
      id: "job_continue_2",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey:
        "emailengine-continuation:acc_1:INBOX:cursor-inbox-3:25",
      maxAttempts: 8,
      notBefore: "2026-06-12T09:02:00.000Z",
      payload: {
        kind: "emailengine_mailbox_continuation",
        mailboxPath: "INBOX",
        cursor: "cursor-inbox-3",
        pageSize: 25,
      },
    });
  });

  it("mirrors mailboxes before handling a message_upserted job", async () => {
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([{ path: "INBOX", name: "Inbox" }]),
      getMessage: vi.fn().mockResolvedValue({ id: "msg_1", subject: "Hello" }),
      listMessages: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      recordMessageDeleted: vi.fn(),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: { kind: "message_upserted", providerMessageId: "msg_1" },
    });

    expect(emailEngine.listMailboxes).toHaveBeenCalledWith("acc_1");
    expect(mirrorStore.upsertMailboxes).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      mailboxes: [{ path: "INBOX", name: "Inbox" }],
    });
    expect(emailEngine.getMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "msg_1",
      textType: "*",
      markAsSeen: false,
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_1", subject: "Hello" },
    });
  });

  it("records a tombstone for message_deleted without fetching message", async () => {
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([]),
      getMessage: vi.fn(),
      listMessages: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn(),
      recordMessageDeleted: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: { kind: "message_deleted", providerMessageId: "msg_1" },
    });

    expect(emailEngine.getMessage).not.toHaveBeenCalled();
    expect(mirrorStore.recordMessageDeleted).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      providerMessageId: "msg_1",
      deletedAt: expect.any(String),
      idempotencyKey: "delete:acc_1:msg_1",
    });
  });

  it("uses resourceIdentity.emailengineMessageId as the EmailEngine API locator", async () => {
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([]),
      getMessage: vi.fn().mockResolvedValue({ id: "msg_2", subject: "Hello" }),
      listMessages: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      recordMessageDeleted: vi.fn(),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: {
        kind: "message_upserted",
        resourceIdentity: {
          emailengineMessageId: "msg_2",
          internetMessageId: "<rfc-message@example.com>",
          mailboxPath: "INBOX",
        },
      },
    });

    expect(emailEngine.getMessage).toHaveBeenCalledWith({
      accountId: "acc_1",
      messageId: "msg_2",
      textType: "*",
      markAsSeen: false,
    });
    expect(mirrorStore.upsertMessage).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      message: { id: "msg_2", subject: "Hello" },
      mailboxPath: "INBOX",
    });
  });

  it("treats a missing message_upserted fetch as a folder deletion instead of retrying forever", async () => {
    const notFound = new Error("EmailEngine request failed: 404 Not Found");
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([{ path: "INBOX", name: "Inbox" }]),
      getMessage: vi.fn().mockRejectedValue(notFound),
      listMessages: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      recordMessageDeleted: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: {
        kind: "message_upserted",
        providerMessageId: "msg_raced",
        providerPath: "INBOX",
      },
    });

    expect(mirrorStore.upsertMessage).not.toHaveBeenCalled();
    expect(mirrorStore.recordMessageDeleted).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      providerMessageId: "msg_raced",
      mailboxPath: "INBOX",
      deletedAt: expect.any(String),
      idempotencyKey: "delete:acc_1:msg_raced",
    });
  });

  it("uses resourceIdentity.emailengineMessageId for delete tombstone idempotency", async () => {
    const emailEngine = {
      listMailboxes: vi.fn().mockResolvedValue([]),
      getMessage: vi.fn(),
      listMessages: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn(),
      recordMessageDeleted: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: {
        kind: "message_deleted",
        resourceIdentity: {
          emailengineMessageId: "msg_2",
          internetMessageId: "<rfc-message@example.com>",
          mailboxPath: "INBOX",
        },
      },
    });

    expect(emailEngine.getMessage).not.toHaveBeenCalled();
    expect(mirrorStore.recordMessageDeleted).toHaveBeenCalledWith({
      engineAccountId: "acc_1",
      provider: "emailengine",
      providerMessageId: "msg_2",
      mailboxPath: "INBOX",
      deletedAt: expect.any(String),
      idempotencyKey: "delete:acc_1:msg_2",
    });
  });

  it("no-ops unknown_notification sync jobs", async () => {
    const emailEngine = {
      listMailboxes: vi.fn(),
      getMessage: vi.fn(),
      listMessages: vi.fn(),
    };
    const mirrorStore = {
      upsertMailboxes: vi.fn(),
      upsertMessage: vi.fn(),
      recordMessageDeleted: vi.fn(),
    };
    const handler = createSyncAccountJobHandler({ emailEngine, mirrorStore });

    await handler({
      ...baseJob,
      payload: { kind: "unknown_notification" },
    });

    expect(emailEngine.listMailboxes).not.toHaveBeenCalled();
    expect(mirrorStore.upsertMailboxes).not.toHaveBeenCalled();
  });
});
