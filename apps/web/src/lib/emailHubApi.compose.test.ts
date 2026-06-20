import { describe, expect, it, vi } from "vitest";

import { createEmailHubApi } from "./emailHubApi";
import { jsonResponse } from "./emailHubApiTestHelpers";

describe("emailHubApi compose routes", () => {
  it("creates and sends mail drafts through compose routes", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/accounts/account_1/compose/drafts") {
        return jsonResponse(
          {
            id: "draft_1",
            accountId: "account_1",
            to: [{ address: "client@example.com", name: "Client" }],
            cc: [],
            bcc: [],
            subject: "Re: Live subject",
            bodyText: "Thanks, I will check this today.",
            status: "draft",
            source: "reply",
            replyToMessageId: "message_1",
            sourceMessageId: "message_1",
            createdAt: "2026-06-13T10:00:00.000Z",
            updatedAt: "2026-06-13T10:00:00.000Z",
          },
          201,
        );
      }

      return jsonResponse(
        {
          accountId: "account_1",
          draftId: "draft_1",
          action: "draft_send_queued",
          draft: {
            id: "draft_1",
            accountId: "account_1",
            status: "sent",
            updatedAt: "2026-06-13T10:01:00.000Z",
          },
        },
        202,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.createMailDraft({
      accountId: "account_1",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "client@example.com", name: "Client" }],
      subject: "Re: Live subject",
      bodyText: "Thanks, I will check this today.",
      source: "reply",
      replyToMessageId: "message_1",
      sourceMessageId: "message_1",
      hermesSkillRunId: "run_rewrite_1",
      hermesDraftText: "Thanks, I will check this today.",
      attachments: [
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
    });
    await api.sendMailDraft({ accountId: "account_1", draftId: "draft_1" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account_1/compose/drafts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          from: { address: "support@demo.site", name: "Support" },
          to: [{ address: "client@example.com", name: "Client" }],
          subject: "Re: Live subject",
          bodyText: "Thanks, I will check this today.",
          source: "reply",
          replyToMessageId: "message_1",
          sourceMessageId: "message_1",
          hermesSkillRunId: "run_rewrite_1",
          hermesDraftText: "Thanks, I will check this today.",
          attachments: [
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
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account_1/compose/drafts/draft_1/send",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("lists saved compose drafts through the compose route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        accountId: "account 1",
        items: [
          {
            id: "draft_1",
            accountId: "account 1",
            to: [{ address: "client@example.com" }],
            cc: [],
            bcc: [],
            subject: "Saved draft",
            bodyText: "Draft body",
            status: "draft",
            source: "manual",
            createdAt: "2026-06-13T10:00:00.000Z",
            updatedAt: "2026-06-13T10:05:00.000Z",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listMailDrafts({
      accountId: "account 1",
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      id: "draft_1",
      subject: "Saved draft",
      status: "draft",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account%201/compose/drafts?limit=20",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uploads compose attachments as raw file bodies", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "upload_1",
        source: "uploaded_file",
        attachmentId: "upload_1",
        storageKey: "11111111-1111-4111-8111-111111111111",
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });
    const file = new File(["hello"], "brief.txt", { type: "text/plain" });

    const attachment = await api.uploadComposeAttachment({
      accountId: "account_1",
      file,
    });

    expect(attachment).toMatchObject({
      source: "uploaded_file",
      storageKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/compose/attachments",
      expect.objectContaining({
        method: "POST",
        body: file,
        headers: expect.objectContaining({
          "content-type": "text/plain",
          "x-emailhub-filename": "brief.txt",
        }),
      }),
    );
  });

  it("updates existing mail drafts through the compose route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "draft_1",
        accountId: "account_1",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Updated subject",
        bodyText: "Updated body",
        status: "draft",
        source: "reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        createdAt: "2026-06-13T10:00:00.000Z",
        updatedAt: "2026-06-13T10:05:00.000Z",
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.updateMailDraft({
      accountId: "account 1",
      draftId: "draft/1",
      to: [{ address: "client@example.com" }],
      subject: "Updated subject",
      bodyText: "Updated body",
      source: "reply",
      replyToMessageId: "message_1",
      hermesSkillRunId: "run_rewrite_1",
      hermesDraftText: "Hermes polished body",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account%201/compose/drafts/draft%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          to: [{ address: "client@example.com" }],
          subject: "Updated subject",
          bodyText: "Updated body",
          source: "reply",
          replyToMessageId: "message_1",
          hermesSkillRunId: "run_rewrite_1",
          hermesDraftText: "Hermes polished body",
        }),
      }),
    );
  });

  it("loads account send identities through the compose route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        accountId: "account_1",
        items: [
          {
            id: "account:account_1",
            accountId: "account_1",
            from: { address: "me@example.com", name: "Me" },
            source: "account",
            isDefault: true,
            verified: true,
          },
          {
            id: "alias:alias_1",
            accountId: "account_1",
            from: { address: "support@demo.site" },
            source: "domain_alias",
            isDefault: false,
            verified: true,
          },
          {
            id: "provider:identity_1",
            accountId: "account_1",
            from: { address: "team@example.com", name: "Team Inbox" },
            source: "provider_native",
            isDefault: false,
            verified: true,
            provider: "graph",
            providerIdentityId: "shared-mailbox/team",
            identityType: "shared_mailbox",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSendIdentities({ accountId: "account_1" });

    expect(page.items[1].from.address).toBe("support@demo.site");
    expect(page.items[2]).toMatchObject({
      from: { address: "team@example.com", name: "Team Inbox" },
      source: "provider_native",
      provider: "graph",
      identityType: "shared_mailbox",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/send-identities",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("adds Graph provider send identity candidates", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "provider:identity_1",
        accountId: "account_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        source: "provider_native",
        isDefault: false,
        verified: false,
        provider: "graph",
        providerIdentityId: "team@example.com",
        identityType: "shared_mailbox",
        verificationState: "pending",
        enabled: false,
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const candidate = await api.addProviderSendIdentityCandidate({
      accountId: "account_1",
      provider: "graph",
      address: "team@example.com",
      name: "Team Inbox",
      identityType: "shared_mailbox",
    });

    expect(candidate.verificationState).toBe("pending");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/send-identities/provider-candidates",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          provider: "graph",
          address: "team@example.com",
          name: "Team Inbox",
          identityType: "shared_mailbox",
        }),
      }),
    );
  });

  it("verifies Graph provider send identity candidates", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        accountId: "account_1",
        verified: true,
        candidate: {
          id: "provider:identity_1",
          accountId: "account_1",
          from: { address: "team@example.com", name: "Team Inbox" },
          source: "provider_native",
          isDefault: false,
          verified: true,
          provider: "graph",
          providerIdentityId: "team@example.com",
          identityType: "shared_mailbox",
          verificationState: "verified",
          enabled: true,
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.verifyProviderSendIdentityCandidate({
      accountId: "account_1",
      candidateId: "provider:identity_1",
    });

    expect(result.verified).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/send-identities/provider-candidates/provider%3Aidentity_1/verify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verifies Graph provider send identity user targets", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        accountId: "account_1",
        verified: true,
        candidate: {
          id: "provider:identity_1",
          accountId: "account_1",
          from: { address: "team@example.com", name: "Team Inbox" },
          source: "provider_native",
          isDefault: false,
          verified: true,
          provider: "graph",
          providerIdentityId: "team@example.com",
          identityType: "shared_mailbox",
          verificationState: "verified",
          enabled: true,
          sendMailTargetMode: "users",
          userSendMailEligible: true,
          targetMailbox: {
            userPrincipalName: "team@example.com",
          },
          sentItemsBehavior: "from_mailbox",
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.verifyProviderSendIdentityUserTarget({
      accountId: "account_1",
      candidateId: "provider:identity_1",
      targetMailbox: "team@example.com",
    });

    expect(result.candidate.sendMailTargetMode).toBe("users");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/send-identities/provider-candidates/provider%3Aidentity_1/verify-user-target",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targetMailbox: "team@example.com",
        }),
      }),
    );
  });

  it("reads Graph provider send identity diagnostics", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        accountId: "account_1",
        candidateId: "provider:identity_1",
        provider: "graph",
        generatedAt: "2026-06-15T20:25:00.000Z",
        from: { address: "team@example.com", name: "Team Inbox" },
        identityType: "shared_mailbox",
        status: "target_verification_failed",
        summary:
          "From 可用，但共享邮箱 Sent Items 路径验证失败：ErrorAccessDenied。",
        sendPath: "me",
        sentItemsBehavior: "signed_in_user",
        discoverySupported: false,
        checks: [
          {
            id: "explicit_candidate",
            status: "info",
            title: "显式共享发件人",
            detail:
              "Microsoft Graph 不能可靠枚举当前用户可用的共享邮箱，本候选项由用户显式添加。",
          },
        ],
        nextActions: [
          "确认用户对共享邮箱具备 Full Access 或可用的 /users/{mailbox}/sendMail 权限。",
        ],
        candidate: {
          id: "provider:identity_1",
          accountId: "account_1",
          from: { address: "team@example.com", name: "Team Inbox" },
          source: "provider_native",
          isDefault: false,
          verified: true,
          provider: "graph",
          providerIdentityId: "team@example.com",
          identityType: "shared_mailbox",
          verificationState: "verified",
          enabled: true,
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const diagnostics = await api.diagnoseProviderSendIdentityCandidate({
      accountId: "account_1",
      candidateId: "provider:identity_1",
    });

    expect(diagnostics.status).toBe("target_verification_failed");
    expect(diagnostics.discoverySupported).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/send-identities/provider-candidates/provider%3Aidentity_1/diagnostics",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("downloads message attachments as blobs with server filenames", async () => {
    const attachmentBlob = new Blob(["hello attachment"], { type: "text/plain" });
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "text/plain",
          "content-disposition":
            "attachment; filename*=UTF-8''proposal%20final.txt",
        }),
        blob: vi.fn(async () => attachmentBlob),
      }) as unknown as Response,
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const download = await api.downloadAttachment({
      accountId: "account 1",
      attachmentId: "attachment/1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account%201/attachments/attachment%2F1/download",
      expect.objectContaining({ method: "GET" }),
    );
    expect(download.filename).toBe("proposal final.txt");
    expect(download.contentType).toBe("text/plain");
    expect(download.blob).toBe(attachmentBlob);
  });

  it("prefers RFC 5987 attachment filenames and keeps downgraded content types", async () => {
    const attachmentBlob = new Blob(["active attachment"], {
      type: "application/octet-stream",
    });
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "application/octet-stream",
          "content-disposition":
            "attachment; filename=\"invoice __.html\"; filename*=UTF-8''invoice%20%E4%BD%A0%E5%A5%BD.html",
        }),
        blob: vi.fn(async () => attachmentBlob),
      }) as unknown as Response,
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const download = await api.downloadAttachment({
      accountId: "account_1",
      attachmentId: "attachment_1",
    });

    expect(download.filename).toBe("invoice 你好.html");
    expect(download.contentType).toBe("application/octet-stream");
    expect(download.blob).toBe(attachmentBlob);
  });

  it("creates compose seeds and previews drafts through compose routes", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/accounts/account_1/messages/message_1/compose/reply-all") {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          accountId: "account_1",
          messageId: "message_1",
          mode: "reply_all",
          to: [{ address: "client@example.com" }],
          cc: [{ address: "ops@example.com" }],
          bcc: [],
          subject: "Re: Live subject",
          bodyText: "\n\nOn Sat, client@example.com wrote:\n> Thanks",
          source: "reply_all",
          replyToMessageId: "message_1",
          sourceMessageId: "message_1",
          attachments: [],
          warnings: [],
          generatedAt: "2026-06-13T10:00:00.000Z",
        });
      }

      expect(url).toBe("/api/accounts/account_1/compose/preview");
      expect(init?.method).toBe("POST");
      return jsonResponse({
        accountId: "account_1",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Re: Live subject",
        bodyText: "Thanks",
        source: "reply_all",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        warnings: [],
        estimatedSizeBytes: 32,
        readyToSend: true,
        generatedAt: "2026-06-13T10:01:00.000Z",
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const seed = await api.createComposeSeed({
      accountId: "account_1",
      messageId: "message_1",
      mode: "reply_all",
      from: { address: "support@demo.site" },
    });
    const preview = await api.previewMailDraft({
      accountId: "account_1",
      to: seed.to,
      subject: seed.subject,
      bodyText: "Thanks",
      source: seed.source,
      replyToMessageId: seed.replyToMessageId,
      sourceMessageId: seed.sourceMessageId,
      attachments: [
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
    });

    expect(seed.source).toBe("reply_all");
    expect(preview.readyToSend).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account_1/messages/message_1/compose/reply-all",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ from: { address: "support@demo.site" } }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account_1/compose/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          to: [{ address: "client@example.com" }],
          subject: "Re: Live subject",
          bodyText: "Thanks",
          source: "reply_all",
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
              contentBase64: "aGVsbG8=",
            },
          ],
        }),
      }),
    );
  });

  it("schedules drafts and manages outbox items through compose routes", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/outbox?limit=20")) {
        return jsonResponse({
          accountId: "account_1",
          items: [
            {
              id: "schedule_1",
              accountId: "account_1",
              draftId: "draft_1",
              scheduledAt: "2026-06-14T09:30:00.000Z",
              status: "scheduled",
              attempts: 0,
              maxAttempts: 5,
              notBefore: "2026-06-14T09:30:00.000Z",
              canEdit: true,
              canSendNow: true,
              canDelete: true,
              createdAt: "2026-06-13T10:00:00.000Z",
              updatedAt: "2026-06-13T10:00:00.000Z",
            },
          ],
        });
      }

      return jsonResponse({
        id: "schedule_1",
        accountId: "account_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-14T09:30:00.000Z",
        status: "scheduled",
        attempts: 0,
        maxAttempts: 5,
        notBefore: "2026-06-14T09:30:00.000Z",
        canEdit: true,
        canSendNow: true,
        canDelete: true,
        createdAt: "2026-06-13T10:00:00.000Z",
        updatedAt: "2026-06-13T10:00:00.000Z",
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.scheduleMailDraft({
      accountId: "account_1",
      draftId: "draft_1",
      scheduledAt: "2026-06-14T09:30:00.000Z",
    });
    await api.listOutbox({ accountId: "account_1", limit: 20 });
    await api.sendScheduledNow({
      accountId: "account_1",
      scheduledId: "schedule_1",
    });
    await api.rescheduleScheduledSend({
      accountId: "account_1",
      scheduledId: "schedule_1",
      scheduledAt: "2026-06-14T12:30:00.000Z",
    });
    await api.cancelScheduledSend({
      accountId: "account_1",
      scheduledId: "schedule_1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account_1/compose/drafts/draft_1/schedule",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ scheduledAt: "2026-06-14T09:30:00.000Z" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account_1/outbox?limit=20",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/accounts/account_1/outbox/schedule_1/send-now",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/accounts/account_1/outbox/schedule_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ scheduledAt: "2026-06-14T12:30:00.000Z" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/accounts/account_1/outbox/schedule_1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("loads and updates scheduled outbox drafts through compose routes", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        scheduledSend: {
          id: "schedule/1",
          accountId: "account 1",
          draftId: "draft_1",
          scheduledAt: "2026-06-14T09:30:00.000Z",
          status: "scheduled",
          attempts: 0,
          maxAttempts: 5,
          notBefore: "2026-06-14T09:30:00.000Z",
          canEdit: true,
          canSendNow: true,
          canDelete: true,
          createdAt: "2026-06-13T10:00:00.000Z",
          updatedAt: "2026-06-13T10:00:00.000Z",
        },
        draft: {
          id: "draft_1",
          accountId: "account 1",
          to: [{ address: "lina@example.com" }],
          cc: [],
          bcc: [],
          subject: "Scheduled subject",
          bodyText: "Scheduled body",
          status: "scheduled",
          source: "manual",
          createdAt: "2026-06-13T10:00:00.000Z",
          updatedAt: "2026-06-13T10:00:00.000Z",
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.getScheduledDraft({
      accountId: "account 1",
      scheduledId: "schedule/1",
    });
    await api.updateScheduledDraft({
      accountId: "account 1",
      scheduledId: "schedule/1",
      to: [{ address: "lina@example.com" }],
      subject: "Updated scheduled subject",
      bodyText: "Updated scheduled body",
      hermesSkillRunId: "run_rewrite_1",
      hermesDraftText: "Hermes scheduled body",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "plan.pdf",
          contentType: "application/pdf",
          byteSize: 4,
          inline: false,
        },
      ],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account%201/outbox/schedule%2F1/draft",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account%201/outbox/schedule%2F1/draft",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          to: [{ address: "lina@example.com" }],
          subject: "Updated scheduled subject",
          bodyText: "Updated scheduled body",
          hermesSkillRunId: "run_rewrite_1",
          hermesDraftText: "Hermes scheduled body",
          attachments: [
            {
              id: "upload_1",
              source: "uploaded_file",
              attachmentId: "upload_1",
              filename: "plan.pdf",
              contentType: "application/pdf",
              byteSize: 4,
              inline: false,
            },
          ],
        }),
      }),
    );
  });
});
