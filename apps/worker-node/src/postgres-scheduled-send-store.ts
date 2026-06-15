import type { Queryable } from "./postgres-sync-job-queue.js";
import type {
  MailAddress,
  MailSendAttachment,
  MailThreading,
  MailThreadingAction,
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
  from_address: string | null;
  from_name: string | null;
  subject: string;
  to_emails: unknown;
  cc_emails: unknown;
  bcc_emails: unknown;
  body_text: string | null;
  body_html: string | null;
  attachment_manifest: unknown;
  thread_action: string | null;
  thread_in_reply_to: string | null;
  thread_references: unknown;
  thread_emailengine_message_id: string | null;
  thread_gmail_thread_id: string | null;
  thread_graph_message_id: string | null;
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
            claimed_draft.from_address,
            claimed_draft.from_name,
            claimed_draft.subject,
            claimed_draft.to_emails,
            claimed_draft.cc_emails,
            claimed_draft.bcc_emails,
            claimed_draft.body_text,
            claimed_draft.body_html,
            claimed_draft.attachment_manifest,
            claimed_draft.thread_action,
            claimed_draft.thread_in_reply_to,
            claimed_draft.thread_references,
            claimed_draft.thread_emailengine_message_id,
            claimed_draft.thread_gmail_thread_id,
            claimed_draft.thread_graph_message_id
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
  const threading = rowToThreading(row);
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    draftId: String(row.draft_id),
    engineProvider:
      row.engine_provider === "native" ? "native" : "emailengine",
    ...(nativeProvider(row.native_provider)
      ? { nativeProvider: nativeProvider(row.native_provider) }
      : {}),
    ...(row.from_address
      ? {
          from: {
            address: row.from_address,
            ...(row.from_name ? { name: row.from_name } : {}),
          },
        }
      : {}),
    to: addresses(row.to_emails),
    cc: addresses(row.cc_emails),
    bcc: addresses(row.bcc_emails),
    subject: String(row.subject),
    ...(row.body_text ? { bodyText: row.body_text } : {}),
    ...(row.body_html ? { bodyHtml: row.body_html } : {}),
    ...(() => {
      const attachments = attachmentManifest(row.attachment_manifest);
      return attachments.length > 0 ? { attachments } : {};
    })(),
    ...(threading ? { threading } : {}),
    scheduledAt: toIsoString(row.scheduled_at),
    attempts: Number(row.attempts),
  };
}

function attachmentManifest(value: unknown): MailSendAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = recordValue(item);
      const filename = textValue(record.filename);
      const contentType = textValue(record.contentType);
      const providerAttachmentId = textValue(record.providerAttachmentId);
      const contentBase64 = textValue(record.contentBase64);
      if (
        !filename ||
        !contentType ||
        (!providerAttachmentId && !contentBase64)
      ) {
        return undefined;
      }

      const contentId = textValue(record.contentId);
      return {
        filename: sanitizeFilename(filename),
        contentType: sanitizeContentType(contentType),
        byteSize: Math.max(0, numberValue(record.byteSize)),
        inline: record.inline === true,
        ...(contentId ? { contentId: sanitizeText(contentId) } : {}),
        ...(providerAttachmentId
          ? { providerAttachmentId: sanitizeText(providerAttachmentId) }
          : {}),
        ...(contentBase64 ? { contentBase64 } : {}),
      };
    })
    .filter((item): item is MailSendAttachment => Boolean(item));
}

function rowToThreading(row: ScheduledSendJobRow): MailThreading | undefined {
  const action = threadingAction(row.thread_action);
  if (!action) {
    return undefined;
  }

  const references = headerValues(row.thread_references);
  const threading: MailThreading = {
    action,
    references,
  };
  const inReplyTo = headerValue(row.thread_in_reply_to);
  const emailEngineMessageId = textValue(row.thread_emailengine_message_id);
  const gmailThreadId = textValue(row.thread_gmail_thread_id);
  const graphMessageId = textValue(row.thread_graph_message_id);

  if (inReplyTo) {
    threading.inReplyTo = inReplyTo;
  }
  if (emailEngineMessageId) {
    threading.emailEngineMessageId = emailEngineMessageId;
  }
  if (gmailThreadId) {
    threading.gmailThreadId = gmailThreadId;
  }
  if (graphMessageId) {
    threading.graphMessageId = graphMessageId;
  }

  return threading;
}

function nativeProvider(value: unknown): ScheduledSendJob["nativeProvider"] {
  return value === "gmail" || value === "graph" || value === "imap"
    ? value
    : undefined;
}

function threadingAction(value: unknown): MailThreadingAction | undefined {
  return value === "reply" || value === "reply_all" ? value : undefined;
}

function headerValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    const header = headerValue(item);
    if (header) {
      unique.add(header);
    }
  }
  return [...unique];
}

function headerValue(value: unknown): string | undefined {
  const text = textValue(value);
  if (!text) {
    return undefined;
  }
  return text.replace(/[\r\n]+/g, " ").trim();
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : 0;
  }
  return 0;
}

function sanitizeText(value: string): string {
  return value.replace(/[\r\n\u0000]+/g, " ").trim();
}

function sanitizeFilename(value: string): string {
  const sanitized = sanitizeText(value);
  return sanitized.length > 0 ? sanitized.slice(0, 255) : "attachment";
}

function sanitizeContentType(value: string): string {
  const sanitized = value.replace(/[\r\n\u0000]+/g, "").trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(sanitized)
    ? sanitized
    : "application/octet-stream";
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
