import { describe, expect, it } from "vitest";

import { createPostgresMailComposeStore } from "../src/mail-compose/postgres-mail-compose-store";

describe("Postgres mail compose store", () => {
  it("inserts app-owned draft rows without provider payloads", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "draft_1",
              account_id: "acc_1",
              from_address: null,
              from_name: null,
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com", name: "Lina" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: "draft",
              source: "manual",
              reply_to_message_id: null,
              hermes_skill_run_id: null,
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
              sent_at: null,
            },
          ],
        };
      },
    });

    const draft = await store.createDraft({
      id: "draft_1",
      accountId: "acc_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
      source: "manual",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO email_drafts/i);
    expect(JSON.stringify(queries[0])).not.toMatch(/secret|provider_payload/i);
    expect(queries[0].values).toEqual([
      "draft_1",
      "acc_1",
      null,
      null,
      "Launch confirmation",
      [{ address: "lina@example.com", name: "Lina" }],
      [],
      [],
      "Looks good.",
      null,
      "manual",
      null,
      null,
      null,
      "2026-06-13T08:00:00.000Z",
    ]);
    expect(draft).toMatchObject({
      id: "draft_1",
      accountId: "acc_1",
      status: "draft",
    });
  });

  it("persists the original Hermes reply text for later draft feedback", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "draft_1",
              account_id: "acc_1",
              from_address: "support@demo.site",
              from_name: "Support",
              subject: "Re: Launch confirmation",
              to_emails: [{ address: "lina@example.com", name: "Lina" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Hi Lina,\n\nConfirmed for Thursday.",
              body_html: null,
              status: "draft",
              source: "hermes_reply",
              reply_to_message_id: "message_1",
              hermes_skill_run_id: "run_reply_1",
              hermes_draft_text:
                "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
              sent_at: null,
            },
          ],
        };
      },
    });

    const draft = await store.createDraft({
      id: "draft_1",
      accountId: "acc_1",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [],
      subject: "Re: Launch confirmation",
      bodyText: "Hi Lina,\n\nConfirmed for Thursday.",
      source: "hermes_reply",
      replyToMessageId: "message_1",
      hermesSkillRunId: "run_reply_1",
      hermesDraftText:
        "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/hermes_draft_text/i);
    expect(queries[0].values).toContain("support@demo.site");
    expect(queries[0].values).toContain("Support");
    expect(queries[0].values).toContain(
      "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
    );
    expect(draft).toMatchObject({
      id: "draft_1",
      source: "hermes_reply",
      from: { address: "support@demo.site", name: "Support" },
      hermesSkillRunId: "run_reply_1",
      hermesDraftText:
        "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
    });
  });

  it("loads draft with account state and engine before sending", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "draft_1",
              account_id: "acc_1",
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: "draft",
              source: "manual",
              reply_to_message_id: null,
              hermes_skill_run_id: null,
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
              sent_at: null,
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const loaded = await store.getDraftWithAccount({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(queries[0].text).toMatch(/JOIN connected_accounts/i);
    expect(queries[0].values).toEqual(["acc_1", "draft_1"]);
    expect(loaded).toMatchObject({
      account: {
        accountId: "acc_1",
        email: "me@example.com",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
      draft: {
        id: "draft_1",
        status: "draft",
      },
    });
  });

  it("claims only draft-status rows and records provider queue result", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "draft_1",
              account_id: "acc_1",
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: text.includes("provider_queue_id") ? "sent" : "sending",
              source: "manual",
              reply_to_message_id: null,
              hermes_skill_run_id: null,
              provider_queue_id: "queue_1",
              provider_message_id: "<message@example.com>",
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:01:00.000Z",
              sent_at: "2026-06-13T08:01:00.000Z",
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    await store.claimDraftForSend({
      accountId: "acc_1",
      draftId: "draft_1",
      leaseOwner: "api-send-draft",
      leaseExpiresAt: "2026-06-13T08:01:00.000Z",
      now: "2026-06-13T08:00:00.000Z",
    });
    await store.markDraftSent({
      accountId: "acc_1",
      draftId: "draft_1",
      providerQueueId: "queue_1",
      providerMessageId: "<message@example.com>",
      sentAt: "2026-06-13T08:01:00.000Z",
    });

    expect(queries[0].text).toMatch(/status = 'sending'/i);
    expect(queries[0].text).toMatch(/status = 'draft'/i);
    expect(queries[0].text).toMatch(/send_lease_owner = \$3/i);
    expect(queries[0].text).toMatch(/send_lease_expires_at = \$4::timestamptz/i);
    expect(queries[1].text).toMatch(/provider_queue_id/i);
    expect(queries[1].values).toEqual([
      "acc_1",
      "draft_1",
      "queue_1",
      "<message@example.com>",
      "2026-06-13T08:01:00.000Z",
    ]);
  });

  it("reclaims expired sending draft leases without allowing active duplicates", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "draft_1",
              account_id: "acc_1",
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: "sending",
              source: "manual",
              reply_to_message_id: null,
              hermes_skill_run_id: null,
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
              sent_at: null,
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const claimed = await store.claimDraftForSend({
      accountId: "acc_1",
      draftId: "draft_1",
      leaseOwner: "api-send-draft",
      leaseExpiresAt: "2026-06-13T08:03:00.000Z",
      now: "2026-06-13T08:02:00.000Z",
    });

    expect(queries[0].text).toMatch(/status = 'sending'/i);
    expect(queries[0].text).toMatch(/send_lease_expires_at <= \$5::timestamptz/i);
    expect(queries[0].text).toMatch(/send_lease_owner = \$3/i);
    expect(queries[0].text).toMatch(/send_lease_expires_at = \$4::timestamptz/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "draft_1",
      "api-send-draft",
      "2026-06-13T08:03:00.000Z",
      "2026-06-13T08:02:00.000Z",
    ]);
    expect(claimed).toMatchObject({
      draft: {
        id: "draft_1",
        status: "sending",
      },
      account: {
        engineProvider: "emailengine",
      },
    });
  });

  it("schedules a draft by changing draft state and inserting a durable outbox row", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [scheduledRow()] };
      },
    });

    const result = await store.createScheduledSend({
      id: "schedule_1",
      accountId: "acc_1",
      draftId: "draft_1",
      scheduledAt: "2026-06-13T12:30:00.000Z",
      notBefore: "2026-06-13T12:30:00.000Z",
      idempotencyKey: "compose:draft_1:schedule:2026-06-13T12:30:00.000Z",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/WITH schedulable_draft AS/i);
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/status = 'scheduled'/i);
    expect(queries[0].text).toMatch(/INSERT INTO scheduled_sends/i);
    expect(queries[0].values).toEqual([
      "schedule_1",
      "acc_1",
      "draft_1",
      "2026-06-13T12:30:00.000Z",
      "2026-06-13T12:30:00.000Z",
      "compose:draft_1:schedule:2026-06-13T12:30:00.000Z",
      "2026-06-13T08:00:00.000Z",
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      accountId: "acc_1",
      draftId: "draft_1",
      status: "scheduled",
      canEdit: true,
      canSendNow: true,
    });
  });

  it("lists only active outbox scheduled sends", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [scheduledRow()] };
      },
    });

    const result = await store.listScheduledSends({
      accountId: "acc_1",
      limit: 20,
    });

    expect(queries[0].text).toMatch(/FROM scheduled_sends/i);
    expect(queries[0].text).toMatch(
      /status IN \('scheduled', 'queued', 'sending', 'failed'\)/i,
    );
    expect(queries[0].text).toMatch(/ORDER BY scheduled_at ASC/i);
    expect(queries[0].values).toEqual(["acc_1", 20]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "schedule_1",
        status: "scheduled",
        canSendNow: true,
      }),
    ]);
  });

  it("claims a scheduled send with a lease and moves the draft to sending", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...scheduledRowWithPrefix(),
              id: "draft_1",
              account_id: "acc_1",
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: "sending",
              source: "manual",
              reply_to_message_id: null,
              hermes_skill_run_id: null,
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
              sent_at: null,
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const result = await store.claimScheduledSendForSubmit({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      leaseOwner: "worker_1",
      leaseExpiresAt: "2026-06-13T08:01:00.000Z",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE scheduled_sends/i);
    expect(queries[0].text).toMatch(/lease_owner = \$3/i);
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/email_drafts.status IN \('scheduled', 'sending'\)/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "worker_1",
      "2026-06-13T08:01:00.000Z",
      "2026-06-13T08:00:00.000Z",
    ]);
    expect(result).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        status: "scheduled",
      },
      draft: {
        id: "draft_1",
        status: "sending",
      },
      account: {
        engineProvider: "emailengine",
      },
    });
  });

  it("reclaims expired sending scheduled sends for send-now", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...scheduledRowWithPrefix({
                scheduled_status: "sending",
                scheduled_attempts: 2,
              }),
              id: "draft_1",
              account_id: "acc_1",
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: "sending",
              source: "manual",
              reply_to_message_id: null,
              hermes_skill_run_id: null,
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
              sent_at: null,
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const result = await store.claimScheduledSendForSubmit({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      leaseOwner: "api-send-now",
      leaseExpiresAt: "2026-06-13T08:02:30.000Z",
      now: "2026-06-13T08:01:00.000Z",
    });

    expect(queries[0].text).toMatch(/status = 'sending'/i);
    expect(queries[0].text).toMatch(/lease_expires_at <= \$5::timestamptz/i);
    expect(queries[0].text).toMatch(/email_drafts\.status IN \('scheduled', 'sending'\)/i);
    expect(result).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        status: "sending",
        attempts: 2,
      },
      draft: {
        id: "draft_1",
        status: "sending",
      },
    });
  });

  it("marks the draft failed when scheduled send retries are exhausted", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            scheduledRow({
              status: "dead_letter",
              attempts: 5,
              max_attempts: 5,
              last_error: "SMTP rejected message",
            }),
          ],
        };
      },
    });

    const result = await store.markScheduledSendFailed({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      draftId: "draft_1",
      errorMessage: "SMTP rejected message",
      now: "2026-06-13T08:03:00.000Z",
    });

    expect(queries[0].text).toMatch(/status = CASE/i);
    expect(queries[0].text).toMatch(/WHEN attempts >= max_attempts THEN 'dead_letter'/i);
    expect(queries[0].text).toMatch(/lease_owner = NULL/i);
    expect(queries[0].text).toMatch(/lease_expires_at = NULL/i);
    expect(queries[0].text).toMatch(/WHEN failed_schedule.status = 'dead_letter' THEN 'failed'/i);
    expect(queries[0].text).toMatch(/ELSE 'scheduled'/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "draft_1",
      "SMTP rejected message",
      "2026-06-13T08:03:00.000Z",
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      status: "dead_letter",
      attempts: 5,
      maxAttempts: 5,
      lastError: "SMTP rejected message",
      canSendNow: false,
      canEdit: false,
    });
  });
});

