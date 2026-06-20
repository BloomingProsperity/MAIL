import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import type {
  EmailHubApi,
  MailProviderCapabilityDto,
  OAuthProvider,
} from "../../lib/emailHubApi";

describe("Add Mail click matrix", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("filters every Add Mail provider group from the sidebar matrix", async () => {
    const api = createApiFixture();
    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    const providerNav = await screen.findByLabelText("添加邮箱服务商分类");

    const groups = [
      {
        name: /Gmail/,
        visible: ["Gmail"],
        hidden: ["Outlook", "iCloud Mail", "163 邮箱", "QQ 邮箱", "Proton Mail", "个人域名邮箱"],
      },
      {
        name: /Outlook/,
        visible: ["Outlook"],
        hidden: ["Gmail", "iCloud Mail", "163 邮箱", "QQ 邮箱", "Proton Mail", "个人域名邮箱"],
      },
      {
        name: /iCloud/,
        visible: ["iCloud Mail"],
        hidden: ["Gmail", "Outlook", "163 邮箱", "QQ 邮箱", "Proton Mail", "个人域名邮箱"],
      },
      {
        name: /163 \/ QQ/,
        visible: ["163 邮箱", "QQ 邮箱"],
        hidden: ["Gmail", "Outlook", "iCloud Mail", "Proton Mail", "个人域名邮箱"],
      },
      {
        name: /Proton/,
        visible: ["Proton Mail"],
        hidden: ["Gmail", "Outlook", "iCloud Mail", "163 邮箱", "QQ 邮箱", "个人域名邮箱"],
      },
      {
        name: /个人域名/,
        visible: ["个人域名邮箱"],
        hidden: ["Gmail", "Outlook", "iCloud Mail", "163 邮箱", "QQ 邮箱", "Proton Mail"],
      },
    ];

    for (const group of groups) {
      fireEvent.click(within(providerNav).getByRole("button", { name: group.name }));
      for (const title of group.visible) {
        expect(await screen.findByLabelText(`${title} 接入卡片`)).toBeTruthy();
      }
      for (const title of group.hidden) {
        expect(screen.queryByLabelText(`${title} 接入卡片`)).toBeNull();
      }
    }
  });

  it.each([
    { title: "Gmail", provider: "gmail" as const, email: "owner@gmail.com" },
    { title: "Outlook", provider: "outlook" as const, email: "owner@outlook.com" },
  ])("starts $title OAuth from its card", async ({ title, provider, email }) => {
    const api = createApiFixture();
    const oauthRedirect = vi.fn();
    vi.mocked(api.startOAuthAccount).mockResolvedValue(oauthStartFixture(provider));

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        oauthRedirect={oauthRedirect}
      />,
    );
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: email },
    });
    fireEvent.click(await screen.findByRole("button", { name: `连接 ${title}` }));

    await waitFor(() => {
      expect(api.startOAuthAccount).toHaveBeenCalledWith({
        provider,
        redirectUri: expect.stringMatching(/\/oauth\/callback$/),
        loginHint: email,
      });
    });
    expect(oauthRedirect).toHaveBeenCalledWith(
      `https://auth.example/${provider}`,
    );
  });

  it("does not start Outlook OAuth when Microsoft web login is unavailable", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailProviderCapabilities).mockResolvedValueOnce({
      providers: [
        mailProviderCapabilityFixture({
          provider: "outlook",
          label: "Outlook",
          connectionLabel: "登录 Microsoft 账号",
          accountGroup: "global",
          supportsLogin: false,
          supportsWebLogin: false,
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();

    const outlookButton = await screen.findByRole("button", {
      name: "连接 Outlook",
    });
    expect((outlookButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(outlookButton);
    expect(api.startOAuthAccount).not.toHaveBeenCalled();
  });

  it.each([
    { title: "163 邮箱", provider: "163", email: "archive@163.com", secret: "163-code" },
    { title: "QQ 邮箱", provider: "qq", email: "support@qq.com", secret: "qq-code" },
    { title: "iCloud Mail", provider: "icloud", email: "me@icloud.com", secret: "icloud-app-password" },
  ])(
    "clicks and submits $title app-password setup",
    async ({ title, provider, email, secret }) => {
      const api = createApiFixture();

      render(<App api={api} defaultAccountId="account_1" />);
      openAddMail();
      fireEvent.change(screen.getByLabelText("Add mail email"), {
        target: { value: email },
      });
      fireEvent.click(await screen.findByRole("button", { name: `连接 ${title}` }));
      await screen.findByLabelText("Add mail secret");
      fireEvent.change(screen.getByLabelText("Add mail secret"), {
        target: { value: secret },
      });
      fireEvent.click(screen.getByRole("button", { name: `接入${title}` }));

      await waitFor(() => {
        expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
          email,
          provider,
          secret,
        });
      });
      expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith({
        email,
        provider,
        secret,
      });
    },
  );

  it("clicks custom-domain server fields, secure toggles, and submits manual payload", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@example.com" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 个人域名邮箱" }));
    await fillCustomDomainForm();
    fireEvent.click(screen.getByLabelText("Custom receive secure"));
    fireEvent.click(screen.getByLabelText("Custom send secure"));
    fireEvent.click(screen.getByRole("button", { name: "接入个人域名邮箱" }));

    const expectedInput = {
      email: "support@example.com",
      provider: "custom_domain",
      imap: {
        host: "imap.example.com",
        port: 1143,
        secure: false,
        username: "support@example.com",
        secret: "custom-password",
      },
      smtp: {
        host: "smtp.example.com",
        port: 1025,
        secure: false,
        username: "support@example.com",
        secret: "custom-password",
      },
    };
    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith(expectedInput);
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith(expectedInput);
  });

  it("clicks Proton Bridge host, port, and secure options before submit", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 Proton Mail" }));
    await screen.findByLabelText("Add mail secret");
    fireEvent.change(screen.getByLabelText("Add mail username"), {
      target: { value: "bridge-user" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge receive host"), {
      target: { value: "bridge.local" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge receive port"), {
      target: { value: "2143" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge send host"), {
      target: { value: "bridge.local" },
    });
    fireEvent.change(screen.getByLabelText("Proton Bridge send port"), {
      target: { value: "2025" },
    });
    fireEvent.click(screen.getByLabelText("Proton Bridge receive secure"));
    fireEvent.click(screen.getByLabelText("Proton Bridge send secure"));
    fireEvent.click(screen.getByRole("button", { name: "接入Proton Mail" }));

    const expectedInput = {
      email: "me@proton.me",
      provider: "proton_bridge",
      imap: {
        host: "bridge.local",
        port: 2143,
        secure: true,
        username: "bridge-user",
        secret: "bridge-password",
      },
      smtp: {
        host: "bridge.local",
        port: 2025,
        secure: true,
        username: "bridge-user",
        secret: "bridge-password",
      },
    };
    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith(expectedInput);
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith(expectedInput);
  });
});

