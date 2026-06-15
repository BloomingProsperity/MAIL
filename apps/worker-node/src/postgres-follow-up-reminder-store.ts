import type { Queryable } from "./postgres-sync-job-queue.js";
import type {
  FollowUpReminderJob,
  FollowUpReminderStore,
} from "./follow-up-reminder-runner.js";

interface FollowUpReminderRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  message_id: string;
  kind: string;
  due_at: string | Date;
  title: string | null;
  note: string | null;
}

export function createPostgresFollowUpReminderStore(
  client: Queryable,
): FollowUpReminderStore {
  return {
    async claimNextDueFollowUp(input) {
      const leaseExpiresAt = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      const result = await client.query<FollowUpReminderRow>(
        `
          WITH candidate AS (
            SELECT id
            FROM follow_up_reminders
            WHERE status = 'open'
              AND due_at <= $1::timestamptz
              AND (
                lease_expires_at IS NULL
                OR lease_expires_at <= $1::timestamptz
              )
            ORDER BY due_at ASC, created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE follow_up_reminders
          SET lease_owner = $2,
              lease_expires_at = $3::timestamptz,
              updated_at = $1::timestamptz
          FROM candidate
          WHERE follow_up_reminders.id = candidate.id
          RETURNING
            follow_up_reminders.id,
            follow_up_reminders.account_id,
            follow_up_reminders.message_id,
            follow_up_reminders.kind,
            follow_up_reminders.due_at,
            follow_up_reminders.title,
            follow_up_reminders.note
        `,
        [input.now.toISOString(), input.workerId, leaseExpiresAt.toISOString()],
      );

      return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
    },

    async promoteDueFollowUp(input) {
      await client.query(
        `
          WITH due_followup AS (
            UPDATE follow_up_reminders
            SET status = 'due',
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = $3::timestamptz
            WHERE id = $1
              AND message_id = $2
              AND status = 'open'
            RETURNING message_id
          )
          INSERT INTO message_classification (
            message_id,
            bucket,
            priority_score,
            reasons,
            classified_by
          )
          SELECT
            due_followup.message_id,
            'P3 Needs Action',
            85,
            ARRAY['Follow-up reminder is due'],
            'follow_up_reminder'
          FROM due_followup
          ON CONFLICT (message_id) DO UPDATE
          SET bucket = 'P3 Needs Action',
              priority_score = GREATEST(
                message_classification.priority_score,
                EXCLUDED.priority_score
              ),
              reasons = (
                SELECT ARRAY(
                  SELECT DISTINCT reason
                  FROM unnest(
                    message_classification.reasons || EXCLUDED.reasons
                  ) AS reason
                )
              ),
              classified_by = 'follow_up_reminder',
              updated_at = $3::timestamptz
        `,
        [input.followUpId, input.messageId, input.now.toISOString()],
      );
    },
  };
}

function rowToJob(row: FollowUpReminderRow): FollowUpReminderJob {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    messageId: String(row.message_id),
    kind: String(row.kind),
    dueAt: toIsoString(row.due_at),
    ...(row.title ? { title: row.title } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