function scheduledRow(overrides = {}) {
  return {
    id: "schedule_1",
    account_id: "acc_1",
    draft_id: "draft_1",
    scheduled_at: "2026-06-13T12:30:00.000Z",
    status: "scheduled",
    attempts: 0,
    max_attempts: 5,
    not_before: "2026-06-13T12:30:00.000Z",
    provider_queue_id: null,
    provider_message_id: null,
    last_error: null,
    created_at: "2026-06-13T08:00:00.000Z",
    updated_at: "2026-06-13T08:00:00.000Z",
    sent_at: null,
    cancelled_at: null,
    completed_at: null,
    ...overrides,
  };
}

function scheduledRowWithPrefix(overrides = {}) {
  return {
    scheduled_id: "schedule_1",
    scheduled_account_id: "acc_1",
    scheduled_draft_id: "draft_1",
    scheduled_at: "2026-06-13T12:30:00.000Z",
    scheduled_status: "scheduled",
    scheduled_attempts: 1,
    scheduled_max_attempts: 5,
    scheduled_not_before: "2026-06-13T12:30:00.000Z",
    scheduled_provider_queue_id: null,
    scheduled_provider_message_id: null,
    scheduled_last_error: null,
    scheduled_created_at: "2026-06-13T08:00:00.000Z",
    scheduled_updated_at: "2026-06-13T08:00:00.000Z",
    scheduled_sent_at: null,
    scheduled_cancelled_at: null,
    scheduled_completed_at: null,
    ...overrides,
  };
}
