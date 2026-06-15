import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type {
  EmailHubApi,
  FollowUpDto,
  FollowUpPage,
  HermesFollowupTrackerResult,
  HermesQuickReplyResult,
  HermesReplyDraftResult,
  HermesRewritePolishResult,
  MailNavigationSummaryDto,
  MailProviderCapabilityDto,
  OAuthStartResult,
  ReauthorizationTaskDto,
  SyncManualResyncResult,
  SyncPauseResult,
  SyncResumeResult,
  SyncRetryFailedResult,
  MailDraftDto,
  ScheduledSendDto,
} from "./lib/emailHubApi";

describe("Email Hub first UI baseline", () => {
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("keeps global functions in the left sidebar and mail folders in the second column", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".mail-grid")?.className).toContain("outlook-layout");

    const globalNav = screen.getByRole("navigation");
    const navLabels = within(globalNav).getAllByRole("button").map((button) => button.textContent ?? "");
    expect(navLabels).toContain("邮箱128");
    expect(navLabels).toContain("添加邮箱");
    expect(navLabels).toContain("同步中心");
    expect(navLabels).toContain("搜索");
    expect(navLabels).toContain("设置");
    expect(navLabels).not.toContain("待办9");
    expect(navLabels).not.toContain("Hermes");

    const directory = screen.getByLabelText("邮箱目录栏");
    expect(within(directory).getByRole("button", { name: /收件箱/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /草稿/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /已发送/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /归档/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /垃圾邮件/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /已删除/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /附件/ })).toBeTruthy();
  });

  it("keeps Hermes as a blurred compact dock that opens on demand and hides after idle", () => {
    vi.useFakeTimers();
    render(<App />);

    const dock = screen.getByLabelText("Hermes 底部输入");
    expect(dock.className).toContain("is-blurred");
    expect(dock.className).toContain("is-collapsed");
    expect(within(dock).getByRole("button", { name: "打开 Hermes" })).toBeTruthy();
    expect(within(dock).queryByDisplayValue("搜索邮件、写回复、整理收件箱...")).toBeNull();

    fireEvent.click(within(dock).getByRole("button", { name: "打开 Hermes" }));

    expect(dock.className).toContain("is-open");
    expect(within(dock).getByDisplayValue("搜索邮件、写回复、整理收件箱...")).toBeTruthy();
    expect(within(dock).queryByRole("button", { name: "搜索邮件" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(dock.className).toContain("is-collapsed");
    expect(within(dock).getByRole("button", { name: "打开 Hermes" })).toBeTruthy();
  });

  it("keeps the Hermes command dock short and resets the idle hide timer on activity", () => {
    vi.useFakeTimers();
    const { container } = render(<App />);

    const dock = container.querySelector(".hermes-dock");
    expect(dock?.className).toContain("dock-short");
    expect(dock?.className).toContain("is-collapsed");

    const launcher = container.querySelector(".dock-launcher");
    expect(launcher).toBeTruthy();
    fireEvent.click(launcher as HTMLElement);

    expect(dock?.className).toContain("is-open");
    expect(dock?.className).toContain("dock-short");
    expect(container.querySelector(".dock-command-input")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(dock?.className).toContain("is-open");

    fireEvent.mouseMove(dock as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(dock?.className).toContain("is-open");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(dock?.className).toContain("is-collapsed");
  });

  it("offers Outlook-style density modes for the mail list", () => {
    render(<App />);

    const density = screen.getByLabelText("邮件列表密度");
    expect(within(density).getByRole("button", { name: "宽阔" })).toBeTruthy();
    expect(within(density).getByRole("button", { name: "舒适" })).toBeTruthy();
    expect(within(density).getByRole("button", { name: "紧凑" })).toBeTruthy();

    fireEvent.click(within(density).getByRole("button", { name: "紧凑" }));

    expect(screen.getByLabelText("邮件列表").className).toContain("density-compact");
    expect(screen.getByLabelText("邮箱三栏工作台").className).toContain("layout-compact");
  });

  it("adds provider categories under Add Mail and common mail categories in the directory", () => {
    render(<App />);

    const commonCategories = screen.getByLabelText("常用分类");
    expect(within(commonCategories).getByRole("button", { name: /验证码/ })).toBeTruthy();
    expect(within(commonCategories).getByRole("button", { name: /账单\/收据/ })).toBeTruthy();
    expect(within(commonCategories).getByRole("button", { name: /物流\/订单/ })).toBeTruthy();
    expect(within(commonCategories).getByRole("button", { name: /订阅\/营销/ })).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );

    const providerNav = screen.getByLabelText("添加邮箱服务商分类");
    expect(within(providerNav).getByRole("button", { name: /Gmail/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /Outlook/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /iCloud/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /163 \/ QQ/ })).toBeTruthy();
  });

  it("uses mailbox provider icons and hides technical onboarding labels from Add Mail cards", () => {
    const { container } = render(<App />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );

    expect(screen.getByLabelText("Gmail 图标")).toBeTruthy();
    expect(screen.getByLabelText("Outlook 图标")).toBeTruthy();
    expect(screen.getByLabelText("163 邮箱 图标")).toBeTruthy();
    expect(screen.getByLabelText("QQ 邮箱 图标")).toBeTruthy();
    expect(screen.getByLabelText("iCloud Mail 图标")).toBeTruthy();
    expect(screen.getByLabelText("Proton Mail 图标")).toBeTruthy();

    const iconSources = Array.from(container.querySelectorAll<HTMLImageElement>(".provider-icon img")).map(
      (image) => image.src,
    );
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

  it("does not expose implementation terms in rendered user-facing copy", () => {
    const { container } = render(<App />);
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }));

    expect(container.textContent).not.toMatch(
      /OAuth|Gmail API|Microsoft Graph|M365|IMAP|SMTP|backend API|token|provider|skills|memory|DNS|DKIM|MX/i,
    );

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(container.textContent).not.toMatch(
      /OAuth|Gmail API|Microsoft Graph|M365|IMAP|SMTP|backend API|token|provider|skills|memory|DNS|DKIM|MX/i,
    );
  });

  it("keeps Todo and Hermes configuration inside Settings instead of the global sidebar", () => {
    render(<App />);

    const globalNav = screen.getByRole("navigation");
    expect(within(globalNav).queryByRole("button", { name: "待办9" })).toBeNull();
    expect(within(globalNav).queryByRole("button", { name: "Hermes" })).toBeNull();

    fireEvent.click(within(globalNav).getByRole("button", { name: "设置" }));

    const settingsNav = screen.getByLabelText("设置目录");
    expect(within(settingsNav).getByRole("button", { name: /Hermes/ })).toBeTruthy();
    expect(within(settingsNav).getByRole("button", { name: "待办" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Hermes/ })).toBeTruthy();

    fireEvent.click(within(settingsNav).getByRole("button", { name: "待办" }));

    expect(screen.getByRole("heading", { name: "待办" })).toBeTruthy();
    expect(screen.getByText("今天 17:00 前确认 Q2 合作方案")).toBeTruthy();
  });

  it("loads, saves, and tests Hermes connection from Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );

    expect(
      await screen.findByDisplayValue("http://hermes:8081/v1/chat/completions"),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "http://localhost:11434/v1/chat/completions" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "hermes-2-pro" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "runtime-secret" },
    });

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => {
      expect(api.probeHermesProvider).toHaveBeenCalledWith({
        providerKey: "hermes",
        endpointUrl: "http://localhost:11434/v1/chat/completions",
        model: "hermes-2-pro",
        apiKey: "runtime-secret",
      });
    });
    expect(await screen.findByText(/当前配置可用/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => {
      expect(api.updateHermesRuntimeSettings).toHaveBeenCalledWith({
        enabled: true,
        mode: "external_hermes",
        providerKey: "hermes",
        endpointUrl: "http://localhost:11434/v1/chat/completions",
        model: "hermes-2-pro",
        apiKey: "runtime-secret",
        updatePolicy: "manual",
        updateChannel: "stable",
      });
    });
  });

  it("clears the saved Hermes API key from Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );

    expect(await screen.findByText(/Hermes 已连接访问密钥/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除访问密钥" }));

    await waitFor(() => {
      expect(api.clearHermesRuntimeApiKey).toHaveBeenCalledWith({
        enabled: true,
        mode: "external_hermes",
        providerKey: "hermes",
        endpointUrl: "http://hermes:8081/v1/chat/completions",
        model: "hermes-email",
        updatePolicy: "manual",
        updateChannel: "stable",
      });
    });
    expect(await screen.findByText("访问密钥已清除。")).toBeTruthy();
  });

  it("loads Hermes model interfaces from the backend catalog before saving", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );

    expect(await screen.findByText("NovitaAI")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("模型接口"), {
      target: { value: "novita" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "moonshotai/kimi-k2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(api.updateHermesRuntimeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          providerKey: "novita",
          model: "moonshotai/kimi-k2.5",
        }),
      );
    });
  });

  it("applies Hermes provider catalog defaults when switching model interfaces", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );

    expect(
      await screen.findByDisplayValue("http://hermes:8081/v1/chat/completions"),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("模型接口"), {
      target: { value: "novita" },
    });

    expect((screen.getByLabelText("服务地址") as HTMLInputElement).value).toBe(
      "https://api.novita.ai/v3/openai/chat/completions",
    );
    expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe(
      "moonshotai/kimi-k2.5",
    );

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(api.updateHermesRuntimeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          providerKey: "novita",
          endpointUrl: "https://api.novita.ai/v3/openai/chat/completions",
          model: "moonshotai/kimi-k2.5",
        }),
      );
    });
  });

  it("marks Hermes providers that need external setup as unavailable in Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );

    const providerSelect = screen.getByLabelText("模型接口");
    expect(await within(providerSelect).findByRole("option", { name: "AWS Bedrock" }))
      .toBeTruthy();
    expect(
      (
        within(providerSelect).getByRole("option", {
          name: "AWS Bedrock",
        }) as HTMLOptionElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps Hermes fallback provider labels user-facing when the backend catalog is unavailable", () => {
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(container.textContent).not.toMatch(/\bAPI\b|OpenAI-compatible/i);
    const providerSelect = screen.getByLabelText("模型接口");
    expect(
      within(providerSelect).queryByRole("option", {
        name: /\bAPI\b|OpenAI-compatible/i,
      }),
    ).toBeNull();
    expect(within(providerSelect).getByRole("option", { name: "OpenAI" })).toBeTruthy();
    expect(
      within(providerSelect).getByRole("option", { name: "自定义模型服务" }),
    ).toBeTruthy();
  });

  it("changes the reading pane when another message is selected", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /新品发布会排期确认/ }));

    const reader = screen.getByRole("article");
    expect(within(reader).getByRole("heading", { name: "新品发布会排期确认" })).toBeTruthy();
    expect(within(reader).getByText(/P2 Important/)).toBeTruthy();
  });

  it("loads mailboxes, smart messages, and selected message detail from the backend api", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    expect(
      await screen.findByRole("heading", { name: "Live subject" }),
    ).toBeTruthy();
    expect(await screen.findByText("Live body from backend")).toBeTruthy();
    expect(api.listMailboxes).toHaveBeenCalledWith({ accountId: "account_1" });
    expect(api.listMessages).toHaveBeenCalledWith({
      accountId: "account_1",
      limit: 50,
      sort: "smart",
    });
    expect(api.getMessage).toHaveBeenCalledWith({
      accountId: "account_1",
      messageId: "message_1",
    });
  });

  it("reloads the message list with the selected mailbox id when a folder is opened", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailboxes).mockResolvedValue({
      items: [
        {
          id: "mailbox_inbox",
          accountId: "account_1",
          name: "Inbox",
          role: "inbox",
          messageCount: 1,
          unreadCount: 1,
        },
        {
          id: "mailbox_sent",
          accountId: "account_1",
          name: "Sent",
          role: "sent",
          messageCount: 1,
          unreadCount: 0,
        },
      ],
    });
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.mailboxId === "mailbox_sent" ? "message_sent" : "message_1",
          accountId: "account_1",
          subject:
            input.mailboxId === "mailbox_sent"
              ? "Sent subject from backend"
              : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet:
            input.mailboxId === "mailbox_sent"
              ? "Sent folder message"
              : "Live snippet",
          unread: input.mailboxId !== "mailbox_sent",
          starred: false,
          mailboxIds: [input.mailboxId ?? "mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.mailboxId === "mailbox_sent" ? 55 : 96,
            reasons:
              input.mailboxId === "mailbox_sent"
                ? ["Loaded from Sent"]
                : ["Direct to you"],
          },
        },
      ],
    }));
    vi.mocked(api.getMessage).mockImplementation(async (input) => ({
      id: input.messageId,
      accountId: "account_1",
      subject:
        input.messageId === "message_sent"
          ? "Sent subject from backend"
          : "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet:
        input.messageId === "message_sent"
          ? "Sent folder message"
          : "Live snippet",
      unread: false,
      starred: false,
      mailboxIds: [input.messageId === "message_sent" ? "mailbox_sent" : "mailbox_inbox"],
      attachmentCount: 0,
      classification: {
        bucket: "P2 Important",
        priorityScore: 55,
        reasons: ["Loaded from Sent"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText:
        input.messageId === "message_sent"
          ? "Sent body from backend"
          : "Live body from backend",
      attachments: [],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    expect(await screen.findByRole("heading", { name: "Live subject" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Sent/ }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        mailboxId: "mailbox_sent",
        limit: 50,
        sort: "smart",
      });
    });
    expect(await screen.findByRole("heading", { name: "Sent subject from backend" })).toBeTruthy();
    expect(await screen.findByText("Sent body from backend")).toBeTruthy();
  });

  it("runs search page queries through the backend message search route", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q ? "message_search" : "message_1",
          accountId: "account_1",
          subject: input.q ? "Signed contract found" : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched contract and payment text" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 91 : 96,
            reasons: input.q ? ["Matched search"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "搜索" }),
    );
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "signed contract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter attachments" }));
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "signed contract",
        sort: "smart",
        quickFilters: ["attachments"],
        qScopes: ["sender", "subject", "body"],
      });
    });
    expect(await screen.findByText("Signed contract found")).toBeTruthy();
  });

  it("loads and saves new-sender handling from Settings", async () => {
    const api = createApiFixture() as EmailHubApi & {
      getGatekeeperSettings: ReturnType<typeof vi.fn>;
      updateGatekeeperSettings: ReturnType<typeof vi.fn>;
    };
    api.getGatekeeperSettings = vi.fn(async () => ({
      accountId: "account_1",
      mode: "off_accept_all" as const,
      updatedAt: "2026-06-14T08:00:00.000Z",
    }));
    api.updateGatekeeperSettings = vi.fn(async (input) => ({
      accountId: input.accountId,
      mode: input.mode,
      updatedAt: "2026-06-14T08:05:00.000Z",
    }));

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "新发件人处理" }));

    await waitFor(() => {
      expect(api.getGatekeeperSettings).toHaveBeenCalledWith({ accountId: "account_1" });
    });
    expect(screen.getByRole("heading", { name: "新发件人处理" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "先进入新发件人" }));

    await waitFor(() => {
      expect(api.updateGatekeeperSettings).toHaveBeenCalledWith({
        accountId: "account_1",
        mode: "before_inbox",
      });
    });
    expect(await screen.findByText("当前：先进入新发件人")).toBeTruthy();
  });

  it("loads and decides Gatekeeper sender screening rows from Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "新发件人处理" }));

    expect(await screen.findByText("new-client@example.com")).toBeTruthy();
    expect(api.listGatekeeperSenders).toHaveBeenCalledWith({
      accountId: "account_1",
      status: "unknown",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Accept sender new-client@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.acceptGatekeeperSender).toHaveBeenCalledWith({
        accountId: "account_1",
        senderId: "sender_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Block domain example.com" }),
    );

    await waitFor(() => {
      expect(api.blockGatekeeperDomain).toHaveBeenCalledWith({
        accountId: "account_1",
        domain: "example.com",
      });
    });
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

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    await waitFor(() => {
      expect(api.getMailProviderCapabilities).toHaveBeenCalled();
    });

    const providerNav = screen.getByLabelText("添加邮箱服务商分类");
    expect(within(providerNav).getByRole("button", { name: /Gmail7/ })).toBeTruthy();
    expect(within(providerNav).getByRole("button", { name: /iCloud3/ })).toBeTruthy();
  });

  it("filters Add Mail provider cards when a provider group is selected", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    const providerNav = await screen.findByLabelText("添加邮箱服务商分类");
    fireEvent.click(within(providerNav).getByRole("button", { name: /iCloud3/ }));

    expect(await screen.findByLabelText("iCloud Mail 图标")).toBeTruthy();
    expect(screen.queryByLabelText("Gmail 图标")).toBeNull();
    expect(screen.queryByLabelText("Outlook 图标")).toBeNull();
    expect(screen.queryByLabelText("QQ 邮箱 图标")).toBeNull();
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
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );

    expect(api.getMailProviderCapabilities).toHaveBeenCalled();
    expect(await screen.findByText("使用 Apple 专用密码连接")).toBeTruthy();
    expect(await screen.findByText("腾讯企业邮箱")).toBeTruthy();
    expect(screen.queryByText(/OAuth|IMAP|SMTP|API/)).toBeNull();
  });

  it("previews CSV import and imports account transfer packages from Add Mail", async () => {
    const api = createApiFixture();
    const csv = "email,provider,auth_method,secret\nsupport@qq.com,qq,password,code";

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );

    fireEvent.change(await screen.findByLabelText("Account CSV import"), {
      target: { value: csv },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览 CSV" }));

    await waitFor(() => {
      expect(api.previewAccountCsv).toHaveBeenCalledWith({ csv });
    });

    fireEvent.click(screen.getByRole("button", { name: "创建导入任务" }));
    await waitFor(() => {
      expect(api.createAccountCsvImport).toHaveBeenCalledWith({ csv });
    });

    fireEvent.click(screen.getByRole("button", { name: "导出安全配置" }));
    await waitFor(() => {
      expect(api.exportAccountTransfer).toHaveBeenCalledWith();
    });

    fireEvent.click(screen.getByRole("button", { name: "导入迁移包" }));
    await waitFor(() => {
      expect(api.importAccountTransfer).toHaveBeenCalledWith({
        package: {
          schemaVersion: 1,
          exportedAt: "2026-06-14T08:00:00.000Z",
          accounts: [
            {
              email: "sync@example.com",
              provider: "gmail",
              authMethod: "oauth",
              engineProvider: "native",
              displayName: "Sync",
            },
          ],
        },
      });
    });
  });

  it("loads common categories through the backend saved view route", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    await waitFor(() => {
      expect(api.getMailNavigationSummary).toHaveBeenCalled();
    });

    fireEvent.click(
      within(screen.getByLabelText("常用分类")).getByRole("button", {
        name: /验证码4/,
      }),
    );

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        sort: "smart",
        savedView: "codes",
      });
    });
  });

  it("queues Spark done through the backend and exposes a local undo action", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "Done selected message" }));

    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "done",
      });
    });
    expect(screen.getByRole("button", { name: "Undo done" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo done" }));

    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "undo_done",
        undoToken: "undo_1",
      });
    });
  });

  it("saves a reply draft through the backend compose route", async () => {
    const api = createApiFixture();

    const { container } = render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    const replyTextarea = container.querySelector(".reply-composer textarea");
    expect(replyTextarea).toBeTruthy();

    fireEvent.change(replyTextarea as HTMLTextAreaElement, {
      target: { value: "Thanks, I will check this today." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reply draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Thanks, I will check this today.",
        source: "manual",
        replyToMessageId: "message_1",
      });
    });
    expect(await screen.findByText(/草稿已保存：draft_1/)).toBeTruthy();
  });

  it("creates then sends a reply draft through the backend compose route", async () => {
    const api = createApiFixture();

    const { container } = render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    const replyTextarea = container.querySelector(".reply-composer textarea");
    expect(replyTextarea).toBeTruthy();

    fireEvent.change(replyTextarea as HTMLTextAreaElement, {
      target: { value: "Send this after preview." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reply draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Send this after preview.",
        source: "manual",
        replyToMessageId: "message_1",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    expect(vi.mocked(api.createMailDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0],
    );
    expect(await screen.findByText(/回复已发送：draft_1/)).toBeTruthy();
  });

  it("uses Hermes to draft a reply into the composer", async () => {
    const api = createApiFixture();

    const { container } = render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));

    await waitFor(() => {
      expect(api.draftReply).toHaveBeenCalledWith({
        subject: "Live subject",
        threadText: "Live body from backend",
        instruction: "Draft a concise reply in my normal style.",
        readMessageIds: ["message_1"],
      });
    });

    const replyTextarea = container.querySelector(".reply-composer textarea");
    expect((replyTextarea as HTMLTextAreaElement).value).toBe(
      "Hi,\n\nI can confirm this plan.",
    );
    expect(await screen.findByText(/Hermes 已生成回复草稿/)).toBeTruthy();
  });

  it("uses Hermes quick reply with editable reply learning metadata", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", { name: "Ask Hermes quick reply thanks" }),
    );

    await waitFor(() => {
      expect(api.quickReply).toHaveBeenCalledWith({
        subject: "Live subject",
        threadText: "Live body from backend",
        scenario: "thanks",
        instruction: "Thank them warmly and keep the reply short.",
        tone: "warm professional",
        readMessageIds: ["message_1"],
      });
    });
    expect((screen.getByLabelText("Reply body") as HTMLTextAreaElement).value).toBe(
      "Thanks, I will take a look.",
    );
    expect(await screen.findByText(/Hermes 已生成快速回复/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save reply draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Thanks, I will take a look.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        hermesSkillRunId: "run_quick_1",
        hermesDraftText: "Thanks, I will take a look.",
      });
    });
  });

  it("saves Hermes-generated reply drafts with the skill run id for learning", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Save reply draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
  });

  it("sends Hermes-generated reply drafts with the skill run id for learning", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Send reply draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
  });

  it("adds a Sync Center module backed by backend account status", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));

    expect(await screen.findByText("sync@example.com")).toBeTruthy();
    expect(await screen.findByText(/正在同步/)).toBeTruthy();
    expect(api.listSyncCenterAccounts).toHaveBeenCalled();
    expect(api.listSyncCenterReauthorizations).toHaveBeenCalled();
    const reauthorizationPanel = screen.getByRole("region", {
      name: "需要重新授权",
    });
    expect(within(reauthorizationPanel).getByText("reauth@example.com")).toBeTruthy();
    expect(
      within(reauthorizationPanel).getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "span" &&
          (element.textContent ?? "").includes("发信权限"),
      ),
    ).toBeTruthy();
  });

  it("starts OAuth reauthorization from Sync Center", async () => {
    const api = createApiFixture();
    const oauthRedirect = vi.fn();

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        oauthRedirect={oauthRedirect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));
    expect(await screen.findByText("reauth@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start reauthorization for reauth@example.com",
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
      '"provider":"gmail"',
    );
  });

  it("wires Sync Center account controls to backend actions", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));

    expect(await screen.findByText("sync@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Request resync for sync@example.com" }),
    );
    await waitFor(() => {
      expect(api.requestSyncCenterResync).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Pause sync for sync@example.com" }),
    );
    await waitFor(() => {
      expect(api.pauseSyncCenterAccount).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });
    expect((await screen.findAllByText(/已暂停/)).length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Resume sync for sync@example.com" }),
    );
    await waitFor(() => {
      expect(api.resumeSyncCenterAccount).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry failed sync jobs for sync@example.com",
      }),
    );
    await waitFor(() => {
      expect(api.retryFailedSyncCenterJobs).toHaveBeenCalledWith({
        accountId: "account_1",
      });
    });
    expect(screen.getByRole("status").textContent).toContain("1");
  });

  it("opens Sync Center account diagnostics from backend operational events", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));

    expect(await screen.findByText("sync@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "View sync diagnostics for sync@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.listSyncCenterAccountDiagnostics).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 200,
      });
    });
    expect(await screen.findByText("同步诊断")).toBeTruthy();
    expect(screen.getByText("emailengine_webhook_ingested")).toBeTruthy();
    expect(
      screen.getByText("EmailEngine webhook auth_failed ingested for account_1"),
    ).toBeTruthy();
  });

  it("switches the active mailbox account from Sync Center before loading mail and search", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValue({
      items: [
        {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
        {
          accountId: "account_outlook",
          email: "outlook@example.com",
          provider: "outlook",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
    });
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.accountId === "account_outlook" ? "message_outlook" : "message_1",
          accountId: input.accountId ?? "account_1",
          subject: input.q
            ? "Outlook search result"
            : input.accountId === "account_outlook"
              ? "Outlook inbox subject"
              : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched from Outlook" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 90,
            reasons: ["Selected account"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));
    expect(await screen.findByText("outlook@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Use account outlook@example.com" }),
    );

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "account_outlook",
      });
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "account_outlook",
    );

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "contract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search current account" }));
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_outlook",
        limit: 50,
        q: "contract",
        qScopes: ["sender", "subject", "body"],
        sort: "smart",
      });
    });
  });

  it("starts Gmail OAuth from the Add Mail workspace without exposing backend routes in the component", async () => {
    const api = createApiFixture();
    const oauthRedirect = vi.fn();

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        oauthRedirect={oauthRedirect}
      />,
    );
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
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

  it("completes an OAuth callback from the provider and clears pending state", async () => {
    const api = createApiFixture();
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
    expect(await screen.findByText(/me@gmail.com/)).toBeTruthy();
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toBeNull();
  });

  it("does not call the backend when an OAuth callback was denied", async () => {
    const api = createApiFixture();
    sessionStorage.setItem(
      "email-hub:oauth:state_1",
      JSON.stringify({ provider: "gmail", returnTo: "add-mail" }),
    );
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?state=state_1&error=access_denied",
    );

    render(<App api={api} defaultAccountId="account_1" />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.completeOAuthCallback).not.toHaveBeenCalled();
  });

  it("loads mail with the first real backend account when no default account is provided", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValueOnce({
      items: [
        {
          accountId: "2f4f58af-7359-47f0-9158-1ef3a07fbc01",
          email: "real@example.com",
          provider: "gmail",
          syncState: "syncing",
        },
      ],
    });

    render(<App api={api} />);

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "2f4f58af-7359-47f0-9158-1ef3a07fbc01",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "account_1",
    });
  });

  it("replaces a stale preview account from session storage before loading backend mail", async () => {
    const api = createApiFixture();
    sessionStorage.setItem("email-hub:selected-account-id", "account_1");
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValueOnce({
      items: [
        {
          accountId: "33333333-3333-4333-8333-333333333333",
          email: "real-session@example.com",
          provider: "outlook",
          syncState: "syncing",
        },
      ],
    });

    render(<App api={api} />);

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "33333333-3333-4333-8333-333333333333",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "account_1",
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("replaces a missing session account with the first account returned by the backend", async () => {
    const api = createApiFixture();
    sessionStorage.setItem("email-hub:selected-account-id", "deleted-account");
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValueOnce({
      items: [
        {
          accountId: "44444444-4444-4444-8444-444444444444",
          email: "still-here@example.com",
          provider: "gmail",
          syncState: "syncing",
        },
      ],
    });

    render(<App api={api} />);

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "44444444-4444-4444-8444-444444444444",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "deleted-account",
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("tests app-password providers before onboarding them from Add Mail", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@qq.com" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "qq-auth-code" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 QQ 邮箱" }));

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

  it("tests custom domain server settings before onboarding from Add Mail", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@example.com" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 个人域名邮箱" }));

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
    fireEvent.click(screen.getByRole("button", { name: "测试并接入个人域名邮箱" }));

    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
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
      });
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith({
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
    });
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
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "support@qq.com" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "qq-auth-code" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 QQ 邮箱" }));

    await waitFor(() => {
      expect(api.listMailboxes).toHaveBeenCalledWith({
        accountId: "1c594d28-b36c-4e8f-a8e4-80ac73b29d6b",
      });
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBe(
      "1c594d28-b36c-4e8f-a8e4-80ac73b29d6b",
    );
  });

  it("shows backend diagnostics and stops onboarding when provider tests fail", async () => {
    const api = createApiFixture();
    vi.mocked(api.testImapSmtpConnection).mockResolvedValueOnce({
      provider: "163",
      ok: false,
      checks: {
        imap: { ok: false, code: "EAUTH", error: "Invalid login" },
        smtp: { ok: true },
      },
    });

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "archive@163.com" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bad-auth-code" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 163 邮箱" }));

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
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("EAUTH");
      expect(screen.getByRole("status").textContent).toContain("连接检查没有通过");
    });
  });

  it("loads follow-up reminders into Tasks and marks one done through the backend", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(within(screen.getByLabelText("设置目录")).getByRole("button", { name: "待办" }));

    expect(await screen.findByText("Check whether Lina replied")).toBeTruthy();
    expect(api.listFollowUps).toHaveBeenCalledWith({
      accountId: "account_1",
      status: "open",
      limit: 50,
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark follow-up done" }));

    await waitFor(() => {
      expect(api.updateFollowUp).toHaveBeenCalledWith({
        id: "fu_1",
        status: "done",
      });
    });
  });

  it("loads domain alias settings from the backend instead of showing only placeholders", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(
      within(screen.getByLabelText("设置目录")).getByRole("button", {
        name: "域名管理",
      }),
    );

    expect(await screen.findByText("demo.site")).toBeTruthy();
    expect(await screen.findByText("owner@example.net")).toBeTruthy();
    expect((await screen.findAllByText("support@demo.site")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/已送达/)).toBeTruthy();
    expect(api.listDomains).toHaveBeenCalled();
    expect(api.listDomainDestinations).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.listDomainAliases).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.listDomainDeliveryLogs).toHaveBeenCalledWith({
      domainId: "domain_1",
      limit: 20,
    });
  });

  it("uses Hermes to suggest and confirm a follow-up reminder from the reader", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", { name: "Ask Hermes to track follow-up" }),
    );

    expect(await screen.findByText("Check whether Lina replied")).toBeTruthy();
    expect(api.trackFollowup).toHaveBeenCalledWith({
      subject: "Live subject",
      threadText: "Live body from backend",
      userEmail: "me@example.com",
      participants: ["me@example.com", "client@example.com"],
      readMessageIds: ["message_1"],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm Hermes follow-up" }),
    );

    await waitFor(() => {
      expect(api.confirmHermesFollowUp).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        skillRunId: "run_followup_1",
        status: "waiting_on_them",
        dueAt: "2026-06-14T09:00:00.000Z",
        nextAction: "Check whether Lina replied",
        reasons: ["we asked for confirmation and no reply yet"],
      });
    });
    expect(await screen.findByText(/跟进已保存/)).toBeTruthy();
  });

  it("creates and sends a new composed message through backend compose routes", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "Lina <lina@example.com>, team@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [
          { address: "lina@example.com", name: "Lina" },
          { address: "team@example.com" },
        ],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    expect(await screen.findByText(/邮件已进入发送队列：draft_1/)).toBeTruthy();
  });

  it("sends Cc and Bcc from the compose panel through the draft payload", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose cc"), {
      target: { value: "Ops <ops@example.com>" },
    });
    fireEvent.change(screen.getByLabelText("Compose bcc"), {
      target: { value: "audit@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        cc: [{ address: "ops@example.com", name: "Ops" }],
        bcc: [{ address: "audit@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
  });

  it("sends selected send-as identity from the compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText(/support@demo\.site/);

    fireEvent.change(screen.getByLabelText("Compose from identity"), {
      target: { value: "alias:alias_1" },
    });
    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        from: { address: "support@demo.site", name: "Support" },
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
  });

  it("fills the compose panel from a backend reply-all seed", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "回复全部" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply_all",
      });
    });
    expect((screen.getByLabelText("Compose recipients") as HTMLInputElement).value).toBe(
      "Live Client <client@example.com>",
    );
    expect((screen.getByLabelText("Compose cc") as HTMLInputElement).value).toBe(
      "Ops <ops@example.com>",
    );
    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Re: Live subject",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toContain(
      "> Live body from backend",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        cc: [{ address: "ops@example.com", name: "Ops" }],
        subject: "Re: Live subject",
        bodyText:
          "On Sat, Live Client <client@example.com> wrote:\n> Live body from backend",
        source: "reply_all",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
      });
    });
  });

  it("carries forwarded seed attachments into the composed draft payload", async () => {
    const api = createApiFixture();
    vi.mocked(api.createComposeSeed).mockResolvedValueOnce({
      accountId: "account_1",
      messageId: "message_1",
      mode: "forward",
      to: [],
      cc: [],
      bcc: [],
      subject: "Fwd: Live subject",
      bodyText:
        "\n\n---------- Forwarded message ---------\nFrom: Live Client <client@example.com>\nSubject: Live subject\n\nLive body from backend",
      source: "forward",
      sourceMessageId: "message_1",
      attachments: [
        {
          id: "attachment_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          inline: false,
        },
      ],
      warnings: ["missing_recipient"],
      generatedAt: "2026-06-13T10:00:00.000Z",
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "转发" }));

    expect(await screen.findByText("proposal.pdf")).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Fwd: Live subject",
        bodyText:
          "---------- Forwarded message ---------\nFrom: Live Client <client@example.com>\nSubject: Live subject\n\nLive body from backend",
        source: "forward",
        sourceMessageId: "message_1",
        attachments: [
          {
            id: "attachment_1",
            source: "message_attachment",
            attachmentId: "attachment_1",
            filename: "proposal.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            inline: false,
          },
        ],
      });
    });
  });

  it("previews composed mail without sending it", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview composed draft" }));

    await waitFor(() => {
      expect(api.previewMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("可发送预览")).toBeTruthy();
  });

  it("polishes a composed draft through Hermes before saving it", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch plan" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "please review launch plan" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Polish composed draft with Hermes",
      }),
    );

    await waitFor(() => {
      expect(api.rewritePolishDraft).toHaveBeenCalledWith({
        text: "please review launch plan",
        action: "polish",
        instruction:
          "Polish this email while preserving intent, recipient details, and concrete commitments.",
        tone: "clear professional",
      });
    });
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Hi Lina,\n\nPlease review the launch plan today.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Hi Lina,\n\nPlease review the launch plan today.",
        source: "manual",
      });
    });
  });

  it("schedules composed drafts and refreshes the outbox", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Tomorrow review" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this tomorrow morning." },
    });
    fireEvent.change(screen.getByLabelText("Compose scheduled time"), {
      target: { value: "2026-06-14T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule composed draft" }));

    await waitFor(() => {
      expect(api.scheduleMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-14T09:30:00.000Z",
      });
    });
    expect(vi.mocked(api.createMailDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.scheduleMailDraft).mock.invocationCallOrder[0],
    );
    await waitFor(() => {
      expect(api.listOutbox).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 20,
      });
    });
    expect(await screen.findByText(/邮件已定时/)).toBeTruthy();
  });

  it("manages scheduled outbox items through backend routes", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");

    fireEvent.change(screen.getByLabelText("Reschedule schedule_1"), {
      target: { value: "2026-06-14T12:30" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reschedule scheduled send schedule_1" }),
    );

    await waitFor(() => {
      expect(api.rescheduleScheduledSend).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        scheduledAt: "2026-06-14T12:30:00.000Z",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Send scheduled send schedule_1 now" }),
    );
    await waitFor(() => {
      expect(api.sendScheduledNow).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel scheduled send schedule_1" }),
    );
    await waitFor(() => {
      expect(api.cancelScheduledSend).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });
  });
});

function createApiFixture(): EmailHubApi {
  return {
    listMailboxes: vi.fn(async () => ({
      items: [
        {
          id: "mailbox_inbox",
          accountId: "account_1",
          name: "Inbox",
          role: "inbox",
          messageCount: 1,
          unreadCount: 1,
        },
      ],
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
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["Direct to you"],
          },
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
      classification: {
        bucket: "P1 Urgent",
        priorityScore: 96,
        reasons: ["Direct to you"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText: "Live body from backend",
      attachments: [],
    })),
    applyMailAction: vi.fn(async (input) => ({
      accountId: input.accountId,
      messageId: input.messageId,
      action: input.action,
      state: {
        unread: false,
        starred: false,
        archived: input.action === "done",
        deleted: false,
        mailboxIds: input.action === "done" ? [] : ["mailbox_inbox"],
        labelIds: [],
        doneAt: input.action === "done" ? "2026-06-13T10:00:00.000Z" : null,
        undoToken: input.action === "done" ? "undo_1" : null,
        undoExpiresAt:
          input.action === "done" ? "2026-06-13T10:00:05.000Z" : null,
      },
      command: {
        id: "cmd_1",
        commandType: input.action === "done" ? "archive" : "move",
        accountId: input.accountId,
        messageId: input.messageId,
        idempotencyKey: "mail-action",
        status: "queued",
      },
    })),
    applySmartInboxCardBulkAction: vi.fn(async (input) => ({
      accountId: input.accountId,
      bucket: input.bucket,
      action: input.action,
      requestedCount: input.messageIds.length,
      attemptedCount: input.messageIds.length,
      succeededCount: input.messageIds.length,
      failedCount: 0,
      succeeded: input.messageIds.map((messageId: string, index: number) => ({
        messageId,
        undoToken: `undo_${index + 1}`,
        commandId: `cmd_${index + 1}`,
      })),
      failed: [],
    })),
    recordSmartInboxFeedback: vi.fn(async () => ({
      feedbackEventId: "feedback_1",
      accountId: "account_1",
      messageId: "message_1",
      classification: {
        bucket: "P6 Feed",
        priorityScore: 15,
        reasons: ["User moved sender to Newsletters"],
      },
    })),
    getGatekeeperSettings: vi.fn(async () => ({
      accountId: "account_1",
      mode: "off_accept_all" as const,
      updatedAt: "2026-06-14T08:00:00.000Z",
    })),
    updateGatekeeperSettings: vi.fn(async (input) => ({
      accountId: input.accountId,
      mode: input.mode,
      updatedAt: "2026-06-14T08:05:00.000Z",
    })),
    listGatekeeperSenders: vi.fn(async () => ({
      items: [
        {
          senderId: "sender_1",
          email: "new-client@example.com",
          domain: "example.com",
          status: "unknown" as const,
          messageCount: 2,
          latestMessageId: "message_1",
          latestReceivedAt: "2026-06-14T08:00:00.000Z",
          bulkAvailable: true,
        },
      ],
    })),
    acceptGatekeeperSender: vi.fn(async (input) => ({
      senderId: input.senderId,
      email: "new-client@example.com",
      domain: "example.com",
      status: "accepted" as const,
      action: "accept" as const,
      eventId: "screen_event_1",
    })),
    blockGatekeeperSender: vi.fn(async (input) => ({
      senderId: input.senderId,
      email: "new-client@example.com",
      domain: "example.com",
      status: "blocked" as const,
      action: "block_sender" as const,
      eventId: "screen_event_2",
    })),
    bulkDecideGatekeeperSenders: vi.fn(async (input) => ({
      items: input.senderIds.map((senderId: string) => ({
        senderId,
        email: "new-client@example.com",
        domain: "example.com",
        status: input.action === "accept" ? "accepted" as const : "blocked" as const,
        action: input.action === "accept" ? "accept" as const : "block_sender" as const,
        eventId: `screen_event_${senderId}`,
      })),
      missingSenderIds: [],
    })),
    blockGatekeeperDomain: vi.fn(async (input) => ({
      senderId: "domain_rule_1",
      domain: input.domain,
      status: "blocked" as const,
      action: "block_domain" as const,
      eventId: "screen_event_3",
    })),
    getHermesRuntimeSettings: vi.fn(async () => ({
      enabled: true,
      mode: "external_hermes" as const,
      providerKey: "hermes",
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      model: "hermes-email",
      apiKeyConfigured: true,
      updatePolicy: "manual" as const,
      updateChannel: "stable" as const,
      installedVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      source: "database" as const,
      updatedAt: "2026-06-14T08:00:00.000Z",
    })),
    getHermesProviders: vi.fn(async () => ({
      providers: [
        {
          key: "hermes",
          label: "Hermes 服务",
          category: "gateway" as const,
          authType: "api_key_optional" as const,
          requestProtocol: "openai_chat_completions" as const,
          endpointEditable: true,
          aliases: [],
          modelExamples: ["hermes-email"],
          capabilities: ["chat", "email_skills", "memory"],
        },
        {
          key: "novita",
          label: "NovitaAI",
          category: "cloud" as const,
          authType: "api_key" as const,
          requestProtocol: "openai_chat_completions" as const,
          endpointEditable: true,
          aliases: ["novita-ai"],
          modelExamples: ["moonshotai/kimi-k2.5"],
          defaultEndpoint: "https://api.novita.ai/v3/openai/chat/completions",
          capabilities: ["chat", "email_skills"],
        },
        {
          key: "aws-bedrock",
          label: "AWS Bedrock",
          category: "cloud" as const,
          authType: "aws_credentials" as const,
          requestProtocol: "aws_bedrock" as const,
          endpointEditable: false,
          aliases: [],
          modelExamples: ["anthropic.claude-sonnet-4-6"],
          capabilities: ["chat", "email_skills"],
        },
      ],
    })),
    updateHermesRuntimeSettings: vi.fn(async (input) => ({
      enabled: input.enabled,
      mode: input.mode,
      providerKey: input.providerKey ?? "custom",
      endpointUrl: input.endpointUrl,
      model: input.model,
      apiKeyConfigured: true,
      updatePolicy: input.updatePolicy,
      updateChannel: input.updateChannel,
      installedVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      source: "database" as const,
      updatedAt: "2026-06-14T08:05:00.000Z",
    })),
    clearHermesRuntimeApiKey: vi.fn(async (input) => ({
      enabled: input.enabled,
      mode: input.mode,
      providerKey: input.providerKey ?? "custom",
      endpointUrl: input.endpointUrl,
      model: input.model,
      apiKeyConfigured: false,
      updatePolicy: input.updatePolicy,
      updateChannel: input.updateChannel,
      installedVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      source: "database" as const,
      updatedAt: "2026-06-14T08:05:00.000Z",
    })),
    probeHermesProvider: vi.fn(async (input) => ({
      ok: true,
      status: "ready" as const,
      providerKey: input.providerKey,
      label: input.providerKey,
      category: "gateway" as const,
      authType: "api_key_optional" as const,
      endpointUrl: input.endpointUrl,
      model: input.model,
      missing: [],
      checkedAt: "2026-06-14T08:05:00.000Z",
    })),
    testHermesRuntimeConnection: vi.fn(async () => ({
      ok: true,
      checkedAt: "2026-06-14T08:00:00.000Z",
      providerKey: "hermes",
      requestProtocol: "openai_chat_completions" as const,
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      model: "hermes-email",
    })),
    getHermesRuntimeVersion: vi.fn(async () => ({
      installedVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      updatePolicy: "manual" as const,
      updateChannel: "stable" as const,
    })),
    checkHermesRuntimeUpdate: vi.fn(async () => ({
      installedVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      updatePolicy: "manual" as const,
      updateChannel: "stable" as const,
      lastCheckedAt: "2026-06-14T08:05:00.000Z",
    })),
    previewAccountCsv: vi.fn(async () => ({
      summary: {
        totalRows: 0,
        ready: 0,
        needsOAuth: 0,
        disabled: 0,
        invalid: 0,
      },
      rows: [],
    })),
    createAccountCsvImport: vi.fn(async () => ({
      summary: {
        totalRows: 0,
        ready: 0,
        needsOAuth: 0,
        disabled: 0,
        invalid: 0,
      },
      rows: [],
    })),
    exportAccountTransfer: vi.fn(async () => ({
      schemaVersion: 1 as const,
      exportedAt: "2026-06-14T08:00:00.000Z",
      accounts: [
        {
          email: "sync@example.com",
          provider: "gmail",
          authMethod: "oauth" as const,
          engineProvider: "native" as const,
          displayName: "Sync",
        },
      ],
    })),
    importAccountTransfer: vi.fn(async () => ({
      importedTaskCount: 1,
      reauthRequiredCount: 1,
      tasks: [
        {
          id: "task_transfer_1",
          email: "sync@example.com",
          provider: "gmail",
          authMethod: "oauth",
          status: "pending",
        },
      ],
    })),
    startOAuthAccount: vi.fn(async () => oauthStartFixture()),
    completeOAuthCallback: vi.fn(async () => oauthCallbackFixture()),
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
        id: "task_icloud",
        email: "me@icloud.com",
        provider: "icloud",
        authMethod: "password",
        status: "completed",
      },
    })),
    listOperationalEvents: vi.fn(async () => ({
      items: [
        {
          id: "op_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          service: "email-hub-api",
          level: "warn" as const,
          event: "account_onboarding_connection_test_failed",
          lane: "account_onboarding",
          message: "connection test failed for 163",
          context: {},
        },
      ],
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          syncState: "syncing",
          nextAction: "wait_for_sync",
        },
      ],
    })),
    listSyncCenterReauthorizations: vi.fn(async () => ({
      items: [reauthorizationTaskFixture()],
    })),
    startSyncCenterOAuthReauthorization: vi.fn(async () => oauthStartFixture()),
    listSyncCenterAccountDiagnostics: vi.fn(async () => ({
      items: [
        {
          id: "op_sync_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          service: "email-hub-api",
          level: "info" as const,
          event: "emailengine_webhook_ingested",
          accountId: "account_1",
          lane: "sync",
          jobId: "job_sync",
          message: "EmailEngine webhook auth_failed ingested for account_1",
          context: {
            duplicate: false,
            syncJobType: "account_state",
          },
        },
      ],
    })),
    requestSyncCenterResync: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "manual_sync_queued",
        job: {
          id: "job_sync",
          jobType: "sync_account",
          accountId: "account_1",
          idempotencyKey: "job:manual-sync:account_1:job_sync",
          status: "queued",
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      }) satisfies SyncManualResyncResult,
    ),
    pauseSyncCenterAccount: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "sync_paused",
        account: { accountId: "account_1", syncState: "paused" },
      }) satisfies SyncPauseResult,
    ),
    resumeSyncCenterAccount: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "sync_resumed",
        account: { accountId: "account_1", syncState: "syncing" },
      }) satisfies SyncResumeResult,
    ),
    retryFailedSyncCenterJobs: vi.fn(async () =>
      ({
        accountId: "account_1",
        action: "failed_sync_requeued",
        retriedJobCount: 1,
      }) satisfies SyncRetryFailedResult,
    ),
    getMailNavigationSummary: vi.fn(async () =>
      ({
        providerGroups: [
          { id: "gmail", label: "Gmail", count: 7 },
          { id: "outlook", label: "Outlook", count: 1 },
          { id: "icloud", label: "iCloud", count: 3 },
          { id: "domestic", label: "163 / QQ", count: 2 },
          { id: "proton", label: "Proton", count: 1 },
          { id: "domain", label: "个人域名", count: 5 },
        ],
        quickCategories: [
          { id: "codes", label: "验证码", count: 4, tone: "blue" },
          { id: "receipts", label: "账单/收据", count: 2, tone: "green" },
          { id: "shipping", label: "物流/订单", count: 1, tone: "yellow" },
          { id: "travel", label: "旅行/票务", count: 0, tone: "purple" },
          { id: "notifications", label: "系统通知", count: 9, tone: "coral" },
          { id: "newsletters", label: "订阅/营销", count: 8, tone: "purple" },
          { id: "social", label: "社交/社区", count: 6, tone: "blue" },
        ],
      }) satisfies MailNavigationSummaryDto,
    ),
    getMailProviderCapabilities: vi.fn(async () => ({
      providers: [
        mailProviderCapabilityFixture({
          provider: "gmail",
          label: "Gmail",
          connectionLabel: "登录后同步 Gmail 邮件",
          accountGroup: "global",
          supportsWebLogin: true,
          supportsLabels: true,
          supportsJunkFiltering: true,
        }),
        mailProviderCapabilityFixture({
          provider: "outlook",
          label: "Outlook",
          connectionLabel: "登录后同步 Outlook 邮件",
          accountGroup: "global",
          supportsWebLogin: true,
          supportsJunkFiltering: true,
        }),
        mailProviderCapabilityFixture({
          provider: "163",
          label: "163 邮箱",
          connectionLabel: "按提示完成邮箱授权",
          accountGroup: "domestic",
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
        mailProviderCapabilityFixture({
          provider: "qq",
          label: "QQ 邮箱",
          connectionLabel: "按提示完成邮箱授权",
          accountGroup: "domestic",
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
        mailProviderCapabilityFixture({
          provider: "icloud",
          label: "iCloud Mail",
          connectionLabel: "连接 iCloud 邮箱",
          accountGroup: "global",
          supportsAppPassword: true,
        }),
        mailProviderCapabilityFixture({
          provider: "proton_bridge",
          label: "Proton Mail",
          connectionLabel: "通过 Proton Bridge 连接",
          accountGroup: "private",
          requiresLocalBridge: true,
        }),
        mailProviderCapabilityFixture({
          provider: "custom_domain",
          label: "个人域名邮箱",
          connectionLabel: "连接企业或个人域名邮箱",
          accountGroup: "domain",
          supportsMailboxPassword: true,
        }),
      ],
    })),
    listDomains: vi.fn(async () => ({
      items: [
        {
          id: "domain_1",
          domain: "demo.site",
          verificationStatus: "pending",
          dnsRecords: {},
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    })),
    listDomainDestinations: vi.fn(async () => ({
      items: [
        {
          id: "dest_1",
          domainId: "domain_1",
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    })),
    listDomainAliases: vi.fn(async () => ({
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
    })),
    listDomainDeliveryLogs: vi.fn(async () => ({
      items: [
        {
          id: "log_1",
          domainId: "domain_1",
          recipient: "support@demo.site",
          status: "delivered",
          createdAt: "2026-06-13T09:00:00.000Z",
        },
      ],
    })),
    listFollowUps: vi.fn(async () => ({
      accountId: "account_1",
      status: "open",
      items: [followUpFixture()],
    } satisfies FollowUpPage)),
    trackFollowup: vi.fn(async () => ({
      skillRunId: "run_followup_1",
      skillId: "followup_tracker",
      status: "waiting_on_them",
      followupNeeded: true,
      owner: "them",
      confidence: 0.86,
      dueAt: "2026-06-14T09:00:00.000Z",
      nextAction: "Check whether Lina replied",
      reasons: ["we asked for confirmation and no reply yet"],
    } satisfies HermesFollowupTrackerResult)),
    draftReply: vi.fn(async () => ({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      draftText: "Hi,\n\nI can confirm this plan.",
    } satisfies HermesReplyDraftResult)),
    quickReply: vi.fn(async () => ({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    } satisfies HermesQuickReplyResult)),
    rewritePolishDraft: vi.fn(async () => ({
      skillRunId: "run_rewrite_1",
      skillId: "rewrite_polish",
      action: "polish",
      rewrittenText: "Hi Lina,\n\nPlease review the launch plan today.",
      editable: true,
      sendsDirectly: false,
    } satisfies HermesRewritePolishResult)),
    confirmHermesFollowUp: vi.fn(async () => followUpFixture()),
    createFollowUp: vi.fn(async () => followUpFixture()),
    updateFollowUp: vi.fn(async () =>
      followUpFixture({
        status: "done",
        updatedAt: "2026-06-13T10:00:00.000Z",
        completedAt: "2026-06-13T10:00:00.000Z",
      }),
    ),
    cancelFollowUp: vi.fn(async () =>
      followUpFixture({
        status: "cancelled",
        updatedAt: "2026-06-13T10:00:00.000Z",
        cancelledAt: "2026-06-13T10:00:00.000Z",
      }),
    ),
    listSendIdentities: vi.fn(async () => ({
      accountId: "account_1",
      items: [
        {
          id: "account:account_1",
          accountId: "account_1",
          from: { address: "work@demo.site", name: "Work" },
          source: "account" as const,
          isDefault: true,
          verified: true,
        },
        {
          id: "alias:alias_1",
          accountId: "account_1",
          from: { address: "support@demo.site", name: "Support" },
          source: "domain_alias" as const,
          isDefault: false,
          verified: true,
        },
      ],
    })),
    createComposeSeed: vi.fn(async (input) => ({
      accountId: input.accountId,
      messageId: input.messageId,
      mode: input.mode,
      to:
        input.mode === "forward"
          ? []
          : [{ address: "client@example.com", name: "Live Client" }],
      cc:
        input.mode === "reply_all"
          ? [{ address: "ops@example.com", name: "Ops" }]
          : [],
      bcc: [],
      subject: input.mode === "forward" ? "Fwd: Live subject" : "Re: Live subject",
      bodyText:
        input.mode === "forward"
          ? "\n\n---------- Forwarded message ---------\nFrom: Live Client <client@example.com>\nSubject: Live subject\n\nLive body from backend"
          : "\n\nOn Sat, Live Client <client@example.com> wrote:\n> Live body from backend",
      source: input.mode === "reply_all" ? "reply_all" : input.mode,
      ...(input.mode === "forward" ? {} : { replyToMessageId: input.messageId }),
      sourceMessageId: input.messageId,
      attachments: [],
      warnings: input.mode === "forward" ? ["missing_recipient" as const] : [],
      generatedAt: "2026-06-13T10:00:00.000Z",
    })),
    previewMailDraft: vi.fn(async (input) => ({
      accountId: input.accountId,
      ...(input.from ? { from: input.from } : {}),
      to: input.to ?? [],
      cc: input.cc ?? [],
      bcc: input.bcc ?? [],
      subject: input.subject ?? "",
      ...(input.bodyText ? { bodyText: input.bodyText } : {}),
      ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
      source: input.source ?? "manual",
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.sourceMessageId ?? input.replyToMessageId
        ? { sourceMessageId: input.sourceMessageId ?? input.replyToMessageId }
        : {}),
      warnings: [],
      estimatedSizeBytes: 120,
      readyToSend: true,
      generatedAt: "2026-06-13T10:01:00.000Z",
    })),
    createMailDraft: vi.fn(async () => mailDraftFixture()),
    sendMailDraft: vi.fn(async () => ({
      accountId: "account_1",
      draftId: "draft_1",
      action: "draft_send_queued" as const,
      draft: mailDraftFixture({ status: "sent" }),
    })),
    scheduleMailDraft: vi.fn(async () => scheduledSendFixture()),
    listOutbox: vi.fn(async () => ({
      accountId: "account_1",
      items: [scheduledSendFixture()],
    })),
    sendScheduledNow: vi.fn(async () =>
      scheduledSendFixture({
        status: "sent",
        canEdit: false,
        canSendNow: false,
        canDelete: false,
      }),
    ),
    rescheduleScheduledSend: vi.fn(async () =>
      scheduledSendFixture({
        scheduledAt: "2026-06-14T12:30:00.000Z",
      }),
    ),
    cancelScheduledSend: vi.fn(async () =>
      scheduledSendFixture({
        status: "cancelled",
        canEdit: false,
        canSendNow: false,
        canDelete: false,
      }),
    ),
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

function oauthStartFixture(): OAuthStartResult {
  return {
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
      engineProvider: "native",
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

function followUpFixture(overrides: Partial<FollowUpDto> = {}): FollowUpDto {
  return {
    id: "fu_1",
    accountId: "account_1",
    messageId: "message_1",
    kind: "waiting_on_them",
    status: "open",
    dueAt: "2026-06-14T09:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
    source: "hermes_followup",
    hermesSkillRunId: "run_1",
    createdAt: "2026-06-13T09:00:00.000Z",
    updatedAt: "2026-06-13T09:00:00.000Z",
    ...overrides,
  };
}

function mailDraftFixture(overrides: Partial<MailDraftDto> = {}): MailDraftDto {
  return {
    id: "draft_1",
    accountId: "account_1",
    to: [{ address: "client@example.com", name: "Client" }],
    cc: [],
    bcc: [],
    subject: "Re: Live subject",
    bodyText: "Thanks, I will check this today.",
    status: "draft",
    source: "manual",
    replyToMessageId: "message_1",
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z",
    ...overrides,
  };
}

function scheduledSendFixture(
  overrides: Partial<ScheduledSendDto> = {},
): ScheduledSendDto {
  return {
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
    ...overrides,
  };
}
