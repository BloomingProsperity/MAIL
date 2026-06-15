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
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/messages?limit=25&q=invoice&sort=smart&quickFilter=unread&quickFilter=attachments&qScope=sender&qScope=subject&qScope=body&labelId=label_1&labelId=label_2&tagMode=all",
      expect.objectContaining({ method: "GET" }),
    );
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

  it("lists and starts Sync Center reauthorization tasks", async () => {
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
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSendIdentities({ accountId: "account_1" });

    expect(page.items[1].from.address).toBe("support@demo.site");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account_1/send-identities",
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

    expect(domains.items[0].domain).toBe("demo.site");
    expect(aliases.items[0].address).toBe("support@demo.site");
    expect(logs.items[0].status).toBe("delivered");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/domains/domain_1/delivery-logs?limit=20",
      expect.objectContaining({ method: "GET" }),
    );
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
            tasks: [],
          },
          202,
        ),
      );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });
    const csv = "email,provider,auth_method,secret\nsupport@qq.com,qq,password,code";

    await api.previewAccountCsv({ csv });
    await api.createAccountCsvImport({ csv });

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
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
