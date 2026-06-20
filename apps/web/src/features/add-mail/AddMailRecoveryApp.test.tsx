import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { ApiRequestError, type EmailHubApi } from "../../lib/emailHubApi";

describe("Add Mail recovery guidance", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("shows safe recovery guidance and stops onboarding when provider tests fail", async () => {
    const api = createApiFixture();
    vi.mocked(api.testImapSmtpConnection).mockResolvedValueOnce({
      provider: "163",
      ok: false,
      checks: {
        imap: { ok: false, code: "EAUTH", error: "Invalid login" },
        smtp: { ok: true },
      },
      diagnostics: [
        {
          code: "netease_163_authorization_code_required",
          provider: "163",
          severity: "action_required",
          affected: "account",
          message: "Use bad-auth-code from settings, not the mailbox password.",
          recoveryAction: "enable_163_mail_authorization_code",
        },
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "archive@163.com" },
    });
    await selectCredentialProvider("163 邮箱");
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bad-auth-code" },
    });
    submitCredentialProvider("163 邮箱");

    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
        email: "archive@163.com",
        provider: "163",
        secret: "bad-auth-code",
      });
    });
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();
    expect(api.listOperationalEvents).toHaveBeenCalledWith({
      service: "email-hub-api",
      lane: "account_onboarding",
      limit: 3,
    });
    expect(
      await screen.findByText("163 邮箱 连接检查未通过。"),
    ).toBeTruthy();
    expect(await screen.findByText("163 邮箱授权码")).toBeTruthy();
    expect(screen.getByText("163 邮箱授权码不可用。")).toBeTruthy();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("EAUTH");
    expect(pageText).not.toContain("Invalid login");
    expect(pageText).not.toContain("bad-auth-code");
    expect(pageText).not.toContain("netease_163_authorization_code_required");
    expect(pageText).not.toContain("enable_163_mail_authorization_code");
    expect(screen.queryByDisplayValue("bad-auth-code")).toBeNull();
  });

  it("uses a generic Add Mail recovery message when tests fail without diagnostics", async () => {
    const api = createApiFixture();
    vi.mocked(api.testImapSmtpConnection).mockResolvedValueOnce({
      provider: "custom_domain",
      ok: false,
      checks: {
        imap: {
          ok: false,
          code: "ECONNREFUSED",
          error: "connect ECONNREFUSED 127.0.0.1:993",
        },
        smtp: { ok: false, code: "EAUTH", error: "Invalid custom-password" },
      },
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@example.com" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 个人域名邮箱" }));
    await fillCustomDomainForm({
      username: "support@example.com",
      secret: "custom-password",
      receiveHost: "mail.example.com",
      sendHost: "smtp.example.com",
    });
    fireEvent.click(screen.getByRole("button", { name: "接入个人域名邮箱" }));

    expect(
      await screen.findByText(
        "个人域名邮箱 连接检查未通过。",
      ),
    ).toBeTruthy();
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("ECONNREFUSED");
    expect(pageText).not.toContain("EAUTH");
    expect(pageText).not.toContain("custom-password");
    expect(pageText).not.toContain("127.0.0.1");
    expect(screen.queryByDisplayValue("custom-password")).toBeNull();
  });

  it("shows Proton Bridge recovery guidance without raw connection errors", async () => {
    const api = createApiFixture();
    vi.mocked(api.testImapSmtpConnection).mockResolvedValueOnce({
      provider: "proton_bridge",
      ok: false,
      checks: {
        imap: {
          ok: false,
          code: "ECONNREFUSED",
          error: "connect ECONNREFUSED 127.0.0.1:1143",
        },
        smtp: {
          ok: false,
          code: "ECONNREFUSED",
          error: "connect ECONNREFUSED 127.0.0.1:1025",
        },
      },
      diagnostics: [
        {
          code: "proton_bridge_unreachable",
          provider: "proton_bridge",
          severity: "action_required",
          affected: "account",
          message:
            "Start Proton Bridge on this computer and use bridge-password.",
          recoveryAction: "start_proton_bridge",
        },
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    await selectCredentialProvider("Proton Mail");
    fireEvent.change(screen.getByLabelText("Add mail username"), {
      target: { value: "bridge-user" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    submitCredentialProvider("Proton Mail");

    expect(await screen.findByText("Proton Bridge 未连接")).toBeTruthy();
    expect(screen.getByText("Proton Bridge 未连接。")).toBeTruthy();
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("ECONNREFUSED");
    expect(pageText).not.toContain("127.0.0.1");
    expect(pageText).not.toContain("proton_bridge_unreachable");
    expect(pageText).not.toContain("start_proton_bridge");
    expect(pageText).not.toContain("bridge-password");
    expect(screen.queryByDisplayValue("bridge-password")).toBeNull();
  });

  it("requires Proton Bridge username before testing mailbox credentials", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    await selectCredentialProvider("Proton Mail");
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    submitCredentialProvider("Proton Mail");

    expect(await screen.findByText("Proton Mail 接入信息不完整。")).toBeTruthy();
    expect(screen.getByText("Bridge 用户名")).toBeTruthy();
    expect(screen.getByText("Bridge 密码")).toBeTruthy();
    expect(screen.queryByText("先启动 Proton Bridge 并保持登录。")).toBeNull();
    expect(screen.getByPlaceholderText("me@proton.me")).toBeTruthy();
    expect(screen.getByPlaceholderText("授权信息")).toBeTruthy();
    expect(api.testImapSmtpConnection).not.toHaveBeenCalled();
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();
  });

  it("keeps Proton Bridge provider id when the capability catalog falls back", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailProviderCapabilities).mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    await selectCredentialProvider("Proton Mail");
    fireEvent.change(screen.getByLabelText("Add mail username"), {
      target: { value: "bridge-user" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    submitCredentialProvider("Proton Mail");

    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
        email: "me@proton.me",
        provider: "proton_bridge",
        username: "bridge-user",
        secret: "bridge-password",
      });
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith({
      email: "me@proton.me",
      provider: "proton_bridge",
      username: "bridge-user",
      secret: "bridge-password",
    });
  });

  it("shows recovery guidance when Add Mail registration fails after a successful test", async () => {
    const api = createApiFixture();
    vi.mocked(api.testImapSmtpConnection).mockResolvedValueOnce({
      provider: "qq",
      ok: true,
      checks: {
        imap: { ok: true },
        smtp: { ok: true },
      },
      diagnostics: [],
    });
    vi.mocked(api.onboardImapSmtpAccount).mockRejectedValueOnce(
      new ApiRequestError(400, "imap_smtp_onboarding_failed", {
        error: "imap_smtp_onboarding_failed",
        provider: "qq",
        detail: "EmailEngine account registration failed: EAUTH qq-auth-code rejected",
        diagnostics: [
          {
            code: "qq_authorization_code_required",
            provider: "qq",
            severity: "action_required",
            affected: "account",
            message: "Use qq-auth-code from settings.",
            recoveryAction: "enable_qq_mail_authorization_code",
          },
        ],
      }),
    );

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

    expect(
      await screen.findByText("QQ 邮箱 暂时无法接入。"),
    ).toBeTruthy();
    expect(await screen.findByText("QQ 邮箱授权码")).toBeTruthy();
    expect(screen.getByText("QQ 邮箱授权码不可用。")).toBeTruthy();
    expect(api.listOperationalEvents).toHaveBeenCalledWith({
      service: "email-hub-api",
      lane: "account_onboarding",
      limit: 3,
    });

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("EAUTH");
    expect(pageText).not.toContain("qq-auth-code");
    expect(pageText).not.toContain("imap_smtp_onboarding_failed");
    expect(screen.queryByDisplayValue("qq-auth-code")).toBeNull();
  });

  it("hides backend detail when Add Mail onboarding save fails", async () => {
    const api = createApiFixture();
    vi.mocked(api.listOperationalEvents).mockResolvedValueOnce({
      items: [
        {
          id: "op_raw_onboarding_failure",
          occurredAt: "2026-06-14T08:05:00.000Z",
          service: "email-hub-api",
          level: "error" as const,
          event: "account_onboarding_failed",
          lane: "account_onboarding",
          message: "EAUTH rejected qq-auth-code for support@qq.com",
          context: {
            error: {
              message: "EAUTH rejected qq-auth-code for support@qq.com",
            },
          },
        },
      ],
    });
    vi.mocked(api.onboardImapSmtpAccount).mockRejectedValueOnce(
      new ApiRequestError(400, "bad_request", {
        error: "bad_request",
        detail: "EAUTH rejected qq-auth-code for support@qq.com",
      }),
    );

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

    expect(
      await screen.findByText(
        "QQ 邮箱 暂时无法接入。",
      ),
    ).toBeTruthy();
    expect(api.onboardImapSmtpAccount).toHaveBeenCalled();
    expect(await screen.findByText("邮箱接入失败")).toBeTruthy();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("EAUTH");
    expect(pageText).not.toContain("qq-auth-code");
    expect(pageText).not.toContain("bad_request");
    expect(screen.queryByDisplayValue("qq-auth-code")).toBeNull();
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

async function fillCustomDomainForm(input: {
  username: string;
  secret: string;
  receiveHost: string;
  sendHost: string;
}) {
  fireEvent.change(await screen.findByLabelText("Custom mail username"), {
    target: { value: input.username },
  });
  fireEvent.change(screen.getByLabelText("Custom mail secret"), {
    target: { value: input.secret },
  });
  fireEvent.change(screen.getByLabelText("Custom receive host"), {
    target: { value: input.receiveHost },
  });
  fireEvent.change(screen.getByLabelText("Custom send host"), {
    target: { value: input.sendHost },
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
