import { randomUUID } from "node:crypto";

import type {
  MailEngineEventKind,
  NormalizedMailEngineEvent,
} from "./webhook.js";

export type SyncJobType = "sync_account" | "account_state";
export type SyncJobStatus = "queued" | "running" | "done" | "failed";

export interface StoredMailEngineEvent extends NormalizedMailEngineEvent {
  id: string;
  receivedAt: string;
  rawPayload: unknown;
  duplicate: boolean;
}

export interface SyncJob {
  id: string;
  jobType: SyncJobType;
  accountId?: string;
  mailboxId?: string;
  triggerEventId: string;
  status: SyncJobStatus;
  idempotencyKey: string;
  createdAt: string;
}

export interface IngestWebhookInput {
  events: NormalizedMailEngineEvent[];
  rawPayload: unknown;
  receivedAt?: Date;
}

export interface IngestWebhookResult {
  events: StoredMailEngineEvent[];
  syncJobs: SyncJob[];
  duplicateCount: number;
}

export interface MailEngineIngestStore {
  ingestWebhook(input: IngestWebhookInput): Promise<IngestWebhookResult>;
}

export interface InMemoryMailEngineIngestStore extends MailEngineIngestStore {
  listEvents(): StoredMailEngineEvent[];
  listSyncJobs(): SyncJob[];
}

export function createInMemoryMailEngineIngestStore(): InMemoryMailEngineIngestStore {
  const eventsByKey = new Map<string, StoredMailEngineEvent>();
  const syncJobs: SyncJob[] = [];

  return {
    async ingestWebhook(input) {
      const receivedAt = (input.receivedAt ?? new Date()).toISOString();
      const storedEvents: StoredMailEngineEvent[] = [];
      const queuedJobs: SyncJob[] = [];
      let duplicateCount = 0;

      for (const event of input.events) {
        const existing = eventsByKey.get(event.idempotencyKey);
        if (existing) {
          duplicateCount += 1;
          storedEvents.push({ ...existing, duplicate: true });
          continue;
        }

        const storedEvent: StoredMailEngineEvent = {
          source: event.source,
          kind: event.kind,
          ...(event.accountId ? { accountId: event.accountId } : {}),
          ...(event.mailboxId ? { mailboxId: event.mailboxId } : {}),
          ...(event.providerMessageId
            ? { providerMessageId: event.providerMessageId }
            : {}),
          ...(event.providerThreadId
            ? { providerThreadId: event.providerThreadId }
            : {}),
          ...(event.providerEmailId
            ? { providerEmailId: event.providerEmailId }
            : {}),
          ...(event.rfcMessageId ? { rfcMessageId: event.rfcMessageId } : {}),
          ...(event.providerUid ? { providerUid: event.providerUid } : {}),
          ...(event.providerPath ? { providerPath: event.providerPath } : {}),
          ...(event.resourceKey ? { resourceKey: event.resourceKey } : {}),
          ...(event.resourceIdentity
            ? { resourceIdentity: event.resourceIdentity }
            : {}),
          ...(event.providerEventName
            ? { providerEventName: event.providerEventName }
            : {}),
          idempotencyKey: event.idempotencyKey,
          id: randomUUID(),
          receivedAt,
          rawPayload: input.rawPayload,
          duplicate: false,
        };
        eventsByKey.set(event.idempotencyKey, storedEvent);
        storedEvents.push(storedEvent);

        const job = createSyncJob(storedEvent, receivedAt);
        syncJobs.push(job);
        queuedJobs.push(job);
      }

      return {
        events: storedEvents,
        syncJobs: queuedJobs,
        duplicateCount,
      };
    },

    listEvents() {
      return [...eventsByKey.values()];
    },

    listSyncJobs() {
      return [...syncJobs];
    },
  };
}

function createSyncJob(
  event: StoredMailEngineEvent,
  createdAt: string,
): SyncJob {
  return {
    id: randomUUID(),
    jobType: jobTypeForEvent(event.kind),
    ...(event.accountId ? { accountId: event.accountId } : {}),
    ...(event.mailboxId ? { mailboxId: event.mailboxId } : {}),
    triggerEventId: event.id,
    status: "queued",
    idempotencyKey: `job:${event.idempotencyKey}`,
    createdAt,
  };
}

function jobTypeForEvent(kind: MailEngineEventKind): SyncJobType {
  return isAccountStateEvent(kind) ? "account_state" : "sync_account";
}

function isAccountStateEvent(kind: MailEngineEventKind): boolean {
  return (
    kind === "auth_succeeded" ||
    kind === "auth_failed" ||
    kind === "sync_failed" ||
    kind === "account_deleted"
  );
}
