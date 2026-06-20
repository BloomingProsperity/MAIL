import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import {
  ApiRequestError,
  type EmailHubApi,
  type MailProviderCapabilityDto,
  type OAuthProvider,
  type ReauthorizationTaskDto,
} from "../../lib/emailHubApi";

describe("Add Mail OAuth diagnostics", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("shows recoverable OAuth start diagnostics from Add Mail", async () => {
    const api = createAddMailApiFixture();
    const oauthRedirect = vi.fn();
    vi.mocked(api.startOAuthAccount).mockRejectedValueOnce(
      new ApiRequestError(400, "bad_request", {
        detail: "gmail OAuth client is not configured",
      }),
    );

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        oauthRedirect={oauthRedirect}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "添加邮箱",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "连接 Gmail" }));

    expect(
      await screen.findByText(
        "Gmail 网页登录暂时不可用。",
      ),
    ).toBeTruthy();
    expect(oauthRedirect).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toContain(
      "gmail OAuth client is not configured",
    );
  });

  it("starts Gmail OAuth from the Add Mail workspace without exposing backend routes in the component", async () => {
    const api = createAddMailApiFixture();
    const oauthRedirect = vi.fn();
    vi.mocked(api.startOAuthAccount).mockResolvedValue(oauthStartFixture());

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        oauthRedirect={oauthRedirect}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "添加邮箱",
      }),
    );
    expect(screen.queryByLabelText("Add mail secret")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "连接 Gmail" }));

    await waitFor(() => {
      expect(api.startOAuthAccount).toHaveBeenCalledWith({
        provider: "gmail",
        redirectUri: expect.stringMatching(/\/oauth\/callback$/),
      });
    });
    expect(oauthRedirect).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toContain(
      '"provider":"gmail"',
    );
    expect(screen.getByText("iCloud Mail")).toBeTruthy();
  });

  it.each([
    { title: "Gmail", provider: "gmail" as const, email: "owner@gmail.com" },
    {
      title: "Outlook",
      provider: "outlook" as const,
      email: "owner@outlook.com",
    },
  ])(
    "keeps $title on official web login when stale capabilities omit web login",
    async ({ title, provider, email }) => {
      const api = createAddMailApiFixture();
      const oauthRedirect = vi.fn();
      vi.mocked(api.startOAuthAccount).mockResolvedValueOnce(
        oauthStartFixture(provider),
      );
      vi.mocked(api.getMailProviderCapabilities).mockResolvedValueOnce({
        providers: [
          mailProviderCapabilityFixture({
            provider,
            label: title,
            connectionLabel: "旧的错误连接方式",
            accountGroup: "global",
            supportsLogin: false,
            supportsWebLogin: false,
            supportsAppPassword: true,
            supportsMailboxPassword: true,
          }),
        ],
      });

      render(
        <App
          api={api}
          defaultAccountId="account_1"
          oauthRedirect={oauthRedirect}
        />,
      );
      fireEvent.click(
        within(screen.getByRole("navigation")).getByRole("button", {
          name: "添加邮箱",
        }),
      );
      fireEvent.change(await screen.findByLabelText("Add mail email"), {
        target: { value: email },
      });
      expect(screen.queryByLabelText("Add mail secret")).toBeNull();
      expect(
        await screen.findByText(
          `${title === "Gmail" ? "Google" : "Microsoft"} 账号`,
        ),
      ).toBeTruthy();
      expect(document.body.textContent ?? "").not.toContain("旧的错误连接方式");
      fireEvent.click(
        await screen.findByRole("button", { name: `连接 ${title}` }),
      );

      await waitFor(() => {
        expect(api.startOAuthAccount).toHaveBeenCalledWith({
          provider,
          redirectUri: expect.stringMatching(/\/oauth\/callback$/),
          loginHint: email,
        });
      });
      expect(oauthRedirect).toHaveBeenCalledWith(
        provider === "outlook"
          ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
          : "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(screen.queryByLabelText("Add mail secret")).toBeNull();
      expect(api.testImapSmtpConnection).not.toHaveBeenCalled();
      expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();
    },
  );

  it("shows recoverable OAuth callback diagnostics without raw backend errors", async () => {
    const api = createCallbackApiFixture();
    vi.mocked(api.completeOAuthCallback).mockRejectedValue(
      new ApiRequestError(400, "bad_request", {
        detail: "OAuth callback did not return a refresh token",
      }),
    );
    sessionStorage.setItem(
      "email-hub:oauth:state_refresh",
      JSON.stringify({
        provider: "gmail",
        flow: "onboarding",
        returnTo: "add-mail",
        createdAt: "2026-06-18T05:30:00.000Z",
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_refresh&code=raw-code",
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await waitFor(() => {
      expect(api.completeOAuthCallback).toHaveBeenCalledWith({
        provider: "gmail",
        state: "state_refresh",
        code: "raw-code",
      });
    });
    expect(
      await screen.findByText(
        "授权没有返回长期同步权限。",
      ),
    ).toBeTruthy();
    expect(sessionStorage.getItem("email-hub:oauth:state_refresh")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("refresh token");
    expect(document.body.textContent ?? "").not.toContain("raw-code");
  });

  it("uses a safe message when the provider denies authorization", async () => {
    const api = createCallbackApiFixture();
    sessionStorage.setItem(
      "email-hub:oauth:state_denied",
      JSON.stringify({
        provider: "gmail",
        flow: "onboarding",
        returnTo: "add-mail",
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_denied&error=access_denied",
    );

    render(<App api={api} defaultAccountId="account_1" />);

    expect(await screen.findByText("登录授权已取消。")).toBeTruthy();
    expect(api.completeOAuthCallback).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toContain("access_denied");
  });

  it("shows reauthorization tasks directly from Add Mail", async () => {
    const api = createAddMailApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          source: "emailengine_account_state",
          errorMessage: "EMAILENGINE_ACCESS_TOKEN is not configured",
        }),
        reauthorizationTaskFixture({
          taskId: "task_old_csv",
          email: "old-csv@example.com",
          source: "csv_import",
          reauthRequired: false,
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" initialView="add-mail" />);

    const reauthorizationPanel = await screen.findByRole("region", {
      name: "需要重新授权",
    });
    expect(within(reauthorizationPanel).getByText("reauth@example.com")).toBeTruthy();
    expect(within(reauthorizationPanel).queryByText("old-csv@example.com")).toBeNull();
    expect(within(reauthorizationPanel).queryByText(/emailengine/i)).toBeNull();
    expect(within(reauthorizationPanel).queryByText(/ACCESS_TOKEN/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "邮箱连接" })).toBeNull();
    expect(screen.queryByRole("button", { name: /邮箱连接/ })).toBeNull();
  });

  it("shows connected Gmail accounts and hides stale or cross-provider reauthorization tasks", async () => {
    const api = createAddMailApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValueOnce({
      items: [
        {
          accountId: "account_gmail",
          email: "huakaifugui2.0@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          syncState: "syncing",
          engineProvider: "emailengine",
          nextAction: "wait_for_sync",
          accountUpdatedAt: "2026-06-20T08:00:00.000Z",
        },
      ],
    });
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_stale_gmail",
          email: "huakaifugui2.0@gmail.com",
          provider: "gmail",
          source: "emailengine_account_state",
        }),
        reauthorizationTaskFixture({
          taskId: "task_transfer_custom",
          email: "browser-reauth@example.com",
          provider: "custom_domain",
          authMethod: "password",
          source: "account_transfer_import",
        }),
        reauthorizationTaskFixture({
          taskId: "task_transfer_qq",
          email: "transfer@qq.com",
          provider: "qq",
          authMethod: "password",
          source: "account_transfer_import",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" initialView="add-mail" />);

    const connectedPanel = await screen.findByRole("region", {
      name: "已添加邮箱账号",
    });
    expect(
      within(connectedPanel).getByText("huakaifugui2.0@gmail.com"),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "需要重新授权" })).toBeNull();
    expect(screen.queryByText("browser-reauth@example.com")).toBeNull();
    expect(screen.queryByText("transfer@qq.com")).toBeNull();
  });

  it("starts OAuth reauthorization from Add Mail", async () => {
    const api = createAddMailApiFixture();
    const oauthRedirect = vi.fn();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [reauthorizationTaskFixture()],
    });
    vi.mocked(api.startSyncCenterOAuthReauthorization).mockResolvedValueOnce(
      oauthStartFixture(),
    );

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        initialView="add-mail"
        oauthRedirect={oauthRedirect}
      />,
    );
    expect(await screen.findByText("reauth@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "重新登录 reauth@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.startSyncCenterOAuthReauthorization).toHaveBeenCalledWith({
        taskId: "task_reauth_1",
        redirectUri: "http://localhost:3000/oauth/callback",
      });
    });
    expect(oauthRedirect).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toContain(
      '"flow":"reauthorization"',
    );
  });

  it("completes an OAuth callback from the provider and clears pending state", async () => {
    const api = createCallbackApiFixture();
    sessionStorage.setItem(
      "email-hub:oauth:state_1",
      JSON.stringify({ provider: "gmail", returnTo: "add-mail" }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_1&code=code_1",
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await waitFor(() => {
      expect(api.completeOAuthCallback).toHaveBeenCalledWith({
        provider: "gmail",
        state: "state_1",
        code: "code_1",
      });
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toBeNull();
  });

  it("rejects a Gmail OAuth callback when browser session state was lost", async () => {
    const api = createCallbackApiFixture();
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_1&iss=https%3A%2F%2Faccounts.google.com&code=code_1",
    );

    render(<App api={api} defaultAccountId="account_1" />);

    expect(await screen.findByText("登录已过期。")).toBeTruthy();
    expect(api.completeOAuthCallback).not.toHaveBeenCalled();
  });

  it("returns home after OAuth success without waiting for mailbox refresh", async () => {
    const api = createCallbackApiFixture();
    let resolveAccounts: (page: Awaited<ReturnType<EmailHubApi["listSyncCenterAccounts"]>>) => void =
      () => {};
    const slowAccountRefresh = new Promise<
      Awaited<ReturnType<EmailHubApi["listSyncCenterAccounts"]>>
    >((resolve) => {
      resolveAccounts = resolve;
    });
    vi.mocked(api.listSyncCenterAccounts).mockReturnValue(slowAccountRefresh);
    sessionStorage.setItem(
      "email-hub:oauth:state_1",
      JSON.stringify({ provider: "gmail", returnTo: "add-mail" }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_1&code=code_1",
    );

    render(<App api={api} />);

    await waitFor(() => {
      expect(api.completeOAuthCallback).toHaveBeenCalledWith({
        provider: "gmail",
        state: "state_1",
        code: "code_1",
      });
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("navigation")).toBeTruthy();
    resolveAccounts({
      items: [
        {
          accountId: "account_gmail",
          email: "me@gmail.com",
          provider: "gmail",
          syncState: "syncing",
        },
      ],
    });
    await act(async () => {
      await slowAccountRefresh;
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "account_gmail",
    );
  });

  it("completes an email connection OAuth reauthorization callback and clears pending state", async () => {
    const api = createCallbackApiFixture();
    sessionStorage.setItem(
      "email-hub:oauth:state_1",
      JSON.stringify({
        provider: "gmail",
        flow: "reauthorization",
        returnTo: "add-mail",
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_1&code=code_1",
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await waitFor(() => {
      expect(api.completeSyncCenterOAuthReauthorizationCallback).toHaveBeenCalledWith(
        {
          state: "state_1",
          code: "code_1",
        },
      );
    });
    expect(api.completeOAuthCallback).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toBeNull();
  });

  it("returns to the mailbox after OAuth callback completion in StrictMode", async () => {
    const api = createCallbackApiFixture();
    vi.mocked(api.completeOAuthCallback).mockResolvedValue({
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
        engineProvider: "emailengine",
      },
    });
    sessionStorage.setItem(
      "email-hub:oauth:state_strict",
      JSON.stringify({
        provider: "gmail",
        flow: "onboarding",
        returnTo: "add-mail",
        createdAt: "2026-06-18T05:30:00.000Z",
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_strict&iss=https%3A%2F%2Faccounts.google.com&code=oauth-code",
    );

    render(
      <StrictMode>
        <App api={api} defaultAccountId="account_1" />
      </StrictMode>,
    );

    await waitFor(
      () => {
        expect(window.location.pathname).toBe("/");
      },
      { timeout: 2500 },
    );
    expect(api.completeOAuthCallback).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("email-hub:oauth:state_strict")).toBeNull();
  });
});

function createCallbackApiFixture(): EmailHubApi {
  return {
    ...createAddMailApiFixture(),
    completeOAuthCallback: vi.fn(async () => oauthCallbackFixture()),
    completeSyncCenterOAuthReauthorizationCallback: vi.fn(async () =>
      oauthCallbackFixture(),
    ),
  } as unknown as EmailHubApi;
}

function createAddMailApiFixture(): EmailHubApi {
  return {
    getMailNavigationSummary: vi.fn(async () => ({
      providerGroups: [{ id: "global", label: "国际邮箱", count: 2 }],
      quickCategories: [],
      labels: [],
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "me@example.com",
          provider: "gmail",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
    })),
    listMailboxes: vi.fn(async () => ({
      items: [{ id: "mailbox_inbox", name: "收件箱", messageCount: 1 }],
    })),
    listMessages: vi.fn(async () => ({
      items: [
        {
          id: "message_1",
          accountId: "account_1",
          subject: "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
        },
      ],
    })),
    getMessage: vi.fn(async () => ({
      id: "message_1",
      accountId: "account_1",
      subject: "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: "Live snippet",
      unread: true,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 0,
      to: ["me@example.com"],
      cc: [],
      bodyText: "Live body",
      attachments: [],
    })),
    listLabels: vi.fn(async () => ({ items: [] })),
    listSendIdentities: vi.fn(async () => ({ items: [] })),
    listMailDrafts: vi.fn(async () => ({ items: [] })),
    listOutbox: vi.fn(async () => ({ items: [] })),
    getMailProviderCapabilities: vi.fn(async () => ({ providers: [] })),
    getMailEngineHealth: vi.fn(async () => ({
      provider: "emailengine",
      ok: true,
      detail: "ready",
      checks: {
        url: "configured",
        http: "ok",
        apiAuth: "ok",
        webhookSecret: "custom",
        accessToken: "configured",
      },
      capabilities: {
        accessTokenConfigured: true,
        imapSmtpOnboarding: true,
        attachmentDownload: true,
        send: true,
      },
      missing: [],
      warnings: [],
      readiness: {
        status: "ready",
        summary: "EmailEngine is ready.",
        setupActions: [],
      },
    })),
    startOAuthAccount: vi.fn(),
    startSyncCenterOAuthReauthorization: vi.fn(),
    listSyncCenterReauthorizations: vi.fn(async () => ({ items: [] })),
    testImapSmtpConnection: vi.fn(),
    onboardImapSmtpAccount: vi.fn(),
    listOperationalEvents: vi.fn(async () => ({ items: [] })),
  } as unknown as EmailHubApi;
}

function oauthStartFixture(provider: OAuthProvider = "gmail") {
  return {
    provider,
    authorizationUrl:
      provider === "outlook"
        ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        : "https://accounts.google.com/o/oauth2/v2/auth",
    state: "state_1",
    task: {
      id: "task_1",
      email:
        provider === "outlook"
          ? "pending@outlook.oauth"
          : "pending@gmail.oauth",
      provider,
      authMethod: "oauth",
      status: "pending",
    },
  };
}

function oauthCallbackFixture() {
  return {
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
      engineProvider: "emailengine",
    },
  };
}

function reauthorizationTaskFixture(
  overrides: Partial<ReauthorizationTaskDto> = {},
): ReauthorizationTaskDto {
  return {
    taskId: "task_reauth_1",
    email: "reauth@example.com",
    provider: "gmail",
    authMethod: "oauth",
    status: "pending",
    source: "native_send",
    reauthRequired: true,
    loginHint: "reauth@example.com",
    createdAt: "2026-06-14T08:00:00.000Z",
    updatedAt: "2026-06-14T08:00:00.000Z",
    ...overrides,
  };
}

function mailProviderCapabilityFixture(
  input: Partial<MailProviderCapabilityDto> &
    Pick<
      MailProviderCapabilityDto,
      "provider" | "label" | "connectionLabel" | "accountGroup"
    >,
): MailProviderCapabilityDto {
  return {
    supportsLogin: true,
    supportsWebLogin: false,
    supportsScanLogin: false,
    supportsAppPassword: false,
    supportsMailboxPassword: false,
    supportsServerSearch: false,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: false,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: false,
    requiresLocalBridge: false,
    setupHints: [],
    providerSpecificActions: [],
    ...input,
  };
}
