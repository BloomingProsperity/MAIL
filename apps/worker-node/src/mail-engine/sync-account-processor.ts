import { randomUUID } from "node:crypto";

import { EmailEngineRequestError } from "./email-engine-client.js";
import type { EmailEngineClient } from "./email-engine-client.js";
import type { MirrorStore } from "./mirror-store.js";
import { NonRetryableQueueError } from "../queue-errors.js";
import type { EnqueueJobInput } from "../sync-job-queue.js";
import type { SyncJobRecord } from "../sync-job-queue.js";

export interface EmailEngineReauthorizationMarker {
  markAccountReauthRequired(input: {
    accountId: string;
    reason: "auth_failed";
    at: string;
  }): Promise<{ taskId?: string }>;
}

export interface CreateSyncAccountJobHandlerInput {
  emailEngine: EmailEngineClient;
  mirrorStore: MirrorStore;
  reauthorizationMarker?: EmailEngineReauthorizationMarker;
  continuationQueue?: {
    enqueueJob(input: EnqueueJobInput): Promise<SyncJobRecord>;
  };
  createId?: () => string;
  now?: () => Date;
}

export type SyncAccountJobHandler = (job: SyncJobRecord) => Promise<void>;

const DEFAULT_EMAILENGINE_PAGE_SIZE = 50;

type SyncJobPayload = {
  kind?: string;
  providerMessageId?: string;
  providerPath?: string;
  mailboxId?: string;
  mailboxPath?: string;
  cursor?: string;
  pageSize?: number;
  limit?: number;
  resourceIdentity?: {
    emailengineMessageId?: string;
    mailboxPath?: string;
  };
};

export function createSyncAccountJobHandler(
  input: CreateSyncAccountJobHandlerInput,
): SyncAccountJobHandler {
  return async (job) => {
    if (job.jobType !== "sync_account") {
      return;
    }

    if (!job.accountId) {
      throw new Error(`sync_account job ${job.id} is missing accountId`);
    }

    const payload = asPayload(job.payload);
    if (payload.kind === "unknown_notification") {
      return;
    }

    if (payload.kind === "emailengine_mailbox_continuation") {
      await syncMailboxPage({
        input,
        job,
        mailboxPath: mailboxPathFor(payload, job.mailboxId),
        cursor: payload.cursor,
        pageSize: pageSizeFor(payload),
      });
      return;
    }

    const mailboxes = await callEmailEngineOrMarkReauth({
      input,
      job,
      operation: "listMailboxes",
      call: () => input.emailEngine.listMailboxes(job.accountId!),
    });
    await input.mirrorStore.upsertMailboxes({
      engineAccountId: job.accountId,
      provider: "emailengine",
      mailboxes,
    });

    const emailengineMessageId = emailengineMessageIdFor(payload);
    const mailboxPath = mailboxPathFor(payload, job.mailboxId);

    if (isBootstrapPayload(payload, emailengineMessageId)) {
      await syncBootstrapMailboxPages({
        input,
        job,
        mailboxes,
        pageSize: pageSizeFor(payload),
      });
      return;
    }

    if (payload.kind === "message_deleted" && emailengineMessageId) {
      await input.mirrorStore.recordMessageDeleted({
        engineAccountId: job.accountId,
        provider: "emailengine",
        providerMessageId: emailengineMessageId,
        ...(mailboxPath ? { mailboxPath } : {}),
        deletedAt: new Date().toISOString(),
        idempotencyKey: `delete:${job.accountId}:${emailengineMessageId}`,
      });
      return;
    }

    if (emailengineMessageId) {
      const message = await getMessageOrRecordDeleted({
        input,
        job,
        accountId: job.accountId,
        messageId: emailengineMessageId,
        mailboxPath,
      });
      if (!message) {
        return;
      }

      await input.mirrorStore.upsertMessage({
        engineAccountId: job.accountId,
        provider: "emailengine",
        message,
        ...(mailboxPath ? { mailboxPath } : {}),
      });
    }
  };
}

async function getMessageOrRecordDeleted(input: {
  input: CreateSyncAccountJobHandlerInput;
  job: SyncJobRecord;
  accountId: string;
  messageId: string;
  mailboxPath?: string;
}): Promise<unknown | undefined> {
  try {
    return await callEmailEngineOrMarkReauth({
      input: input.input,
      job: input.job,
      operation: "getMessage",
      call: () =>
        input.input.emailEngine.getMessage({
          accountId: input.accountId,
          messageId: input.messageId,
          textType: "*",
          markAsSeen: false,
        }),
    });
  } catch (error) {
    if (!isEmailEngineNotFoundError(error)) {
      throw error;
    }

    await input.input.mirrorStore.recordMessageDeleted({
      engineAccountId: input.accountId,
      provider: "emailengine",
      providerMessageId: input.messageId,
      ...(input.mailboxPath ? { mailboxPath: input.mailboxPath } : {}),
      deletedAt: new Date().toISOString(),
      idempotencyKey: `delete:${input.accountId}:${input.messageId}`,
    });
    return undefined;
  }
}

async function syncBootstrapMailboxPages(input: {
  input: CreateSyncAccountJobHandlerInput;
  job: SyncJobRecord;
  mailboxes: unknown[];
  pageSize: number;
}): Promise<void> {
  for (const mailbox of input.mailboxes) {
    const mailboxPath = mailboxPathFromMailbox(mailbox);
    if (!mailboxPath) {
      continue;
    }

    await syncMailboxPage({
      input: input.input,
      job: input.job,
      mailboxPath,
      pageSize: input.pageSize,
    });
  }
}

