import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { ApiRequestError, type EmailHubApi } from "../../lib/emailHubApi";

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
});

function createCallbackApiFixture(): EmailHubApi {
  return {
    ...createAddMailApiFixture(),
    completeOAuthCallback: vi.fn(),
    completeSyncCenterOAuthReauthorizationCallback: vi.fn(),
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
    listOperationalEvents: vi.fn(async () => ({ items: [] })),
  } as unknown as EmailHubApi;
}
