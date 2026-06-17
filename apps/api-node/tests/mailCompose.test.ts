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

  it("lists editable drafts with bounded default and explicit limits", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async listDrafts(input) {
          calls.push(input);
          return [
            {
              id: "draft_1",
              accountId: input.accountId,
              to: [{ address: "lina@example.com" }],
              cc: [],
              bcc: [],
              subject: "Draft subject",
              bodyText: "Draft body.",
              status: "draft",
              source: "manual",
              createdAt: "2026-06-13T08:00:00.000Z",
              updatedAt: "2026-06-13T09:00:00.000Z",
            },
          ];
        },
      }),
      createId: () => "draft_2",
      transports: {},
    });

    const defaultPage = await service.listDrafts({ accountId: "acc_1" });
    const limitedPage = await service.listDrafts({
      accountId: "acc_1",
      limit: 20,
    });

    expect(calls).toEqual([
      { accountId: "acc_1", limit: 50 },
      { accountId: "acc_1", limit: 20 },
    ]);
    expect(defaultPage).toEqual({
      accountId: "acc_1",
      items: [
        expect.objectContaining({
          id: "draft_1",
          status: "draft",
          subject: "Draft subject",
        }),
      ],
    });
    expect(limitedPage.accountId).toBe("acc_1");
  });

  it("rejects invalid draft list limits before store access", async () => {
    let called = false;
    const service = createMailComposeService({
      store: createStore({
        async listDrafts() {
          called = true;
          return [];
        },
      }),
      createId: () => "draft_1",
      transports: {},
    });

    await expect(
      service.listDrafts({ accountId: "acc_1", limit: 101 }),
    ).rejects.toThrow("draft list limit is invalid");
    expect(called).toBe(false);
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

  it("adds an explicit Graph shared sender candidate without making it sendable", async () => {
    const upserts: unknown[] = [];
    const service = createMailComposeService({
      store: createStore(),
      createId: () => "unused",
      now: () => new Date("2026-06-15T20:00:00.000Z"),
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [];
        },
        async upsertProviderSendIdentityCandidate(input) {
          upserts.push(input);
          return sendIdentityCandidate({
            from: input.from,
            verificationState: "pending",
            enabled: false,
          });
        },
      },
    });

    const candidate = await service.addProviderSendIdentityCandidate({
      accountId: "acc_1",
      provider: "graph",
      from: { address: "Team@Example.com", name: "Team Inbox" },
      identityType: "shared_mailbox",
    });

    expect(upserts).toEqual([
      {
        accountId: "acc_1",
        provider: "graph",
        from: { address: "team@example.com", name: "Team Inbox" },
        identityType: "shared_mailbox",
        now: "2026-06-15T20:00:00.000Z",
      },
    ]);
    expect(candidate).toMatchObject({
      from: { address: "team@example.com", name: "Team Inbox" },
      verificationState: "pending",
      enabled: false,
      verified: false,
    });
  });

  it("verifies a Graph shared sender candidate only after a successful test send", async () => {
    const verificationCalls: unknown[] = [];
    const marks: unknown[] = [];
    const pending = sendIdentityCandidate({
      verificationState: "pending",
      enabled: false,
    });
    const verified = sendIdentityCandidate({
      verificationState: "verified",
      enabled: true,
    });
    const service = createMailComposeService({
      store: createStore(),
      createId: () => "unused",
      now: () => new Date("2026-06-15T20:05:00.000Z"),
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [];
        },
        async getProviderSendIdentityCandidate(input) {
          expect(input).toEqual({
            accountId: "acc_1",
            candidateId: "provider:identity_1",
          });
          return pending;
        },
        async markProviderSendIdentityCandidateVerification(input) {
          marks.push(input);
          return verified;
        },
      },
      graphSendIdentityVerifier: {
        async sendVerification(input) {
          verificationCalls.push(input);
        },
      },
    });

    const result = await service.verifyProviderSendIdentityCandidate({
      accountId: "acc_1",
      candidateId: "provider:identity_1",
    });

    expect(verificationCalls).toEqual([
      {
        accountId: "acc_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        to: { address: "me@example.com" },
        now: "2026-06-15T20:05:00.000Z",
      },
    ]);
    expect(marks).toEqual([
      {
        accountId: "acc_1",
        candidateId: "provider:identity_1",
        verificationState: "verified",
        enabled: true,
        now: "2026-06-15T20:05:00.000Z",
      },
    ]);
    expect(result).toEqual({
      accountId: "acc_1",
      candidate: verified,
      verified: true,
    });
  });

  it("marks a Graph shared sender candidate failed when the test send is denied", async () => {
    const marks: unknown[] = [];
    const failed = sendIdentityCandidate({
      verificationState: "failed",
      enabled: false,
      verificationError: "ErrorSendAsDenied",
    });
    const service = createMailComposeService({
      store: createStore(),
      createId: () => "unused",
      now: () => new Date("2026-06-15T20:10:00.000Z"),
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [];
        },
        async getProviderSendIdentityCandidate() {
          return sendIdentityCandidate({
            verificationState: "pending",
            enabled: false,
          });
        },
        async markProviderSendIdentityCandidateVerification(input) {
          marks.push(input);
          return failed;
        },
      },
      graphSendIdentityVerifier: {
        async sendVerification() {
          throw Object.assign(new Error("denied"), {
            code: "ErrorSendAsDenied",
          });
        },
      },
    });

    const result = await service.verifyProviderSendIdentityCandidate({
      accountId: "acc_1",
      candidateId: "provider:identity_1",
    });

    expect(marks).toEqual([
      {
        accountId: "acc_1",
        candidateId: "provider:identity_1",
        verificationState: "failed",
        enabled: false,
        verificationError: "ErrorSendAsDenied",
        now: "2026-06-15T20:10:00.000Z",
      },
    ]);
    expect(result).toEqual({
      accountId: "acc_1",
      candidate: failed,
      verified: false,
      errorCode: "ErrorSendAsDenied",
    });
  });

  it("verifies a Graph shared sender user target after base From verification", async () => {
    const verificationCalls: unknown[] = [];
    const marks: unknown[] = [];
    const verified = sendIdentityCandidate({
      verificationState: "verified",
      enabled: true,
      verified: true,
      sendMailTargetMode: "me",
      userSendMailEligible: false,
    });
    const targetVerified = sendIdentityCandidate({
      verificationState: "verified",
      enabled: true,
      verified: true,
      sendMailTargetMode: "users",
      userSendMailEligible: true,
      targetMailbox: { userPrincipalName: "shared@example.com" },
      sentItemsBehavior: "from_mailbox",
    });
    const service = createMailComposeService({
      store: createStore(),
      createId: () => "unused",
      now: () => new Date("2026-06-15T20:15:00.000Z"),
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [];
        },
        async getProviderSendIdentityCandidate() {
          return verified;
        },
        async markProviderSendIdentityCandidateUserTargetVerification(input) {
          marks.push(input);
          return targetVerified;
        },
      },
      graphSendIdentityVerifier: {
        async sendVerification() {
          throw new Error("not used");
        },
        async sendUserTargetVerification(input) {
          verificationCalls.push(input);
        },
      },
    });

    const result = await service.verifyProviderSendIdentityUserTarget({
      accountId: "acc_1",
      candidateId: "provider:identity_1",
      targetMailbox: "Shared@Example.com",
    });

    expect(verificationCalls).toEqual([
      {
        accountId: "acc_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        to: { address: "me@example.com" },
        targetMailbox: "shared@example.com",
        now: "2026-06-15T20:15:00.000Z",
      },
    ]);
    expect(marks).toEqual([
      {
        accountId: "acc_1",
        candidateId: "provider:identity_1",
        targetMailbox: "shared@example.com",
        verified: true,
        now: "2026-06-15T20:15:00.000Z",
      },
    ]);
    expect(result).toEqual({
      accountId: "acc_1",
      candidate: targetVerified,
      verified: true,
    });
  });

  it("keeps a base-verified Graph sender usable when user target verification fails", async () => {
    const marks: unknown[] = [];
    const targetFailed = sendIdentityCandidate({
      verificationState: "verified",
      enabled: true,
      verified: true,
      sendMailTargetMode: "me",
      userSendMailEligible: false,
      userTargetVerificationError: "ErrorAccessDenied",
    });
    const service = createMailComposeService({
      store: createStore(),
      createId: () => "unused",
      now: () => new Date("2026-06-15T20:20:00.000Z"),
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [];
        },
        async getProviderSendIdentityCandidate() {
          return sendIdentityCandidate({
            verificationState: "verified",
            enabled: true,
            verified: true,
          });
        },
        async markProviderSendIdentityCandidateUserTargetVerification(input) {
          marks.push(input);
          return targetFailed;
        },
      },
      graphSendIdentityVerifier: {
        async sendVerification() {
          throw new Error("not used");
        },
        async sendUserTargetVerification() {
          throw Object.assign(new Error("denied"), {
            code: "ErrorAccessDenied",
          });
        },
      },
    });

    const result = await service.verifyProviderSendIdentityUserTarget({
      accountId: "acc_1",
      candidateId: "provider:identity_1",
      targetMailbox: "shared@example.com",
    });

    expect(marks).toEqual([
      {
        accountId: "acc_1",
        candidateId: "provider:identity_1",
        targetMailbox: "shared@example.com",
        verified: false,
        verificationError: "ErrorAccessDenied",
        now: "2026-06-15T20:20:00.000Z",
      },
    ]);
    expect(result).toEqual({
      accountId: "acc_1",
      candidate: targetFailed,
      verified: false,
      errorCode: "ErrorAccessDenied",
    });
  });

  it("diagnoses Graph shared sender permissions without sending another test message", async () => {
    const service = createMailComposeService({
      store: createStore(),
      createId: () => "unused",
      now: () => new Date("2026-06-15T20:25:00.000Z"),
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [];
        },
        async getProviderSendIdentityCandidate(input) {
          expect(input).toEqual({
            accountId: "acc_1",
            candidateId: "provider:identity_1",
          });
          return sendIdentityCandidate({
            verificationState: "verified",
            enabled: true,
            verified: true,
            sendMailTargetMode: "me",
            userSendMailEligible: false,
            userTargetVerificationError: "ErrorAccessDenied",
          });
        },
      },
      graphSendIdentityVerifier: {
        async sendVerification() {
          throw new Error("diagnostics must not send mail");
        },
        async sendUserTargetVerification() {
          throw new Error("diagnostics must not send mail");
        },
      },
    });

    const diagnostics = await service.diagnoseProviderSendIdentityCandidate({
      accountId: "acc_1",
      candidateId: "provider:identity_1",
    });

    expect(diagnostics).toMatchObject({
      accountId: "acc_1",
      candidateId: "provider:identity_1",
      provider: "graph",
      generatedAt: "2026-06-15T20:25:00.000Z",
      status: "target_verification_failed",
      sendPath: "me",
      sentItemsBehavior: "signed_in_user",
      discoverySupported: false,
      summary:
        "From 可用，但共享邮箱 Sent Items 路径验证失败：ErrorAccessDenied。",
      checks: [
        { id: "explicit_candidate", status: "info" },
        { id: "from_permission", status: "pass" },
        { id: "sent_items_target", status: "fail" },
      ],
      nextActions: [
        "确认用户对共享邮箱具备 Full Access 或可用的 /users/{mailbox}/sendMail 权限。",
        "修正目标邮箱地址后重新验证共享邮箱目标路径。",
      ],
    });
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

  it("records Hermes rewrite polish feedback when saving a manual draft", async () => {
    const feedbackCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async createDraft(input) {
          return {
            id: input.id,
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
            createdAt: input.now,
            updatedAt: input.now,
          };
        },
      }),
      createId: () => "draft_1",
      transports: {},
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      hermesDraftFeedbackStore: {
        async recordDraftFeedback(input) {
          feedbackCalls.push(input);
          return { feedbackId: "feedback_1", learned: true };
        },
      },
    });

    await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com" }],
      subject: "Launch plan",
      bodyText: "Hi Lina,\n\nPlease review the launch plan today.",
      source: "manual",
      hermesSkillRunId: "run_rewrite_1",
      hermesDraftText:
        "Hi Lina,\n\nPlease review the launch plan today and let me know if anything is missing.",
    });

    expect(feedbackCalls).toEqual([
      {
        skillRunId: "run_rewrite_1",
        draftText:
          "Hi Lina,\n\nPlease review the launch plan today and let me know if anything is missing.",
        finalText: "Hi Lina,\n\nPlease review the launch plan today.",
        subject: "Launch plan",
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

  it("stores uploaded attachment object references without embedding content", async () => {
    const storageKey = "11111111-1111-4111-8111-111111111111";
    const blobCalls: unknown[] = [];
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
              storageKey: attachment.storageKey,
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
      attachmentBlobStore: {
        async getUploadedAttachment(input) {
          blobCalls.push(input);
          return {
            id: `upload_${storageKey}`,
            source: "uploaded_file",
            attachmentId: `upload_${storageKey}`,
            storageKey,
            filename: "large-plan.pdf",
            contentType: "application/pdf",
            byteSize: 5242880,
            inline: false,
          };
        },
        async loadUploadedAttachmentContent() {
          throw new Error("not used");
        },
      },
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com" }],
      subject: "Launch confirmation",
      bodyText: "Please review the proposal.",
      attachments: [
        {
          source: "uploaded_file",
          attachmentId: `upload_${storageKey}`,
          storageKey,
        },
      ],
    });

    expect(blobCalls).toEqual([
      {
        accountId: "acc_1",
        storageKey,
        attachmentId: `upload_${storageKey}`,
      },
    ]);
    expect(storeCalls).toEqual([
      expect.objectContaining({
        attachments: [
          {
            id: `upload_${storageKey}`,
            source: "uploaded_file",
            attachmentId: `upload_${storageKey}`,
            storageKey,
            filename: "large-plan.pdf",
            contentType: "application/pdf",
            byteSize: 5242880,
            inline: false,
          },
        ],
      }),
    ]);
    expect(JSON.stringify(storeCalls)).not.toContain("contentBase64");
    expect(draft.attachments).toEqual([
      {
        id: `upload_${storageKey}`,
        source: "uploaded_file",
        attachmentId: `upload_${storageKey}`,
        storageKey,
        filename: "large-plan.pdf",
        contentType: "application/pdf",
        byteSize: 5242880,
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

  it("creates drafts with provider-native send-as identities", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
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
      }),
      createId: () => "draft_1",
      transports: {},
      sendIdentityStore: {
        async listSendIdentities() {
          return [
            {
              id: "provider:identity_1",
              accountId: "acc_1",
              from: { address: "team@example.com", name: "Team Inbox" },
              source: "provider_native",
              isDefault: false,
              verified: true,
              provider: "graph",
              providerIdentityId: "shared-mailbox/team",
              identityType: "shared_mailbox",
            },
          ];
        },
      },
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const draft = await service.createDraft({
      accountId: "acc_1",
      from: { address: "Team@Example.com", name: "Team Inbox" },
      to: [{ address: "lina@example.com" }],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
    });

    expect(calls[0]).toMatchObject({
      from: { address: "team@example.com", name: "Team Inbox" },
    });
    expect(draft).toMatchObject({
      from: { address: "team@example.com", name: "Team Inbox" },
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

  it("queues a draft for immediate worker send without calling the provider", async () => {
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
          draft: {
            ...draft(),
            from: { address: "support@demo.site", name: "Support" },
            threading: {
              action: "reply" as const,
              inReplyTo: "<source@example.com>",
              references: ["<source@example.com>"],
              emailEngineMessageId: "emailengine_msg_1",
            },
          },
        };
      },
      async createScheduledSend(input) {
        calls.push(["queue", input]);
        return scheduledSend({
          id: input.id,
          accountId: input.accountId,
          draftId: input.draftId,
          scheduledAt: input.scheduledAt,
          status: input.status,
          notBefore: input.notBefore,
          canEdit: false,
          canSendNow: false,
          canDelete: false,
          updatedAt: input.now,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
        name: "Support",
      }),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const result = await service.sendDraft({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
      [
        "queue",
        {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T08:00:00.000Z",
          notBefore: "2026-06-13T08:00:00.000Z",
          status: "queued",
          idempotencyKey: "compose:draft_1:send-now",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      accountId: "acc_1",
      draftId: "draft_1",
      action: "draft_send_queued",
      draft: {
        status: "scheduled",
        updatedAt: "2026-06-13T08:00:00.000Z",
      },
    });
  });

  it("rejects immediate EmailEngine sends before queueing when the transport is missing", async () => {
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
          draft: {
            ...draft(),
            from: { address: "support@demo.site", name: "Support" },
          },
        };
      },
      async createScheduledSend(input) {
        calls.push(["queue", input]);
        throw new Error("should not queue without a transport");
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
        name: "Support",
      }),
      transports: {},
    });

    await expect(
      service.sendDraft({
        accountId: "acc_1",
        draftId: "draft_1",
      }),
    ).rejects.toThrow("emailengine send transport is not configured");
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
    ]);
  });

  it("returns the existing immediate send queue item for retried draft sends", async () => {
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
          draft: {
            ...draft(),
            from: { address: "support@demo.site", name: "Support" },
            status: "scheduled",
            errorMessage: "previous transient error",
          },
        };
      },
      async createScheduledSend(input) {
        calls.push(["queue", input]);
        return scheduledSend({
          id: "schedule_existing",
          accountId: input.accountId,
          draftId: input.draftId,
          scheduledAt: "2026-06-13T07:59:59.000Z",
          status: "queued",
          notBefore: "2026-06-13T07:59:59.000Z",
          canEdit: false,
          canSendNow: false,
          canDelete: false,
          updatedAt: "2026-06-13T08:00:01.000Z",
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "schedule_retry",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
        name: "Support",
      }),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const result = await service.sendDraft({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
      [
        "queue",
        {
          id: "schedule_retry",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T08:00:00.000Z",
          notBefore: "2026-06-13T08:00:00.000Z",
          status: "queued",
          idempotencyKey: "compose:draft_1:send-now",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      action: "draft_send_queued",
      draft: {
        status: "scheduled",
        updatedAt: "2026-06-13T08:00:01.000Z",
      },
    });
    expect(result.draft).not.toHaveProperty("errorMessage");
  });

  it("does not hydrate stored uploaded attachment content while queueing a draft", async () => {
    const storageKey = "11111111-1111-4111-8111-111111111111";
    const blobCalls: unknown[] = [];
    const store = createStore({
      async getDraftWithAccount() {
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
            attachments: [
              {
                id: `upload_${storageKey}`,
                source: "uploaded_file" as const,
                attachmentId: `upload_${storageKey}`,
                storageKey,
                filename: "brief.txt",
                contentType: "text/plain",
                byteSize: 5,
                inline: false,
              },
            ],
          },
        };
      },
      async createScheduledSend(input) {
        return scheduledSend({
          id: input.id,
          accountId: input.accountId,
          draftId: input.draftId,
          scheduledAt: input.scheduledAt,
          status: input.status,
          notBefore: input.notBefore,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
        name: "Support",
      }),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
      attachmentBlobStore: {
        async getUploadedAttachment() {
          throw new Error("not used");
        },
        async loadUploadedAttachmentContent(input) {
          blobCalls.push(input);
          return {
            contentBase64: "aGVsbG8=",
            byteSize: 5,
          };
        },
      },
    });

    await service.sendDraft({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(blobCalls).toEqual([]);
    expect(providerCalls).toEqual([]);
    expect(JSON.stringify(providerCalls)).not.toContain(storageKey);
  });

  it("rejects queueing a draft when the saved send-as identity was revoked", async () => {
    const calls: unknown[] = [];
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getDraftWithAccount(input) {
          calls.push(["get", input]);
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
            },
          };
        },
      }),
      createId: () => "unused",
      sendIdentityStore: sendIdentityStoreFor({
        address: "me@example.com",
        name: "Me",
      }),
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
    ).rejects.toThrow("from address is not allowed");
    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
    ]);
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
          status: "scheduled",
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

  it("rejects scheduling drafts when the saved send-as identity was revoked", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getDraftWithAccount(input) {
          calls.push(["get", input]);
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
            },
          };
        },
        async createScheduledSend(input) {
          calls.push(["schedule", input]);
          throw new Error("not expected");
        },
      }),
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({ address: "me@example.com" }),
      transports: {},
    });

    await expect(
      service.scheduleDraft({
        accountId: "acc_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-13T12:30:00.000Z",
      }),
    ).rejects.toThrow("from address is not allowed");
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
    ]);
  });

  it("loads an editable scheduled draft with its current content", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(input);
          return {
            scheduledSend: scheduledSend({
              scheduledAt: "2026-06-13T12:30:00.000Z",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              subject: "Scheduled launch",
              bodyText: "Send later body.",
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 12,
                  inline: false,
                },
              ],
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    const detail = await service.getScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(calls).toEqual([{ accountId: "acc_1", scheduledId: "schedule_1" }]);
    expect(detail).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        draftId: "draft_1",
        canEdit: true,
      },
      draft: {
        id: "draft_1",
        status: "scheduled",
        subject: "Scheduled launch",
        bodyText: "Send later body.",
      },
    });
  });

  it("updates scheduled draft content without creating a replacement", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend({ id: input.scheduledId }),
            draft: {
              ...draft(),
              status: "scheduled",
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                },
              ],
            },
            transportAttachments: [
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
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft(input) {
          calls.push(["update", input]);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              subject: input.subject,
              to: input.to,
              cc: input.cc,
              bcc: input.bcc,
              bodyText: input.bodyText,
              attachments: input.attachments?.map((attachment) => ({
                id: attachment.id,
                source: attachment.source,
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                contentType: attachment.contentType,
                byteSize: attachment.byteSize,
                inline: attachment.inline,
              })),
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused_new_draft_id",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const detail = await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "Lina@Example.com", name: "Lina" }],
      subject: " Updated scheduled launch ",
      bodyText: "Edited send-later body.",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "plan.pdf",
          contentType: "application/pdf",
          byteSize: 8,
        },
      ],
    });

    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
      [
        "update",
        expect.objectContaining({
          accountId: "acc_1",
          scheduledId: "schedule_1",
          to: [{ address: "lina@example.com", name: "Lina" }],
          cc: [],
          bcc: [],
          subject: "Updated scheduled launch",
          bodyText: "Edited send-later body.",
          source: "manual",
          attachments: [
            expect.objectContaining({
              id: "upload_1",
              source: "uploaded_file",
              filename: "plan.pdf",
              contentBase64: "cGxhbg==",
            }),
          ],
          now: "2026-06-13T08:30:00.000Z",
        }),
      ],
    ]);
    expect(detail).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        status: "scheduled",
      },
      draft: {
        id: "draft_1",
        status: "scheduled",
        bodyText: "Edited send-later body.",
      },
    });
  });

  it("preserves scheduled draft object-storage attachments during edits", async () => {
    const storageKey = "11111111-1111-4111-8111-111111111111";
    const calls: unknown[] = [];
    const blobCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend({ id: input.scheduledId }),
            draft: {
              ...draft(),
              status: "scheduled",
              attachments: [
                {
                  id: `upload_${storageKey}`,
                  source: "uploaded_file" as const,
                  attachmentId: `upload_${storageKey}`,
                  storageKey,
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 5242880,
                  inline: false,
                },
              ],
            },
            transportAttachments: [
              {
                id: `upload_${storageKey}`,
                source: "uploaded_file" as const,
                attachmentId: `upload_${storageKey}`,
                storageKey,
                filename: "plan.pdf",
                contentType: "application/pdf",
                byteSize: 5242880,
                inline: false,
              },
            ],
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft(input) {
          calls.push(["update", input]);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              subject: input.subject,
              to: input.to,
              cc: input.cc,
              bcc: input.bcc,
              bodyText: input.bodyText,
              attachments: input.attachments?.map((attachment) => ({
                id: attachment.id,
                source: attachment.source,
                attachmentId: attachment.attachmentId,
                storageKey: attachment.storageKey,
                filename: attachment.filename,
                contentType: attachment.contentType,
                byteSize: attachment.byteSize,
                inline: attachment.inline,
              })),
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused_new_draft_id",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
      attachmentBlobStore: {
        async getUploadedAttachment(input) {
          blobCalls.push(input);
          return {
            id: `upload_${storageKey}`,
            source: "uploaded_file",
            attachmentId: `upload_${storageKey}`,
            storageKey,
            filename: "plan.pdf",
            contentType: "application/pdf",
            byteSize: 5242880,
            inline: false,
          };
        },
        async loadUploadedAttachmentContent() {
          throw new Error("not used");
        },
      },
    });

    await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      subject: "Scheduled launch",
      bodyText: "Edited body.",
      attachments: [
        {
          source: "uploaded_file",
          attachmentId: `upload_${storageKey}`,
          filename: "plan.pdf",
          contentType: "application/pdf",
        },
      ],
    });

    expect(blobCalls).toEqual([
      {
        accountId: "acc_1",
        storageKey,
        attachmentId: `upload_${storageKey}`,
      },
    ]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
      [
        "update",
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: `upload_${storageKey}`,
              source: "uploaded_file",
              storageKey,
              filename: "plan.pdf",
            }),
          ],
        }),
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain("contentBase64");
  });

  it("keeps scheduled draft attachments when body-only edits omit attachments", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async updateScheduledDraft(input) {
          calls.push(input);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              bodyText: input.bodyText,
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                },
              ],
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const detail = await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      subject: "Scheduled launch",
      bodyText: "Body-only edit.",
    });

    expect(calls).toEqual([
      expect.not.objectContaining({
        attachments: expect.anything(),
      }),
    ]);
    expect(detail.draft).toMatchObject({
      bodyText: "Body-only edit.",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          filename: "plan.pdf",
        },
      ],
    });
  });

  it("clears scheduled draft attachments when edits pass an explicit empty list", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend({ id: input.scheduledId }),
            draft: {
              ...draft(),
              status: "scheduled",
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                },
              ],
            },
            transportAttachments: [
              {
                id: "upload_1",
                source: "uploaded_file" as const,
                attachmentId: "upload_1",
                filename: "plan.pdf",
                contentType: "application/pdf",
                byteSize: 4,
                inline: false,
                contentBase64: "cGxhbg==",
              },
            ],
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft(input) {
          calls.push(["update", input]);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              bodyText: input.bodyText,
              attachments: input.attachments ?? [],
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const detail = await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      subject: "Scheduled launch",
      bodyText: "Clear attachment edit.",
      attachments: [],
    });

    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
      [
        "update",
        expect.objectContaining({
          accountId: "acc_1",
          scheduledId: "schedule_1",
          attachments: [],
        }),
      ],
    ]);
    expect(detail.draft).toMatchObject({
      bodyText: "Clear attachment edit.",
      attachments: [],
    });
  });

  it("rejects scheduled attachment edits when existing uploaded bytes are unavailable", async () => {
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft() {
          return {
            scheduledSend: scheduledSend(),
            draft: { ...draft(), status: "scheduled" },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft() {
          throw new Error("not expected");
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    await expect(
      service.updateScheduledDraft({
        accountId: "acc_1",
        scheduledId: "schedule_1",
        to: [{ address: "lina@example.com" }],
        subject: "Scheduled launch",
        bodyText: "Missing bytes.",
        attachments: [
          {
            source: "uploaded_file",
            attachmentId: "upload_1",
            filename: "plan.pdf",
            contentType: "application/pdf",
            byteSize: 4,
          },
        ],
      }),
    ).rejects.toThrow("attachment content is required");
  });

  it("rejects updating missing or claimed scheduled draft rows", async () => {
    const service = createMailComposeService({
      store: createStore({
        async updateScheduledDraft() {
          return undefined;
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    await expect(
      service.updateScheduledDraft({
        accountId: "acc_1",
        scheduledId: "schedule_claimed",
        to: [{ address: "lina@example.com" }],
        subject: "Too late",
        bodyText: "Worker already claimed this.",
      }),
    ).rejects.toThrow("scheduled draft was not found");
  });

  it("queues a scheduled draft for immediate worker send without calling the provider", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getScheduledDraft(input) {
        calls.push(["get", input]);
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
            status: "scheduled",
            threading: {
              action: "reply_all" as const,
              inReplyTo: "<source@example.com>",
              references: ["<root@example.com>", "<source@example.com>"],
              emailEngineMessageId: "emailengine_msg_1",
            },
          },
        };
      },
      async queueScheduledSendNow(input) {
        calls.push(["queue-now", input]);
        return scheduledSend({
          id: input.scheduledId,
          scheduledAt: input.scheduledAt,
          status: "queued",
          notBefore: input.notBefore,
          canEdit: false,
          canSendNow: false,
          canDelete: false,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
      }),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const result = await service.sendScheduledNow({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      [
        "get",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
        },
      ],
      [
        "queue-now",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
          scheduledAt: "2026-06-13T08:00:00.000Z",
          notBefore: "2026-06-13T08:00:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      status: "queued",
      notBefore: "2026-06-13T08:00:00.000Z",
      canSendNow: false,
    });
  });

  it("rejects scheduled send-now before queueing when the transport is missing", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getScheduledDraft(input) {
        calls.push(["get", input]);
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
            status: "scheduled",
          },
        };
      },
      async queueScheduledSendNow(input) {
        calls.push(["queue-now", input]);
        throw new Error("should not queue without a transport");
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
      }),
      transports: {},
    });

    await expect(
      service.sendScheduledNow({
        accountId: "acc_1",
        scheduledId: "schedule_1",
      }),
    ).rejects.toThrow("emailengine send transport is not configured");
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
    ]);
  });

  it("rejects send-now before queueing when the saved send-as identity was revoked", async () => {
    const calls: unknown[] = [];
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
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
              status: "scheduled",
            },
          };
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({ address: "me@example.com" }),
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
      service.sendScheduledNow({
        accountId: "acc_1",
        scheduledId: "schedule_1",
      }),
    ).rejects.toThrow("from address is not allowed");

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      [
        "get",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
        },
      ],
    ]);
  });
});

