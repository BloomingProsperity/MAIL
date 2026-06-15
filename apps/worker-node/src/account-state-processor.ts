import { NonRetryableQueueError } from "./queue-errors.js";
import type { OperationalEventRecorder } from "./logging/operational-events.js";
import type { SyncJobRecord } from "./sync-job-queue.js";

export interface AccountStateStore {
  markAccountReauthRequired(input: {
    accountId: string;
    reason: "auth_failed" | "sync_failed";
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

    const reason = reauthReason(asPayload(job.payload));
    if (!reason) {
      return;
    }

    await input.store.markAccountReauthRequired({
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
        ...(job.triggerEventId ? { triggerEventId: job.triggerEventId } : {}),
      },
    });
  };
}

function reauthReason(
  payload: AccountStatePayload,
): "auth_failed" | "sync_failed" | undefined {
  return payload.kind === "auth_failed" || payload.kind === "sync_failed"
    ? payload.kind
    : undefined;
}

function asPayload(value: unknown): AccountStatePayload {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AccountStatePayload;
  }

  return {};
}
