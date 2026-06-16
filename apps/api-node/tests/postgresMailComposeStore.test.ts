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
              source_message_id: null,
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
      null,
      [],
      null,
      null,
      null,
      [],
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

  it("lists only editable draft rows by most recent update", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            draftRow({
              id: "draft_2",
              from_address: "support@example.com",
              from_name: "Support",
              subject: "Recent draft",
              attachment_manifest: [
                {
                  id: "upload_1",
                  source: "uploaded_file",
                  attachmentId: "upload_1",
                  storageKey: "11111111-1111-4111-8111-111111111111",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                  contentBase64: "cGxhbg==",
                },
              ],
              hermes_skill_run_id: "run_1",
              hermes_draft_text: "Original Hermes body",
              updated_at: "2026-06-13T09:00:00.000Z",
            }),
          ],
        };
      },
    });

    const result = await store.listDrafts({ accountId: "acc_1", limit: 20 });

    expect(queries[0].text).toMatch(/FROM email_drafts/i);
    expect(queries[0].text).toMatch(/status = 'draft'/i);
    expect(queries[0].text).toMatch(
      /ORDER BY updated_at DESC, created_at DESC, id DESC/i,
    );
    expect(queries[0].values).toEqual(["acc_1", 20]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "draft_2",
        status: "draft",
        from: { address: "support@example.com", name: "Support" },
        subject: "Recent draft",
        hermesSkillRunId: "run_1",
        hermesDraftText: "Original Hermes body",
        attachments: [
          {
            id: "upload_1",
            source: "uploaded_file",
            attachmentId: "upload_1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            filename: "plan.pdf",
            contentType: "application/pdf",
            byteSize: 4,
            inline: false,
          },
        ],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("cGxhbg==");
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
              source_message_id: "message_1",
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
      sourceMessageId: "message_1",
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
      sourceMessageId: "message_1",
      hermesSkillRunId: "run_reply_1",
      hermesDraftText:
        "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
    });
  });

  it("updates only editable draft rows", async () => {
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
              subject: "Updated subject",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Updated body",
              body_html: null,
              status: "draft",
              source: "reply",
              reply_to_message_id: "message_1",
              source_message_id: "message_1",
              hermes_skill_run_id: "run_1",
              hermes_draft_text: "Original Hermes body",
              provider_queue_id: null,
              provider_message_id: null,
              error_message: null,
              created_at: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:30:00.000Z",
              sent_at: null,
            },
          ],
        };
      },
    });

    const draft = await store.updateDraft({
      accountId: "acc_1",
      draftId: "draft_1",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Updated subject",
      bodyText: "Updated body",
      source: "reply",
      replyToMessageId: "message_1",
      sourceMessageId: "message_1",
      hermesSkillRunId: "run_1",
      hermesDraftText: "Original Hermes body",
      now: "2026-06-13T08:30:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/AND status = 'draft'/i);
    expect(queries[0].text).toMatch(/error_message = NULL/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "draft_1",
      null,
      null,
      "Updated subject",
      [{ address: "lina@example.com" }],
      [],
      [],
      "Updated body",
      null,
      "reply",
      "message_1",
      "message_1",
      null,
      null,
      [],
      null,
      null,
      null,
      [],
      "run_1",
      "Original Hermes body",
      "2026-06-13T08:30:00.000Z",
    ]);
    expect(draft).toMatchObject({
      id: "draft_1",
      subject: "Updated subject",
      bodyText: "Updated body",
      source: "reply",
      replyToMessageId: "message_1",
      hermesSkillRunId: "run_1",
    });
  });

  it("stores draft attachment manifests without exposing provider ids in the DTO", async () => {
    const manifest = [
      {
        id: "attachment_1",
        source: "message_attachment",
        attachmentId: "attachment_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
        inline: false,
        providerAttachmentId: "ee_attachment_1",
        contentBase64: "Zm9yd2FyZA==",
      },
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
        contentBase64: "aGVsbG8=",
      },
    ];
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
              subject: "Fwd: Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Forwarding the proposal.",
              body_html: null,
              status: "draft",
              source: "forward",
              reply_to_message_id: null,
              source_message_id: "message_1",
              thread_action: null,
              thread_in_reply_to: null,
              thread_references: [],
              thread_emailengine_message_id: null,
              thread_gmail_thread_id: null,
              thread_graph_message_id: null,
              attachment_manifest: manifest,
              hermes_skill_run_id: null,
              hermes_draft_text: null,
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
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Fwd: Launch confirmation",
      bodyText: "Forwarding the proposal.",
      source: "forward",
      sourceMessageId: "message_1",
      attachments: manifest as any,
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/attachment_manifest/i);
    expect(queries[0].values).toContainEqual(manifest);
    expect(JSON.stringify(draft)).not.toContain("ee_attachment_1");
    expect(JSON.stringify(draft)).not.toContain("aGVsbG8=");
    expect(JSON.stringify(draft)).not.toContain("Zm9yd2FyZA==");
    expect(draft.attachments).toEqual([
      {
        id: "attachment_1",
        source: "message_attachment",
        attachmentId: "attachment_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
        inline: false,
      },
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      },
    ]);
  });

  it("hydrates private attachment content for transport without exposing it", async () => {
    const manifest = [
      {
        id: "attachment_1",
        source: "message_attachment",
        attachmentId: "attachment_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: 7,
        inline: false,
        providerAttachmentId: "ee_attachment_1",
        contentBase64: "Zm9yd2FyZA==",
      },
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
        contentBase64: "aGVsbG8=",
      },
    ];
    const store = createPostgresMailComposeStore({
      async query() {
        return {
          rows: [
            {
              id: "draft_1",
              account_id: "acc_1",
              from_address: null,
              from_name: null,
              subject: "Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Looks good.",
              body_html: null,
              status: "draft",
              source: "manual",
              reply_to_message_id: null,
              source_message_id: null,
              thread_action: null,
              thread_in_reply_to: null,
              thread_references: [],
              thread_emailengine_message_id: null,
              thread_gmail_thread_id: null,
              thread_graph_message_id: null,
              attachment_manifest: manifest,
              hermes_skill_run_id: null,
              hermes_draft_text: null,
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

    const result = await store.getDraftWithAccount({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(JSON.stringify(result?.draft)).not.toContain("aGVsbG8=");
    expect(JSON.stringify(result?.draft)).not.toContain("ee_attachment_1");
    expect(JSON.stringify(result?.draft)).not.toContain("Zm9yd2FyZA==");
    expect(result?.draft.attachments).toEqual([
      {
        id: "attachment_1",
        source: "message_attachment",
        attachmentId: "attachment_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: 7,
        inline: false,
      },
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      },
    ]);
    expect(result?.transportAttachments).toEqual([
      {
        id: "attachment_1",
        source: "message_attachment",
        attachmentId: "attachment_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: 7,
        inline: false,
        providerAttachmentId: "ee_attachment_1",
        contentBase64: "Zm9yd2FyZA==",
      },
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
        contentBase64: "aGVsbG8=",
      },
    ]);
  });

  it("keeps uploaded attachment storage references in the private manifest", async () => {
    const storageKey = "11111111-1111-4111-8111-111111111111";
    const manifest = [
      {
        id: `upload_${storageKey}`,
        source: "uploaded_file",
        attachmentId: `upload_${storageKey}`,
        storageKey,
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      },
    ];
    const store = createPostgresMailComposeStore({
      async query() {
        return {
          rows: [
            {
              ...draftRow({
                attachment_manifest: manifest,
              }),
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const result = await store.getDraftWithAccount({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(JSON.stringify(result?.draft)).not.toContain("contentBase64");
    expect(result?.draft.attachments).toEqual([
      {
        id: `upload_${storageKey}`,
        source: "uploaded_file",
        attachmentId: `upload_${storageKey}`,
        storageKey,
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      },
    ]);
    expect(result?.transportAttachments).toEqual([
      {
        id: `upload_${storageKey}`,
        source: "uploaded_file",
        attachmentId: `upload_${storageKey}`,
        storageKey,
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      },
    ]);
  });

  it("persists reply threading metadata with the draft", async () => {
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
              subject: "Re: Launch confirmation",
              to_emails: [{ address: "lina@example.com" }],
              cc_emails: [],
              bcc_emails: [],
              body_text: "Thanks.",
              body_html: null,
              status: "draft",
              source: "reply",
              reply_to_message_id: "message_1",
              source_message_id: "message_1",
              thread_action: "reply",
              thread_in_reply_to: "<source@example.com>",
              thread_references: [
                "<root@example.com>",
                "<source@example.com>",
              ],
              thread_emailengine_message_id: "emailengine_msg_1",
              thread_gmail_thread_id: "gmail_thread_1",
              thread_graph_message_id: "graph_msg_1",
              hermes_skill_run_id: null,
              hermes_draft_text: null,
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
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Re: Launch confirmation",
      bodyText: "Thanks.",
      source: "reply",
      replyToMessageId: "message_1",
      sourceMessageId: "message_1",
      threading: {
        action: "reply",
        inReplyTo: "<source@example.com>",
        references: ["<root@example.com>", "<source@example.com>"],
        emailEngineMessageId: "emailengine_msg_1",
        gmailThreadId: "gmail_thread_1",
        graphMessageId: "graph_msg_1",
      },
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/thread_action/i);
    expect(queries[0].values).toEqual([
      "draft_1",
      "acc_1",
      null,
      null,
      "Re: Launch confirmation",
      [{ address: "lina@example.com" }],
      [],
      [],
      "Thanks.",
      null,
      "reply",
      "message_1",
      "message_1",
      "reply",
      "<source@example.com>",
      ["<root@example.com>", "<source@example.com>"],
      "emailengine_msg_1",
      "gmail_thread_1",
      "graph_msg_1",
      [],
      null,
      null,
      "2026-06-13T08:00:00.000Z",
    ]);
    expect(draft).toMatchObject({
      id: "draft_1",
      source: "reply",
      replyToMessageId: "message_1",
      sourceMessageId: "message_1",
      threading: {
        action: "reply",
        inReplyTo: "<source@example.com>",
        references: ["<root@example.com>", "<source@example.com>"],
        emailEngineMessageId: "emailengine_msg_1",
        gmailThreadId: "gmail_thread_1",
        graphMessageId: "graph_msg_1",
      },
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
              source_message_id: null,
              thread_action: null,
              thread_in_reply_to: null,
              thread_references: [],
              thread_emailengine_message_id: null,
              thread_gmail_thread_id: null,
              thread_graph_message_id: null,
              attachment_manifest: [
                {
                  id: "attachment_1",
                  source: "message_attachment",
                  attachmentId: "attachment_1",
                  filename: "proposal.pdf",
                  contentType: "application/pdf",
                  byteSize: 7,
                  inline: false,
                  providerAttachmentId: "ee_attachment_1",
                  contentBase64: "Zm9yd2FyZA==",
                },
              ],
              hermes_skill_run_id: null,
              hermes_draft_text: null,
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
      status: "scheduled",
      idempotencyKey: "compose:draft_1:schedule:2026-06-13T12:30:00.000Z",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/WITH draft_lock AS/i);
    expect(queries[0].text).toMatch(/FOR UPDATE/i);
    expect(queries[0].text).toMatch(/existing_send AS/i);
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/status = 'scheduled'/i);
    expect(queries[0].text).toMatch(/INSERT INTO scheduled_sends/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/i);
    expect(queries[0].text).toMatch(/SELECT \* FROM existing_send/i);
    expect(queries[0].values).toEqual([
      "schedule_1",
      "acc_1",
      "draft_1",
      "2026-06-13T12:30:00.000Z",
      "2026-06-13T12:30:00.000Z",
      "compose:draft_1:schedule:2026-06-13T12:30:00.000Z",
      "2026-06-13T08:00:00.000Z",
      "scheduled",
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

  it("queues an existing scheduled send for immediate worker pickup", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            scheduledRow({
              status: "queued",
              scheduled_at: "2026-06-13T08:00:00.000Z",
              not_before: "2026-06-13T08:00:00.000Z",
              updated_at: "2026-06-13T08:00:00.000Z",
            }),
          ],
        };
      },
    });

    const result = await store.queueScheduledSendNow({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      scheduledAt: "2026-06-13T08:00:00.000Z",
      notBefore: "2026-06-13T08:00:00.000Z",
      now: "2026-06-13T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE scheduled_sends/i);
    expect(queries[0].text).toMatch(/status = 'queued'/i);
    expect(queries[0].text).toMatch(/lease_owner = NULL/i);
    expect(queries[0].text).toMatch(/lease_expires_at = NULL/i);
    expect(queries[0].text).toMatch(/last_error = NULL/i);
    expect(queries[0].text).toMatch(/status IN \('scheduled', 'failed'\)/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "2026-06-13T08:00:00.000Z",
      "2026-06-13T08:00:00.000Z",
      "2026-06-13T08:00:00.000Z",
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      status: "queued",
      notBefore: "2026-06-13T08:00:00.000Z",
      canEdit: false,
      canSendNow: false,
      canDelete: false,
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

  it("loads only editable scheduled outbox drafts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...scheduledRowWithPrefix(),
              ...draftRow({ status: "scheduled" }),
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const result = await store.getScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(queries[0].text).toMatch(/FROM scheduled_sends/i);
    expect(queries[0].text).toMatch(/JOIN email_drafts/i);
    expect(queries[0].text).toMatch(
      /scheduled_sends.status IN \('scheduled', 'failed'\)/i,
    );
    expect(queries[0].text).toMatch(/email_drafts.status = 'scheduled'/i);
    expect(queries[0].values).toEqual(["acc_1", "schedule_1"]);
    expect(result).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        status: "scheduled",
      },
      draft: {
        id: "draft_1",
        status: "scheduled",
        subject: "Launch confirmation",
      },
      account: {
        engineProvider: "emailengine",
      },
    });
  });

  it("updates only editable scheduled outbox drafts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...scheduledRowWithPrefix({
                scheduled_status: "scheduled",
                scheduled_attempts: 0,
                scheduled_last_error: null,
              }),
              ...draftRow({
                status: "scheduled",
                subject: "Edited scheduled launch",
                body_text: "Edited body.",
                updated_at: "2026-06-13T08:30:00.000Z",
              }),
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const result = await store.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      from: { address: "support@example.com", name: "Support" },
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Edited scheduled launch",
      bodyText: "Edited body.",
      source: "manual",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "plan.pdf",
          contentType: "application/pdf",
          byteSize: 4,
          inline: false,
          contentBase64: "cGxhbg==",
        },
      ],
      now: "2026-06-13T08:30:00.000Z",
    });

    expect(queries[0].text).toMatch(/WITH editable_schedule AS/i);
    expect(queries[0].text).toMatch(/UPDATE scheduled_sends/i);
    expect(queries[0].text).toMatch(/status = 'scheduled'/i);
    expect(queries[0].text).toMatch(/attempts = 0/i);
    expect(queries[0].text).toMatch(/last_error = NULL/i);
    expect(queries[0].text).toMatch(
      /AND status IN \('scheduled', 'failed'\)/i,
    );
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/email_drafts.status = 'scheduled'/i);
    expect(queries[0].text).toMatch(/attachment_manifest = COALESCE/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "support@example.com",
      "Support",
      "Edited scheduled launch",
      [{ address: "lina@example.com" }],
      [],
      [],
      "Edited body.",
      null,
      "manual",
      null,
      null,
      null,
      null,
      [],
      null,
      null,
      null,
      [
        {
          id: "upload_1",
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "plan.pdf",
          contentType: "application/pdf",
          byteSize: 4,
          inline: false,
          contentBase64: "cGxhbg==",
        },
      ],
      null,
      null,
      "2026-06-13T08:30:00.000Z",
    ]);
    expect(result).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        status: "scheduled",
        attempts: 0,
        canEdit: true,
      },
      draft: {
        id: "draft_1",
        status: "scheduled",
        subject: "Edited scheduled launch",
        bodyText: "Edited body.",
      },
    });
    expect(JSON.stringify(result?.draft)).not.toContain("cGxhbg==");
  });

  it("preserves scheduled draft attachments when no attachment payload is sent", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...scheduledRowWithPrefix(),
              ...draftRow({
                status: "scheduled",
                body_text: "Body-only edit.",
                attachment_manifest: [
                  {
                    id: "upload_1",
                    source: "uploaded_file",
                    attachmentId: "upload_1",
                    filename: "plan.pdf",
                    contentType: "application/pdf",
                    byteSize: 4,
                    inline: false,
                    contentBase64: "cGxhbg==",
                  },
                ],
              }),
              account_email: "me@example.com",
              sync_state: "syncing",
              engine_provider: "emailengine",
            },
          ],
        };
      },
    });

    const result = await store.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Launch confirmation",
      bodyText: "Body-only edit.",
      source: "manual",
      now: "2026-06-13T08:30:00.000Z",
    });

    expect(queries[0].text).toMatch(/attachment_manifest = COALESCE/i);
    expect(queries[0].values?.[19]).toBeNull();
    expect(result?.draft.attachments).toEqual([
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "plan.pdf",
        contentType: "application/pdf",
        byteSize: 4,
        inline: false,
      },
    ]);
    expect(JSON.stringify(result?.draft)).not.toContain("cGxhbg==");
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
              source_message_id: null,
              thread_action: null,
              thread_in_reply_to: null,
              thread_references: [],
              thread_emailengine_message_id: null,
              thread_gmail_thread_id: null,
              thread_graph_message_id: null,
              attachment_manifest: [
                {
                  id: "attachment_1",
                  source: "message_attachment",
                  attachmentId: "attachment_1",
                  filename: "proposal.pdf",
                  contentType: "application/pdf",
                  byteSize: 7,
                  inline: false,
                  providerAttachmentId: "ee_attachment_1",
                  contentBase64: "Zm9yd2FyZA==",
                },
              ],
              hermes_skill_run_id: null,
              hermes_draft_text: null,
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
    expect(queries[0].text).toMatch(/status IN \('scheduled', 'queued', 'failed'\)/i);
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
    expect(JSON.stringify(result?.draft)).not.toContain("ee_attachment_1");
    expect(JSON.stringify(result?.draft)).not.toContain("Zm9yd2FyZA==");
    expect(result?.transportAttachments).toEqual([
      {
        id: "attachment_1",
        source: "message_attachment",
        attachmentId: "attachment_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: 7,
        inline: false,
        providerAttachmentId: "ee_attachment_1",
        contentBase64: "Zm9yd2FyZA==",
      },
    ]);
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

function draftRow(overrides = {}) {
  return {
    id: "draft_1",
    account_id: "acc_1",
    from_address: null,
    from_name: null,
    subject: "Launch confirmation",
    to_emails: [{ address: "lina@example.com" }],
    cc_emails: [],
    bcc_emails: [],
    body_text: "Looks good.",
    body_html: null,
    status: "draft",
    source: "manual",
    reply_to_message_id: null,
    source_message_id: null,
    thread_action: null,
    thread_in_reply_to: null,
    thread_references: [],
    thread_emailengine_message_id: null,
    thread_gmail_thread_id: null,
    thread_graph_message_id: null,
    attachment_manifest: [],
    hermes_skill_run_id: null,
    hermes_draft_text: null,
    provider_queue_id: null,
    provider_message_id: null,
    error_message: null,
    created_at: "2026-06-13T08:00:00.000Z",
    updated_at: "2026-06-13T08:00:00.000Z",
    sent_at: null,
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
