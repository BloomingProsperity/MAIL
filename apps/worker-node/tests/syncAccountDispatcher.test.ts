import { describe, expect, it, vi } from "vitest";

import { createSyncAccountDispatcher } from "../src/sync-account-dispatcher";
import { NonRetryableQueueError } from "../src/queue-errors";
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

describe("sync account dispatcher", () => {
  it("no-ops non sync_account jobs without reading account settings", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn(),
    };
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = { syncAccount: vi.fn() };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      jobType: "import_accounts",
    });

    expect(accountSettingsStore.getAccountSyncPlan).not.toHaveBeenCalled();
    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
  });

  it("routes account_state jobs to the account state handler without reading sync plans", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn(),
    };
    const accountStateHandler = vi.fn().mockResolvedValue(undefined);
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = { syncAccount: vi.fn() };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      accountStateHandler,
      emailEngineHandler,
      nativeSyncProcessor,
    });
    const job = {
      ...baseJob,
      jobType: "account_state" as const,
      payload: { kind: "auth_failed" },
    };

    await dispatcher(job);

    expect(accountSettingsStore.getAccountSyncPlan).not.toHaveBeenCalled();
    expect(accountStateHandler).toHaveBeenCalledWith(job);
    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
  });

  it("no-ops unknown provider notifications before reading account settings", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn(),
    };
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = { syncAccount: vi.fn() };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      accountId: undefined,
      payload: { kind: "unknown_notification" },
    });

    expect(accountSettingsStore.getAccountSyncPlan).not.toHaveBeenCalled();
    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
  });

  it("throws when a real sync_account job is missing accountId", async () => {
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: { getAccountSyncPlan: vi.fn() },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor: { syncAccount: vi.fn() },
    });

    const rejected = dispatcher({
      ...baseJob,
      accountId: undefined,
      payload: { kind: "message_upserted", providerMessageId: "msg_1" },
    });

    await expect(rejected).rejects.toBeInstanceOf(NonRetryableQueueError);
    await expect(
      dispatcher({
        ...baseJob,
        accountId: undefined,
        payload: { kind: "message_upserted", providerMessageId: "msg_1" },
      }),
    ).rejects.toThrow("sync_account job job_1 is missing accountId");
  });

  it("routes EmailEngine accounts to the EmailEngine handler exactly once", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn().mockResolvedValue({
        accountId: "acc_1",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        engineProvider: "emailengine",
        capabilities: {},
        settings: {},
      }),
    };
    const emailEngineHandler = vi.fn().mockResolvedValue(undefined);
    const nativeSyncProcessor = { syncAccount: vi.fn() };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      payload: { kind: "message_upserted", providerMessageId: "msg_1" },
    });

    expect(accountSettingsStore.getAccountSyncPlan).toHaveBeenCalledWith("acc_1");
    expect(emailEngineHandler).toHaveBeenCalledTimes(1);
    expect(emailEngineHandler).toHaveBeenCalledWith({
      ...baseJob,
      payload: { kind: "message_upserted", providerMessageId: "msg_1" },
    });
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
  });

  it("skips paused accounts without calling provider handlers", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn().mockResolvedValue({
        accountId: "acc_1",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        engineProvider: "emailengine",
        syncState: "paused",
        capabilities: {},
        settings: {},
      }),
    };
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = { syncAccount: vi.fn() };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
    });

    await dispatcher(baseJob);

    expect(accountSettingsStore.getAccountSyncPlan).toHaveBeenCalledWith("acc_1");
    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
  });

  it("routes native Gmail accounts to the native sync processor with payload limit", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn().mockResolvedValue({
        accountId: "acc_1",
        email: "me@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        engineProvider: "native",
        nativeProvider: "gmail",
        capabilities: { read: true },
        settings: { syncMode: "history" },
      }),
    };
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = {
      syncAccount: vi.fn().mockResolvedValue({
        provider: "gmail",
        accountId: "acc_1",
        changeCount: 2,
        cursorAdvanced: true,
        hasMore: false,
      }),
    };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      payload: { kind: "manual_resync", limit: 25 },
    });

    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "gmail",
      limit: 25,
    });
  });

  it("blocks native sync when the Native Engine is paused", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn().mockResolvedValue({
        accountId: "acc_1",
        email: "me@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        engineProvider: "native",
        nativeProvider: "gmail",
        capabilities: { read: true },
        settings: { syncMode: "history" },
      }),
    };
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = {
      syncAccount: vi.fn(),
      discoverMailboxes: vi.fn(),
    };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
      nativeEngineEnabled: false,
    });

    const rejected = dispatcher(baseJob);
    await expect(rejected).rejects.toBeInstanceOf(NonRetryableQueueError);
    await expect(rejected).rejects.toThrow(
      "Native Engine is paused for EmailEngine-first launch",
    );
    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.discoverMailboxes).not.toHaveBeenCalled();
  });

  it("passes native continuation payloads to the native sync processor", async () => {
    const nativeSyncProcessor = {
      syncAccount: vi.fn().mockResolvedValue({
        provider: "gmail",
        accountId: "acc_1",
        changeCount: 1,
        cursorAdvanced: false,
        hasMore: false,
      }),
    };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          engineProvider: "native",
          nativeProvider: "gmail",
          capabilities: { read: true },
          settings: {},
        }),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      payload: {
        kind: "native_continuation",
        limit: 25,
        continuation: {
          provider: "gmail",
          mode: "history",
          startHistoryId: "900",
          pageToken: "page-2",
        },
      },
    });

    expect(nativeSyncProcessor.syncAccount).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "gmail",
      limit: 25,
      continuation: {
        provider: "gmail",
        mode: "history",
        startHistoryId: "900",
        pageToken: "page-2",
      },
    });
  });

  it("enqueues a native continuation sync job when the processor returns one", async () => {
    const enqueueJob = vi.fn().mockResolvedValue({
      id: "job_next",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "native-continuation:acc_1:gmail:hash",
      status: "queued",
      attempts: 0,
      maxAttempts: 8,
      notBefore: "2026-06-12T09:00:00.000Z",
      payload: {},
      createdAt: "2026-06-12T09:00:00.000Z",
      updatedAt: "2026-06-12T09:00:00.000Z",
    });
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          engineProvider: "native",
          nativeProvider: "gmail",
          capabilities: { read: true },
          settings: {},
        }),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor: {
        syncAccount: vi.fn().mockResolvedValue({
          provider: "gmail",
          accountId: "acc_1",
          changeCount: 1,
          cursorAdvanced: false,
          hasMore: true,
          continuation: {
            provider: "gmail",
            mode: "history",
            startHistoryId: "900",
            pageToken: "page-2",
          },
        }),
      },
      continuationQueue: { enqueueJob },
      createId: () => "job_next",
      now: () => new Date("2026-06-12T09:00:00.000Z"),
    });

    await dispatcher({
      ...baseJob,
      payload: { kind: "manual_resync", limit: 25 },
    });

    expect(enqueueJob).toHaveBeenCalledWith({
      id: "job_next",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: expect.stringMatching(
        /^native-continuation:acc_1:gmail:/,
      ),
      maxAttempts: 8,
      notBefore: "2026-06-12T09:00:00.000Z",
      payload: {
        kind: "native_continuation",
        limit: 25,
        continuation: {
          provider: "gmail",
          mode: "history",
          startHistoryId: "900",
          pageToken: "page-2",
        },
      },
    });
  });

  it("routes Outlook accounts to the Graph native sync processor", async () => {
    const accountSettingsStore = {
      getAccountSyncPlan: vi.fn().mockResolvedValue({
        accountId: "acc_1",
        email: "me@outlook.com",
        provider: "outlook",
        authMethod: "oauth",
        engineProvider: "native",
        nativeProvider: "graph",
        capabilities: { read: true },
        settings: { syncMode: "delta" },
      }),
    };
    const emailEngineHandler = vi.fn();
    const nativeSyncProcessor = {
      syncAccount: vi.fn().mockResolvedValue({
        provider: "graph",
        accountId: "acc_1",
        changeCount: 1,
        cursorAdvanced: true,
        hasMore: false,
      }),
    };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore,
      emailEngineHandler,
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      payload: { kind: "manual_resync", limit: 50 },
    });

    expect(emailEngineHandler).not.toHaveBeenCalled();
    expect(nativeSyncProcessor.syncAccount).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "graph",
      limit: 50,
    });
  });

  it("routes native folder sync payloads to the native sync processor", async () => {
    const nativeSyncProcessor = {
      syncAccount: vi.fn().mockResolvedValue({
        provider: "graph",
        accountId: "acc_1",
        changeCount: 0,
        cursorAdvanced: false,
        hasMore: false,
      }),
    };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@outlook.com",
          provider: "outlook",
          authMethod: "oauth",
          engineProvider: "native",
          nativeProvider: "graph",
          capabilities: { read: true },
          settings: {},
        }),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor,
    });

    await dispatcher({
      ...baseJob,
      payload: {
        kind: "folder_resync",
        limit: 50,
        mailbox: {
          provider: "graph",
          folderId: "folder_archive",
        },
      },
    });

    expect(nativeSyncProcessor.syncAccount).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "graph",
      mailbox: {
        provider: "graph",
        folderId: "folder_archive",
      },
      limit: 50,
    });
  });

  it("discovers native folders and enqueues one folder resync job per mailbox", async () => {
    let id = 0;
    const enqueueJob = vi.fn().mockResolvedValue({
      id: "queued_job",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: "native-folder-sync:acc_1:graph:hash",
      status: "queued",
      attempts: 0,
      maxAttempts: 8,
      notBefore: "2026-06-12T09:00:00.000Z",
      payload: {},
      createdAt: "2026-06-12T09:00:00.000Z",
      updatedAt: "2026-06-12T09:00:00.000Z",
    });
    const nativeSyncProcessor = {
      syncAccount: vi.fn(),
      discoverMailboxes: vi.fn().mockResolvedValue({
        provider: "graph",
        accountId: "acc_1",
        mailboxCount: 2,
        mailboxes: [
          {
            identity: { provider: "graph", folderId: "inbox" },
            displayName: "Inbox",
            role: "inbox",
          },
          {
            identity: { provider: "graph", folderId: "archive" },
            displayName: "Archive",
            role: "archive",
          },
        ],
      }),
    };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@outlook.com",
          provider: "outlook",
          authMethod: "oauth",
          engineProvider: "native",
          nativeProvider: "graph",
          capabilities: { read: true },
          settings: {},
        }),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor,
      continuationQueue: { enqueueJob },
      createId: () => `folder_job_${++id}`,
      now: () => new Date("2026-06-12T09:00:00.000Z"),
    });

    await dispatcher({
      ...baseJob,
      payload: { kind: "native_folder_discovery", limit: 50 },
    });

    expect(nativeSyncProcessor.discoverMailboxes).toHaveBeenCalledWith({
      accountId: "acc_1",
      provider: "graph",
    });
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
    expect(enqueueJob).toHaveBeenCalledTimes(2);
    expect(enqueueJob).toHaveBeenNthCalledWith(1, {
      id: "folder_job_1",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: expect.stringMatching(
        /^native-folder-sync:acc_1:graph:/,
      ),
      maxAttempts: 8,
      notBefore: "2026-06-12T09:00:00.000Z",
      payload: {
        kind: "folder_resync",
        limit: 50,
        mailbox: { provider: "graph", folderId: "inbox" },
      },
    });
    expect(enqueueJob).toHaveBeenNthCalledWith(2, {
      id: "folder_job_2",
      jobType: "sync_account",
      accountId: "acc_1",
      idempotencyKey: expect.stringMatching(
        /^native-folder-sync:acc_1:graph:/,
      ),
      maxAttempts: 8,
      notBefore: "2026-06-12T09:00:00.000Z",
      payload: {
        kind: "folder_resync",
        limit: 50,
        mailbox: { provider: "graph", folderId: "archive" },
      },
    });
  });

  it("rejects native accounts without a nativeProvider instead of falling back silently", async () => {
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          engineProvider: "native",
          capabilities: {},
          settings: {},
        }),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor: { syncAccount: vi.fn() },
    });

    const rejected = dispatcher(baseJob);

    await expect(rejected).rejects.toBeInstanceOf(NonRetryableQueueError);
    await expect(dispatcher(baseJob)).rejects.toThrow(
      "native account acc_1 is missing nativeProvider",
    );
  });

  it("rejects native provider conflicts instead of running the wrong adapter", async () => {
    const nativeSyncProcessor = { syncAccount: vi.fn() };
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue({
          accountId: "acc_1",
          email: "me@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          engineProvider: "native",
          nativeProvider: "imap",
          capabilities: {},
          settings: {},
        }),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor,
    });

    const rejected = dispatcher(baseJob);

    await expect(rejected).rejects.toBeInstanceOf(NonRetryableQueueError);
    await expect(dispatcher(baseJob)).rejects.toThrow(
      "native provider conflict for acc_1: account provider gmail cannot use imap",
    );
    expect(nativeSyncProcessor.syncAccount).not.toHaveBeenCalled();
  });

  it("rejects sync jobs whose connected account cannot be found", async () => {
    const dispatcher = createSyncAccountDispatcher({
      accountSettingsStore: {
        getAccountSyncPlan: vi.fn().mockResolvedValue(undefined),
      },
      emailEngineHandler: vi.fn(),
      nativeSyncProcessor: { syncAccount: vi.fn() },
    });

    const rejected = dispatcher(baseJob);

    await expect(rejected).rejects.toBeInstanceOf(NonRetryableQueueError);
    await expect(dispatcher(baseJob)).rejects.toThrow(
      "connected account not found for sync job: acc_1",
    );
  });
});
