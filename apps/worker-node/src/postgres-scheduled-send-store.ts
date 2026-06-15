import type { Queryable } from "./postgres-sync-job-queue.js";
import type {
  MailAddress,
  ScheduledSendJob,
  ScheduledSendStore,
} from "./scheduled-send-runner.js";

interface ScheduledSendJobRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  draft_id: string;
  engine_provider?: string | null;
  native_provider?: string | null;
  scheduled_at: string | Date;
  attempts: number;
  subject: string;
  to_emails: unknown;
  cc_emails: unknown;
  bcc_emails: unknown;
  body_text: string | null;
  body_html: string | null;
}

export function createPostgresScheduledSendStore(
  client: Queryable,
): ScheduledSendStore {
  return {
    async claimNextScheduledSend(input) {
      const leaseExpiresAt = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      const result = await client.query<ScheduledSendJobRow>(
        `
          WITH candidate AS (
            SELECT id
            FROM scheduled_sends
            WHERE (
                status IN ('scheduled', 'failed')
                OR (
                  status = 'sending'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at <= $1::timestamptz
                )
              )
              AND not_before <= $1::timestamptz
            ORDER BY not_before ASC, scheduled_at ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          ), claimed AS (
            UPDATE scheduled_sends
            SET status = 'sending',
                attempts = attempts + 1,
                lease_owner = $2,
                lease_expires_at = $3::timestamptz,
                last_error = NULL,
                updated_at = $1::timestamptz
            FROM candidate
            WHERE scheduled_sends.id = candidate.id
            RETURNING scheduled_sends.*
          ), claimed_draft AS (
            UPDATE email_drafts
            SET status = 'sending',
                error_message = NULL,
                updated_at = $1::timestamptz
            FROM claimed
            WHERE email_drafts.account_id = claimed.account_id
              AND email_drafts.id = claimed.draft_id
              AND email_drafts.status IN ('scheduled', 'sending')
            RETURNING email_drafts.*
          )
          SELECT
            claimed.id,
            claimed.account_id,
            claimed.draft_id,
            connected_accounts.engine_provider,
            account_provider_settings.native_provider,
            claimed.scheduled_at,
            claimed.attempts,
            claimed_draft.subject,
            claimed_draft.to_emails,
            claimed_draft.cc_emails,
            claimed_draft.bcc_emails,
            claimed_draft.body_text,
            claimed_draft.body_html
          FROM claimed
          JOIN claimed_draft ON claimed_draft.id = claimed.draft_id
          JOIN connected_accounts
            ON connected_accounts.id = claimed.account_id
          LEFT JOIN account_provider_settings
            ON account_provider_settings.account_id = claimed.account_id
        `,
        [input.now.toISOString(), input.workerId, leaseExpiresAt.toISOString()],
      );

      return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
    },

    async markScheduledSendSent(input) {
      await client.query(
        `
          WITH sent_schedule AS (
            UPDATE scheduled_sends
            SET status = 'sent',
                provider_queue_id = $4,
                provider_message_id = $5,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error = NULL,
                sent_at = $6::timestamptz,
                completed_at = $6::timestamptz,
                updated_at = $6::timestamptz
            WHERE account_id = $1
              AND id = $2
              AND status = 'sending'
            RETURNING *
          )
          UPDATE email_drafts
          SET status = 'sent',
              provider_queue_id = $4,
              provider_message_id = $5,
              error_message = NULL,
              sent_at = $6::timestamptz,
              updated_at = $6::timestamptz
          FROM sent_schedule
          WHERE email_drafts.account_id = sent_schedule.account_id
            AND email_drafts.id = $3
        `,
        [
          input.accountId,
          input.scheduledId,
          input.draftId,
          input.providerQueueId ?? null,
          input.providerMessageId ?? null,
          input.sentAt,
        ],
      );
    },

    async markScheduledSendFailed(input) {
      await client.query(
        `
          WITH failed_schedule AS (
            UPDATE scheduled_sends
            SET status = CASE
                  WHEN attempts >= max_attempts THEN 'dead_letter'
                  ELSE 'failed'
                END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                not_before = CASE
                  WHEN attempts >= max_attempts THEN not_before
                  ELSE (
                    $5::timestamptz +
                    (
                      LEAST(
                        60 * POWER(2, GREATEST(attempts - 1, 0)),
                        1800
                      ) * INTERVAL '1 second'
                    )
                  )
                END,
                last_error = $4,
                updated_at = $5::timestamptz
            WHERE account_id = $1
              AND id = $2
              AND status = 'sending'
            RETURNING *
          )
          UPDATE email_drafts
          SET status = CASE
                WHEN failed_schedule.status = 'dead_letter' THEN 'failed'
                ELSE 'scheduled'
              END,
              error_message = $4,
              updated_at = $5::timestamptz
          FROM failed_schedule
          WHERE email_drafts.account_id = failed_schedule.account_id
            AND email_drafts.id = $3
        `,
        [
          input.accountId,
          input.scheduledId,
          input.draftId,
          input.errorMessage,
          input.now.toISOString(),
        ],
      );
    },
  };
}

function rowToJob(row: ScheduledSendJobRow): ScheduledSendJob {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    draftId: String(row.draft_id),
    engineProvider:
      row.engine_provider === "native" ? "native" : "emailengine",
    ...(nativeProvider(row.native_provider)
      ? { nativeProvider: nativeProvider(row.native_provider) }
      : {}),
    to: addresses(row.to_emails),
    cc: addresses(row.cc_emails),
    bcc: addresses(row.bcc_emails),
    subject: String(row.subject),
    ...(row.body_text ? { bodyText: row.body_text } : {}),
    ...(row.body_html ? { bodyHtml: row.body_html } : {}),
    scheduledAt: toIsoString(row.scheduled_at),
    attempts: Number(row.attempts),
  };
}

function nativeProvider(value: unknown): ScheduledSendJob["nativeProvider"] {
  return value === "gmail" || value === "graph" || value === "imap"
    ? value
    : undefined;
}

function addresses(value: unknown): MailAddress[] {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") {
            return undefined;
          }
          const record = item as Record<string, unknown>;
          if (typeof record.address !== "string") {
            return undefined;
          }
          return {
            address: record.address,
            ...(typeof record.name === "string" ? { name: record.name } : {}),
          };
        })
        .filter((item): item is MailAddress => Boolean(item))
    : [];
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
