import { randomUUID } from "node:crypto";

import type {
  IngestWebhookInput,
  IngestWebhookResult,
  MailEngineIngestStore,
  StoredMailEngineEvent,
  SyncJob,
  SyncJobType,
} from "./ingest-store.js";
import type {
  MailEngineEventKind,
  MailEngineResourceIdentity,
} from "./webhook.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface MailEngineEventRow extends Record<string, unknown> {
  id: string;
  source: "emailengine_webhook";
  kind: MailEngineEventKind;
  account_id?: string | null;
  mailbox_id?: string | null;
  provider_message_id?: string | null;
  provider_thread_id?: string | null;
  provider_email_id?: string | null;
  rfc_message_id?: string | null;
  provider_uid?: string | null;
  provider_path?: string | null;
  resource_key?: string | null;
  resource_identity?: MailEngineResourceIdentity | null;
  provider_event_name?: string | null;
  idempotency_key: string;
  raw_payload: unknown;
  received_at: string | Date;
}

interface SyncJobRow extends Record<string, unknown> {
  id: string;
  job_type: SyncJobType;
  account_id?: string | null;
  mailbox_id?: string | null;
  trigger_event_id: string;
  status: "queued" | "running" | "done" | "failed";
  idempotency_key: string;
  created_at: string | Date;
}

export function createPostgresMailEngineIngestStore(
  client: Queryable,
): MailEngineIngestStore {
  return {
    async ingestWebhook(input: IngestWebhookInput) {
      const result: IngestWebhookResult = {
        events: [],
        syncJobs: [],
        duplicateCount: 0,
      };

      for (const event of input.events) {
        const inserted = await insertEvent(client, input, event);
        if (inserted.duplicate) {
          result.duplicateCount += 1;
          result.events.push(inserted);
        } else {
          result.events.push(inserted);
        }

        const job = await insertSyncJob(client, inserted);
        if (job) {
          result.syncJobs.push(job);
        }
      }

      return result;
    },
  };
}

async function insertEvent(
  client: Queryable,
  input: IngestWebhookInput,
  event: IngestWebhookInput["events"][number],
): Promise<StoredMailEngineEvent> {
  const id = randomUUID();
  const inserted = await client.query<MailEngineEventRow>(
    `
      INSERT INTO mail_engine_events (
        id,
        source,
        kind,
        account_id,
        mailbox_id,
        provider_message_id,
        provider_thread_id,
        provider_email_id,
        rfc_message_id,
        provider_uid,
        provider_path,
        resource_key,
        resource_identity,
        provider_event_name,
        idempotency_key,
        raw_payload,
        received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17::timestamptz, now()))
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING
        id,
        source,
        kind,
        account_id,
        mailbox_id,
        provider_message_id,
        provider_thread_id,
        provider_email_id,
        rfc_message_id,
        provider_uid,
        provider_path,
        resource_key,
        resource_identity,
        provider_event_name,
        idempotency_key,
        raw_payload,
        received_at
    `,
    [
      id,
      event.source,
      event.kind,
      event.accountId,
      event.mailboxId,
      event.providerMessageId,
      event.providerThreadId,
      event.providerEmailId,
      event.rfcMessageId,
      event.providerUid,
      event.providerPath,
      event.resourceKey,
      event.resourceIdentity,
      event.providerEventName,
      event.idempotencyKey,
      input.rawPayload,
      input.receivedAt?.toISOString(),
    ],
  );

  if (inserted.rows[0]) {
    return rowToStoredEvent(inserted.rows[0], false);
  }

  const existing = await client.query<MailEngineEventRow>(
    `
      SELECT
        id,
        source,
        kind,
        account_id,
        mailbox_id,
        provider_message_id,
        provider_thread_id,
        provider_email_id,
        rfc_message_id,
        provider_uid,
        provider_path,
        resource_key,
        resource_identity,
        provider_event_name,
        idempotency_key,
        raw_payload,
        received_at
      FROM mail_engine_events
      WHERE idempotency_key = $1
    `,
    [event.idempotencyKey],
  );

  if (!existing.rows[0]) {
    throw new Error(`mail engine event was not inserted or found: ${event.idempotencyKey}`);
  }

  return rowToStoredEvent(existing.rows[0], true);
}

async function insertSyncJob(
  client: Queryable,
  event: StoredMailEngineEvent,
): Promise<SyncJob | undefined> {
  const inserted = await client.query<SyncJobRow>(
    `
      INSERT INTO sync_jobs (
        id,
        job_type,
        account_id,
        mailbox_id,
        trigger_event_id,
        idempotency_key,
        status,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING
        id,
        job_type,
        account_id,
        mailbox_id,
        trigger_event_id,
        idempotency_key,
        status,
        created_at
    `,
    [
      randomUUID(),
      jobTypeForEvent(event.kind),
      event.accountId,
      event.mailboxId,
      event.id,
      `job:${event.idempotencyKey}`,
      {
        source: event.source,
        kind: event.kind,
        providerMessageId: event.providerMessageId,
        providerEmailId: event.providerEmailId,
        rfcMessageId: event.rfcMessageId,
        resourceKey: event.resourceKey,
        resourceIdentity: event.resourceIdentity,
        providerEventName: event.providerEventName,
      },
    ],
  );

  return inserted.rows[0] ? rowToSyncJob(inserted.rows[0]) : undefined;
}

function rowToStoredEvent(
  row: MailEngineEventRow,
  duplicate: boolean,
): StoredMailEngineEvent {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    ...(row.account_id ? { accountId: row.account_id } : {}),
    ...(row.mailbox_id ? { mailboxId: row.mailbox_id } : {}),
    ...(row.provider_message_id
      ? { providerMessageId: row.provider_message_id }
      : {}),
    ...(row.provider_thread_id
      ? { providerThreadId: row.provider_thread_id }
      : {}),
    ...(row.provider_email_id
      ? { providerEmailId: row.provider_email_id }
      : {}),
    ...(row.rfc_message_id ? { rfcMessageId: row.rfc_message_id } : {}),
    ...(row.provider_uid ? { providerUid: row.provider_uid } : {}),
    ...(row.provider_path ? { providerPath: row.provider_path } : {}),
    ...(row.resource_key ? { resourceKey: row.resource_key } : {}),
    ...(row.resource_identity ? { resourceIdentity: row.resource_identity } : {}),
    ...(row.provider_event_name
      ? { providerEventName: row.provider_event_name }
      : {}),
    idempotencyKey: row.idempotency_key,
    rawPayload: row.raw_payload,
    receivedAt: toIsoString(row.received_at),
    duplicate,
  };
}

function rowToSyncJob(row: SyncJobRow): SyncJob {
  return {
    id: row.id,
    jobType: row.job_type,
    ...(row.account_id ? { accountId: row.account_id } : {}),
    ...(row.mailbox_id ? { mailboxId: row.mailbox_id } : {}),
    triggerEventId: row.trigger_event_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: toIsoString(row.created_at),
  };
}

function jobTypeForEvent(kind: MailEngineEventKind): SyncJobType {
  return kind === "auth_failed" || kind === "sync_failed"
    ? "account_state"
    : "sync_account";
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
