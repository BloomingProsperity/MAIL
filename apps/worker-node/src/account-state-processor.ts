import { NonRetryableQueueError } from "./queue-errors.js";
import type { OperationalEventRecorder } from "./logging/operational-events.js";
import type { SyncJobRecord } from "./sync-job-queue.js";

export interface AccountStateStore {
  markAccountReauthRequired(input: {
    accountId: string;
    reason: AccountRecoveryReason;
    at: string;
  }): Promise<{ taskId?: string }>;
  markAccountSyncing(input: {
    accountId: string;
    at: string;
  }): Promise<void>;
}

export interface CreateAccountStateJobHandlerInput {
  store: AccountStateStore;
  diagnostics?: OperationalEventRecorder;
  now?: () => Date;
}

export type AccountStateJobHandler = (job: SyncJobRecord) => Promise<void>;

type AccountStatePayload = {
  kind?: string;
};

export type AccountStateSuccessReason = "auth_succeeded";

export type AccountRecoveryReason =
  | "auth_failed"
  | "sync_failed"
  | "account_deleted";

export function createAccountStateJobHandler(
  input: CreateAccountStateJobHandlerInput,
): AccountStateJobHandler {
  return async (job) => {
    if (job.jobType !== "account_state") {
      return;
    }

    if (!job.accountId) {
      throw new NonRetryableQueueError(
        `account_state job ${job.id} is missing accountId`,
      );
    }

    const payload = asPayload(job.payload);
    const successReason = syncReason(payload);
    if (successReason) {
      await input.store.markAccountSyncing({
        accountId: job.accountId,
        at: (input.now?.() ?? new Date()).toISOString(),
      });

      await input.diagnostics?.record({
        service: "email-hub-worker",
        level: "info",
        event: "account_reauthorization_cleared",
        message: `Account ${job.accountId} returned to syncing after ${successReason}`,
        accountId: job.accountId,
        lane: "sync",
        jobId: job.id,
        context: {
          reason: successReason,
          ...(job.triggerEventId ? { triggerEventId: job.triggerEventId } : {}),
        },
      });
      return;
    }

    const reason = reauthReason(payload);
    if (!reason) {
      return;
    }

    const marker = await input.store.markAccountReauthRequired({
      accountId: job.accountId,
      reason,
      at: (input.now?.() ?? new Date()).toISOString(),
    });

    await input.diagnostics?.record({
      service: "email-hub-worker",
      level: "warn",
      event: "account_reauthorization_required",
      message: `Account ${job.accountId} requires reauthorization after ${reason}`,
      accountId: job.accountId,
      lane: "sync",
      jobId: job.id,
      context: {
        reason,
        ...(marker.taskId ? { taskId: marker.taskId } : {}),
        ...(job.triggerEventId ? { triggerEventId: job.triggerEventId } : {}),
      },
    });
  };
}

function reauthReason(payload: AccountStatePayload): AccountRecoveryReason | undefined {
  return isAccountRecoveryReason(payload.kind)
    ? payload.kind
    : undefined;
}

function syncReason(
  payload: AccountStatePayload,
): AccountStateSuccessReason | undefined {
  return payload.kind === "auth_succeeded" ? "auth_succeeded" : undefined;
}

function isAccountRecoveryReason(kind: unknown): kind is AccountRecoveryReason {
  return (
    kind === "auth_failed" ||
    kind === "sync_failed" ||
    kind === "account_deleted"
  );
}

function asPayload(value: unknown): AccountStatePayload {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AccountStatePayload;
  }

  return {};
}
