import type {
  DraftWithAccount,
  MailAddress,
  MailComposeAccount,
  MailComposeStore,
  MailDraft,
  MailDraftAttachment,
  MailDraftTransportAttachment,
  MailDraftStatus,
  MailThreading,
  MailThreadingAction,
  ScheduledSend,
  ScheduledSendStatus,
  ScheduledSendWithDraft,
} from "./mail-compose.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface DraftRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  from_address: string | null;
  from_name: string | null;
  subject: string;
  to_emails: unknown;
  cc_emails: unknown;
  bcc_emails: unknown;
  body_text: string | null;
  body_html: string | null;
  status: string;
  source: string;
  reply_to_message_id: string | null;
  source_message_id: string | null;
  thread_action: string | null;
  thread_in_reply_to: string | null;
  thread_references: unknown;
  thread_emailengine_message_id: string | null;
  thread_gmail_thread_id: string | null;
  thread_graph_message_id: string | null;
  attachment_manifest: unknown;
  hermes_skill_run_id: string | null;
  hermes_draft_text: string | null;
  provider_queue_id: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  sent_at: string | Date | null;
  account_email?: string;
  sync_state?: string;
  engine_provider?: string;
}

interface ScheduledSendRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  draft_id: string;
  scheduled_at: string | Date;
  status: string;
  attempts: number;
  max_attempts: number;
  not_before: string | Date;
  provider_queue_id: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  sent_at: string | Date | null;
  cancelled_at: string | Date | null;
  completed_at: string | Date | null;
}

interface ScheduledSendWithDraftRow
  extends DraftRow,
    Record<string, unknown> {
  scheduled_id: string;
  scheduled_account_id: string;
  scheduled_draft_id: string;
  scheduled_at: string | Date;
  scheduled_status: string;
  scheduled_attempts: number;
  scheduled_max_attempts: number;
  scheduled_not_before: string | Date;
  scheduled_provider_queue_id: string | null;
  scheduled_provider_message_id: string | null;
  scheduled_last_error: string | null;
  scheduled_created_at: string | Date;
  scheduled_updated_at: string | Date;
  scheduled_sent_at: string | Date | null;
  scheduled_cancelled_at: string | Date | null;
  scheduled_completed_at: string | Date | null;
}

