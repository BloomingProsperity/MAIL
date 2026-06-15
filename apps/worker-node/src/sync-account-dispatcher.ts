import { createHash, randomUUID } from "node:crypto";

import type {
  AccountProviderSettingsStore,
  AccountSyncPlan,
} from "./account-provider-settings-store.js";
import type {
  ProviderMailbox,
  NativeProvider,
  ProviderMailboxIdentity,
  ProviderSyncContinuation,
} from "./mail-provider/contract.js";
import type {
  NativeSyncAccountResult,
  NativeSyncProcessor,
} from "./mail-provider/native-sync-processor.js";
import { NonRetryableQueueError } from "./queue-errors.js";
import type { EnqueueJobInput, SyncJobRecord } from "./sync-job-queue.js";

export type SyncAccountJobHandler = (job: SyncJobRecord) => Promise<void>;

export interface CreateSyncAccountDispatcherInput {
  accountSettingsStore: AccountProviderSettingsStore;
  accountStateHandler?: SyncAccountJobHandler;
  emailEngineHandler: SyncAccountJobHandler;
  nativeSyncProcessor: NativeSyncProcessor;
  continuationQueue?: {
    enqueueJob(input: EnqueueJobInput): Promise<SyncJobRecord>;
  };
  createId?: () => string;
  now?: () => Date;
}

type SyncJobPayload = {
  kind?: string;
  limit?: number;
  mailbox?: ProviderMailboxIdentity;
  continuation?: ProviderSyncContinuation;
};

export function createSyncAccountDispatcher(
  input: CreateSyncAccountDispatcherInput,
): SyncAccountJobHandler {
  return async (job) => {
    if (job.jobType === "account_state") {
      await input.accountStateHandler?.(job);
      return;
    }

    if (job.jobType !== "sync_account") {
      return;
    }

    const payload = asPayload(job.payload);
    if (payload.kind === "unknown_notification") {
      return;
    }

    if (!job.accountId) {
      throw new NonRetryableQueueError(
        `sync_account job ${job.id} is missing accountId`,
      );
    }

    const plan = await input.accountSettingsStore.getAccountSyncPlan(
      job.accountId,
    );
    if (!plan) {
      throw new NonRetryableQueueError(
        `connected account not found for sync job: ${job.accountId}`,
      );
    }

    if (plan.syncState === "paused") {
      return;
    }

    if (plan.engineProvider === "emailengine") {
      await input.emailEngineHandler(job);
      return;
    }

    await syncNativeAccount({
      nativeSyncProcessor: input.nativeSyncProcessor,
      continuationQueue: input.continuationQueue,
      createId: input.createId,
      now: input.now,
      job,
      plan,
      payload,
    });
  };
}

async function syncNativeAccount(input: {
  nativeSyncProcessor: NativeSyncProcessor;
  continuationQueue?: {
    enqueueJob(input: EnqueueJobInput): Promise<SyncJobRecord>;
  };
  createId?: () => string;
  now?: () => Date;
  job: SyncJobRecord;
  plan: AccountSyncPlan;
  payload: SyncJobPayload;
}): Promise<void> {
  if (!input.plan.nativeProvider) {
    throw new NonRetryableQueueError(
      `native account ${input.job.accountId} is missing nativeProvider`,
    );
  }

  if (
    !canAccountProviderUseNativeProvider(
      input.plan.provider,
    input.plan.nativeProvider,
    )
  ) {
    throw new NonRetryableQueueError(
      `native provider conflict for ${input.job.accountId}: account provider ${input.plan.provider} cannot use ${input.plan.nativeProvider}`,
    );
  }

  if (input.payload.kind === "native_folder_discovery") {
    const result = await input.nativeSyncProcessor.discoverMailboxes({
      accountId: input.job.accountId!,
      provider: input.plan.nativeProvider as NativeProvider,
    });

    await enqueueFolderResyncJobs({
      dispatcher: input,
      mailboxes: result.mailboxes,
    });
    return;
  }

  const result = await input.nativeSyncProcessor.syncAccount({
    accountId: input.job.accountId!,
    provider: input.plan.nativeProvider as NativeProvider,
    ...(input.payload.mailbox
      ? { mailbox: providerMailboxPayload(input.payload.mailbox) }
      : {}),
    ...(Number.isInteger(input.payload.limit) && input.payload.limit! > 0
      ? { limit: input.payload.limit }
      : {}),
    ...(input.payload.continuation
      ? { continuation: input.payload.continuation }
      : {}),
  });

  if (result.continuation) {
    await enqueueContinuation({
      dispatcher: input,
      result,
    });
  }
}