function createStore(overrides: Partial<MailComposeStore>): MailComposeStore {
  return {
    async createDraft() {
      throw new Error("not used");
    },
    async listDrafts() {
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
    async getScheduledDraft() {
      throw new Error("not used");
    },
    async updateScheduledDraft() {
      throw new Error("not used");
    },
    async rescheduleScheduledSend() {
      throw new Error("not used");
    },
    async queueScheduledSendNow() {
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

function sendIdentityStoreFor(input: { address: string; name?: string }) {
  return {
    async listSendIdentities() {
      return [
        {
          id: `identity:${input.address}`,
          accountId: "acc_1",
          from: {
            address: input.address,
            ...(input.name ? { name: input.name } : {}),
          },
          source: "provider_native" as const,
          isDefault: false,
          verified: true,
          provider: "graph",
          providerIdentityId: input.address,
          identityType: "shared_mailbox" as const,
        },
      ];
    },
  };
}

function sendIdentityCandidate(overrides = {}) {
  return {
    id: "provider:identity_1",
    accountId: "acc_1",
    from: { address: "team@example.com", name: "Team Inbox" },
    source: "provider_native" as const,
    isDefault: false,
    verified: false,
    provider: "graph",
    providerIdentityId: "team@example.com",
    identityType: "shared_mailbox" as const,
    verificationState: "pending" as const,
    enabled: false,
    verificationRecipient: { address: "me@example.com" },
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