function openAddMail() {
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: "添加邮箱",
    }),
  );
}

async function fillCustomDomainForm() {
  fireEvent.change(await screen.findByLabelText("Custom mail username"), {
    target: { value: "support@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Custom mail secret"), {
    target: { value: "custom-password" },
  });
  fireEvent.change(screen.getByLabelText("Custom receive host"), {
    target: { value: "imap.example.com" },
  });
  fireEvent.change(screen.getByLabelText("Custom receive port"), {
    target: { value: "1143" },
  });
  fireEvent.change(screen.getByLabelText("Custom send host"), {
    target: { value: "smtp.example.com" },
  });
  fireEvent.change(screen.getByLabelText("Custom send port"), {
    target: { value: "1025" },
  });
}

function oauthStartFixture(provider: OAuthProvider) {
  return {
    provider,
    authorizationUrl: `https://auth.example/${provider}`,
    state: `state_${provider}`,
    task: {
      id: `task_${provider}`,
      email: `pending@${provider}.oauth`,
      provider,
      authMethod: "oauth",
      status: "pending",
    },
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

function createApiFixture(): EmailHubApi {
  return {
    getMailNavigationSummary: vi.fn(async () => ({
      providerGroups: [
        { id: "gmail", label: "Gmail", count: 1 },
        { id: "outlook", label: "Outlook", count: 1 },
        { id: "icloud", label: "iCloud", count: 1 },
        { id: "domestic", label: "163 / QQ", count: 2 },
        { id: "proton", label: "Proton", count: 1 },
        { id: "domain", label: "个人域名", count: 1 },
      ],
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
        id: "task_1",
        email: "me@example.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "account_added",
        email: "me@example.com",
        provider: "qq",
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    })),
    listOperationalEvents: vi.fn(async () => ({ items: [] })),
  } as unknown as EmailHubApi;
}
