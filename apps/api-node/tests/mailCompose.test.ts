import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  createMailComposeService,
  InvalidMailComposeRequestError,
  MAX_DRAFT_ATTACHMENT_BYTES,
  type MailComposeStore,
} from "../src/mail-compose/mail-compose";

describe("mail compose service", () => {
  it("creates an app-owned draft without calling a provider", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async createDraft(input) {
        calls.push(input);
        return {
          id: input.id,
          accountId: input.accountId,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          createdAt: input.now,
          updatedAt: input.now,
        };
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
      source: "hermes_reply",
      hermesSkillRunId: "run_1",
    });

    expect(calls).toEqual([
      {
        id: "draft_1",
        accountId: "acc_1",
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
        source: "hermes_reply",
        hermesSkillRunId: "run_1",
        now: "2026-06-13T08:00:00.000Z",
      },
    ]);
    expect(providerCalls).toEqual([]);
    expect(draft).toMatchObject({
      id: "draft_1",
      accountId: "acc_1",
      status: "draft",
      source: "hermes_reply",
    });
  });

  it("records Hermes reply draft edits when saving the composed draft", async () => {
    const feedbackCalls: unknown[] = [];
    const store = createStore({
      async createDraft(input) {
        return {
          id: input.id,
          accountId: input.accountId,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          hermesSkillRunId: input.hermesSkillRunId,
          hermesDraftText: input.hermesDraftText,
          createdAt: input.now,
          updatedAt: input.now,
        };
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {},
      hermesDraftFeedbackStore: {
        async recordDraftFeedback(input) {
          feedbackCalls.push(input);
          return {
            feedbackId: "feedback_1",
            skillRunId: input.skillRunId,
            learned: true,
            memoryId: "memory_1",
          };
        },
      },
    });

    await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      subject: "Re: Launch confirmation",
      bodyText: "Hi Lina,\n\nConfirmed for Thursday.",
      source: "hermes_reply",
      hermesSkillRunId: "run_reply_1",
      hermesDraftText:
        "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
    });

    expect(feedbackCalls).toEqual([
      {
        skillRunId: "run_reply_1",
        draftText:
          "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
        finalText: "Hi Lina,\n\nConfirmed for Thursday.",
        subject: "Re: Launch confirmation",
        recipientEmail: "lina@example.com",
      },
    ]);
  });

  it("updates an existing draft without creating a replacement", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async updateDraft(input) {
        calls.push(input);
        return {
          id: input.draftId,
          accountId: input.accountId,
          from: input.from,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          replyToMessageId: input.replyToMessageId,
          sourceMessageId: input.sourceMessageId,
          createdAt: "2026-06-13T07:00:00.000Z",
          updatedAt: input.now,
        };
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "unused_new_draft_id",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const draft = await service.updateDraft({
      accountId: "acc_1",
      draftId: "draft_existing",
      to: [{ address: "Lina@Example.com", name: "Lina" }],
      subject: " Re: Launch confirmation ",
      bodyText: "Updated body",
      source: "reply",
      replyToMessageId: "message_1",
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        draftId: "draft_existing",
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Re: Launch confirmation",
        bodyText: "Updated body",
        source: "reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        now: "2026-06-13T08:30:00.000Z",
      },
    ]);
    expect(draft).toMatchObject({
      id: "draft_existing",
      bodyText: "Updated body",
      sourceMessageId: "message_1",
    });
  });

  it("rejects updating missing or non-draft rows", async () => {
    const service = createMailComposeService({
      store: createStore({
        async updateDraft() {
          return undefined;
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    await expect(
      service.updateDraft({
        accountId: "acc_1",
        draftId: "sent_draft",
        to: [{ address: "lina@example.com" }],
        subject: "Cannot edit",
        bodyText: "This should not overwrite sent mail.",
      }),
    ).rejects.toThrow("draft was not found");
  });

  it("records Hermes feedback when updating an edited draft", async () => {
    const feedbackCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async updateDraft(input) {
          return {
            id: input.draftId,
            accountId: input.accountId,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            bodyText: input.bodyText,
            status: "draft",
            source: input.source,
            hermesSkillRunId: input.hermesSkillRunId,
            hermesDraftText: input.hermesDraftText,
            createdAt: "2026-06-13T07:00:00.000Z",
            updatedAt: input.now,
          };
        },
      }),
      createId: () => "unused",
      transports: {},
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      hermesDraftFeedbackStore: {
        async recordDraftFeedback(input) {
          feedbackCalls.push(input);
          return { feedbackId: "feedback_1" };
        },
      },
    });

    await service.updateDraft({
      accountId: "acc_1",
      draftId: "draft_1",
      to: [{ address: "lina@example.com" }],
      subject: "Re: Launch",
      bodyText: "Edited final reply.",
      source: "hermes_reply",
      hermesSkillRunId: "run_reply_1",
      hermesDraftText: "Original Hermes reply.",
    });

    expect(feedbackCalls).toEqual([
      {
        skillRunId: "run_reply_1",
        draftText: "Original Hermes reply.",
        finalText: "Edited final reply.",
        subject: "Re: Launch",
        recipientEmail: "lina@example.com",
      },
    ]);
  });

  it("resolves forwarded attachment refs before storing a draft", async () => {
    const contentBase64 = Buffer.from("forwarded bytes").toString("base64");
    const storeCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async createDraft(input) {
          storeCalls.push(input);
          return {
            id: input.id,
            accountId: input.accountId,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            bodyText: input.bodyText,
            source: input.source,
            attachments: input.attachments?.map((attachment) => ({
              id: attachment.id,
              source: attachment.source,
              attachmentId: attachment.attachmentId,
              filename: attachment.filename,
              contentType: attachment.contentType,
              byteSize: attachment.byteSize,
              inline: attachment.inline,
            })),
            status: "draft",
            createdAt: input.now,
            updatedAt: input.now,
          };
        },
      }),
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {},
      mailReadStore: {
        async getMessage() {
          throw new Error("not used");
        },
        async getAttachmentDownload(input) {
          expect(input).toEqual({
            accountId: "acc_1",
            attachmentId: "attachment_1",
          });
          return {
            id: "attachment_1",
            accountId: "acc_1",
            providerAttachmentId: "ee_attachment_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
          };
        },
      },
      attachmentContentStore: {
        async downloadAttachment(input) {
          expect(input).toEqual({
            accountId: "acc_1",
            providerAttachmentId: "ee_attachment_1",
            maxBytes: MAX_DRAFT_ATTACHMENT_BYTES,
          });
          return {
            bytes: Buffer.from("forwarded bytes"),
            contentType: "application/pdf",
          };
        },
      },
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com" }],
      subject: "Fwd: Launch confirmation",
      bodyText: "Forwarding the proposal.",
      source: "forward",
      sourceMessageId: "message_1",
      attachments: [
        {
          source: "message_attachment",
          attachmentId: "attachment_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
      ],
    });

    expect(storeCalls).toEqual([
      expect.objectContaining({
        attachments: [
          {
            id: "attachment_1",
            source: "message_attachment",
            attachmentId: "attachment_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: Buffer.byteLength("forwarded bytes"),
            inline: false,
            providerAttachmentId: "ee_attachment_1",
            contentBase64,
          },
        ],
      }),
    ]);
    expect(JSON.stringify(draft)).not.toContain("ee_attachment_1");
    expect(JSON.stringify(draft)).not.toContain(contentBase64);
    expect(draft.attachments?.[0]).toMatchObject({
      attachmentId: "attachment_1",
      filename: "proposal.pdf",
      byteSize: Buffer.byteLength("forwarded bytes"),
    });
  });

  it("rejects forwarded attachments when content download fails", async () => {
    let createDraftCalled = false;
    const service = createMailComposeService({
      store: createStore({
        async createDraft() {
          createDraftCalled = true;
          throw new Error("not expected");
        },
      }),
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {},
      mailReadStore: {
        async getMessage() {
          throw new Error("not used");
        },
        async getAttachmentDownload() {
          return {
            id: "attachment_1",
            accountId: "acc_1",
            providerAttachmentId: "ee_attachment_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
          };
        },
      },
      attachmentContentStore: {
        async downloadAttachment() {
          throw new Error("EmailEngine is unavailable");
        },
      },
    });

    await expect(
      service.createDraft({
        accountId: "acc_1",
        to: [{ address: "lina@example.com" }],
        subject: "Fwd: Launch confirmation",
        bodyText: "Forwarding the proposal.",
        source: "forward",
        sourceMessageId: "message_1",
        attachments: [
          {
            source: "message_attachment",
            attachmentId: "attachment_1",
          },
        ],
      }),
    ).rejects.toThrow("attachment download failed");
    expect(createDraftCalled).toBe(false);
  });

  it("rejects forwarded attachments when the content snapshot is too large", async () => {
    let createDraftCalled = false;
    const service = createMailComposeService({
      store: createStore({
        async createDraft() {
          createDraftCalled = true;
          throw new Error("not expected");
        },
      }),
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {},
      mailReadStore: {
        async getMessage() {
          throw new Error("not used");
        },
        async getAttachmentDownload() {
          return {
            id: "attachment_1",
            accountId: "acc_1",
            providerAttachmentId: "ee_attachment_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
          };
        },
      },
      attachmentContentStore: {
        async downloadAttachment() {
          throw new Error("attachments are too large");
        },
      },
    });

    await expect(
      service.createDraft({
        accountId: "acc_1",
        to: [{ address: "lina@example.com" }],
        subject: "Fwd: Launch confirmation",
        bodyText: "Forwarding the proposal.",
        source: "forward",
        sourceMessageId: "message_1",
        attachments: [
          {
            source: "message_attachment",
            attachmentId: "attachment_1",
          },
        ],
      }),
    ).rejects.toThrow("attachments are too large");
    expect(createDraftCalled).toBe(false);
  });

  it("stores uploaded attachment content snapshots without exposing base64", async () => {
    const contentBase64 = Buffer.from("hello attachment").toString("base64");
    const storeCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async createDraft(input) {
          storeCalls.push(input);
          return {
            id: input.id,
            accountId: input.accountId,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            bodyText: input.bodyText,
            source: input.source,
            attachments: input.attachments?.map((attachment) => ({
              id: attachment.id,
              source: attachment.source,
              attachmentId: attachment.attachmentId,
              filename: attachment.filename,
              contentType: attachment.contentType,
              byteSize: attachment.byteSize,
              inline: attachment.inline,
            })),
            status: "draft",
            createdAt: input.now,
            updatedAt: input.now,
          };
        },
      }),
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {},
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com" }],
      subject: "Launch confirmation",
      bodyText: "Please review the proposal.",
      attachments: [
        {
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 1,
          contentBase64,
        },
      ],
    });

    expect(storeCalls).toEqual([
      expect.objectContaining({
        attachments: [
          {
            id: "upload_1",
            source: "uploaded_file",
            attachmentId: "upload_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: Buffer.byteLength("hello attachment"),
            inline: false,
            contentBase64,
          },
        ],
      }),
    ]);
    expect(JSON.stringify(draft)).not.toContain(contentBase64);
    expect(draft.attachments).toEqual([
      {
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        filename: "proposal.pdf",
        contentType: "application/pdf",
        byteSize: Buffer.byteLength("hello attachment"),
        inline: false,
      },
    ]);
  });

  it("resolves provider threading metadata when creating reply drafts", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async createDraft(input) {
        calls.push(["create", input]);
        return {
          id: input.id,
          accountId: input.accountId,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          replyToMessageId: input.replyToMessageId,
          sourceMessageId: input.sourceMessageId,
          threading: input.threading,
          createdAt: input.now,
          updatedAt: input.now,
        };
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "draft_1",
      transports: {},
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      threadingStore: {
        async getThreadingMetadata(input) {
          calls.push(["threading", input]);
          return {
            action: input.action,
            inReplyTo: "<source@example.com>",
            references: ["<root@example.com>", "<source@example.com>"],
            emailEngineMessageId: "emailengine_msg_1",
            gmailThreadId: "gmail_thread_1",
            graphMessageId: "graph_msg_1",
          };
        },
      },
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com" }],
      subject: "Re: Launch confirmation",
      bodyText: "Thanks.",
      source: "reply_all",
      replyToMessageId: "message_1",
    });

    expect(calls).toEqual([
      [
        "threading",
        {
          accountId: "acc_1",
          messageId: "message_1",
          action: "reply_all",
        },
      ],
      [
        "create",
        expect.objectContaining({
          id: "draft_1",
          accountId: "acc_1",
          source: "reply_all",
          replyToMessageId: "message_1",
          sourceMessageId: "message_1",
          threading: {
            action: "reply_all",
            inReplyTo: "<source@example.com>",
            references: ["<root@example.com>", "<source@example.com>"],
            emailEngineMessageId: "emailengine_msg_1",
            gmailThreadId: "gmail_thread_1",
            graphMessageId: "graph_msg_1",
          },
        }),
      ],
    ]);
    expect(draft.threading).toEqual({
      action: "reply_all",
      inReplyTo: "<source@example.com>",
      references: ["<root@example.com>", "<source@example.com>"],
      emailEngineMessageId: "emailengine_msg_1",
      gmailThreadId: "gmail_thread_1",
      graphMessageId: "graph_msg_1",
    });
  });

  it("creates drafts with allowed send-as identities", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async createDraft(input) {
        calls.push(input);
        return {
          id: input.id,
          accountId: input.accountId,
          from: input.from,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          createdAt: input.now,
          updatedAt: input.now,
        };
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "draft_1",
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [
            {
              id: "alias_1",
              accountId: "acc_1",
              from: { address: "support@demo.site" },
              source: "domain_alias",
              isDefault: false,
              verified: true,
            },
          ];
        },
      },
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      from: { address: "Support@Demo.Site", name: "Support" },
      to: [{ address: "lina@example.com" }],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
    });

    expect(calls[0]).toMatchObject({
      from: { address: "support@demo.site", name: "Support" },
    });
    expect(draft).toMatchObject({
      from: { address: "support@demo.site", name: "Support" },
    });
  });

  it("rejects unverified send-as identities before creating drafts", async () => {
    const storeCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async createDraft(input) {
          storeCalls.push(input);
          throw new Error("not expected");
        },
      }),
      createId: () => "draft_1",
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [
            {
              id: "account_1",
              accountId: "acc_1",
              from: { address: "me@example.com" },
              source: "account",
              isDefault: true,
              verified: true,
            },
          ];
        },
      },
    });

    await expect(
      service.createDraft({
        accountId: "acc_1",
        from: { address: "spoof@example.net" },
        to: [{ address: "lina@example.com" }],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
      }),
    ).rejects.toThrow("from address is not allowed");
    expect(storeCalls).toEqual([]);
  });

  it("creates a reply-all compose seed that excludes verified self identities", async () => {
    const service = createMailComposeService({
      store: createStore({}),
      createId: () => "unused",
      transports: {},
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: {
        async listSendIdentities() {
          return [
            {
              id: "account_1",
              accountId: "acc_1",
              from: { address: "me@example.com", name: "Me" },
              source: "account",
              isDefault: true,
              verified: true,
            },
            {
              id: "alias_1",
              accountId: "acc_1",
              from: { address: "support@demo.site" },
              source: "domain_alias",
              isDefault: false,
              verified: true,
            },
          ];
        },
      },
      mailReadStore: {
        async getMessage(input) {
          expect(input).toEqual({ accountId: "acc_1", messageId: "message_1" });
          return messageDetail({
            to: ["Me <me@example.com>", "Team <team@example.com>"],
            cc: ["Support <support@demo.site>", "ops@example.com"],
          });
        },
      },
    });

    const seed = await service.createComposeSeed({
      accountId: "acc_1",
      messageId: "message_1",
      mode: "reply_all",
    });

    expect(seed).toMatchObject({
      accountId: "acc_1",
      messageId: "message_1",
      mode: "reply_all",
      source: "reply_all",
      replyToMessageId: "message_1",
      sourceMessageId: "message_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [
        { address: "team@example.com", name: "Team" },
        { address: "ops@example.com" },
      ],
      subject: "Re: Launch confirmation",
      warnings: [],
      generatedAt: "2026-06-13T08:00:00.000Z",
    });
    expect(seed.bodyText).toContain("Lina <lina@example.com> wrote:");
    expect(seed.bodyText).toContain("> Looks good.");
  });

  it("creates a forward compose seed with attachment summaries and no recipient", async () => {
    const service = createMailComposeService({
      store: createStore({}),
      createId: () => "unused",
      transports: {},
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      mailReadStore: {
        async getMessage() {
          return messageDetail({
            attachments: [
              {
                id: "att_1",
                filename: "proposal.pdf",
                contentType: "application/pdf",
                byteSize: 2048,
                embedded: false,
                inline: false,
              },
            ],
          });
        },
      },
    });

    const seed = await service.createComposeSeed({
      accountId: "acc_1",
      messageId: "message_1",
      mode: "forward",
    });

    expect(seed).toMatchObject({
      mode: "forward",
      source: "forward",
      sourceMessageId: "message_1",
      to: [],
      cc: [],
      subject: "Fwd: Launch confirmation",
      warnings: ["missing_recipient"],
      attachments: [
        {
          id: "att_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          inline: false,
        },
      ],
    });
    expect(seed.replyToMessageId).toBeUndefined();
    expect(seed.bodyText).toContain("---------- Forwarded message ---------");
    expect(seed.bodyText).toContain("Subject: Launch confirmation");
  });

  it("previews a normalized compose draft without persisting it", async () => {
    const storeCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async createDraft(input) {
          storeCalls.push(input);
          throw new Error("not expected");
        },
      }),
      createId: () => "unused",
      transports: {},
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const preview = await service.previewDraft({
      accountId: "acc_1",
      to: [{ address: "Lina@Example.com", name: "Lina" }],
      subject: " Launch confirmation ",
      bodyText: " Looks good. ",
      source: "reply",
      replyToMessageId: "message_1",
      attachments: [
        {
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "brief.txt",
          contentType: "text/plain",
          byteSize: 1,
          contentBase64: Buffer.from("hello").toString("base64"),
        },
      ],
    });

    expect(preview).toMatchObject({
      accountId: "acc_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
      source: "reply",
      replyToMessageId: "message_1",
      sourceMessageId: "message_1",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "brief.txt",
          contentType: "text/plain",
          byteSize: 5,
          inline: false,
        },
      ],
      warnings: [],
      readyToSend: true,
      generatedAt: "2026-06-13T08:00:00.000Z",
    });
    expect(JSON.stringify(preview)).not.toContain("aGVsbG8=");
    expect(preview.estimatedSizeBytes).toBeGreaterThan(0);
    expect(storeCalls).toEqual([]);
  });

  it("rejects uploaded attachments with invalid base64 content", async () => {
    const service = createMailComposeService({
      store: createStore({}),
      createId: () => "draft_1",
      transports: {},
    });

    await expect(
      service.createDraft({
        accountId: "acc_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch confirmation",
        bodyText: "Please review the proposal.",
        attachments: [
          {
            source: "uploaded_file",
            attachmentId: "upload_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            contentBase64: "not base64!",
          },
        ],
      }),
    ).rejects.toThrow("attachment content is invalid");
  });

  it("claims a draft, submits it through the account engine, and marks it sent", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getDraftWithAccount(input) {
        calls.push(["get", input]);
        return {
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: draft(),
        };
      },
      async claimDraftForSend(input) {
        calls.push(["claim", input]);
        return {
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: {
            ...draft(),
            from: { address: "support@demo.site", name: "Support" },
            status: "sending",
            threading: {
              action: "reply" as const,
              inReplyTo: "<source@example.com>",
              references: ["<source@example.com>"],
              emailEngineMessageId: "emailengine_msg_1",
            },
          },
          transportAttachments: [
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
          ],
        };
      },
      async markDraftSent(input) {
        calls.push(["sent", input]);
        return {
          ...draft(),
          status: "sent",
          providerQueueId: input.providerQueueId,
          providerMessageId: input.providerMessageId,
          sentAt: input.sentAt,
        };
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            return {
              queueId: "queue_1",
              messageId: "<message@example.com>",
              sendAt: "2026-06-13T08:00:00.000Z",
            };
          },
        },
      },
    });

    const result = await service.sendDraft({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(providerCalls).toEqual([
      {
        accountId: "acc_1",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        from: { address: "support@demo.site", name: "Support" },
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
        attachments: [
          {
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            inline: false,
            providerAttachmentId: "ee_attachment_1",
            contentBase64: "Zm9yd2FyZA==",
          },
          {
            filename: "brief.txt",
            contentType: "text/plain",
            byteSize: 5,
            inline: false,
            contentBase64: "aGVsbG8=",
          },
        ],
        threading: {
          action: "reply",
          inReplyTo: "<source@example.com>",
          references: ["<source@example.com>"],
          emailEngineMessageId: "emailengine_msg_1",
        },
      },
    ]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
      [
        "claim",
        {
          accountId: "acc_1",
          draftId: "draft_1",
          leaseOwner: "api-send-draft",
          leaseExpiresAt: "2026-06-13T08:01:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
      [
        "sent",
        {
          accountId: "acc_1",
          draftId: "draft_1",
          providerQueueId: "queue_1",
          providerMessageId: "<message@example.com>",
          sentAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      accountId: "acc_1",
      draftId: "draft_1",
      action: "draft_send_queued",
      draft: {
        status: "sent",
        providerQueueId: "queue_1",
        providerMessageId: "<message@example.com>",
      },
    });
  });

  it("rejects sending paused or already sent drafts before provider calls", async () => {
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getDraftWithAccount() {
          return {
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "paused",
              engineProvider: "emailengine",
            },
            draft: { ...draft(), status: "sent" },
          };
        },
      }),
      createId: () => "unused",
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    await expect(
      service.sendDraft({ accountId: "acc_1", draftId: "draft_1" }),
    ).rejects.toBeInstanceOf(InvalidMailComposeRequestError);
    expect(providerCalls).toEqual([]);
  });

  it("schedules a draft without calling the provider", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getDraftWithAccount(input) {
        calls.push(["get", input]);
        return {
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: draft(),
        };
      },
      async createScheduledSend(input) {
        calls.push(["schedule", input]);
        return scheduledSend({
          id: input.id,
          accountId: input.accountId,
          draftId: input.draftId,
          scheduledAt: input.scheduledAt,
          notBefore: input.notBefore,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const result = await service.scheduleDraft({
      accountId: "acc_1",
      draftId: "draft_1",
      scheduledAt: "2026-06-13T12:30:00.000Z",
    });

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
      [
        "schedule",
        {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T12:30:00.000Z",
          notBefore: "2026-06-13T12:30:00.000Z",
          idempotencyKey: "compose:draft_1:schedule:2026-06-13T12:30:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      accountId: "acc_1",
      draftId: "draft_1",
      status: "scheduled",
      canSendNow: true,
    });
  });

  it("sends a scheduled draft now through the account engine", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async claimScheduledSendForSubmit(input) {
        calls.push(["claim", input]);
        return {
          scheduledSend: scheduledSend(),
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: {
            ...draft(),
            from: { address: "support@demo.site" },
            status: "sending",
            threading: {
              action: "reply_all" as const,
              inReplyTo: "<source@example.com>",
              references: ["<root@example.com>", "<source@example.com>"],
              emailEngineMessageId: "emailengine_msg_1",
            },
          },
          transportAttachments: [
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
          ],
        };
      },
      async markScheduledSendSent(input) {
        calls.push(["sent", input]);
        return scheduledSend({
          status: "sent",
          providerQueueId: input.providerQueueId,
          providerMessageId: input.providerMessageId,
          sentAt: input.sentAt,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            return {
              queueId: "queue_1",
              messageId: "<message@example.com>",
              sendAt: "2026-06-13T08:00:01.000Z",
            };
          },
        },
      },
    });

    const result = await service.sendScheduledNow({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(providerCalls).toEqual([
      {
        accountId: "acc_1",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        from: { address: "support@demo.site" },
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
        attachments: [
          {
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            inline: false,
            providerAttachmentId: "ee_attachment_1",
            contentBase64: "Zm9yd2FyZA==",
          },
        ],
        threading: {
          action: "reply_all",
          inReplyTo: "<source@example.com>",
          references: ["<root@example.com>", "<source@example.com>"],
          emailEngineMessageId: "emailengine_msg_1",
        },
      },
    ]);
    expect(calls).toEqual([
      [
        "claim",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
          leaseOwner: "api-send-now",
          leaseExpiresAt: "2026-06-13T08:01:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
      [
        "sent",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
          draftId: "draft_1",
          providerQueueId: "queue_1",
          providerMessageId: "<message@example.com>",
          sentAt: "2026-06-13T08:00:01.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      status: "sent",
      providerQueueId: "queue_1",
      providerMessageId: "<message@example.com>",
    });
  });
});

function createStore(overrides: Partial<MailComposeStore>): MailComposeStore {
  return {
    async createDraft() {
      throw new Error("not used");
    },
    async updateDraft() {
      throw new Error("not used");
    },
    async getDraftWithAccount() {
      throw new Error("not used");
    },
    async claimDraftForSend() {
      throw new Error("not used");
    },
    async markDraftSent() {
      throw new Error("not used");
    },
    async markDraftFailed() {
      throw new Error("not used");
    },
    async createScheduledSend() {
      throw new Error("not used");
    },
    async listScheduledSends() {
      throw new Error("not used");
    },
    async rescheduleScheduledSend() {
      throw new Error("not used");
    },
    async cancelScheduledSend() {
      throw new Error("not used");
    },
    async claimScheduledSendForSubmit() {
      throw new Error("not used");
    },
    async markScheduledSendSent() {
      throw new Error("not used");
    },
    async markScheduledSendFailed() {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function draft() {
  return {
    id: "draft_1",
    accountId: "acc_1",
    to: [{ address: "lina@example.com", name: "Lina" }],
    cc: [],
    bcc: [],
    subject: "Launch confirmation",
    bodyText: "Looks good.",
    status: "draft" as const,
    source: "manual" as const,
    createdAt: "2026-06-13T07:00:00.000Z",
    updatedAt: "2026-06-13T07:00:00.000Z",
  };
}

function scheduledSend(overrides = {}) {
  return {
    id: "schedule_1",
    accountId: "acc_1",
    draftId: "draft_1",
    scheduledAt: "2026-06-13T12:30:00.000Z",
    status: "scheduled" as const,
    attempts: 0,
    maxAttempts: 5,
    notBefore: "2026-06-13T12:30:00.000Z",
    canEdit: true,
    canSendNow: true,
    canDelete: true,
    createdAt: "2026-06-13T08:00:00.000Z",
    updatedAt: "2026-06-13T08:00:00.000Z",
    ...overrides,
  };
}

function messageDetail(overrides = {}) {
  return {
    id: "message_1",
    accountId: "acc_1",
    subject: "Launch confirmation",
    from: {
      email: "lina@example.com",
      name: "Lina",
    },
    receivedAt: "2026-06-13T07:30:00.000Z",
    snippet: "Looks good.",
    unread: true,
    starred: false,
    mailboxIds: ["inbox"],
    attachmentCount: 0,
    classification: {
      bucket: "P3 Needs Action",
      priorityScore: 80,
      reasons: ["direct"],
    },
    to: ["me@example.com"],
    cc: [],
    bodyText: "Looks good.",
    attachments: [],
    ...overrides,
  };
}