async function syncMailboxPage(input: {
  input: CreateSyncAccountJobHandlerInput;
  job: SyncJobRecord;
  mailboxPath?: string;
  cursor?: string;
  pageSize: number;
}): Promise<void> {
  if (!input.mailboxPath || !input.job.accountId) {
    return;
  }

  const page = asMessagePage(
    await callEmailEngineOrMarkReauth({
      input: input.input,
      job: input.job,
      operation: "listMessages",
      call: () =>
        input.input.emailEngine.listMessages({
          accountId: input.job.accountId!,
          path: input.mailboxPath!,
          pageSize: input.pageSize,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        }),
    }),
  );

  for (const message of page.messages) {
    await input.input.mirrorStore.upsertMessage({
      engineAccountId: input.job.accountId,
      provider: "emailengine",
      message,
      mailboxPath: input.mailboxPath,
    });
  }

  if (page.nextPageCursor) {
    await enqueueMailboxContinuation({
      input: input.input,
      job: input.job,
      mailboxPath: input.mailboxPath,
      cursor: page.nextPageCursor,
      pageSize: input.pageSize,
    });
  }
}

async function enqueueMailboxContinuation(input: {
  input: CreateSyncAccountJobHandlerInput;
  job: SyncJobRecord;
  mailboxPath: string;
  cursor: string;
  pageSize: number;
}): Promise<void> {
  const queue = input.input.continuationQueue;
  if (!queue) {
    return;
  }

  await queue.enqueueJob({
    id: input.input.createId?.() ?? randomUUID(),
    jobType: "sync_account",
    accountId: input.job.accountId,
    idempotencyKey: [
      "emailengine-continuation",
      input.job.accountId,
      input.mailboxPath,
      input.cursor,
      input.pageSize,
    ].join(":"),
    maxAttempts: input.job.maxAttempts,
    notBefore: (input.input.now?.() ?? new Date()).toISOString(),
    payload: {
      kind: "emailengine_mailbox_continuation",
      mailboxPath: input.mailboxPath,
      cursor: input.cursor,
      pageSize: input.pageSize,
    },
  });
}

function isBootstrapPayload(
  payload: SyncJobPayload,
  emailengineMessageId?: string,
): boolean {
  return (
    !emailengineMessageId &&
    (payload.kind === undefined ||
      payload.kind === "initial_bootstrap" ||
      payload.kind === "manual_resync" ||
      payload.kind === "sync_requested")
  );
}

function asPayload(value: unknown): SyncJobPayload {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SyncJobPayload;
  }

  return {};
}

function emailengineMessageIdFor(
  payload: SyncJobPayload,
): string | undefined {
  return payload.resourceIdentity?.emailengineMessageId ?? payload.providerMessageId;
}

function mailboxPathFor(
  payload: SyncJobPayload,
  jobMailboxId?: string,
): string | undefined {
  return (
    payload.resourceIdentity?.mailboxPath ??
    payload.mailboxPath ??
    payload.providerPath ??
    payload.mailboxId ??
    jobMailboxId
  );
}

function pageSizeFor(payload: SyncJobPayload): number {
  const value = payload.pageSize ?? payload.limit;
  return Number.isInteger(value) && value! > 0
    ? value!
    : DEFAULT_EMAILENGINE_PAGE_SIZE;
}

function mailboxPathFromMailbox(mailbox: unknown): string | undefined {
  const raw = asRecord(mailbox);
  return readString(raw.path) ?? readString(raw.id) ?? readString(raw.mailboxId);
}

function asMessagePage(value: unknown): {
  messages: unknown[];
  nextPageCursor?: string;
} {
  const raw = asRecord(value);
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  return {
    messages,
    nextPageCursor: readString(raw.nextPageCursor),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function callEmailEngineOrMarkReauth<T>(input: {
  input: CreateSyncAccountJobHandlerInput;
  job: SyncJobRecord;
  operation: string;
  call: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.call();
  } catch (error) {
    if (!isEmailEngineAuthError(error)) {
      throw error;
    }

    if (input.job.accountId) {
      await input.input.reauthorizationMarker?.markAccountReauthRequired({
        accountId: input.job.accountId,
        reason: "auth_failed",
        at: (input.input.now?.() ?? new Date()).toISOString(),
      });
    }

    throw new NonRetryableQueueError(
      `EmailEngine account ${input.job.accountId ?? "unknown"} requires reauthorization after ${input.operation}`,
    );
  }
}

function isEmailEngineNotFoundError(error: unknown): boolean {
  if (error instanceof EmailEngineRequestError) {
    return error.status === 404 || error.code === "MessageNotFound";
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("EmailEngine request failed: 404") ||
    error.message.includes("MessageNotFound")
  );
}

function isEmailEngineAuthError(error: unknown): boolean {
  if (error instanceof EmailEngineRequestError) {
    return (
      error.status === 401 ||
      error.status === 403 ||
      isAuthFailureText(error.code) ||
      isAuthFailureText(error.detail)
    );
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return isAuthFailureText(error.message);
}

function isAuthFailureText(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("credential") ||
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("invalid login") ||
    normalized.includes("login failed")
  );
}
