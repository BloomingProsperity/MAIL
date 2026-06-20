import { describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  createEmailHubApi,
} from "./emailHubApi";
import { jsonResponse } from "./emailHubApiTestHelpers";

describe("emailHubApi", () => {
  it("loads mailbox provider capabilities for Add Mail wiring", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        providers: [
          {
            provider: "gmail",
            label: "Gmail",
            connectionLabel: "登录 Google 账号",
            accountGroup: "global",
            supportsLogin: true,
            supportsWebLogin: true,
            supportsScanLogin: false,
            supportsAppPassword: false,
            supportsMailboxPassword: false,
            supportsServerSearch: true,
            supportsCalendar: false,
            supportsContacts: false,
            supportsAliasSync: false,
            supportsRecall: false,
            supportsReadReceipts: false,
            supportsLargeAttachment: false,
            supportsCloudAttachment: false,
            supportsOnlineArchive: false,
            supportsJunkFiltering: true,
            supportsSendAsGroup: false,
            supportsSendOnBehalf: false,
            supportsLabels: true,
            requiresLocalBridge: false,
            setupHints: ["登录后自动同步邮件"],
            providerSpecificActions: [],
          },
        ],
      }),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const result = await api.getMailProviderCapabilities();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/mail-providers/capabilities",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.providers[0]).toMatchObject({
      provider: "gmail",
      connectionLabel: "登录 Google 账号",
      supportsWebLogin: true,
      setupHints: ["登录后自动同步邮件"],
    });
  });

  it("sends the configured API bearer token on JSON and attachment requests", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/download")) {
        return new Response("attachment body", {
          headers: {
            "content-disposition": 'attachment; filename="proof.txt"',
            "content-type": "text/plain",
          },
        });
      }

      return jsonResponse({ items: [] });
    });
    const api = createEmailHubApi({
      fetchImpl: fetchMock as any,
      apiToken: " api-secret ",
    });

    await api.listMailboxes({ accountId: "account_1" });
    await api.downloadAttachment({
      accountId: "account_1",
      attachmentId: "attachment_1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account_1/mailboxes",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer api-secret",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account_1/attachments/attachment_1/download",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer api-secret",
        }),
      }),
    );
  });

  it("loads EmailEngine readiness for production setup guidance", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        provider: "emailengine",
        ok: false,
        detail: "adapter boundary ready: http://emailengine:3000",
        checks: {
          url: "configured",
          http: "unavailable",
          accessToken: "missing",
          apiAuth: "skipped",
          webhookSecret: "custom",
        },
        capabilities: {
          urlConfigured: true,
          accessTokenConfigured: false,
          imapSmtpOnboarding: false,
          attachmentDownload: false,
          send: false,
        },
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
        warnings: [],
        readiness: {
          status: "degraded",
          summary: "EmailEngine 配置未完全就绪，部分上线能力会降级。",
          setupActions: [
            {
              code: "set_emailengine_access_token",
              label: "设置 EmailEngine 访问令牌",
              env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
              effect: "添加邮箱、附件下载、发信和同步任务会失败。",
            },
          ],
        },
      }),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    await expect(api.getMailEngineHealth()).resolves.toMatchObject({
      provider: "emailengine",
      ok: false,
      checks: {
        http: "unavailable",
        accessToken: "missing",
        apiAuth: "skipped",
      },
      missing: ["EMAILENGINE_ACCESS_TOKEN"],
      readiness: {
        status: "degraded",
        setupActions: [
          {
            code: "set_emailengine_access_token",
          },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/mail-engine/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("loads API health for email connection availability", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        service: "email-hub-api",
        ok: true,
        checks: {
          database: "ok",
        },
      }),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    await expect(api.getApiHealth()).resolves.toEqual({
      service: "email-hub-api",
      ok: true,
      checks: {
        database: "ok",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reads and runs compose attachment maintenance through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          generatedAt: "2026-06-16T00:00:00.000Z",
          storage: "local",
          retentionMs: 604800000,
          cleanupLimit: 100,
          protectedStorageKeyCount: 2,
          scanned: 12,
          scanLimit: 5000,
          scanLimited: false,
          uploads: 10,
          totalBytes: 8388608,
          protected: 2,
          fresh: 3,
          staleUnreferenced: 5,
          staleUnreferencedBytes: 2097152,
          invalid: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          generatedAt: "2026-06-16T00:05:00.000Z",
          storage: "local",
          retentionMs: 172800000,
          cleanupLimit: 2,
          protectedStorageKeyCount: 2,
          cleanup: {
            scanned: 4,
            deleted: 2,
            retained: 2,
            skippedFresh: 1,
            skippedProtected: 1,
            skippedInvalid: 0,
            bytesDeleted: 4096,
          },
          after: {
            scanned: 10,
            scanLimit: 5000,
            scanLimited: false,
            uploads: 8,
            totalBytes: 7340032,
            protected: 2,
            fresh: 3,
            staleUnreferenced: 0,
            staleUnreferencedBytes: 0,
            invalid: 0,
          },
        }),
      );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const status = await api.getComposeAttachmentMaintenanceStatus();
    const cleanup = await api.cleanupComposeAttachments({
      minAgeHours: 48,
      limit: 2,
    });

    expect(status.staleUnreferenced).toBe(5);
    expect(cleanup.cleanup.deleted).toBe(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/maintenance/compose-attachments",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/maintenance/compose-attachments/cleanup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minAgeHours: 48, limit: 2 }),
      }),
    );
  });

  it("reads and runs Hermes retention maintenance through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          generatedAt: "2026-06-17T12:00:00.000Z",
          retentionMs: 2592000000,
          retentionDays: 30,
          cleanupLimit: 500,
          cutoff: "2026-05-18T12:00:00.000Z",
          tables: [
            {
              table: "hermes_skill_runs",
              timestampColumn: "created_at",
              expiredRows: 12,
              scanLimit: 500,
              scanLimited: false,
            },
          ],
          expiredRows: 12,
          scanLimited: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          generatedAt: "2026-06-17T12:05:00.000Z",
          retentionMs: 1209600000,
          retentionDays: 14,
          cleanupLimit: 25,
          cutoff: "2026-06-03T12:05:00.000Z",
          cleanup: {
            messageTranslations: 1,
            messageSummaries: 2,
            staleActionPlanConfirmations: 2,
            actionPlans: 3,
            feedback: 4,
            auditEvents: 5,
            skillRuns: 6,
            deleted: 23,
          },
          after: {
            generatedAt: "2026-06-17T12:05:00.000Z",
            retentionMs: 1209600000,
            retentionDays: 14,
            cleanupLimit: 25,
            cutoff: "2026-06-03T12:05:00.000Z",
            tables: [],
            expiredRows: 0,
            scanLimited: false,
          },
        }),
      );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const status = await api.getHermesRetentionMaintenanceStatus();
    const cleanup = await api.cleanupHermesRetention({
      retentionDays: 14,
      limit: 25,
    });

    expect(status.expiredRows).toBe(12);
    expect(cleanup.cleanup.deleted).toBe(23);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/maintenance/hermes-retention",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/maintenance/hermes-retention/cleanup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ retentionDays: 14, limit: 25 }),
      }),
    );
  });

  it("loads smart-sorted messages with local mailbox ids only", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({
        items: [
          {
            id: "message_1",
            accountId: "account_1",
            subject: "Live subject",
            from: { email: "client@example.com", name: "Client" },
            receivedAt: "2026-06-13T10:00:00.000Z",
            snippet: "live snippet",
            unread: true,
            starred: false,
            mailboxIds: ["mailbox_inbox"],
            attachmentCount: 1,
            classification: {
              bucket: "P1 Urgent",
              priorityScore: 96,
              reasons: ["Direct to you"],
            },
          },
        ],
        nextCursor: "cursor_1",
      }),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const result = await api.listMessages({
      accountId: "account_1",
      mailboxId: "mailbox_inbox",
      limit: 25,
      q: " client ",
      sort: "time",
      savedView: "codes",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/accounts/account_1/messages?limit=25&mailboxId=mailbox_inbox&q=client&sort=time&savedView=codes",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.items[0].classification.priorityScore).toBe(96);
    expect(result.nextCursor).toBe("cursor_1");
  });

  it("loads aggregated messages without requiring a selected account", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "message_gmail",
            accountId: "11111111-1111-4111-8111-111111111111",
            subject: "Gmail customer reply",
            from: { email: "client@example.com" },
            receivedAt: "2026-06-13T10:00:00.000Z",
            unread: true,
            starred: false,
            mailboxIds: ["mailbox_gmail_inbox"],
            attachmentCount: 0,
            classification: {
              bucket: "P1 Urgent",
              priorityScore: 96,
              reasons: ["Direct to you"],
            },
          },
        ],
      }),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const result = await api.listMessages({
      limit: 25,
      sort: "time",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/messages?limit=25&sort=time",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.items[0].accountId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("passes search scopes and quick filters to the mail read route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.listMessages({
      limit: 25,
      q: "invoice",
      sort: "time",
      quickFilters: ["unread", "snoozed", "attachments"],
      qScopes: ["sender", "subject", "body"],
      labelIds: ["label_1", "label_2"],
      tagMode: "all",
      senderQuery: "Alice",
      recipientQuery: "legal@example.com",
      receivedAfter: "2026-06-08T00:00:00.000Z",
      receivedBefore: "2026-06-15T00:00:00.000Z",
      hasAttachment: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/messages?limit=25&q=invoice&sort=time&quickFilter=unread&quickFilter=snoozed&quickFilter=attachments&qScope=sender&qScope=subject&qScope=body&labelId=label_1&labelId=label_2&tagMode=all&sender=Alice&recipient=legal%40example.com&receivedAfter=2026-06-08T00%3A00%3A00.000Z&receivedBefore=2026-06-15T00%3A00%3A00.000Z&hasAttachment=true",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("loads and upserts account labels through the labels route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "label_codes",
              accountId: "account_1",
              name: "验证码",
              color: "blue",
              messageCount: 4,
              createdAt: "2026-06-13T10:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "label_codes",
          accountId: "account_1",
          name: "验证码",
          color: "blue",
          messageCount: 0,
          createdAt: "2026-06-13T10:01:00.000Z",
        }),
      );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const page = await api.listLabels({ accountId: "account_1" });
    const label = await api.upsertLabel({
      accountId: "account_1",
      name: "验证码",
      color: "blue",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/accounts/account_1/labels",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/accounts/account_1/labels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "验证码", color: "blue" }),
      }),
    );
    expect(page.items[0].messageCount).toBe(4);
    expect(label.name).toBe("验证码");
  });

  it("reads and updates Gatekeeper settings through the account settings route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          accountId: "account_1",
          mode: "off_accept_all",
          updatedAt: "2026-06-14T08:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          accountId: "account_1",
          mode: "before_inbox",
          updatedAt: "2026-06-14T08:05:00.000Z",
        }),
      );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const current = await api.getGatekeeperSettings({ accountId: "account_1" });
    const updated = await api.updateGatekeeperSettings({
      accountId: "account_1",
      mode: "before_inbox",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/accounts/account_1/gatekeeper/settings",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/accounts/account_1/gatekeeper/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ mode: "before_inbox" }),
      }),
    );
    expect(current.mode).toBe("off_accept_all");
    expect(updated.mode).toBe("before_inbox");
  });

  it("routes Gatekeeper sender decisions through sender screening endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              senderId: "sender_1",
              email: "new-client@example.com",
              domain: "example.com",
              status: "unknown",
              messageCount: 2,
              bulkAvailable: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            senderId: "sender_1",
            email: "new-client@example.com",
            domain: "example.com",
            status: "accepted",
            action: "accept",
            eventId: "event_1",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            senderId: "sender_1",
            email: "new-client@example.com",
            domain: "example.com",
            status: "blocked",
            action: "block_sender",
            eventId: "event_2",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            senderId: "domain_rule_1",
            domain: "example.com",
            status: "blocked",
            action: "block_domain",
            eventId: "event_3",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            items: [],
            missingSenderIds: [],
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.listGatekeeperSenders({
      accountId: "account_1",
      status: "unknown",
    });
    await api.acceptGatekeeperSender({
      accountId: "account_1",
      senderId: "sender_1",
    });
    await api.blockGatekeeperSender({
      accountId: "account_1",
      senderId: "sender_1",
    });
    await api.blockGatekeeperDomain({
      accountId: "account_1",
      domain: "example.com",
    });
    await api.bulkDecideGatekeeperSenders({
      accountId: "account_1",
      senderIds: ["sender_1"],
      action: "accept",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/screening/senders?accountId=account_1&status=unknown",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/screening/senders/sender_1/accept",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accountId: "account_1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/screening/senders/sender_1/block",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accountId: "account_1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/screening/domains/example.com/block",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accountId: "account_1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/screening/senders/bulk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          senderIds: ["sender_1"],
          action: "accept",
        }),
      }),
    );
  });

  it("lists domain destinations for alias routing settings", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "dest_1",
            domainId: "domain_1",
            email: "owner@example.net",
            verified: false,
            createdAt: "2026-06-13T08:00:00.000Z",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listDomainDestinations({ domainId: "domain_1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/domains/domain_1/destinations",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page.items[0].email).toBe("owner@example.net");
  });

  it("loads domain alias control-plane data through stable API methods", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/domains") {
        return jsonResponse({
          items: [
            {
              id: "domain_1",
              domain: "demo.site",
              verificationStatus: "pending",
              dnsRecords: {},
              createdAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/domains/domain_1/aliases") {
        return jsonResponse({
          items: [
            {
              id: "alias_1",
              domainId: "domain_1",
              address: "support@demo.site",
              localPart: "support",
              enabled: true,
              destinationIds: ["dest_1"],
              createdAt: "2026-06-13T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/domains/domain_1/catch-all") {
        return jsonResponse({
          item: {
            id: "rule_1",
            domainId: "domain_1",
            ruleType: "catch_all",
            enabled: true,
            config: { mode: "forward", destinationIds: ["dest_1"] },
            createdAt: "2026-06-13T08:00:00.000Z",
          },
        });
      }
      return jsonResponse({
        items: [
          {
            id: "log_1",
            domainId: "domain_1",
            recipient: "support@demo.site",
            status: "delivered",
            createdAt: "2026-06-13T09:00:00.000Z",
          },
        ],
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const domains = await api.listDomains();
    const aliases = await api.listDomainAliases({ domainId: "domain_1" });
    const logs = await api.listDomainDeliveryLogs({
      domainId: "domain_1",
      limit: 20,
    });
    const catchAll = await api.getDomainCatchAll({ domainId: "domain_1" });

    expect(domains.items[0].domain).toBe("demo.site");
    expect(aliases.items[0].address).toBe("support@demo.site");
    expect(logs.items[0].status).toBe("delivered");
    expect(catchAll.item?.config.mode).toBe("forward");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/domains/domain_1/delivery-logs?limit=20",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/domains/domain_1/catch-all",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("writes domain alias control-plane changes through stable API methods", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/domains") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          domain: "example.com",
        });
        return jsonResponse({
          id: "domain_2",
          domain: "example.com",
          verificationStatus: "pending",
          dnsRecords: {},
          createdAt: "2026-06-13T08:00:00.000Z",
        }, 201);
      }
      if (url === "/api/domains/domain_2/destinations") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "owner@example.net",
        });
        return jsonResponse({
          id: "dest_2",
          domainId: "domain_2",
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        }, 201);
      }
      if (url === "/api/domains/domain_2/aliases") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          localPart: "support",
          destinationIds: ["dest_2"],
        });
        return jsonResponse({
          id: "alias_2",
          domainId: "domain_2",
          address: "support@example.com",
          localPart: "support",
          enabled: true,
          destinationIds: ["dest_2"],
          createdAt: "2026-06-13T08:00:00.000Z",
        }, 201);
      }
      expect(url).toBe("/api/domains/domain_2/catch-all");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        mode: "forward",
        destinationIds: ["dest_2"],
      });
      return jsonResponse({
        id: "rule_2",
        domainId: "domain_2",
        ruleType: "catch_all",
        enabled: true,
        config: { mode: "forward", destinationIds: ["dest_2"] },
        createdAt: "2026-06-13T08:00:00.000Z",
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const domain = await api.createDomain({ domain: "example.com" });
    const destination = await api.createDomainDestination({
      domainId: domain.id,
      email: "owner@example.net",
    });
    const alias = await api.createDomainAlias({
      domainId: domain.id,
      localPart: "support",
      destinationIds: [destination.id],
    });
    const catchAll = await api.setDomainCatchAll({
      domainId: domain.id,
      mode: "forward",
      destinationIds: [destination.id],
    });

    expect(alias.address).toBe("support@example.com");
    expect(catchAll.config.destinationIds).toEqual(["dest_2"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("previews CSV import and creates import tasks through account import routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          summary: {
            totalRows: 1,
            ready: 1,
            needsOAuth: 0,
            disabled: 0,
            invalid: 0,
          },
          rows: [{ rowNumber: 2, status: "ready" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            summary: {
              totalRows: 1,
              ready: 1,
              needsOAuth: 0,
              disabled: 0,
              invalid: 0,
            },
            rows: [{ rowNumber: 2, status: "ready" }],
            createdTaskCount: 1,
            tasks: [
              {
                rowNumber: 2,
                id: "task_csv_1",
                email: "support@qq.com",
                provider: "qq",
                authMethod: "password",
                status: "pending",
              },
            ],
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });
    const csv = "email,provider,auth_method,secret\nsupport@qq.com,qq,password,code";

    await api.previewAccountCsv({ csv });
    const created = await api.createAccountCsvImport({ csv });

    expect(created.tasks[0]).toMatchObject({
      rowNumber: 2,
      id: "task_csv_1",
      email: "support@qq.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/import/csv/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ csv }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/import/csv",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ csv }),
      }),
    );
  });

  it("exports and imports account transfer packages without exposing secrets", async () => {
    const transferPackage = {
      schemaVersion: 1 as const,
      exportedAt: "2026-06-14T08:00:00.000Z",
      accounts: [
        {
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password" as const,
          engineProvider: "emailengine" as const,
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(transferPackage))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            importedTaskCount: 1,
            reauthRequiredCount: 1,
            tasks: [
              {
                id: "task_1",
                email: "support@qq.com",
                provider: "qq",
                authMethod: "password",
                status: "pending",
              },
            ],
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const exported = await api.exportAccountTransfer({
      accountIds: ["account_1"],
    });
    await api.importAccountTransfer({ package: transferPackage });

    expect(exported.accounts[0]).not.toHaveProperty("secret");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/transfer/export",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accountIds: ["account_1"] }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/transfer/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ package: transferPackage }),
      }),
    );
  });

  it("throws typed request errors with backend error codes", async () => {
    const api = createEmailHubApi({
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ error: "mail_read_unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ) as any,
    });

    await expect(
      api.listMailboxes({ accountId: "account_1" }),
    ).rejects.toMatchObject({
      status: 503,
      code: "mail_read_unavailable",
    } satisfies Partial<ApiRequestError>);
  });

  it("preserves Hermes disabled skill ids on typed request errors", async () => {
    const api = createEmailHubApi({
      fetchImpl: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "hermes_skill_disabled",
            skillId: "translate_text",
            requiredPermission: "body_read",
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as any,
    });

    await expect(
      api.translateText({
        accountId: "account_1",
        text: "Hello",
        targetLanguage: "Chinese",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "hermes_skill_disabled",
      skillId: "translate_text",
      requiredPermission: "body_read",
    } satisfies Partial<ApiRequestError>);
  });

  it("keeps reauthorization error payloads narrow and typed", async () => {
    const api = createEmailHubApi({
      fetchImpl: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "reauthorization_failed",
            provider: "qq",
            detail: "connection rejected after [redacted]",
            requestId: "req_1",
            submittedSecret: "qq-auth-code-secret",
            diagnostics: [
              {
                code: "qq_authorization_code_required",
                provider: "qq",
                severity: "action_required",
                affected: "account",
                message: "Use [redacted] instead of password.",
                recoveryAction: "enable_qq_mail_authorization_code",
              },
              {
                code: "invalid_diagnostic",
                provider: "qq",
                affected: "account",
                message: "missing required fields",
              },
            ],
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as any,
    });

    try {
      await api.completeSyncCenterImapSmtpReauthorization({
        taskId: "task_password_1",
        username: "support@qq.com",
        secret: "qq-auth-code-secret",
      });
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      const requestError = error as ApiRequestError;
      expect(requestError).toMatchObject({
        status: 400,
        code: "reauthorization_failed",
        provider: "qq",
        detail: "connection rejected after [redacted]",
        requestId: "req_1",
      } satisfies Partial<ApiRequestError>);
      expect(requestError.diagnostics).toEqual([
        {
          code: "qq_authorization_code_required",
          provider: "qq",
          severity: "action_required",
          affected: "account",
          message: "Use [redacted] instead of password.",
          recoveryAction: "enable_qq_mail_authorization_code",
        },
      ]);
      expect(requestError.payload).not.toHaveProperty("submittedSecret");
      expect(JSON.stringify(requestError)).not.toContain("qq-auth-code-secret");
    }
  });
});