export function createPostgresMailComposeStore(
  client: Queryable,
): MailComposeStore {
  return {
    async createDraft(input) {
      const result = await client.query<DraftRow>(
        `
          INSERT INTO email_drafts (
            id,
            account_id,
            from_address,
            from_name,
            subject,
            to_emails,
            cc_emails,
            bcc_emails,
            body_text,
            body_html,
            source,
            reply_to_message_id,
            source_message_id,
            thread_action,
            thread_in_reply_to,
            thread_references,
            thread_emailengine_message_id,
            thread_gmail_thread_id,
            thread_graph_message_id,
            attachment_manifest,
            hermes_skill_run_id,
            hermes_draft_text,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19,
            $20,
            $21,
            $22,
            $23::timestamptz,
            $23::timestamptz
          )
          RETURNING ${draftColumns()}
        `,
        [
          input.id,
          input.accountId,
          input.from?.address ?? null,
          input.from?.name ?? null,
          input.subject,
          input.to,
          input.cc,
          input.bcc,
          input.bodyText ?? null,
          input.bodyHtml ?? null,
          input.source,
          input.replyToMessageId ?? null,
          input.sourceMessageId ?? null,
          input.threading?.action ?? null,
          input.threading?.inReplyTo ?? null,
          input.threading?.references ?? [],
          input.threading?.emailEngineMessageId ?? null,
          input.threading?.gmailThreadId ?? null,
          input.threading?.graphMessageId ?? null,
          input.attachments ?? [],
          input.hermesSkillRunId ?? null,
          input.hermesDraftText ?? null,
          input.now,
        ],
      );

      return rowToDraft(result.rows[0]);
    },

    async updateDraft(input) {
      const result = await client.query<DraftRow>(
        `
          UPDATE email_drafts
          SET from_address = $3,
              from_name = $4,
              subject = $5,
              to_emails = $6,
              cc_emails = $7,
              bcc_emails = $8,
              body_text = $9,
              body_html = $10,
              source = $11,
              reply_to_message_id = $12,
              source_message_id = $13,
              thread_action = $14,
              thread_in_reply_to = $15,
              thread_references = $16,
              thread_emailengine_message_id = $17,
              thread_gmail_thread_id = $18,
              thread_graph_message_id = $19,
              attachment_manifest = $20,
              hermes_skill_run_id = $21,
              hermes_draft_text = $22,
              error_message = NULL,
              updated_at = $23::timestamptz
          WHERE account_id = $1
            AND id = $2
            AND status = 'draft'
          RETURNING ${draftColumns()}
        `,
        [
          input.accountId,
          input.draftId,
          input.from?.address ?? null,
          input.from?.name ?? null,
          input.subject,
          input.to,
          input.cc,
          input.bcc,
          input.bodyText ?? null,
          input.bodyHtml ?? null,
          input.source,
          input.replyToMessageId ?? null,
          input.sourceMessageId ?? null,
          input.threading?.action ?? null,
          input.threading?.inReplyTo ?? null,
          input.threading?.references ?? [],
          input.threading?.emailEngineMessageId ?? null,
          input.threading?.gmailThreadId ?? null,
          input.threading?.graphMessageId ?? null,
          input.attachments ?? [],
          input.hermesSkillRunId ?? null,
          input.hermesDraftText ?? null,
          input.now,
        ],
      );

      return result.rows[0] ? rowToDraft(result.rows[0]) : undefined;
    },

    async getDraftWithAccount(input) {
      const result = await client.query<DraftRow>(
        `
          SELECT
            ${draftColumns("email_drafts")},
            connected_accounts.email AS account_email,
            connected_accounts.sync_state,
            connected_accounts.engine_provider
          FROM email_drafts
          JOIN connected_accounts ON connected_accounts.id = email_drafts.account_id
          WHERE email_drafts.account_id = $1
            AND email_drafts.id = $2
          LIMIT 1
        `,
        [input.accountId, input.draftId],
      );

      return result.rows[0] ? rowToDraftWithAccount(result.rows[0]) : undefined;
    },

    async claimDraftForSend(input) {
      const result = await client.query<DraftRow>(
        `
          WITH claimed AS (
            UPDATE email_drafts
            SET status = 'sending',
                send_lease_owner = $3,
                send_lease_expires_at = $4::timestamptz,
                error_message = NULL,
                updated_at = $5::timestamptz
            WHERE account_id = $1
              AND id = $2
              AND (
                status = 'draft'
                OR (
                  status = 'sending'
                  AND send_lease_expires_at IS NOT NULL
                  AND send_lease_expires_at <= $5::timestamptz
                )
              )
            RETURNING ${draftColumns()}
          )
          SELECT
            ${draftColumns("claimed")},
            connected_accounts.email AS account_email,
            connected_accounts.sync_state,
            connected_accounts.engine_provider
          FROM claimed
          JOIN connected_accounts ON connected_accounts.id = claimed.account_id
        `,
        [
          input.accountId,
          input.draftId,
          input.leaseOwner,
          input.leaseExpiresAt,
          input.now,
        ],
      );

      return result.rows[0] ? rowToDraftWithAccount(result.rows[0]) : undefined;
    },

    async markDraftSent(input) {
      const result = await client.query<DraftRow>(
        `
          UPDATE email_drafts
          SET status = 'sent',
              provider_queue_id = $3,
              provider_message_id = $4,
              send_lease_owner = NULL,
              send_lease_expires_at = NULL,
              error_message = NULL,
              sent_at = $5::timestamptz,
              updated_at = $5::timestamptz
          WHERE account_id = $1
            AND id = $2
          RETURNING ${draftColumns()}
        `,
        [
          input.accountId,
          input.draftId,
          input.providerQueueId ?? null,
          input.providerMessageId ?? null,
          input.sentAt,
        ],
      );

      return rowToDraft(result.rows[0]);
    },

    async markDraftFailed(input) {
      const result = await client.query<DraftRow>(
        `
          UPDATE email_drafts
          SET status = 'failed',
              send_lease_owner = NULL,
              send_lease_expires_at = NULL,
              error_message = $3,
              updated_at = now()
          WHERE account_id = $1
            AND id = $2
          RETURNING ${draftColumns()}
        `,
        [input.accountId, input.draftId, input.errorMessage],
      );

      return result.rows[0] ? rowToDraft(result.rows[0]) : undefined;
    },

    async createScheduledSend(input) {
      const result = await client.query<ScheduledSendRow>(
        `
          WITH schedulable_draft AS (
            UPDATE email_drafts
            SET status = 'scheduled',
                error_message = NULL,
                updated_at = $7::timestamptz
            WHERE account_id = $2
              AND id = $3
              AND status = 'draft'
            RETURNING id
          )
          INSERT INTO scheduled_sends (
            id,
            account_id,
            draft_id,
            scheduled_at,
            status,
            attempts,
            max_attempts,
            not_before,
            idempotency_key,
            created_at,
            updated_at
          )
          SELECT
            $1,
            $2,
            $3,
            $4::timestamptz,
            'scheduled',
            0,
            5,
            $5::timestamptz,
            $6,
            $7::timestamptz,
            $7::timestamptz
          FROM schedulable_draft
          RETURNING ${scheduledColumns()}
        `,
        [
          input.id,
          input.accountId,
          input.draftId,
          input.scheduledAt,
          input.notBefore,
          input.idempotencyKey,
          input.now,
        ],
      );

      return result.rows[0] ? rowToScheduledSend(result.rows[0]) : undefined;
    },

    async listScheduledSends(input) {
      const result = await client.query<ScheduledSendRow>(
        `
          SELECT ${scheduledColumns()}
          FROM scheduled_sends
          WHERE account_id = $1
            AND status IN ('scheduled', 'queued', 'sending', 'failed')
          ORDER BY scheduled_at ASC, created_at ASC, id ASC
          LIMIT $2
        `,
        [input.accountId, input.limit],
      );

      return result.rows.map(rowToScheduledSend);
    },

    async getScheduledDraft(input) {
      const result = await client.query<ScheduledSendWithDraftRow>(
        `
          SELECT
            ${scheduledColumns("scheduled_sends", "scheduled_")},
            ${draftColumns("email_drafts")},
            connected_accounts.email AS account_email,
            connected_accounts.sync_state,
            connected_accounts.engine_provider
          FROM scheduled_sends
          JOIN email_drafts
            ON email_drafts.account_id = scheduled_sends.account_id
           AND email_drafts.id = scheduled_sends.draft_id
          JOIN connected_accounts
            ON connected_accounts.id = scheduled_sends.account_id
          WHERE scheduled_sends.account_id = $1
            AND scheduled_sends.id = $2
            AND scheduled_sends.status IN ('scheduled', 'failed')
            AND email_drafts.status = 'scheduled'
          LIMIT 1
        `,
        [input.accountId, input.scheduledId],
      );

      return result.rows[0]
        ? rowToScheduledSendWithDraft(result.rows[0])
        : undefined;
    },

    async updateScheduledDraft(input) {
      const result = await client.query<ScheduledSendWithDraftRow>(
        `
          WITH editable_schedule AS (
            UPDATE scheduled_sends
            SET status = 'scheduled',
                attempts = 0,
                not_before = scheduled_at,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error = NULL,
                updated_at = $23::timestamptz
            WHERE account_id = $1
              AND id = $2
              AND status IN ('scheduled', 'failed')
            RETURNING *
          ), updated_draft AS (
            UPDATE email_drafts
            SET from_address = $3,
                from_name = $4,
                subject = $5,
                to_emails = $6,
                cc_emails = $7,
                bcc_emails = $8,
                body_text = $9,
                body_html = $10,
                source = $11,
                reply_to_message_id = $12,
                source_message_id = $13,
                thread_action = $14,
                thread_in_reply_to = $15,
                thread_references = $16,
                thread_emailengine_message_id = $17,
                thread_gmail_thread_id = $18,
                thread_graph_message_id = $19,
                attachment_manifest = COALESCE($20, email_drafts.attachment_manifest),
                hermes_skill_run_id = $21,
                hermes_draft_text = $22,
                error_message = NULL,
                updated_at = $23::timestamptz
            FROM editable_schedule
            WHERE email_drafts.account_id = editable_schedule.account_id
              AND email_drafts.id = editable_schedule.draft_id
              AND email_drafts.status = 'scheduled'
            RETURNING email_drafts.*
          )
          SELECT
            ${scheduledColumns("editable_schedule", "scheduled_")},
            ${draftColumns("updated_draft")},
            connected_accounts.email AS account_email,
            connected_accounts.sync_state,
            connected_accounts.engine_provider
          FROM editable_schedule
          JOIN updated_draft
            ON updated_draft.account_id = editable_schedule.account_id
           AND updated_draft.id = editable_schedule.draft_id
          JOIN connected_accounts
            ON connected_accounts.id = editable_schedule.account_id
        `,
        [
          input.accountId,
          input.scheduledId,
          input.from?.address ?? null,
          input.from?.name ?? null,
          input.subject,
          input.to,
          input.cc,
          input.bcc,
          input.bodyText ?? null,
          input.bodyHtml ?? null,
          input.source,
          input.replyToMessageId ?? null,
          input.sourceMessageId ?? null,
          input.threading?.action ?? null,
          input.threading?.inReplyTo ?? null,
          input.threading?.references ?? [],
          input.threading?.emailEngineMessageId ?? null,
          input.threading?.gmailThreadId ?? null,
          input.threading?.graphMessageId ?? null,
          input.attachments ?? null,
          input.hermesSkillRunId ?? null,
          input.hermesDraftText ?? null,
          input.now,
        ],
      );

      return result.rows[0]
        ? rowToScheduledSendWithDraft(result.rows[0])
        : undefined;
    },

    async rescheduleScheduledSend(input) {
      const result = await client.query<ScheduledSendRow>(
        `
          UPDATE scheduled_sends
          SET scheduled_at = $3::timestamptz,
              not_before = $4::timestamptz,
              attempts = 0,
              last_error = NULL,
              updated_at = $5::timestamptz
          WHERE account_id = $1
            AND id = $2
            AND status IN ('scheduled', 'failed')
          RETURNING ${scheduledColumns()}
        `,
        [
          input.accountId,
          input.scheduledId,
          input.scheduledAt,
          input.notBefore,
          input.now,
        ],
      );

      return result.rows[0] ? rowToScheduledSend(result.rows[0]) : undefined;
    },

    async cancelScheduledSend(input) {
      const result = await client.query<ScheduledSendRow>(
        `
          WITH cancelled AS (
            UPDATE scheduled_sends
            SET status = 'cancelled',
                cancelled_at = $3::timestamptz,
                completed_at = $3::timestamptz,
                updated_at = $3::timestamptz
            WHERE account_id = $1
              AND id = $2
              AND status IN ('scheduled', 'failed')
            RETURNING *
          ), released_draft AS (
            UPDATE email_drafts
            SET status = 'draft',
                updated_at = $3::timestamptz
            FROM cancelled
            WHERE email_drafts.account_id = cancelled.account_id
              AND email_drafts.id = cancelled.draft_id
              AND email_drafts.status = 'scheduled'
            RETURNING email_drafts.id
          )
          SELECT ${scheduledColumns("cancelled")}
          FROM cancelled
        `,
        [input.accountId, input.scheduledId, input.now],
      );

      return result.rows[0] ? rowToScheduledSend(result.rows[0]) : undefined;
    },

    async claimScheduledSendForSubmit(input) {
      const result = await client.query<ScheduledSendWithDraftRow>(
        `
          WITH claimed AS (
            UPDATE scheduled_sends
            SET status = 'sending',
                attempts = attempts + 1,
                lease_owner = $3,
                lease_expires_at = $4::timestamptz,
                last_error = NULL,
                updated_at = $5::timestamptz
            WHERE account_id = $1
              AND id = $2
              AND (
                status IN ('scheduled', 'failed')
                OR (
                  status = 'sending'
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at <= $5::timestamptz
                )
              )
            RETURNING *
          ), claimed_draft AS (
            UPDATE email_drafts
            SET status = 'sending',
                error_message = NULL,
                updated_at = $5::timestamptz
            FROM claimed
            WHERE email_drafts.account_id = claimed.account_id
              AND email_drafts.id = claimed.draft_id
              AND email_drafts.status IN ('scheduled', 'sending')
            RETURNING email_drafts.*
          )
          SELECT
            ${scheduledColumns("claimed", "scheduled_")},
            ${draftColumns("claimed_draft")},
            connected_accounts.email AS account_email,
            connected_accounts.sync_state,
            connected_accounts.engine_provider
          FROM claimed
          JOIN claimed_draft ON claimed_draft.id = claimed.draft_id
          JOIN connected_accounts ON connected_accounts.id = claimed.account_id
        `,
        [
          input.accountId,
          input.scheduledId,
          input.leaseOwner,
          input.leaseExpiresAt,
          input.now,
        ],
      );

      return result.rows[0]
        ? rowToScheduledSendWithDraft(result.rows[0])
        : undefined;
    },

    async markScheduledSendSent(input) {
      const result = await client.query<ScheduledSendRow>(
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
          ), sent_draft AS (
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
            RETURNING email_drafts.id
          )
          SELECT ${scheduledColumns("sent_schedule")}
          FROM sent_schedule
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

      return rowToScheduledSend(result.rows[0]);
    },

    async markScheduledSendFailed(input) {
      const result = await client.query<ScheduledSendRow>(
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
          ), failed_draft AS (
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
            RETURNING email_drafts.id
          )
          SELECT ${scheduledColumns("failed_schedule")}
          FROM failed_schedule
        `,
        [
          input.accountId,
          input.scheduledId,
          input.draftId,
          input.errorMessage,
          input.now,
        ],
      );

      return result.rows[0] ? rowToScheduledSend(result.rows[0]) : undefined;
    },
  };
}

function draftColumns(prefix?: string): string {
  const base = prefix ? `${prefix}.` : "";
  return [
    "id",
    "account_id",
    "from_address",
    "from_name",
    "subject",
    "to_emails",
    "cc_emails",
    "bcc_emails",
    "body_text",
    "body_html",
    "status",
    "source",
    "reply_to_message_id",
    "source_message_id",
    "thread_action",
    "thread_in_reply_to",
    "thread_references",
    "thread_emailengine_message_id",
    "thread_gmail_thread_id",
    "thread_graph_message_id",
    "attachment_manifest",
    "hermes_skill_run_id",
    "hermes_draft_text",
    "provider_queue_id",
    "provider_message_id",
    "error_message",
    "created_at",
    "updated_at",
    "sent_at",
  ]
    .map((column) => `${base}${column}`)
    .join(", ");
}

function scheduledColumns(prefix?: string, aliasPrefix = ""): string {
  const base = prefix ? `${prefix}.` : "";
  const columns = [
    "id",
    "account_id",
    "draft_id",
    "scheduled_at",
    "status",
    "attempts",
    "max_attempts",
    "not_before",
    "provider_queue_id",
    "provider_message_id",
    "last_error",
    "created_at",
    "updated_at",
    "sent_at",
    "cancelled_at",
    "completed_at",
  ];

  return columns
    .map((column) =>
      aliasPrefix
        ? `${base}${column} AS ${aliasPrefix}${column}`
        : `${base}${column}`,
    )
    .join(", ");
}

function rowToDraftWithAccount(row: DraftRow): DraftWithAccount {
  const attachments = attachmentManifest(row.attachment_manifest);
  return {
    draft: rowToDraft(row, attachments),
    account: rowToAccount(row),
    ...(attachments.length > 0 ? { transportAttachments: attachments } : {}),
  };
}

function rowToScheduledSendWithDraft(
  row: ScheduledSendWithDraftRow,
): ScheduledSendWithDraft {
  const attachments = attachmentManifest(row.attachment_manifest);
  return {
    scheduledSend: rowToScheduledSend({
      id: row.scheduled_id,
      account_id: row.scheduled_account_id,
      draft_id: row.scheduled_draft_id,
      scheduled_at: row.scheduled_at,
      status: row.scheduled_status,
      attempts: row.scheduled_attempts,
      max_attempts: row.scheduled_max_attempts,
      not_before: row.scheduled_not_before,
      provider_queue_id: row.scheduled_provider_queue_id,
      provider_message_id: row.scheduled_provider_message_id,
      last_error: row.scheduled_last_error,
      created_at: row.scheduled_created_at,
      updated_at: row.scheduled_updated_at,
      sent_at: row.scheduled_sent_at,
      cancelled_at: row.scheduled_cancelled_at,
      completed_at: row.scheduled_completed_at,
    }),
    draft: rowToDraft(row, attachments),
    account: rowToAccount(row),
    ...(attachments.length > 0 ? { transportAttachments: attachments } : {}),
  };
}

function rowToScheduledSend(row: ScheduledSendRow): ScheduledSend {
  const status = scheduledStatus(row.status);
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    draftId: String(row.draft_id),
    scheduledAt: toIsoString(row.scheduled_at),
    status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    notBefore: toIsoString(row.not_before),
    canEdit: status === "scheduled" || status === "failed",
    canSendNow: status === "scheduled" || status === "failed",
    canDelete: status === "scheduled" || status === "failed",
    ...(row.provider_queue_id ? { providerQueueId: row.provider_queue_id } : {}),
    ...(row.provider_message_id
      ? { providerMessageId: row.provider_message_id }
      : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.sent_at ? { sentAt: toIsoString(row.sent_at) } : {}),
    ...(row.cancelled_at
      ? { cancelledAt: toIsoString(row.cancelled_at) }
      : {}),
    ...(row.completed_at
      ? { completedAt: toIsoString(row.completed_at) }
      : {}),
  };
}

function rowToDraft(
  row: DraftRow,
  transportAttachments = attachmentManifest(row.attachment_manifest),
): MailDraft {
  const threading = rowToThreading(row);
  const attachments = publicAttachments(transportAttachments);
  return {
    id: String(row.id),
    accountId: String(row.account_id),
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
    status: draftStatus(row.status),
    source: draftSource(row.source),
    ...(row.reply_to_message_id
      ? { replyToMessageId: row.reply_to_message_id }
      : {}),
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(threading ? { threading } : {}),
    ...(row.hermes_skill_run_id
      ? { hermesSkillRunId: row.hermes_skill_run_id }
      : {}),
    ...(row.hermes_draft_text ? { hermesDraftText: row.hermes_draft_text } : {}),
    ...(row.provider_queue_id ? { providerQueueId: row.provider_queue_id } : {}),
    ...(row.provider_message_id
      ? { providerMessageId: row.provider_message_id }
      : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.sent_at ? { sentAt: toIsoString(row.sent_at) } : {}),
  };
}

function publicAttachments(
  attachments: MailDraftTransportAttachment[],
): MailDraftAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    source: attachment.source,
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    inline: attachment.inline,
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
  }));
}

function attachmentManifest(value: unknown): MailDraftTransportAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = recordValue(item);
      const id = textValue(record.id) ?? textValue(record.attachmentId);
      const attachmentId = textValue(record.attachmentId) ?? id;
      const providerAttachmentId = textValue(record.providerAttachmentId);
      const contentBase64 = textValue(record.contentBase64);
      const source =
        record.source === undefined || record.source === "message_attachment"
          ? "message_attachment"
          : record.source === "uploaded_file"
            ? "uploaded_file"
            : undefined;
      if (!id || !attachmentId || !source) {
        return undefined;
      }

      const contentId = textValue(record.contentId);
      if (source === "uploaded_file" && !contentBase64) {
        return undefined;
      }
      if (
        source === "message_attachment" &&
        !providerAttachmentId &&
        !contentBase64
      ) {
        return undefined;
      }
      return {
        id: sanitizeText(id),
        source,
        attachmentId: sanitizeText(attachmentId),
        filename: sanitizeFilename(textValue(record.filename) ?? "attachment"),
        contentType: sanitizeContentType(
          textValue(record.contentType) ?? "application/octet-stream",
        ),
        byteSize: Math.max(0, numberValue(record.byteSize)),
        inline: record.inline === true,
        ...(contentId ? { contentId: sanitizeText(contentId) } : {}),
        ...(providerAttachmentId
          ? { providerAttachmentId: sanitizeText(providerAttachmentId) }
          : {}),
        ...(contentBase64 ? { contentBase64 } : {}),
      };
    })
    .filter((item): item is MailDraftTransportAttachment => Boolean(item));
}

function rowToThreading(row: DraftRow): MailThreading | undefined {
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

function rowToAccount(row: DraftRow): MailComposeAccount {
  return {
    accountId: String(row.account_id),
    email: String(row.account_email),
    syncState:
      row.sync_state === "paused"
        ? "paused"
        : row.sync_state === "syncing"
          ? "syncing"
          : "reauth_required",
    engineProvider: row.engine_provider === "native" ? "native" : "emailengine",
  };
}

function addresses(value: unknown): MailAddress[] {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") {
            return undefined;
          }
          const record = item as Record<string, unknown>;
          const address = record.address;
          const name = record.name;
          if (typeof address !== "string") {
            return undefined;
          }
          return {
            address,
            ...(typeof name === "string" ? { name } : {}),
          };
        })
        .filter((item): item is MailAddress => Boolean(item))
    : [];
}

function draftStatus(value: string): MailDraftStatus {
  if (
    value === "scheduled" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed"
  ) {
    return value;
  }
  return "draft";
}

function draftSource(value: string): MailDraft["source"] {
  if (
    value === "hermes_reply" ||
    value === "reply" ||
    value === "reply_all" ||
    value === "forward"
  ) {
    return value;
  }
  return "manual";
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

function scheduledStatus(value: string): ScheduledSendStatus {
  if (
    value === "queued" ||
    value === "sending" ||
    value === "sent" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "dead_letter"
  ) {
    return value;
  }
  return "scheduled";
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
