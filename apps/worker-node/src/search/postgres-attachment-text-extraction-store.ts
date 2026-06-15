export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export type AttachmentTextJobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "dead_letter";

export interface AttachmentTextJobRecord {
  id: string;
  accountId: string;
  messageId: string;
  provider: string;
  providerAttachmentId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: AttachmentTextJobStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  errorMessage?: string;
  extractedText?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ClaimAttachmentTextJobInput {
  workerId: string;
  now: Date;
  leaseSeconds: number;
}

export interface CompleteAttachmentTextJobInput {
  jobId: string;
  workerId: string;
  extractedText: string;
  now: Date;
}

export interface FailAttachmentTextJobInput {
  jobId: string;
  workerId: string;
  errorMessage: string;
  now: Date;
  retryable?: boolean;
}

interface AttachmentTextJobRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  message_id: string;
  provider: string;
  provider_attachment_id: string;
  filename: string;
  content_type: string;
  byte_size: string | number;
  status: AttachmentTextJobStatus;
  attempts: number;
  max_attempts: number;
  not_before: string | Date;
  lease_owner?: string | null;
  lease_expires_at?: string | Date | null;
  error_message?: string | null;
  extracted_text?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at?: string | Date | null;
}

export function createPostgresAttachmentTextExtractionStore(
  client: Queryable,
) {
  return {
    async claimNext(input: ClaimAttachmentTextJobInput) {
      const leaseExpiresAt = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      const result = await client.query<AttachmentTextJobRow>(
        `
          WITH candidate AS (
            SELECT id
            FROM attachment_text_extraction_jobs
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
                FROM attachment_text_extraction_jobs active_same_account
                WHERE active_same_account.account_id = attachment_text_extraction_jobs.account_id
                  AND active_same_account.id <> attachment_text_extraction_jobs.id
                  AND active_same_account.status = 'running'
                  AND active_same_account.lease_expires_at > $1::timestamptz
              )
            ORDER BY not_before ASC, created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE attachment_text_extraction_jobs
          SET
            status = 'running',
            attempts = attempts + 1,
            lease_owner = $2,
            lease_expires_at = $3::timestamptz,
            error_message = NULL,
            updated_at = $1::timestamptz
          FROM candidate
          WHERE attachment_text_extraction_jobs.id = candidate.id
          RETURNING attachment_text_extraction_jobs.*
        `,
        [input.now.toISOString(), input.workerId, leaseExpiresAt.toISOString()],
      );

      return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
    },

    async completeJob(input: CompleteAttachmentTextJobInput) {
      const result = await client.query<AttachmentTextJobRow>(
        `
          WITH completed AS (
            UPDATE attachment_text_extraction_jobs
            SET
              status = 'done',
              lease_owner = NULL,
              lease_expires_at = NULL,
              error_message = NULL,
              extracted_text = $3,
              completed_at = $4::timestamptz,
              updated_at = $4::timestamptz
            WHERE id = $1
              AND status = 'running'
              AND lease_owner = $2
            RETURNING *
          ),
          merged_search_document AS (
            INSERT INTO search_documents (
              message_id,
              raw_text,
              document,
              updated_at
            )
            SELECT
              completed.message_id,
              $3,
              to_tsvector('simple', $3),
              $4::timestamptz
            FROM completed
            ON CONFLICT (message_id) DO UPDATE
            SET
              raw_text = btrim(search_documents.raw_text || E'\n' || EXCLUDED.raw_text),
              document = to_tsvector(
                'simple',
                btrim(search_documents.raw_text || E'\n' || EXCLUDED.raw_text)
              ),
              updated_at = $4::timestamptz
            RETURNING message_id
          )
          SELECT completed.*
          FROM completed
          JOIN merged_search_document
            ON merged_search_document.message_id = completed.message_id
        `,
        [
          input.jobId,
          input.workerId,
          input.extractedText,
          input.now.toISOString(),
        ],
      );

      return requireOwnedJob(result, input.workerId);
    },

    async failJob(input: FailAttachmentTextJobInput) {
      const result = await client.query<AttachmentTextJobRow>(
        `
          UPDATE attachment_text_extraction_jobs
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

      return requireOwnedJob(result, input.workerId);
    },
  };
}

function requireOwnedJob(
  result: QueryResult<AttachmentTextJobRow>,
  workerId: string,
): AttachmentTextJobRecord {
  if (!result.rows[0]) {
    throw new Error(`attachment text job lease is not owned by ${workerId}`);
  }

  return rowToJob(result.rows[0]);
}

function rowToJob(row: AttachmentTextJobRow): AttachmentTextJobRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    messageId: row.message_id,
    provider: row.provider,
    providerAttachmentId: row.provider_attachment_id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: toNumber(row.byte_size),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    notBefore: toIsoString(row.not_before),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: toIsoString(row.lease_expires_at) }
      : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.extracted_text ? { extractedText: row.extracted_text } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.completed_at ? { completedAt: toIsoString(row.completed_at) } : {}),
  };
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
