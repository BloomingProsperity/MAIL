import type {
  ClaimNextInput,
  CompleteJobInput,
  EnqueueJobInput,
  FailJobInput,
  SyncJobQueue,
  SyncJobRecord,
  SyncJobStatus,
  SyncJobType,
} from "./sync-job-queue.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface SyncJobRow extends Record<string, unknown> {
  id: string;
  job_type: SyncJobType;
  account_id?: string | null;
  mailbox_id?: string | null;
  trigger_event_id?: string | null;
  idempotency_key: string;
  status: SyncJobStatus;
  attempts: number;
  max_attempts: number;
  not_before: string | Date;
  lease_owner?: string | null;
  lease_expires_at?: string | Date | null;
  payload: unknown;
  error_message?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at?: string | Date | null;
}

export function createPostgresSyncJobQueue(client: Queryable): SyncJobQueue {
  return {
    async enqueueJob(input: EnqueueJobInput) {
      const result = await client.query<SyncJobRow>(
        `
          INSERT INTO sync_jobs (
            id,
            job_type,
            account_id,
            mailbox_id,
            trigger_event_id,
            idempotency_key,
            max_attempts,
            not_before,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)
          ON CONFLICT (idempotency_key) DO UPDATE
          SET updated_at = sync_jobs.updated_at
          RETURNING *
        `,
        [
          input.id,
          input.jobType,
          input.accountId ?? null,
          input.mailboxId ?? null,
          input.triggerEventId ?? null,
          input.idempotencyKey,
          input.maxAttempts ?? 8,
          input.notBefore,
          input.payload,
        ],
      );

      if (!result.rows[0]) {
        throw new Error("sync job enqueue returned no rows");
      }

      return rowToJob(result.rows[0]);
    },

    async claimNext(input: ClaimNextInput) {
      const leaseExpiresAt = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      const result = await client.query<SyncJobRow>(
        `
          WITH candidate AS (
            SELECT id
            FROM sync_jobs
            WHERE
              (
                (
                  status = 'queued'
                  AND not_before <= $1::timestamptz
                )
                OR (
                  status = 'running'
                  AND lease_expires_at <= $1::timestamptz
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM sync_jobs active_same_account
                WHERE active_same_account.account_id = sync_jobs.account_id
                  AND active_same_account.id <> sync_jobs.id
                  AND active_same_account.status = 'running'
                  AND active_same_account.lease_expires_at > $1::timestamptz
              )
              AND (
                sync_jobs.account_id IS NULL
                OR pg_try_advisory_xact_lock(hashtextextended(sync_jobs.account_id, 0))
              )
            ORDER BY not_before ASC, created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE sync_jobs
          SET
            status = 'running',
            attempts = attempts + 1,
            lease_owner = $2,
            lease_expires_at = $3::timestamptz,
            error_message = NULL,
            updated_at = $1::timestamptz
          FROM candidate
          WHERE sync_jobs.id = candidate.id
          RETURNING
            sync_jobs.id,
            sync_jobs.job_type,
            sync_jobs.account_id,
            sync_jobs.mailbox_id,
            sync_jobs.trigger_event_id,
            sync_jobs.idempotency_key,
            sync_jobs.status,
            sync_jobs.attempts,
            sync_jobs.max_attempts,
            sync_jobs.not_before,
            sync_jobs.lease_owner,
            sync_jobs.lease_expires_at,
            sync_jobs.payload,
            sync_jobs.error_message,
            sync_jobs.created_at,
            sync_jobs.updated_at,
            sync_jobs.completed_at
        `,
        [input.now.toISOString(), input.workerId, leaseExpiresAt.toISOString()],
      );

      return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
    },

    async completeJob(input: CompleteJobInput) {
      const result = await client.query<SyncJobRow>(
        `
          UPDATE sync_jobs
          SET
            status = 'done',
            lease_owner = NULL,
            lease_expires_at = NULL,
            error_message = NULL,
            completed_at = $3::timestamptz,
            updated_at = $3::timestamptz
          WHERE id = $1
            AND status = 'running'
            AND lease_owner = $2
          RETURNING *
        `,
        [input.jobId, input.workerId, input.now.toISOString()],
      );

      if (!result.rows[0]) {
        throw new Error(`job lease is not owned by ${input.workerId}`);
      }

      return rowToJob(result.rows[0]);
    },

    async failJob(input: FailJobInput) {
      const result = await client.query<SyncJobRow>(
        `
          UPDATE sync_jobs
          SET
            status = CASE WHEN $5 = FALSE OR attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            not_before = CASE
              WHEN $5 = FALSE OR attempts >= max_attempts THEN not_before
              ELSE (
                $4::timestamptz +
                (
                  LEAST(
                    30 * POWER(2, GREATEST(attempts - 1, 0)),
                    900
                  ) * INTERVAL '1 second'
                )
              )
            END,
            error_message = $3,
            updated_at = $4::timestamptz
          WHERE id = $1
            AND status = 'running'
            AND lease_owner = $2
          RETURNING *
        `,
        [
          input.jobId,
          input.workerId,
          input.errorMessage,
          input.now.toISOString(),
          input.retryable ?? true,
        ],
      );

      if (!result.rows[0]) {
        throw new Error(`job lease is not owned by ${input.workerId}`);
      }

      return rowToJob(result.rows[0]);
    },
  };
}

function rowToJob(row: SyncJobRow): SyncJobRecord {
  return {
    id: row.id,
    jobType: row.job_type,
    ...(row.account_id ? { accountId: row.account_id } : {}),
    ...(row.mailbox_id ? { mailboxId: row.mailbox_id } : {}),
    ...(row.trigger_event_id ? { triggerEventId: row.trigger_event_id } : {}),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    notBefore: toIsoString(row.not_before),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: toIsoString(row.lease_expires_at) }
      : {}),
    payload: row.payload,
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.completed_at ? { completedAt: toIsoString(row.completed_at) } : {}),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
