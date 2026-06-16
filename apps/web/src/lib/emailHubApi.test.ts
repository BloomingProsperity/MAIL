import { describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  createEmailHubApi,
  type HermesProviderCatalogResponse,
  type HermesRuntimeTestResult,
} from "./emailHubApi";

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
      sort: "smart",
      savedView: "codes",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/accounts/account_1/messages?limit=25&mailboxId=mailbox_inbox&q=client&sort=smart&savedView=codes",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.items[0].classification.priorityScore).toBe(96);
    expect(result.nextCursor).toBe("cursor_1");
  });

  it("loads aggregated smart messages without requiring a selected account", async () => {
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
      sort: "smart",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/messages?limit=25&sort=smart",
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
      sort: "smart",
      quickFilters: ["unread", "attachments"],
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
      "/api/messages?limit=25&q=invoice&sort=smart&quickFilter=unread&quickFilter=attachments&qScope=sender&qScope=subject&qScope=body&labelId=label_1&labelId=label_2&tagMode=all&sender=Alice&recipient=legal%40example.com&receivedAfter=2026-06-08T00%3A00%3A00.000Z&receivedBefore=2026-06-15T00%3A00%3A00.000Z&hasAttachment=true",
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

  it("reads, saves, probes, tests, clears, and checks Hermes runtime settings through one client", async () => {
    const runtimeTestResult: HermesRuntimeTestResult = {
      ok: true,
      checkedAt: "2026-06-14T08:00:00.000Z",
      providerKey: "ollama",
      requestProtocol: "openai_chat_completions",
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-2-pro",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          providers: [
            {
              key: "novita",
              label: "NovitaAI",
              category: "cloud",
              authType: "api_key",
              endpointEditable: true,
              aliases: ["novita-ai"],
              modelExamples: ["moonshotai/kimi-k2.5"],
              capabilities: ["chat", "email_skills"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          mode: "external_hermes",
          providerKey: "hermes",
          endpointUrl: "http://hermes:8081/v1/chat/completions",
          model: "hermes-email",
          apiKeyConfigured: true,
          updatePolicy: "manual",
          updateChannel: "stable",
          updateAvailable: false,
          source: "database",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          mode: "openai_compatible",
          providerKey: "ollama",
          endpointUrl: "http://localhost:11434/v1/chat/completions",
          model: "hermes-2-pro",
          apiKeyConfigured: true,
          updatePolicy: "notify",
          updateChannel: "stable",
          updateAvailable: false,
          source: "database",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          status: "ready",
          providerKey: "ollama",
          label: "Ollama 本地",
          category: "local",
          authType: "none",
          endpointUrl: "http://localhost:11434/v1/chat/completions",
          model: "hermes-2-pro",
          missing: [],
          checkedAt: "2026-06-14T08:02:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          enabled: true,
          mode: "openai_compatible",
          providerKey: "ollama",
          endpointUrl: "http://localhost:11434/v1/chat/completions",
          model: "hermes-2-pro",
          apiKeyConfigured: false,
          updatePolicy: "notify",
          updateChannel: "stable",
          updateAvailable: false,
          source: "database",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(runtimeTestResult),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          installedVersion: "0.1.0",
          latestVersion: "0.2.0",
          updateAvailable: true,
          updatePolicy: "notify",
          updateChannel: "stable",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          installedVersion: "0.1.0",
          latestVersion: "0.2.0",
          updateAvailable: true,
          updatePolicy: "notify",
          updateChannel: "stable",
          lastCheckedAt: "2026-06-14T08:05:00.000Z",
        }),
      );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    await api.getHermesProviders();
    await api.getHermesRuntimeSettings();
    await api.updateHermesRuntimeSettings({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "ollama",
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-2-pro",
      apiKey: "runtime-secret",
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    await api.probeHermesProvider({
      providerKey: "ollama",
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-2-pro",
      apiKey: "runtime-secret",
    });
    await api.clearHermesRuntimeApiKey({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "ollama",
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-2-pro",
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    await api.testHermesRuntimeConnection();
    await api.getHermesRuntimeVersion();
    await api.checkHermesRuntimeUpdate();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/hermes/providers",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/hermes/runtime",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8080/api/hermes/runtime",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          mode: "openai_compatible",
          providerKey: "ollama",
          endpointUrl: "http://localhost:11434/v1/chat/completions",
          model: "hermes-2-pro",
          apiKey: "runtime-secret",
          updatePolicy: "notify",
          updateChannel: "stable",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://localhost:8080/api/hermes/providers/ollama/probe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          endpointUrl: "http://localhost:11434/v1/chat/completions",
          model: "hermes-2-pro",
          apiKey: "runtime-secret",
        }),
      }),
    );
    const clearKeyCall = fetchMock.mock.calls[4];
    expect(clearKeyCall[0]).toBe("http://localhost:8080/api/hermes/runtime");
    expect(clearKeyCall[1]).toEqual(
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(clearKeyCall[1]?.body))).toEqual({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "ollama",
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-2-pro",
      clearApiKey: true,
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://localhost:8080/api/hermes/runtime/test",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "http://localhost:8080/api/hermes/runtime/version",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "http://localhost:8080/api/hermes/runtime/update/check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves Hermes provider request protocol metadata for settings wiring", async () => {
    const catalogResponse: HermesProviderCatalogResponse = {
      providers: [
        {
          key: "openai-responses",
          label: "OpenAI Responses",
          category: "cloud",
          authType: "api_key",
          requestProtocol: "openai_responses",
          endpointEditable: true,
          aliases: ["responses"],
          modelExamples: ["gpt-5.2"],
          capabilities: ["chat", "email_skills", "streaming_ready"],
          defaultEndpoint: "https://api.openai.com/v1/responses",
        },
      ],
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse(catalogResponse),
    );
    const api = createEmailHubApi({
      baseUrl: "http://localhost:8080",
      fetchImpl: fetchMock as any,
    });

    const response = await api.getHermesProviders();

    expect(response.providers[0]).toMatchObject({
      key: "openai-responses",
      requestProtocol: "openai_responses",
    });
  });

  it("manages Hermes memories through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "memory_1",
              layer: "writing_style_profile",
              scope: "global",
              content: { preference: "short replies" },
              confidence: 0.75,
              createdAt: "2026-06-14T08:00:00.000Z",
              updatedAt: "2026-06-14T09:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "memory_1",
          layer: "writing_style_profile",
          scope: "global",
          content: { preference: "crisp replies" },
          confidence: 0.9,
          createdAt: "2026-06-14T08:00:00.000Z",
          updatedAt: "2026-06-14T10:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listHermesMemories({
      layer: " writing_style_profile ",
      scope: " global ",
      limit: 25,
    });
    const updated = await api.updateHermesMemory({
      id: "memory_1",
      content: { preference: "crisp replies" },
      confidence: 0.9,
    });
    await api.deleteHermesMemory({ id: "memory_1" });

    expect(page.items[0]).toMatchObject({
      id: "memory_1",
      layer: "writing_style_profile",
      confidence: 0.75,
    });
    expect(updated.content).toEqual({ preference: "crisp replies" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/memories?layer=writing_style_profile&scope=global&limit=25",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/memories/memory_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          content: { preference: "crisp replies" },
          confidence: 0.9,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/hermes/memories/memory_1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("posts Spark done and undo actions through the backend action route", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      jsonResponse({
        accountId: "account_1",
        messageId: "message_1",
        action: JSON.parse(String(init?.body)).action,
        state: {
          unread: false,
          starred: false,
          archived: true,
          deleted: false,
          mailboxIds: [],
          labelIds: [],
          doneAt: "2026-06-13T10:00:00.000Z",
          undoToken: "undo_1",
          undoExpiresAt: "2026-06-13T10:00:05.000Z",
        },
        command: {
          id: "cmd_1",
          commandType: "archive",
          accountId: "account_1",
          messageId: "message_1",
          idempotencyKey: "mail-action:account_1:message_1:done",
          status: "queued",
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.applyMailAction({
      accountId: "account_1",
      messageId: "message_1",
      action: "done",
    });
    await api.applyMailAction({
      accountId: "account_1",
      messageId: "message_1",
      action: "undo_done",
      undoToken: "undo_1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/accounts/account_1/messages/message_1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "done" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/accounts/account_1/messages/message_1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "undo_done", undoToken: "undo_1" }),
      }),
    );
  });

  it("posts Smart Inbox card bulk done through the backend bulk action route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          accountId: "account_1",
          bucket: "P2",
          action: "done",
          requestedCount: 2,
          attemptedCount: 2,
          succeededCount: 2,
          failedCount: 0,
          succeeded: [
            { messageId: "message_1", undoToken: "undo_1", commandId: "cmd_1" },
            { messageId: "message_2", undoToken: "undo_2", commandId: "cmd_2" },
          ],
          failed: [],
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.applySmartInboxCardBulkAction({
      accountId: "account_1",
      bucket: "P2",
      action: "done",
      messageIds: ["message_1", "message_2"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/smart-inbox/cards/P2/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "done",
          messageIds: ["message_1", "message_2"],
        }),
      }),
    );
    expect(result.succeededCount).toBe(2);
  });

  it("records Smart Inbox sender corrections through the feedback route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        feedbackEventId: "feedback_1",
        accountId: "account_1",
        messageId: "message_1",
        classification: {
          bucket: "P6 Feed",
          priorityScore: 15,
          reasons: ["User moved sender to Newsletters"],
        },
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.recordSmartInboxFeedback({
      accountId: "account_1",
      messageId: "message_1",
      action: "move_to_newsletters",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/smart-inbox/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "move_to_newsletters" }),
      }),
    );
  });

  it("starts OAuth onboarding and keeps provider payloads behind the API client", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          provider: "gmail",
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          state: "state_1",
          task: {
            id: "task_1",
            email: "pending@gmail.oauth",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.startOAuthAccount({
      provider: "gmail",
      redirectUri: "http://127.0.0.1:5173/oauth/callback",
      loginHint: "me@gmail.com",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/oauth/gmail/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          redirectUri: "http://127.0.0.1:5173/oauth/callback",
          loginHint: "me@gmail.com",
        }),
      }),
    );
    expect(result.authorizationUrl).toContain("accounts.google.com");
  });

  it("completes OAuth callbacks through the API client", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          task: {
            id: "task_1",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "completed",
          },
          account: {
            id: "account_gmail",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            syncState: "syncing",
            engineProvider: "native",
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.completeOAuthCallback({
      provider: "gmail",
      state: "state_1",
      code: "code 1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/oauth/gmail/callback?state=state_1&code=code+1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.account?.email).toBe("me@gmail.com");
  });

  it("posts iCloud app-password onboarding through the preset IMAP route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          task: {
            id: "task_icloud",
            email: "me@icloud.com",
            provider: "icloud",
            authMethod: "password",
            status: "completed",
          },
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.onboardImapSmtpAccount({
      email: "me@icloud.com",
      provider: "icloud",
      displayName: "iCloud Mail",
      username: "me@icloud.com",
      secret: "apple-app-specific-password",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/imap-smtp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "me@icloud.com",
          provider: "icloud",
          displayName: "iCloud Mail",
          username: "me@icloud.com",
          secret: "apple-app-specific-password",
        }),
      }),
    );
  });

  it("tests app-password mailbox credentials before onboarding", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        provider: "qq",
        ok: false,
        checks: {
          imap: { ok: false, code: "EAUTH", error: "Invalid login" },
          smtp: { ok: true },
        },
        diagnostics: [
          {
            code: "qq_authorization_code_required",
            provider: "qq",
            severity: "action_required",
            affected: "account",
            message:
              "Use the authorization code generated in QQ Mail settings, not your normal account password.",
            recoveryAction: "enable_qq_mail_authorization_code",
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.testImapSmtpConnection({
      email: "support@qq.com",
      provider: "qq",
      secret: "qq-auth-code",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/imap-smtp/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "support@qq.com",
          provider: "qq",
          secret: "qq-auth-code",
        }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.imap.code).toBe("EAUTH");
    expect(result.diagnostics?.[0]).toMatchObject({
      code: "qq_authorization_code_required",
      recoveryAction: "enable_qq_mail_authorization_code",
    });
  });

  it("loads account onboarding diagnostics from durable operational events", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "op_1",
            occurredAt: "2026-06-14T08:00:00.000Z",
            service: "email-hub-api",
            level: "warn",
            event: "account_onboarding_connection_test_failed",
            lane: "account_onboarding",
            message: "IMAP/SMTP connection test failed for qq",
            context: { provider: "qq", email: "support@qq.com" },
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listOperationalEvents({
      service: "email-hub-api",
      lane: "account_onboarding",
      limit: 3,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/diagnostics/events?service=email-hub-api&lane=account_onboarding&limit=3",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page.items[0].event).toBe("account_onboarding_connection_test_failed");
  });

  it("loads provider groups and quick categories for the left navigation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        providerGroups: [
          { id: "gmail", label: "Gmail", count: 2 },
          { id: "outlook", label: "Outlook", count: 1 },
        ],
        quickCategories: [
          { id: "codes", label: "验证码", count: 18, tone: "blue" },
          { id: "receipts", label: "账单/收据", count: 24, tone: "green" },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const summary = await api.getMailNavigationSummary();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mail-navigation/summary",
      expect.objectContaining({ method: "GET" }),
    );
    expect(summary.providerGroups[0]).toEqual({
      id: "gmail",
      label: "Gmail",
      count: 2,
    });
    expect(summary.quickCategories[0]).toEqual({
      id: "codes",
      label: "验证码",
      count: 18,
      tone: "blue",
    });
  });

  it("posts sync center control actions through stable API client methods", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/resync")) {
        return jsonResponse(
          {
            accountId: "acc_1",
            action: "manual_sync_queued",
            job: {
              id: "job_sync",
              jobType: "sync_account",
              accountId: "acc_1",
              idempotencyKey: "job:manual-sync:acc_1:job_sync",
              status: "queued",
              createdAt: "2026-06-13T08:00:00.000Z",
            },
          },
          202,
        );
      }

      if (url.endsWith("/pause")) {
        return jsonResponse(
          {
            accountId: "acc_1",
            action: "sync_paused",
            account: { accountId: "acc_1", syncState: "paused" },
          },
          202,
        );
      }

      if (url.endsWith("/resume")) {
        return jsonResponse(
          {
            accountId: "acc_1",
            action: "sync_resumed",
            account: { accountId: "acc_1", syncState: "syncing" },
          },
          202,
        );
      }

      return jsonResponse(
        {
          accountId: "acc_1",
          action: "failed_sync_requeued",
          retriedJobCount: 2,
        },
        202,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const resync = await api.requestSyncCenterResync({ accountId: "acc_1" });
    const pause = await api.pauseSyncCenterAccount({ accountId: "acc_1" });
    const resume = await api.resumeSyncCenterAccount({ accountId: "acc_1" });
    const retry = await api.retryFailedSyncCenterJobs({ accountId: "acc_1" });

    expect(resync.job.status).toBe("queued");
    expect(pause.account.syncState).toBe("paused");
    expect(resume.account.syncState).toBe("syncing");
    expect(retry.retriedJobCount).toBe(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sync-center/accounts/acc_1/resync",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/sync-center/accounts/acc_1/pause",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/sync-center/accounts/acc_1/resume",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sync-center/accounts/acc_1/retry-failed",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("loads Sync Center account diagnostics with filter parameters", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "op_sync_1",
            occurredAt: "2026-06-14T08:00:00.000Z",
            service: "email-hub-api",
            level: "info",
            event: "emailengine_webhook_ingested",
            accountId: "acc_1",
            lane: "sync",
            jobId: "job_1",
            message: "EmailEngine webhook message_new ingested for acc_1",
            context: { syncJobType: "sync_account" },
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSyncCenterAccountDiagnostics({
      accountId: "acc_1",
      level: "info",
      jobId: "job_1",
      limit: 200,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync-center/accounts/acc_1/diagnostics?level=info&jobId=job_1&limit=200",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page.items[0]).toMatchObject({
      event: "emailengine_webhook_ingested",
      accountId: "acc_1",
      jobId: "job_1",
    });
  });

  it("lists and completes Sync Center reauthorization tasks", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/sync-center/reauthorizations") {
        return jsonResponse({
          items: [
            {
              taskId: "task_reauth_1",
              email: "reauth@example.com",
              provider: "gmail",
              authMethod: "oauth",
              status: "pending",
              source: "native_send",
              reauthRequired: true,
              createdAt: "2026-06-14T08:00:00.000Z",
              updatedAt: "2026-06-14T08:00:00.000Z",
            },
          ],
        });
      }

      return jsonResponse(
        {
          provider: "gmail",
          authorizationUrl: "https://accounts.example/auth",
          state: "state_1",
          task: {
            id: "task_reauth_1",
            email: "reauth@example.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
        },
        202,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSyncCenterReauthorizations();
    await api.startSyncCenterOAuthReauthorization({
      taskId: "task_reauth_1",
      redirectUri: "https://app.example/oauth/callback",
    });
    await api.completeSyncCenterImapSmtpReauthorization({
      taskId: "task_password_1",
      username: "support@qq.com",
      secret: "qq-auth-code",
    });
    await api.completeSyncCenterImapSmtpReauthorization({
      taskId: "task_custom_1",
      username: "custom@example.com",
      secret: "domain-app-password",
      imap: {
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "custom@example.com",
        secret: "domain-app-password",
      },
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "custom@example.com",
        secret: "domain-app-password",
      },
    });

    expect(page.items[0]).toMatchObject({
      taskId: "task_reauth_1",
      source: "native_send",
      reauthRequired: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sync-center/reauthorizations",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/sync-center/reauthorizations/task_reauth_1/oauth/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          redirectUri: "https://app.example/oauth/callback",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/sync-center/reauthorizations/task_password_1/imap-smtp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "support@qq.com",
          secret: "qq-auth-code",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sync-center/reauthorizations/task_custom_1/imap-smtp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "custom@example.com",
          secret: "domain-app-password",
          imap: {
            host: "imap.example.com",
            port: 993,
            secure: true,
            username: "custom@example.com",
            secret: "domain-app-password",
          },
          smtp: {
            host: "smtp.example.com",
            port: 587,
            secure: false,
            username: "custom@example.com",
            secret: "domain-app-password",
          },
        }),
      }),
    );
  });

  it("lists and completes follow-up reminders for the Tasks view", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/follow-ups?accountId=account_1&status=open&limit=25") {
        return jsonResponse({
          accountId: "account_1",
          status: "open",
          items: [
            {
              id: "fu_1",
              accountId: "account_1",
              messageId: "message_1",
              kind: "waiting_on_them",
              status: "open",
              dueAt: "2026-06-14T09:00:00.000Z",
              title: "Check whether Lina replied",
              source: "hermes_followup",
              createdAt: "2026-06-13T09:00:00.000Z",
              updatedAt: "2026-06-13T09:00:00.000Z",
            },
          ],
        });
      }

      return jsonResponse({
        id: "fu_1",
        accountId: "account_1",
        messageId: "message_1",
        kind: "waiting_on_them",
        status: JSON.parse(String(init?.body)).status,
        dueAt: "2026-06-14T09:00:00.000Z",
        title: "Check whether Lina replied",
        source: "hermes_followup",
        createdAt: "2026-06-13T09:00:00.000Z",
        updatedAt: "2026-06-13T10:00:00.000Z",
      });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listFollowUps({
      accountId: "account_1",
      status: "open",
      limit: 25,
    });
    await api.updateFollowUp({ id: "fu_1", status: "done" });

    expect(page.items[0].title).toBe("Check whether Lina replied");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/follow-ups/fu_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      }),
    );
  });

  it("runs Hermes follow-up tracking and confirms the suggestion through backend routes", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/hermes/skills/followup_tracker/run") {
        return jsonResponse(
          {
            skillRunId: "run_followup_1",
            skillId: "followup_tracker",
            status: "waiting_on_them",
            followupNeeded: true,
            owner: "them",
            confidence: 0.86,
            dueAt: "2026-06-14T09:00:00.000Z",
            nextAction: "Check whether Lina replied",
            reasons: ["we asked for confirmation and no reply yet"],
          },
          202,
        );
      }

      return jsonResponse(
        {
          id: "fu_1",
          accountId: "account_1",
          messageId: "message_1",
          kind: "waiting_on_them",
          status: "open",
          dueAt: "2026-06-14T09:00:00.000Z",
          title: "Check whether Lina replied",
          source: "hermes_followup",
          hermesSkillRunId: "run_followup_1",
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
        201,
      );
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const suggestion = await api.trackFollowup({
      subject: "Launch schedule confirmation",
      threadText: "Please confirm the launch schedule.",
      userEmail: "me@example.com",
      participants: ["me@example.com", "lina@example.com"],
      now: "2026-06-13T09:00:00.000Z",
      readMessageIds: ["message_1"],
    });
    if (
      suggestion.status !== "needs_reply" &&
      suggestion.status !== "waiting_on_them"
    ) {
      throw new Error("expected actionable follow-up suggestion");
    }
    await api.confirmHermesFollowUp({
      accountId: "account_1",
      messageId: "message_1",
      skillRunId: suggestion.skillRunId,
      status: suggestion.status,
      dueAt: suggestion.dueAt!,
      nextAction: suggestion.nextAction,
      reasons: suggestion.reasons,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills/followup_tracker/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule confirmation",
          threadText: "Please confirm the launch schedule.",
          userEmail: "me@example.com",
          participants: ["me@example.com", "lina@example.com"],
          now: "2026-06-13T09:00:00.000Z",
          readMessageIds: ["message_1"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/follow-ups/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          messageId: "message_1",
          skillRunId: "run_followup_1",
          status: "waiting_on_them",
          dueAt: "2026-06-14T09:00:00.000Z",
          nextAction: "Check whether Lina replied",
          reasons: ["we asked for confirmation and no reply yet"],
        }),
      }),
    );
  });

  it("runs Hermes reply draft through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_reply_1",
          skillId: "reply_draft",
          draftText: "Hi Lina,\n\nI can confirm the launch plan.",
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.draftReply({
      subject: "Launch schedule confirmation",
      threadText: "Please confirm the launch schedule.",
      instruction: "Confirm politely.",
      readMessageIds: ["message_1"],
    });

    expect(result).toEqual({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      draftText: "Hi Lina,\n\nI can confirm the launch plan.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/reply_draft/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule confirmation",
          threadText: "Please confirm the launch schedule.",
          instruction: "Confirm politely.",
          readMessageIds: ["message_1"],
        }),
      }),
    );
  });

  it("runs Hermes reply draft through the message-scoped backend route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_message_reply_1",
          skillId: "reply_draft",
          accountId: "account_1",
          messageId: "message_1",
          draftText: "Hi Lina,\n\nI can confirm the launch plan.",
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.draftMessageReply({
      accountId: "account_1",
      messageId: "message_1",
      instruction: "Confirm politely.",
      memoryScope: "sender:client@example.com",
      memoryLayers: ["contact_memory", "writing_style_profile"],
    });

    expect(result).toEqual({
      skillRunId: "run_message_reply_1",
      skillId: "reply_draft",
      accountId: "account_1",
      messageId: "message_1",
      draftText: "Hi Lina,\n\nI can confirm the launch plan.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/reply-draft",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          instruction: "Confirm politely.",
          memoryScope: "sender:client@example.com",
          memoryLayers: ["contact_memory", "writing_style_profile"],
        }),
      }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).not.toHaveProperty("threadText");
  });

  it("runs Hermes email search QA through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_search_1",
          skillId: "email_search_qa",
          answerText: "The signed contract is in Lina's latest message.",
          searchQuery: "signed contract",
          searchPlan: {
            searchQuery: "signed contract",
            quickFilters: [],
            qScopes: ["sender", "recipients", "subject", "body"],
            filters: [],
            listMessagesInput: {
              q: "signed contract",
              qScopes: ["sender", "recipients", "subject", "body"],
            },
            explanation: [
              "使用问题中的关键词搜索发件人、收件人、主题和正文。",
            ],
          },
          matches: [
            {
              id: "message_1",
              accountId: "account_1",
              subject: "Signed contract",
              from: { email: "lina@example.com", name: "Lina" },
              receivedAt: "2026-06-13T10:00:00.000Z",
              snippet: "Please review the signed contract.",
              classification: {
                bucket: "P1 Urgent",
                priorityScore: 91,
                reasons: ["Matched search"],
              },
            },
          ],
          citations: [
            {
              resultIndex: 1,
              messageId: "message_1",
              accountId: "account_1",
              subject: "Signed contract",
              from: { email: "lina@example.com", name: "Lina" },
              receivedAt: "2026-06-13T10:00:00.000Z",
              snippet: "Please review the signed contract.",
              bucket: "P1 Urgent",
              reasons: ["Matched search"],
            },
          ],
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.searchMailWithHermes({
      accountId: "account_1",
      question: "Where is the signed contract?",
      searchQuery: "signed contract",
      language: "en",
      limit: 5,
      memoryScope: "global",
    });

    expect(result.answerText).toBe("The signed contract is in Lina's latest message.");
    expect(result.citations[0].messageId).toBe("message_1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/email_search_qa/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          question: "Where is the signed contract?",
          searchQuery: "signed contract",
          language: "en",
          limit: 5,
          memoryScope: "global",
        }),
      }),
    );
  });

  it("runs Hermes organize skills through backend preview skill routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_priority_1",
            skillId: "priority_triage",
            priority: "high",
            bucket: "P1 Urgent",
            score: 94,
            reasons: ["deadline today"],
            explanation: "Needs a reply today.",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_labels_1",
            skillId: "label_suggest",
            labels: [{ name: "客户", confidence: 0.92, reason: "client thread" }],
            actions: [
              { type: "apply_label", label: "客户", reason: "high confidence" },
            ],
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_newsletter_1",
            skillId: "newsletter_cleanup",
            isNewsletter: false,
            confidence: 0.88,
            senderCategory: "personal",
            reasons: ["direct conversation"],
            actions: [{ type: "keep_in_inbox", reason: "needs reply" }],
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_actions_1",
            skillId: "action_item_extract",
            items: [
              {
                title: "Confirm launch schedule",
                owner: "me",
                dueText: "today",
                priority: "high",
                status: "open",
              },
            ],
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });
    const common = {
      subject: "Launch schedule",
      threadText: "Please confirm the launch schedule today.",
      language: "zh-CN",
      readMessageIds: ["message_1"],
      memoryScope: "sender:lina@example.com",
      memoryLayers: ["contact_memory", "procedural_memory"],
    };

    const priority = await api.triagePriorityWithHermes({
      ...common,
      senderEmail: "lina@example.com",
      currentBucket: "P2 Important",
      currentScore: 82,
      currentReasons: ["Direct to you"],
    });
    const labels = await api.suggestLabelsWithHermes({
      ...common,
      senderEmail: "lina@example.com",
      currentLabels: ["市场"],
      availableLabels: ["客户", "市场"],
    });
    const newsletter = await api.cleanupNewsletterWithHermes({
      ...common,
      senderEmail: "lina@example.com",
      currentBucket: "P2 Important",
    });
    const actionItems = await api.extractActionItemsWithHermes({
      ...common,
      now: "2026-06-16T09:00:00.000Z",
    });

    expect(priority.bucket).toBe("P1 Urgent");
    expect(labels.labels[0].name).toBe("客户");
    expect(newsletter.senderCategory).toBe("personal");
    expect(actionItems.items[0].title).toBe("Confirm launch schedule");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills/priority_triage/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          senderEmail: "lina@example.com",
          currentBucket: "P2 Important",
          currentScore: 82,
          currentReasons: ["Direct to you"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/skills/label_suggest/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          senderEmail: "lina@example.com",
          currentLabels: ["市场"],
          availableLabels: ["客户", "市场"],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/hermes/skills/newsletter_cleanup/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          senderEmail: "lina@example.com",
          currentBucket: "P2 Important",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/hermes/skills/action_item_extract/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...common,
          now: "2026-06-16T09:00:00.000Z",
        }),
      }),
    );
  });

  it("runs Hermes translation and thread summary through backend skill routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_translate_1",
            skillId: "translate_text",
            sourceLanguage: "English",
            targetLanguage: "Chinese",
            translatedText: "你好，请确认发布时间。",
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            skillRunId: "run_summary_1",
            skillId: "thread_summarize",
            mode: "action_points",
            summaryText: "Action: confirm the launch schedule today.",
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const translation = await api.translateText({
      text: "Please confirm the launch schedule.",
      targetLanguage: "Chinese",
      tone: "preserve original meaning",
      readMessageIds: ["message_1"],
      memoryScope: "global",
    });
    const summary = await api.summarizeThread({
      subject: "Launch schedule",
      threadText: "Please confirm the launch schedule.",
      mode: "action_points",
      focus: "reply needs",
      language: "English",
      readMessageIds: ["message_1"],
      memoryScope: "global",
    });

    expect(translation.translatedText).toBe("你好，请确认发布时间。");
    expect(summary.summaryText).toBe("Action: confirm the launch schedule today.");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/skills/translate_text/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "Please confirm the launch schedule.",
          targetLanguage: "Chinese",
          tone: "preserve original meaning",
          readMessageIds: ["message_1"],
          memoryScope: "global",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/skills/thread_summarize/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule",
          threadText: "Please confirm the launch schedule.",
          mode: "action_points",
          focus: "reply needs",
          language: "English",
          readMessageIds: ["message_1"],
          memoryScope: "global",
        }),
      }),
    );
  });

  it("runs message-scoped Hermes translation through the account message route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          skillRunId: "run_translate_1",
          skillId: "translate_text",
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "auto",
          targetLanguage: "Chinese",
          translatedText: "你好，请确认发布时间。",
          cached: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const translation = await api.translateMessage({
      accountId: "account_1",
      messageId: "message_1",
      targetLanguage: "Chinese",
      tone: "preserve original meaning",
      memoryScope: "sender:client@example.com",
      memoryLayers: ["contact_memory", "procedural_memory"],
    });

    expect(translation).toMatchObject({
      accountId: "account_1",
      messageId: "message_1",
      translatedText: "你好，请确认发布时间。",
      cached: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/translate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          targetLanguage: "Chinese",
          tone: "preserve original meaning",
          memoryScope: "sender:client@example.com",
          memoryLayers: ["contact_memory", "procedural_memory"],
        }),
      }),
    );
  });

  it("runs message-scoped Hermes summaries through the account message route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          skillRunId: "run_summary_1",
          skillId: "thread_summarize",
          accountId: "account_1",
          messageId: "message_1",
          mode: "action_points",
          summaryText: "Action: confirm the schedule today.",
          cached: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const summary = await api.summarizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      focus: "decisions and reply needs",
      language: "zh-CN",
      memoryScope: "global",
    });

    expect(summary).toMatchObject({
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      summaryText: "Action: confirm the schedule today.",
      cached: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/summary",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "action_points",
          focus: "decisions and reply needs",
          language: "zh-CN",
          memoryScope: "global",
        }),
      }),
    );
  });

  it("loads Hermes workspace context for mailbox-aware operations", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        generatedAt: "2026-06-16T01:00:00.000Z",
        accountScope: {
          requestedAccountId: "account_1",
          availableAccountIds: ["account_1"],
        },
        accounts: [
          {
            accountId: "account_1",
            email: "lina@example.com",
            provider: "gmail",
            authMethod: "oauth",
            syncState: "syncing",
            engineProvider: "emailengine",
            reauthRequired: false,
            nextAction: "none",
            accountUpdatedAt: "2026-06-16T00:00:00.000Z",
          },
        ],
        navigation: {
          providerGroups: [{ id: "gmail", label: "Gmail", count: 1 }],
          quickCategories: [{ id: "codes", label: "验证码", tone: "blue", count: 3 }],
        },
        labels: [],
        rules: [],
        pendingRuleCandidates: [],
        skills: [
          {
            id: "translate_text",
            title: "翻译邮件",
            mode: "read",
            description: "翻译邮件正文",
          },
        ],
        mailEngine: {
          provider: "emailengine",
          ok: false,
          missing: ["EMAILENGINE_ACCESS_TOKEN"],
          warnings: [],
          readiness: {
            status: "degraded",
            summary: "EmailEngine 配置未完全就绪。",
          },
          capabilities: {
            imapSmtpOnboarding: false,
            attachmentDownload: false,
            send: false,
          },
        },
        operationBoundaries: [
          {
            id: "create_mailbox_rule",
            title: "创建邮箱规则和左侧分组",
            mode: "confirmation_required",
            description: "先模拟，再确认启用。",
          },
        ],
        unavailableModules: [],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.getHermesWorkspaceContext({
      accountId: "account_1",
      ruleLimit: 5,
      labelLimit: 8,
    });

    expect(result.accountScope.requestedAccountId).toBe("account_1");
    expect(result.operationBoundaries[0]).toMatchObject({
      id: "create_mailbox_rule",
      mode: "confirmation_required",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/workspace/context?accountId=account_1&ruleLimit=5&labelLimit=8",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates and confirms Hermes action plans through backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "plan_1",
          auditEventId: "audit_plan_1",
          accountId: "account_1",
          command: "帮我创建一个验证码分组规则",
          intent: "create_mailbox_rule",
          status: "requires_confirmation",
          createdAt: "2026-06-16T08:00:00.000Z",
          candidate: {
            id: "candidate_codes",
            accountId: "account_1",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: { type: "apply_label", labelName: "验证码" },
            confidence: 0.9,
            status: "shadow",
            evidenceMessageIds: [],
            createdAt: "2026-06-16T08:00:00.000Z",
          },
          simulation: {
            id: "simulation_1",
            accountId: "account_1",
            candidateId: "candidate_codes",
            mode: "shadow",
            matchedCount: 3,
            sampleMessageIds: ["message_1"],
            actionPreview: { type: "apply_label", labelName: "验证码" },
            createdAt: "2026-06-16T08:00:01.000Z",
          },
          workspace: {
            accountCount: 1,
            labelCount: 2,
            ruleCount: 0,
            pendingRuleCandidateCount: 0,
            unavailableModules: [],
          },
          safety: {
            requiresUserConfirmation: true,
            providerWriteback: false,
            appliesToHistory: false,
            destructive: false,
          },
          steps: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "confirmation_1",
          auditEventId: "audit_confirm_1",
          planId: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          status: "completed",
          confirmedAt: "2026-06-16T08:01:00.000Z",
          rule: {
            id: "rule_codes",
            accountId: "account_1",
            candidateId: "candidate_codes",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: { type: "apply_label", labelId: "label_codes" },
            confidence: 0.9,
            enabled: true,
            createdAt: "2026-06-16T08:01:00.000Z",
          },
          safety: {
            requiresUserConfirmation: false,
            providerWriteback: false,
            appliesToHistory: true,
            destructive: false,
          },
          historyBackfill: {
            accountId: "account_1",
            ruleId: "rule_codes",
            matchedCount: 3,
            appliedCount: 2,
            sampleMessageIds: ["message_1"],
          },
          steps: [],
        }),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const plan = await api.createHermesActionPlan({
      accountId: "account_1",
      command: "帮我创建一个验证码分组规则",
      sampleLimit: 12,
    });
    const confirmation = await api.confirmHermesActionPlan({
      planId: plan.id,
      accountId: "account_1",
      candidateId: plan.candidate.id,
    });

    expect(plan.auditEventId).toBe("audit_plan_1");
    expect(confirmation.rule.id).toBe("rule_codes");
    expect(confirmation.historyBackfill).toMatchObject({
      matchedCount: 3,
      appliedCount: 2,
      sampleMessageIds: ["message_1"],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/hermes/action-plans",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          command: "帮我创建一个验证码分组规则",
          sampleLimit: 12,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/hermes/action-plans/plan_1/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accountId: "account_1",
          candidateId: "candidate_codes",
        }),
      }),
    );
  });

  it("runs Hermes quick reply through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_quick_1",
          skillId: "quick_reply",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.quickReply({
      subject: "Launch schedule confirmation",
      threadText: "Please confirm the launch schedule.",
      scenario: "thanks",
      instruction: "Thank them briefly.",
      readMessageIds: ["message_1"],
    });

    expect(result).toEqual({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/quick_reply/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subject: "Launch schedule confirmation",
          threadText: "Please confirm the launch schedule.",
          scenario: "thanks",
          instruction: "Thank them briefly.",
          readMessageIds: ["message_1"],
        }),
      }),
    );
  });

  it("runs Hermes quick reply through the message-scoped backend route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_message_quick_1",
          skillId: "quick_reply",
          accountId: "account_1",
          messageId: "message_1",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.quickMessageReply({
      accountId: "account_1",
      messageId: "message_1",
      scenario: "thanks",
      instruction: "Thank them briefly.",
      tone: "warm professional",
    });

    expect(result).toEqual({
      skillRunId: "run_message_quick_1",
      skillId: "quick_reply",
      accountId: "account_1",
      messageId: "message_1",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/messages/message_1/quick-reply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scenario: "thanks",
          instruction: "Thank them briefly.",
          tone: "warm professional",
        }),
      }),
    );
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(JSON.parse(body)).not.toHaveProperty("threadText");
  });

  it("runs Hermes rewrite and polish through the backend skills route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          skillRunId: "run_rewrite_1",
          skillId: "rewrite_polish",
          action: "polish",
          rewrittenText: "Hi Lina,\n\nPlease review the launch plan today.",
          editable: true,
          sendsDirectly: false,
        },
        202,
      ),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const result = await api.rewritePolishDraft({
      text: "please review launch plan",
      action: "polish",
      instruction: "Make it professional.",
      tone: "clear professional",
    });

    expect(result).toEqual({
      skillRunId: "run_rewrite_1",
      skillId: "rewrite_polish",
      action: "polish",
      rewrittenText: "Hi Lina,\n\nPlease review the launch plan today.",
      editable: true,
      sendsDirectly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hermes/skills/rewrite_polish/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "please review launch plan",
          action: "polish",
          instruction: "Make it professional.",
          tone: "clear professional",
        }),
      }),
    );
  });

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
