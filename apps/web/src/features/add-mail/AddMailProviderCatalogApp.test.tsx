import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import type { EmailHubApi, MailProviderCapabilityDto } from "../../lib/emailHubApi";

describe("Add Mail provider catalog", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("adds provider categories under Add Mail and common mail categories in the directory", () => {
    render(<App />);

    const commonCategories = screen.getByLabelText("常用分类");
    expect(within(commonCategories).getByRole("button", { name: /验证码/ })).toBeTruthy();
    expect(within(commonCategories).getByRole("button", { name: /账单\/收据/ })).toBeTruthy();
    expect(within(commonCategories).getByRole("button", { name: /物流\/订单/ })).toBeTruthy();
    expect(within(commonCategories).getByRole("button", { name: /订阅\/营销/ })).toBeTruthy();

    openAddMail();

    const providerNav = screen.getByLabelText("添加邮箱服务商分类");
    expect(within(providerNav).getByRole("button", { name: /Gmail/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /Outlook/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /iCloud/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /163 \/ QQ/ })).toBeTruthy();
  });

  it("uses mailbox provider icons and hides technical onboarding labels from Add Mail cards", () => {
    const { container } = render(<App />);

    openAddMail();

    expect(screen.getByLabelText("Gmail 图标")).toBeTruthy();
    expect(screen.getByLabelText("Outlook 图标")).toBeTruthy();
    expect(screen.getByLabelText("163 邮箱 图标")).toBeTruthy();
    expect(screen.getByLabelText("QQ 邮箱 图标")).toBeTruthy();
    expect(screen.getByLabelText("iCloud Mail 图标")).toBeTruthy();
    expect(screen.getByLabelText("Proton Mail 图标")).toBeTruthy();

    const iconSources = Array.from(
      container.querySelectorAll<HTMLImageElement>(".provider-icon img"),
    ).map((image) => image.src);
    expect(iconSources).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico"),
        expect.stringContaining("res.cdn.office.net/assets/mail/pwa"),
        expect.stringContaining("www.icloud.com/favicon.ico"),
        expect.stringContaining("mail.proton.me/assets/apple-touch-icon.png"),
        expect.stringContaining("mail.qq.com/favicon.ico"),
        expect.stringContaining("mail.163.com/favicon.ico"),
      ]),
    );

    expect(screen.queryByText(/OAuth|Gmail API|Microsoft Graph|M365|IMAP|SMTP/)).toBeNull();
  });

  it("loads provider groups and quick categories from the backend navigation summary", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    await waitFor(() => {
      const commonCategories = screen.getByLabelText("常用分类");
      expect(within(commonCategories).getByRole("button", { name: /验证码4/ })).toBeTruthy();
      expect(within(commonCategories).getByRole("button", { name: /账单\/收据2/ })).toBeTruthy();
    });
    expect(api.getMailNavigationSummary).toHaveBeenCalled();

    openAddMail();
    await waitFor(() => {
      expect(api.getMailProviderCapabilities).toHaveBeenCalled();
    });

    const providerNav = screen.getByLabelText("添加邮箱服务商分类");
    expect(within(providerNav).getByRole("button", { name: /Gmail7/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /iCloud3/ })).toBeTruthy();
  });

  it("loads Add Mail provider cards from backend capabilities", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailProviderCapabilities).mockResolvedValueOnce({
      providers: [
        mailProviderCapabilityFixture({
          provider: "icloud",
          label: "iCloud Mail",
          connectionLabel: "使用 Apple 专用密码连接",
          accountGroup: "global",
          supportsAppPassword: true,
        }),
        mailProviderCapabilityFixture({
          provider: "tencent_exmail",
          label: "腾讯企业邮箱",
          connectionLabel: "扫码或专用密码连接",
          accountGroup: "domestic",
          supportsScanLogin: true,
          supportsAppPassword: true,
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();

    expect(api.getMailProviderCapabilities).toHaveBeenCalled();
    expect(await screen.findByText("使用 Apple 专用密码连接")).toBeTruthy();
    expect(await screen.findByText("腾讯企业邮箱")).toBeTruthy();
    expect(screen.queryByText(/OAuth|IMAP|SMTP|API/)).toBeNull();
  });

  it("keeps enterprise import and account transfer out of the regular Add Mail page", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    openAddMail();

    expect(screen.queryByLabelText("企业导入和账号迁移")).toBeNull();
    expect(screen.queryByText("企业导入 / 账号迁移")).toBeNull();
    expect(screen.queryByLabelText("Account CSV import")).toBeNull();
    expect(screen.queryByLabelText("Account transfer package")).toBeNull();
    expect(screen.queryByLabelText("迁移导出账号选择")).toBeNull();
  });
});

function openAddMail() {
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: "添加邮箱",
    }),
  );
}

function createApiFixture(): EmailHubApi {
  return {
    getMailNavigationSummary: vi.fn(async () => ({
      providerGroups: [
        { id: "gmail", label: "Gmail", count: 7 },
        { id: "icloud", label: "iCloud", count: 3 },
      ],
      quickCategories: [
        { id: "codes", label: "验证码", count: 4 },
        { id: "receipts", label: "账单/收据", count: 2 },
      ],
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
    listOperationalEvents: vi.fn(async () => ({ items: [] })),
  } as unknown as EmailHubApi;
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
