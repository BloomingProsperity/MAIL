import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import type { EmailHubApi } from "../../lib/emailHubApi";

describe("Add Mail password onboarding", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("tests app-password providers before onboarding them from Add Mail", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@qq.com" },
    });
    await selectCredentialProvider("QQ 邮箱");
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "qq-auth-code" },
    });
    submitCredentialProvider("QQ 邮箱");

    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
        email: "support@qq.com",
        provider: "qq",
        secret: "qq-auth-code",
      });
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith({
      email: "support@qq.com",
      provider: "qq",
      secret: "qq-auth-code",
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("QQ 邮箱");
    });
  });

  it("keeps EmailEngine setup details out of Add Mail while blocking unavailable onboarding", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailEngineHealth).mockResolvedValueOnce({
      provider: "emailengine",
      ok: false,
      detail: "adapter boundary ready: http://emailengine:3000",
      checks: {
        url: "configured",
        http: "unavailable",
        accessToken: "missing",
        preparedToken: "missing",
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
      warnings: ["EENGINE_PREPARED_TOKEN_MISSING"],
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
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();

    await screen.findByRole("button", { name: "连接 QQ 邮箱" });
    expect(screen.queryByText("邮箱接入服务暂时不可用。")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "邮箱接入状态" }),
    ).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("EMAILENGINE_ACCESS_TOKEN");
    expect(document.body.textContent ?? "").not.toContain(
      "EENGINE_PREPARED_TOKEN_MISSING",
    );
    expect(document.body.textContent ?? "").not.toContain("super-secret-token");

    const qqConnect = await screen.findByRole("button", { name: "连接 QQ 邮箱" });
    expect((qqConnect as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(qqConnect);
    expect(await screen.findByText("邮箱接入服务暂时不可用。")).toBeTruthy();
    expect(api.testImapSmtpConnection).not.toHaveBeenCalled();
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();

    const customConnect = screen.getByRole("button", {
      name: "连接 个人域名邮箱",
    }) as HTMLButtonElement;
    expect(customConnect.disabled).toBe(false);
    fireEvent.click(customConnect);
    const manualSubmit = await screen.findByRole("button", {
      name: "接入个人域名邮箱",
    });
    expect((manualSubmit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(manualSubmit);
    expect(api.testImapSmtpConnection).not.toHaveBeenCalled();
  });

  it("tests custom domain server settings before onboarding from Add Mail", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@example.com" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 个人域名邮箱" }));

    await fillCustomDomainForm();
    fireEvent.click(screen.getByRole("button", { name: "接入个人域名邮箱" }));

    const expectedInput = {
      email: "support@example.com",
      provider: "custom_domain",
      imap: {
        host: "mail.example.com",
        port: 993,
        secure: true,
        username: "support@example.com",
        secret: "custom-password",
      },
      smtp: {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        username: "support@example.com",
        secret: "custom-password",
      },
    };
    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith(expectedInput);
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith(expectedInput);
  });

  it("switches mail loading to the account returned by IMAP onboarding", async () => {
    const api = createApiFixture();
    vi.mocked(api.onboardImapSmtpAccount).mockResolvedValueOnce({
      task: {
        id: "task_real_qq",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "1c594d28-b36c-4e8f-a8e4-80ac73b29d6b",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@qq.com" },
    });
    await selectCredentialProvider("QQ 邮箱");
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "qq-auth-code" },
    });
    submitCredentialProvider("QQ 邮箱");

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "1c594d28-b36c-4e8f-a8e4-80ac73b29d6b",
      });
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "1c594d28-b36c-4e8f-a8e4-80ac73b29d6b",
    );
  });
});

function openAddMail() {
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: "添加邮箱",
    }),
  );
}

async function selectCredentialProvider(providerTitle: string) {
  fireEvent.click(
    await screen.findByRole("button", { name: `连接 ${providerTitle}` }),
  );
  await screen.findByLabelText("Add mail secret");
}

function submitCredentialProvider(providerTitle: string) {
  fireEvent.click(screen.getByRole("button", { name: `接入${providerTitle}` }));
}

async function fillCustomDomainForm() {
  fireEvent.change(await screen.findByLabelText("Custom mail username"), {
    target: { value: "support@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Custom mail secret"), {
    target: { value: "custom-password" },
  });
  fireEvent.change(screen.getByLabelText("Custom receive host"), {
    target: { value: "mail.example.com" },
  });
  fireEvent.change(screen.getByLabelText("Custom receive port"), {
    target: { value: "993" },
  });
  fireEvent.change(screen.getByLabelText("Custom send host"), {
    target: { value: "smtp.example.com" },
  });
  fireEvent.change(screen.getByLabelText("Custom send port"), {
    target: { value: "465" },
  });
}

function createApiFixture(): EmailHubApi {
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
          provider: "qq",
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
    testImapSmtpConnection: vi.fn(async () => ({
      provider: "qq",
      ok: true,
      checks: {
        imap: { ok: true },
        smtp: { ok: true },
      },
    })),
    onboardImapSmtpAccount: vi.fn(async () => ({
      task: {
        id: "task_qq",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "account_qq",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    })),
    listOperationalEvents: vi.fn(async () => ({ items: [] })),
  } as unknown as EmailHubApi;
}