async function enqueueFolderResyncJobs(input: {
  dispatcher: {
    continuationQueue?: {
      enqueueJob(input: EnqueueJobInput): Promise<SyncJobRecord>;
    };
    createId?: () => string;
    now?: () => Date;
    job: SyncJobRecord;
    payload: SyncJobPayload;
    plan: AccountSyncPlan;
  };
  mailboxes: ProviderMailbox[];
}): Promise<void> {
  const queue = input.dispatcher.continuationQueue;
  if (!queue) {
    return;
  }

  const nativeProvider = input.dispatcher.plan.nativeProvider as NativeProvider;
  for (const mailbox of input.mailboxes) {
    const folderPayload = {
      kind: "folder_resync",
      ...(Number.isInteger(input.dispatcher.payload.limit) &&
      input.dispatcher.payload.limit! > 0
        ? { limit: input.dispatcher.payload.limit }
        : {}),
      mailbox: mailbox.identity,
    };

    await queue.enqueueJob({
      id: input.dispatcher.createId?.() ?? randomUUID(),
      jobType: "sync_account",
      accountId: input.dispatcher.job.accountId,
      idempotencyKey: [
        "native-folder-sync",
        input.dispatcher.job.accountId,
        nativeProvider,
        stableHash(folderPayload),
      ].join(":"),
      maxAttempts: input.dispatcher.job.maxAttempts,
      notBefore: (input.dispatcher.now?.() ?? new Date()).toISOString(),
      payload: folderPayload,
    });
  }
}

function providerMailboxPayload(
  value: ProviderMailboxIdentity,
): ProviderMailboxIdentity {
  return value;
}

function canAccountProviderUseNativeProvider(
  accountProvider: string,
  nativeProvider: string,
): boolean {
  return (
    (accountProvider === "gmail" && nativeProvider === "gmail") ||
    (accountProvider === "outlook" && nativeProvider === "graph") ||
    (accountProvider === "imap" && nativeProvider === "imap")
  );
}

function asPayload(value: unknown): SyncJobPayload {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SyncJobPayload;
  }

  return {};
}

async function enqueueContinuation(input: {
  dispatcher: {
    continuationQueue?: {
      enqueueJob(input: EnqueueJobInput): Promise<SyncJobRecord>;
    };
    createId?: () => string;
    now?: () => Date;
    job: SyncJobRecord;
    payload: SyncJobPayload;
    plan: AccountSyncPlan;
  };
  result: NativeSyncAccountResult;
}): Promise<void> {
  const queue = input.dispatcher.continuationQueue;
  if (!queue) {
    return;
  }

  const nativeProvider = input.dispatcher.plan.nativeProvider as NativeProvider;
  const continuationPayload = {
    kind: "native_continuation",
    ...(Number.isInteger(input.dispatcher.payload.limit) &&
    input.dispatcher.payload.limit! > 0
      ? { limit: input.dispatcher.payload.limit }
      : {}),
    continuation: input.result.continuation!,
  };

  await queue.enqueueJob({
    id: input.dispatcher.createId?.() ?? randomUUID(),
    jobType: "sync_account",
    accountId: input.dispatcher.job.accountId,
    idempotencyKey: [
      "native-continuation",
      input.dispatcher.job.accountId,
      nativeProvider,
      stableHash(continuationPayload),
    ].join(":"),
    maxAttempts: input.dispatcher.job.maxAttempts,
    notBefore: (input.dispatcher.now?.() ?? new Date()).toISOString(),
    payload: continuationPayload,
  });
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}
