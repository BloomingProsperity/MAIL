export class InvalidSyncControlRequestError extends Error {
  readonly code = "invalid_sync_control_request";

  constructor(message = "invalid sync control request") {
    super(message);
  }
}

export type SyncControlAccountState = "syncing" | "reauth_required" | "paused";
export type SyncControlEngineProvider = "emailengine" | "native";
export type SyncControlAuthMethod = "password" | "oauth";

export interface SyncControlAccount {
  accountId: string;
  email: string;
  provider: string;
  authMethod: SyncControlAuthMethod;
  syncState: SyncControlAccountState;
  engineProvider: SyncControlEngineProvider;
}

export interface SyncControlJob {
  id: string;
  jobType: "sync_account";
  accountId: string;
  idempotencyKey: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
  createdAt: string;
}

export interface SyncControlStore {
  getAccount(accountId: string): Promise<SyncControlAccount | undefined>;
  enqueueManualSync(input: {
    account: SyncControlAccount;
    jobId: string;
    now: string;
  }): Promise<SyncControlJob>;
  pauseAccount(accountId: string): Promise<SyncControlAccount>;
  resumeAccount(accountId: string): Promise<SyncControlAccount>;
  retryFailedSync(input: {
    accountId: string;
    now: string;
  }): Promise<{
    accountId: string;
    retriedJobCount: number;
    retriedJobIds: string[];
  }>;
}

export interface SyncControlService {
  requestManualSync(input: { accountId: string }): Promise<{
    accountId: string;
    action: "manual_sync_queued";
    job: SyncControlJob;
  }>;
  pause(input: { accountId: string }): Promise<{
    accountId: string;
    action: "sync_paused";
    account: SyncControlAccount;
  }>;
  resume(input: { accountId: string }): Promise<{
    accountId: string;
    action: "sync_resumed";
    account: SyncControlAccount;
  }>;
  retryFailed(input: { accountId: string }): Promise<{
    accountId: string;
    action: "failed_sync_requeued";
    retriedJobCount: number;
    retriedJobIds: string[];
  }>;
}

export function createSyncControlService(options: {
  store: SyncControlStore;
  createId: () => string;
  now?: () => Date;
}): SyncControlService {
  return {
    async requestManualSync(input) {
      const account = await loadAccount(options.store, input.accountId);
      ensureSyncable(account);
      const job = await options.store.enqueueManualSync({
        account,
        jobId: options.createId(),
        now: currentIso(options.now),
      });

      return {
        accountId: account.accountId,
        action: "manual_sync_queued",
        job,
      };
    },

    async pause(input) {
      await loadAccount(options.store, input.accountId);
      const account = await options.store.pauseAccount(input.accountId);
      return {
        accountId: account.accountId,
        action: "sync_paused",
        account,
      };
    },

    async resume(input) {
      await loadAccount(options.store, input.accountId);
      const account = await options.store.resumeAccount(input.accountId);
      return {
        accountId: account.accountId,
        action: "sync_resumed",
        account,
      };
    },

    async retryFailed(input) {
      const account = await loadAccount(options.store, input.accountId);
      ensureSyncable(account);
      const result = await options.store.retryFailedSync({
        accountId: account.accountId,
        now: currentIso(options.now),
      });

      return {
        accountId: result.accountId,
        action: "failed_sync_requeued",
        retriedJobCount: result.retriedJobCount,
        retriedJobIds: result.retriedJobIds,
      };
    },
  };
}

async function loadAccount(
  store: SyncControlStore,
  accountId: string,
): Promise<SyncControlAccount> {
  if (!accountId.trim()) {
    throw new InvalidSyncControlRequestError();
  }

  const account = await store.getAccount(accountId);
  if (!account) {
    throw new InvalidSyncControlRequestError("account was not found");
  }

  return account;
}

function ensureSyncable(account: SyncControlAccount): void {
  if (account.syncState === "reauth_required") {
    throw new InvalidSyncControlRequestError("account requires reauthorization");
  }
  if (account.syncState === "paused") {
    throw new InvalidSyncControlRequestError("account sync is paused");
  }
}

function currentIso(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString();
}
