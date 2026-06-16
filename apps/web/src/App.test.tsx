import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError } from "./lib/emailHubApi";
import type {
  EmailHubApi,
  FollowUpDto,
  FollowUpPage,
  HermesActionItemExtractResult,
  HermesEmailSearchQaResult,
  HermesFollowupTrackerResult,
  HermesLabelSuggestResult,
  HermesNewsletterCleanupResult,
  HermesPriorityTriageResult,
  HermesQuickReplyResult,
  HermesReplyDraftResult,
  HermesRewritePolishResult,
  HermesThreadSummaryResult,
  HermesTranslateTextResult,
  MailNavigationSummaryDto,
  MailEngineHealthDto,
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
    expect(within(dock).queryByLabelText("Hermes 指令")).toBeNull();

    fireEvent.click(within(dock).getByRole("button", { name: "打开 Hermes" }));

    expect(dock.className).toContain("is-open");
    const commandInput = within(dock).getByLabelText("Hermes 指令") as HTMLInputElement;
    expect(commandInput.placeholder).toBe("搜索邮件、写回复、整理收件箱...");
    expect(commandInput.value).toBe("");
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

  it("runs Hermes mail search QA from the compact dock and can open the Search workspace", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "客户上次提到的合同是什么" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith({
        accountId: "account_1",
        question: "客户上次提到的合同是什么",
        language: "zh-CN",
        limit: 5,
        memoryScope: "global",
      });
    });
    expect(
      await screen.findByText("Lina mentioned the signed contract in the latest thread."),
    ).toBeTruthy();
    expect(within(screen.getByLabelText("Hermes 搜索回答")).getByText("Live subject")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "同步到搜索页" }));

    expect(await screen.findByRole("heading", { name: "搜索" })).toBeTruthy();
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "signed contract",
        qScopes: ["sender", "recipients", "subject", "body"],
        sort: "smart",
      });
    });
  });

  it("does not call Hermes mail search QA for an empty dock prompt", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
    expect(await screen.findByText("请输入要让 Hermes 查找或回答的问题。")).toBeTruthy();
  });

  it("shows a clear dock error when Hermes mail search QA is unavailable", async () => {
    const api = createApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(new Error("offline"));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "找一下合同" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    expect(await screen.findByText("Hermes 搜索暂时不可用。")).toBeTruthy();
    expect(screen.queryByLabelText("Hermes 搜索回答")).toBeNull();
  });

  it("runs Hermes summary and translation from the message reader", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Hermes to summarize selected message",
      }),
    );

    await waitFor(() => {
      expect(api.summarizeThread).toHaveBeenCalledWith({
        subject: "Live subject",
        threadText: "Live body from backend",
        mode: "action_points",
        focus: "decisions, deadlines, blockers, and reply needs",
        language: "zh-CN",
        readMessageIds: ["message_1"],
        memoryScope: "global",
      });
    });
    expect(await screen.findByText("需要确认发布时间，并在今天回复 Lina。")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Hermes to translate selected message",
      }),
    );

    await waitFor(() => {
      expect(api.translateText).toHaveBeenCalledWith({
        text: "Live body from backend",
        targetLanguage: "Chinese",
        tone: "preserve original meaning and formatting",
        readMessageIds: ["message_1"],
        memoryScope: "global",
      });
    });
    expect(await screen.findByText("你好，请确认发布计划。")).toBeTruthy();
  });

  it("runs Hermes organization skills from the message reader", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Hermes to organize selected message",
      }),
    );

    await waitFor(() => {
      expect(api.triagePriorityWithHermes).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Live subject",
          threadText: "Live body from backend",
          senderEmail: "client@example.com",
          currentBucket: "P1 Urgent",
          currentScore: 96,
          currentReasons: ["Direct to you"],
          language: "zh-CN",
          readMessageIds: ["message_1"],
          memoryScope: "sender:client@example.com",
          memoryLayers: [
            "contact_memory",
            "procedural_memory",
            "semantic_profile",
            "writing_style_profile",
          ],
        }),
      );
    });
    expect(api.suggestLabelsWithHermes).toHaveBeenCalledWith(
      expect.objectContaining({
        currentLabels: [],
        availableLabels: ["工作", "客户", "财务", "产品", "市场"],
      }),
    );
    expect(api.cleanupNewsletterWithHermes).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBucket: "P1 Urgent",
        senderEmail: "client@example.com",
      }),
    );
    expect(api.extractActionItemsWithHermes).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Live subject",
        readMessageIds: ["message_1"],
      }),
    );
    const result = await screen.findByLabelText("Hermes 整理建议");
    expect(within(result).getByText(/P1 Urgent · 分数 94/)).toBeTruthy();
    expect(within(result).getByText(/标签： 客户/)).toBeTruthy();
    expect(within(result).getByText(/订阅判断：personal · 88%/)).toBeTruthy();
    expect(within(result).getByText(/Confirm launch schedule/)).toBeTruthy();
  });

  it("shows a reader-level Hermes error without replacing the message body", async () => {
    const api = createApiFixture();
    vi.mocked(api.summarizeThread).mockRejectedValueOnce(new Error("offline"));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Hermes to summarize selected message",
      }),
    );

    expect(await screen.findByText("Hermes 总结暂时不可用。")).toBeTruthy();
    expect(screen.getByText("Live body from backend")).toBeTruthy();
    expect(screen.queryByText("需要确认发布时间，并在今天回复 Lina。")).toBeNull();
  });

  it("ignores a stale Hermes reader summary after switching messages", async () => {
    const api = createApiFixture();
    let resolveSummary: (value: HermesThreadSummaryResult) => void = () => {};
    vi.mocked(api.listMessages).mockResolvedValue({
      items: [
        {
          id: "message_1",
          accountId: "account_1",
          subject: "First subject",
          from: { email: "first@example.com", name: "First Sender" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "First snippet",
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
        {
          id: "message_2",
          accountId: "account_1",
          subject: "Second subject",
          from: { email: "second@example.com", name: "Second Sender" },
          receivedAt: "2026-06-13T10:05:00.000Z",
          snippet: "Second snippet",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 88,
            reasons: ["Important sender"],
          },
        },
      ],
    });
    vi.mocked(api.getMessage).mockImplementation(async (input) => ({
      id: input.messageId,
      accountId: "account_1",
      subject: input.messageId === "message_2" ? "Second subject" : "First subject",
      from:
        input.messageId === "message_2"
          ? { email: "second@example.com", name: "Second Sender" }
          : { email: "first@example.com", name: "First Sender" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: input.messageId === "message_2" ? "Second snippet" : "First snippet",
      unread: false,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 0,
      classification: {
        bucket: input.messageId === "message_2" ? "P2 Important" : "P1 Urgent",
        priorityScore: input.messageId === "message_2" ? 88 : 96,
        reasons: ["Loaded detail"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText:
        input.messageId === "message_2"
          ? "Second backend body"
          : "First backend body",
      attachments: [],
    }));
    vi.mocked(api.summarizeThread).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSummary = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "First subject" });
    await screen.findByText("First backend body");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask Hermes to summarize selected message",
      }),
    );
    await waitFor(() => {
      expect(api.summarizeThread).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "First subject",
          threadText: "First backend body",
          readMessageIds: ["message_1"],
        }),
      );
    });

    fireEvent.click(
      within(screen.getByRole("region", { name: "邮件列表" })).getByRole(
        "button",
        { name: /Second subject/ },
      ),
    );
    await screen.findByRole("heading", { name: "Second subject" });
    await screen.findByText("Second backend body");

    await act(async () => {
      resolveSummary({
        skillRunId: "run_stale_summary",
        skillId: "thread_summarize",
        mode: "action_points",
        summaryText: "Stale summary should not render.",
      });
    });

    expect(screen.queryByText("Stale summary should not render.")).toBeNull();
    expect(screen.getByText("Second backend body")).toBeTruthy();
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

  it("lets users review, edit, and delete Hermes memories from Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );

    expect(await screen.findByText("写作风格")).toBeTruthy();
    expect(screen.getByDisplayValue(/Keep replies concise/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Hermes memory content memory_1"), {
      target: {
        value: JSON.stringify({ preference: "Use crisp executive summaries." }, null, 2),
      },
    });
    fireEvent.change(screen.getByLabelText("Hermes memory confidence memory_1"), {
      target: { value: "0.91" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存学习记录" }));

    await waitFor(() => {
      expect(api.updateHermesMemory).toHaveBeenCalledWith({
        id: "memory_1",
        content: { preference: "Use crisp executive summaries." },
        confidence: 0.91,
      });
    });
    expect(await screen.findByText("Hermes 学习记录已保存。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "准备删除" }));
    expect(await screen.findByText("再次点击确认删除 写作风格。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(api.deleteHermesMemory).toHaveBeenCalledWith({ id: "memory_1" });
    });
    expect(await screen.findByText("Hermes 学习记录已删除。")).toBeTruthy();
  });

  it("filters Hermes memories without saving runtime settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );
    expect(await screen.findByText("写作风格")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Hermes memory layer filter"), {
      target: { value: " procedural_memory " },
    });
    fireEvent.change(screen.getByLabelText("Hermes memory scope filter"), {
      target: { value: " sender:team@example.com " },
    });
    fireEvent.change(screen.getByLabelText("Hermes memory limit"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByRole("button", { name: "刷新学习记录" }));

    await waitFor(() => {
      expect(api.listHermesMemories).toHaveBeenLastCalledWith({
        layer: "procedural_memory",
        scope: "sender:team@example.com",
        limit: 100,
      });
    });
    expect(api.updateHermesRuntimeSettings).not.toHaveBeenCalled();
  });

  it("validates Hermes memory JSON before saving", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "设置" }),
    );
    expect(await screen.findByText("写作风格")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Hermes memory content memory_1"), {
      target: { value: "[]" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存学习记录" }));

    expect(await screen.findByText("学习内容必须是 JSON 对象。")).toBeTruthy();
    expect(api.updateHermesMemory).not.toHaveBeenCalled();
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
    const reader = screen.getByRole("article");
    expect(within(reader).queryByText("你好，")).toBeNull();
    expect(within(reader).queryByText(/附件是我们讨论的合作方案/)).toBeNull();
    expect(within(reader).queryByText("谢谢。")).toBeNull();
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
          searchPreview: input.q
            ? {
                source: "indexed_text",
                text: "Indexed body hit: signed contract.",
              }
            : undefined,
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
        qScopes: ["sender", "recipients", "subject", "body"],
      });
    });
    expect(await screen.findByText("Signed contract found")).toBeTruthy();
    expect(await screen.findByText(/Indexed body hit: signed contract/)).toBeTruthy();
  });

  it("lets search page remove recipients from the backend query scope", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "搜索" }),
    );
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "billing contact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search recipients scope" }));
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "billing contact",
        qScopes: ["sender", "subject", "body"],
        sort: "smart",
      });
    });
  });

  it("shows a real empty state when backend search returns no messages", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: input.q
        ? []
        : [
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
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "搜索" }),
    );
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "missing invoice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "missing invoice",
        qScopes: ["sender", "recipients", "subject", "body"],
        sort: "smart",
      });
    });
    expect(await screen.findAllByText("没有匹配邮件。")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("没有找到匹配邮件。");
    expect(screen.queryByText("关于 Q2 合作方案的确认")).toBeNull();
  });

  it("launches global search from the mail top bar", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q ? "message_top_search" : "message_1",
          accountId: "account_1",
          subject: input.q ? "Top search result" : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched from the top search box" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 89 : 96,
            reasons: input.q ? ["Matched top search"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("全局搜索邮件"), {
      target: { value: "signed contract" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));

    expect(await screen.findByRole("heading", { name: "搜索" })).toBeTruthy();
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "signed contract",
        qScopes: ["sender", "recipients", "subject", "body"],
        sort: "smart",
      });
    });
    expect(await screen.findByText("Top search result")).toBeTruthy();
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
    const oauthRedirect = vi.fn();
    const csv = "email,provider,auth_method,secret\nsupport@qq.com,qq,password,code";
    const transferPackage = {
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
    };

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

    fireEvent.click(screen.getByRole("button", { name: "下载 CSV 模板" }));
    expect(
      (await screen.findByLabelText("Account CSV import") as HTMLTextAreaElement)
        .value,
    ).toContain("email,provider,display_name,auth_method");
    expect(await screen.findByText(/CSV 模板已放入文本框/)).toBeTruthy();

    fireEvent.change(await screen.findByLabelText("Account CSV import"), {
      target: { value: csv },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览 CSV" }));

    await waitFor(() => {
      expect(api.previewAccountCsv).toHaveBeenCalledWith({ csv });
    });
    expect(await screen.findByText("owner@gmail.com")).toBeTruthy();
    expect(await screen.findByText("email is invalid")).toBeTruthy();
    expect((await screen.findAllByText("需登录")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "创建导入任务" }));
    await waitFor(() => {
      expect(api.createAccountCsvImport).toHaveBeenCalledWith({ csv });
    });
    expect(await screen.findByText(/已创建 2 个导入任务/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Continue authorization for row 3 owner@gmail.com",
      }),
    );
    await waitFor(() => {
      expect(api.startSyncCenterOAuthReauthorization).toHaveBeenCalledWith({
        taskId: "task_csv_2",
        redirectUri: "http://localhost:3000/oauth/callback",
      });
    });
    expect(oauthRedirect).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(sessionStorage.getItem("email-hub:oauth:state_1")).toContain(
      '"returnTo":"add-mail"',
    );

    fireEvent.click(
      await screen.findByLabelText("Select transfer account sync@example.com"),
    );
    fireEvent.click(screen.getByRole("button", { name: "导出安全配置" }));
    await waitFor(() => {
      expect(api.exportAccountTransfer).toHaveBeenCalledWith({
        accountIds: ["account_1"],
      });
    });

    fireEvent.change(screen.getByLabelText("Account transfer file"), {
      target: {
        files: [
          new File([JSON.stringify(transferPackage)], "transfer.json", {
            type: "application/json",
          }),
        ],
      },
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Account transfer package") as HTMLTextAreaElement)
          .value,
      ).toContain("sync@example.com");
    });
    expect(await screen.findByText(/已读取迁移包文件/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "导入迁移包" }));
    await waitFor(() => {
      expect(api.importAccountTransfer).toHaveBeenCalledWith({
        package: transferPackage,
      });
    });
    expect(await screen.findByText(/已导入 1 个账号/)).toBeTruthy();
    const transferResult = await screen.findByLabelText("账号迁移导入结果");
    expect(within(transferResult).getByText("sync@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开同步中心授权" }));
    expect(await screen.findByRole("heading", { name: "同步中心" })).toBeTruthy();
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

  it("runs Smart Inbox bucket Done per account and removes only confirmed successes", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValueOnce({
      items: [
        {
          accountId: "account_1",
          email: "first@example.com",
          provider: "gmail",
          syncState: "syncing",
        },
        {
          accountId: "account_2",
          email: "second@example.com",
          provider: "outlook",
          syncState: "syncing",
        },
      ],
    });
    vi.mocked(api.listMessages).mockResolvedValue({
      items: [
        {
          id: "urgent_1",
          accountId: "account_1",
          subject: "Account one urgent",
          from: { email: "one@example.com", name: "One Sender" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "first urgent",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["First account"],
          },
        },
        {
          id: "urgent_2",
          accountId: "account_2",
          subject: "Account two urgent",
          from: { email: "two@example.com", name: "Two Sender" },
          receivedAt: "2026-06-13T10:05:00.000Z",
          snippet: "second urgent",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 95,
            reasons: ["Second account"],
          },
        },
        {
          id: "important_1",
          accountId: "account_2",
          subject: "Account two important",
          from: { email: "important@example.com", name: "Important Sender" },
          receivedAt: "2026-06-13T09:55:00.000Z",
          snippet: "still visible",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 80,
            reasons: ["Keep visible"],
          },
        },
      ],
    });

    render(<App api={api} />);

    await waitFor(() => {
      expect(screen.getAllByText("Account one urgent").length).toBeGreaterThan(0);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Smart Inbox done P1 Urgent" }),
    );

    await waitFor(() => {
      expect(api.applySmartInboxCardBulkAction).toHaveBeenCalledTimes(2);
    });
    expect(api.applySmartInboxCardBulkAction).toHaveBeenCalledWith({
      accountId: "account_1",
      bucket: "P1 Urgent",
      action: "done",
      messageIds: ["urgent_1"],
    });
    expect(api.applySmartInboxCardBulkAction).toHaveBeenCalledWith({
      accountId: "account_2",
      bucket: "P1 Urgent",
      action: "done",
      messageIds: ["urgent_2"],
    });
    expect(await screen.findByText("Smart Inbox 已完成 2 封优先邮件。")).toBeTruthy();
    expect(screen.queryByText("Account one urgent")).toBeNull();
    expect(screen.queryByText("Account two urgent")).toBeNull();
    expect(screen.getAllByText("Account two important").length).toBeGreaterThan(0);
  });

  it("records Smart Inbox feedback and updates the selected card classification", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Smart Inbox move selected to newsletters",
      }),
    );

    await waitFor(() => {
      expect(api.recordSmartInboxFeedback).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "move_to_newsletters",
      });
    });
    expect(await screen.findByText("Smart Inbox 已学习：移到订阅。")).toBeTruthy();
    expect(screen.getByText("User moved sender to Newsletters")).toBeTruthy();
  });

  it("hides raw Smart Inbox backend details when feedback fails", async () => {
    const api = createApiFixture();
    vi.mocked(api.recordSmartInboxFeedback).mockRejectedValueOnce(
      new ApiRequestError(500, "internal_error", {
        error: "internal_error",
        detail: "postgres leaked token smart-secret",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Smart Inbox mark selected important",
      }),
    );

    expect(await screen.findByText("Smart Inbox 反馈暂时不可用。")).toBeTruthy();
    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("internal_error");
    expect(pageText).not.toContain("smart-secret");
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

  it("saves a reply draft from a backend seed through the compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "回复" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
    });
    expect(screen.queryByLabelText("Reply body")).toBeNull();
    expect((screen.getByLabelText("Compose recipients") as HTMLInputElement).value).toBe(
      "Live Client <client@example.com>",
    );

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Thanks, I will check this today." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Thanks, I will check this today.",
        source: "reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
      });
    });
    expect(await screen.findByText(/草稿已保存：draft_1/)).toBeTruthy();
  });

  it("creates then sends a reply draft through the unified compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    await screen.findByText(/回复草稿已准备/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this after preview." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Send this after preview.",
        source: "reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
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
    expect(await screen.findByText(/邮件已进入发送队列：draft_1/)).toBeTruthy();
  });

  it("downloads message attachments through the backend blob route", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMessage).mockResolvedValueOnce({
      id: "message_1",
      accountId: "account_1",
      subject: "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: "Live snippet",
      unread: true,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 1,
      classification: {
        bucket: "P1 Urgent",
        priorityScore: 96,
        reasons: ["Direct to you"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText: "Live body from backend",
      attachments: [
        {
          id: "attachment_1",
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          embedded: false,
          inline: false,
        },
      ],
    });

    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => "blob:attachment_1");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      render(<App api={api} defaultAccountId="account_1" />);
      await screen.findByText("proposal.pdf");

      fireEvent.click(
        screen.getByRole("button", { name: "Download attachment proposal.pdf" }),
      );

      await waitFor(() => {
        expect(api.downloadAttachment).toHaveBeenCalledWith({
          accountId: "account_1",
          attachmentId: "attachment_1",
        });
      });
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalled();
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:attachment_1");
      expect(await screen.findByText(/附件已开始下载：proposal.pdf/)).toBeTruthy();
    } finally {
      click.mockRestore();
      restoreUrlDownloadMethod("createObjectURL", originalCreateObjectUrl);
      restoreUrlDownloadMethod("revokeObjectURL", originalRevokeObjectUrl);
    }
  });

  it("uses Hermes to draft a reply into the unified compose panel", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
    });
    await waitFor(() => {
      expect(api.draftReply).toHaveBeenCalledWith({
        subject: "Live subject",
        threadText: "Live body from backend",
        instruction: "Draft a concise reply in my normal style.",
        readMessageIds: ["message_1"],
      });
    });

    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Hi,\n\nI can confirm this plan.",
    );
    expect((screen.getByLabelText("Compose recipients") as HTMLInputElement).value).toBe(
      "Live Client <client@example.com>",
    );
    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Re: Live subject",
    );
    expect(screen.queryByLabelText("Reply body")).toBeNull();
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
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
      });
    });
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
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Thanks, I will take a look.",
    );
    expect(await screen.findByText(/Hermes 已生成快速回复/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Thanks, I will take a look.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
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
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
  });

  it("keeps the original Hermes draft text when the composed reply is edited", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Hi,\n\nI edited this before sending." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI edited this before sending.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
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
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
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

  it("keeps selected send-as identity when Hermes drafts a reply", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText(/support@demo\.site/);

    fireEvent.change(screen.getByLabelText("Compose from identity"), {
      target: { value: "alias:alias_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));

    await waitFor(() => {
      expect(api.createComposeSeed).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "reply",
        from: { address: "support@demo.site", name: "Support" },
      });
    });
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        from: { address: "support@demo.site", name: "Support" },
        to: [{ address: "client@example.com", name: "Live Client" }],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
        hermesSkillRunId: "run_reply_1",
        hermesDraftText: "Hi,\n\nI can confirm this plan.",
      });
    });
  });

  it("saves manual drafts with provider-native send-as identities", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText(/Team Inbox <team@example\.com> · Outlook共享邮箱/);

    fireEvent.change(screen.getByLabelText("Compose from identity"), {
      target: { value: "provider:identity_1" },
    });
    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Launch confirmation" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Please review the launch plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        from: { address: "team@example.com", name: "Team Inbox" },
        to: [{ address: "lina@example.com" }],
        subject: "Launch confirmation",
        bodyText: "Please review the launch plan.",
        source: "manual",
      });
    });
  });

  it("previews Hermes replies through compose preview without learning fields", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(screen.getByRole("button", { name: "Ask Hermes to draft reply" }));
    await screen.findByText(/Hermes 已生成回复草稿/);
    fireEvent.click(screen.getByRole("button", { name: "Preview composed draft" }));

    await waitFor(() => {
      expect(api.previewMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "client@example.com", name: "Live Client" }],
        cc: [],
        bcc: [],
        subject: "Re: Live subject",
        bodyText: "Hi,\n\nI can confirm this plan.",
        source: "hermes_reply",
        replyToMessageId: "message_1",
        sourceMessageId: "message_1",
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

  it("shows EmailEngine readiness in Sync Center", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailEngineHealth).mockResolvedValueOnce({
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
    });

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));

    expect(await screen.findByText("EmailEngine 上线还差配置")).toBeTruthy();
    expect(screen.getByText("运行探测")).toBeTruthy();
    expect(screen.getByText("不可达")).toBeTruthy();
    expect(screen.getByText("设置 EmailEngine 访问令牌")).toBeTruthy();
    expect(
      screen.getByText("EMAILENGINE_ACCESS_TOKEN / EENGINE_PREPARED_TOKEN"),
    ).toBeTruthy();
  });

  it("keeps EmailEngine readiness visible when older APIs omit runtime checks", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailEngineHealth).mockResolvedValueOnce({
      provider: "emailengine",
      ok: false,
      detail: "adapter boundary ready: http://emailengine:3000",
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
        setupActions: [],
      },
    });

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));

    expect(await screen.findByText("EmailEngine 上线还差配置")).toBeTruthy();
    expect(screen.getByText("运行探测")).toBeTruthy();
    expect(screen.getByText("未探测")).toBeTruthy();
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

  it("completes password reauthorization from Sync Center", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_password_1",
          email: "password-reauth@qq.com",
          provider: "qq",
          authMethod: "password",
          source: "account_transfer_import",
          username: "password-reauth@qq.com",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));
    expect(await screen.findByText("password-reauth@qq.com")).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("Reauthorization secret for password-reauth@qq.com"),
      { target: { value: "new-auth-code" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Complete reauthorization for password-reauth@qq.com",
      }),
    );

    await waitFor(() => {
      expect(api.completeSyncCenterImapSmtpReauthorization).toHaveBeenCalledWith({
        taskId: "task_password_1",
        username: "password-reauth@qq.com",
        secret: "new-auth-code",
      });
    });
    expect(await screen.findByText("password-reauth@qq.com 已恢复同步。")).toBeTruthy();
    expect(screen.queryByDisplayValue("new-auth-code")).toBeNull();
  });

  it("shows safe recovery guidance when password reauthorization diagnostics fail", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_password_1",
          email: "password-reauth@qq.com",
          provider: "qq",
          authMethod: "password",
          source: "account_transfer_import",
          username: "password-reauth@qq.com",
        }),
      ],
    });
    vi.mocked(api.completeSyncCenterImapSmtpReauthorization).mockRejectedValueOnce(
      new ApiRequestError(400, "reauthorization_failed", {
        error: "reauthorization_failed",
        provider: "qq",
        diagnostics: [
          {
            code: "qq_authorization_code_required",
            provider: "qq",
            severity: "action_required",
            affected: "account",
            message: "Use qq-auth-code-secret instead of password.",
            recoveryAction: "enable_qq_mail_authorization_code",
          },
        ],
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));
    expect(await screen.findByText("password-reauth@qq.com")).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("Reauthorization secret for password-reauth@qq.com"),
      { target: { value: "qq-auth-code-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Complete reauthorization for password-reauth@qq.com",
      }),
    );

    expect(await screen.findByText("需要 QQ 邮箱授权码")).toBeTruthy();
    expect(
      screen.getByText("请在 QQ 邮箱设置里开启服务并使用生成的授权码。"),
    ).toBeTruthy();
    expect(
      await screen.findByText("password-reauth@qq.com 重新授权没有通过，请按提示处理。"),
    ).toBeTruthy();

    const secretInput = screen.getByLabelText(
      "Reauthorization secret for password-reauth@qq.com",
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(secretInput.value).toBe("");
    });
    expect(screen.queryByText("qq_authorization_code_required")).toBeNull();
    expect(screen.queryByText("enable_qq_mail_authorization_code")).toBeNull();
    expect(screen.queryByText("qq-auth-code-secret")).toBeNull();
  });

  it("submits custom IMAP and SMTP settings for password reauthorization", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterReauthorizations).mockResolvedValueOnce({
      items: [
        reauthorizationTaskFixture({
          taskId: "task_custom_1",
          email: "custom@example.com",
          provider: "custom",
          authMethod: "password",
          source: "csv_import",
          username: "custom@example.com",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "同步中心" }));
    expect(await screen.findByText("custom@example.com")).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText("Use custom receiving and sending settings for custom@example.com"),
    );
    fireEvent.change(
      screen.getByLabelText("Reauthorization secret for custom@example.com"),
      { target: { value: "domain-app-password" } },
    );
    fireEvent.change(screen.getByLabelText("Receiving host for custom@example.com"), {
      target: { value: "imap.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Sending host for custom@example.com"), {
      target: { value: "smtp.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Sending port for custom@example.com"), {
      target: { value: "587" },
    });
    fireEvent.click(screen.getByLabelText("Sending secure connection for custom@example.com"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Complete reauthorization for custom@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.completeSyncCenterImapSmtpReauthorization).toHaveBeenCalledWith({
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
    });
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
    expect(screen.getByText("邮箱服务状态已更新")).toBeTruthy();
    expect(screen.getByText("系统已收到邮箱服务回调，正在按本地同步状态处理。")).toBeTruthy();
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
        qScopes: ["sender", "recipients", "subject", "body"],
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

  it("falls back to EmailEngine app-password onboarding when Gmail web login is unavailable", async () => {
    const api = createApiFixture();
    const oauthRedirect = vi.fn();
    vi.mocked(api.getMailProviderCapabilities).mockResolvedValueOnce({
      providers: [
        mailProviderCapabilityFixture({
          provider: "gmail",
          label: "Gmail",
          connectionLabel: "输入 Google 应用专用密码",
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
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(await screen.findByLabelText("Add mail email"), {
      target: { value: "owner@gmail.com" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "google-app-password" },
    });
    expect(await screen.findByText("输入 Google 应用专用密码")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "连接 Gmail" }));

    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
        email: "owner@gmail.com",
        provider: "gmail",
        secret: "google-app-password",
      });
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith({
      email: "owner@gmail.com",
      provider: "gmail",
      secret: "google-app-password",
    });
    expect(api.startOAuthAccount).not.toHaveBeenCalled();
    expect(oauthRedirect).not.toHaveBeenCalled();
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

  it("loads the aggregated smart inbox when no default account is provided", async () => {
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
      expect(api.listMessages).toHaveBeenCalledWith({
        limit: 50,
        sort: "smart",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "2f4f58af-7359-47f0-9158-1ef3a07fbc01",
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "account_1",
    });
  });

  it("uses each aggregated message account for detail reads and reader actions", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValueOnce({
      items: [
        {
          accountId: "account_1",
          email: "first@example.com",
          provider: "gmail",
          syncState: "syncing",
        },
        {
          accountId: "account_2",
          email: "second@example.com",
          provider: "outlook",
          syncState: "syncing",
        },
      ],
    });
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items:
        input.accountId === undefined
          ? [
              {
                id: "shared_message",
                accountId: "account_1",
                subject: "Account one subject",
                from: { email: "one@example.com", name: "One Sender" },
                receivedAt: "2026-06-13T10:00:00.000Z",
                snippet: "one snippet",
                unread: false,
                starred: false,
                mailboxIds: ["mailbox_inbox"],
                attachmentCount: 0,
                classification: {
                  bucket: "P2 Important",
                  priorityScore: 80,
                  reasons: ["First account"],
                },
              },
              {
                id: "shared_message",
                accountId: "account_2",
                subject: "Account two subject",
                from: { email: "two@example.com", name: "Two Sender" },
                receivedAt: "2026-06-13T10:05:00.000Z",
                snippet: "two snippet",
                unread: true,
                starred: false,
                mailboxIds: ["mailbox_inbox"],
                attachmentCount: 0,
                classification: {
                  bucket: "P1 Urgent",
                  priorityScore: 96,
                  reasons: ["Second account"],
                },
              },
            ]
          : [],
    }));
    vi.mocked(api.getMessage).mockImplementation(async (input) => ({
      id: input.messageId,
      accountId: input.accountId,
      subject:
        input.accountId === "account_2"
          ? "Account two subject"
          : "Account one subject",
      from: { email: `${input.accountId}@example.com` },
      receivedAt: "2026-06-13T10:05:00.000Z",
      snippet: "detail snippet",
      unread: input.accountId === "account_2",
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 0,
      classification: {
        bucket: input.accountId === "account_2" ? "P1 Urgent" : "P2 Important",
        priorityScore: input.accountId === "account_2" ? 96 : 80,
        reasons: [input.accountId],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText:
        input.accountId === "account_2"
          ? "Second account body"
          : "First account body",
      attachments: [],
    }));

    render(<App api={api} />);
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenCalledWith({
        limit: 50,
        sort: "smart",
      });
    });
    expect(
      (await screen.findAllByText("Account two subject")).length,
    ).toBeGreaterThan(0);

    await waitFor(() => {
      expect(api.getMessage).toHaveBeenLastCalledWith({
        accountId: "account_2",
        messageId: "shared_message",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Star selected message" }));
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenLastCalledWith({
        accountId: "account_2",
        messageId: "shared_message",
        action: "star",
      });
    });
    expect(screen.getByRole("button", { name: "Unstar selected message" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark selected message as read" }));
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenLastCalledWith({
        accountId: "account_2",
        messageId: "shared_message",
        action: "mark_read",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive selected message" }));
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenLastCalledWith({
        accountId: "account_2",
        messageId: "shared_message",
        action: "archive",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Account two subject")).toBeNull();
    });
    expect(screen.getAllByText("Account one subject").length).toBeGreaterThan(0);
  });

  it("clears a stale preview account from session storage before loading aggregated mail", async () => {
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
      expect(api.listMessages).toHaveBeenCalledWith({
        limit: 50,
        sort: "smart",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "account_1",
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBeNull();
  });

  it("clears a missing session account before loading aggregated mail", async () => {
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
      expect(api.listMessages).toHaveBeenCalledWith({
        limit: 50,
        sort: "smart",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "deleted-account",
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBeNull();
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

  it("surfaces EmailEngine production setup gaps from Add Mail", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailEngineHealth).mockResolvedValueOnce({
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
    });

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );

    expect(await screen.findByText("EmailEngine 上线还差配置")).toBeTruthy();
    expect(screen.getByText("运行探测")).toBeTruthy();
    expect(screen.getByText("不可达")).toBeTruthy();
    expect(screen.getByText("设置 EmailEngine 访问令牌")).toBeTruthy();
    expect(
      screen.getByText("EMAILENGINE_ACCESS_TOKEN / EENGINE_PREPARED_TOKEN"),
    ).toBeTruthy();
    expect(
      screen.getByText("添加邮箱、附件下载、发信和同步任务会失败。"),
    ).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain("super-secret-token");
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
    expect(
      await screen.findByText("163 邮箱 连接检查没有通过，请按提示处理。"),
    ).toBeTruthy();
    expect(await screen.findByText("需要 163 邮箱授权码")).toBeTruthy();
    expect(
      screen.getByText("请在 163 邮箱设置里开启客户端授权并使用生成的授权码。"),
    ).toBeTruthy();

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
    fireEvent.change(screen.getByLabelText("Custom send host"), {
      target: { value: "smtp.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "测试并接入个人域名邮箱" }));

    expect(
      await screen.findByText(
        "个人域名邮箱 连接检查没有通过，请检查邮箱地址、授权码和收发信服务器。",
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
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 Proton Mail" }));

    expect(await screen.findByText("Proton Bridge 未连接")).toBeTruthy();
    expect(
      screen.getByText("请启动 Proton Bridge 并保持登录后重试。"),
    ).toBeTruthy();
    expect(api.onboardImapSmtpAccount).not.toHaveBeenCalled();

    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("ECONNREFUSED");
    expect(pageText).not.toContain("127.0.0.1");
    expect(pageText).not.toContain("proton_bridge_unreachable");
    expect(pageText).not.toContain("start_proton_bridge");
    expect(pageText).not.toContain("bridge-password");
    expect(screen.queryByDisplayValue("bridge-password")).toBeNull();
  });

  it("keeps Proton Bridge provider id when the capability catalog falls back", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMailProviderCapabilities).mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "添加邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("Add mail email"), {
      target: { value: "me@proton.me" },
    });
    fireEvent.change(screen.getByLabelText("Add mail secret"), {
      target: { value: "bridge-password" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "连接 Proton Mail" }));

    await waitFor(() => {
      expect(api.testImapSmtpConnection).toHaveBeenCalledWith({
        email: "me@proton.me",
        provider: "proton_bridge",
        secret: "bridge-password",
      });
    });
    expect(api.onboardImapSmtpAccount).toHaveBeenCalledWith({
      email: "me@proton.me",
      provider: "proton_bridge",
      secret: "bridge-password",
    });
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

    expect(
      await screen.findByText(
        "QQ 邮箱 暂时无法接入，连接信息未保存。请重新检查授权码或稍后再试。",
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

    expect((await screen.findAllByText(/demo\.site/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("owner@example.net")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("support@demo.site")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/已送达/)).toBeTruthy();
    expect(api.listDomains).toHaveBeenCalled();
    expect(api.listDomainDestinations).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.listDomainAliases).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.getDomainCatchAll).toHaveBeenCalledWith({
      domainId: "domain_1",
    });
    expect(api.listDomainDeliveryLogs).toHaveBeenCalledWith({
      domainId: "domain_1",
      limit: 20,
    });
  });

  it("configures domains, forwarding targets, aliases, and catch-all from Settings", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(
      within(screen.getByLabelText("设置目录")).getByRole("button", {
        name: "域名管理",
      }),
    );

    await screen.findByText("emailhub-domain-verification=domain_1");

    fireEvent.change(screen.getByLabelText("Domain name"), {
      target: { value: "demo.site" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加域名" }));

    await waitFor(() => {
      expect(api.createDomain).toHaveBeenCalledWith({ domain: "demo.site" });
    });

    fireEvent.change(screen.getByLabelText("Domain destination email"), {
      target: { value: "ops@example.net" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加目标邮箱" }));

    await waitFor(() => {
      expect(api.createDomainDestination).toHaveBeenCalledWith({
        domainId: "domain_1",
        email: "ops@example.net",
      });
    });

    fireEvent.change(screen.getByLabelText("Domain alias local part"), {
      target: { value: "ops" },
    });
    fireEvent.change(screen.getByLabelText("Domain alias destination"), {
      target: { value: "dest_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建别名" }));

    await waitFor(() => {
      expect(api.createDomainAlias).toHaveBeenCalledWith({
        domainId: "domain_1",
        localPart: "ops",
        destinationIds: ["dest_1"],
      });
    });

    fireEvent.change(screen.getByLabelText("Domain catch-all mode"), {
      target: { value: "forward" },
    });
    fireEvent.change(screen.getByLabelText("Domain catch-all destination"), {
      target: { value: "dest_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 Catch-all" }));

    await waitFor(() => {
      expect(api.setDomainCatchAll).toHaveBeenCalledWith({
        domainId: "domain_1",
        mode: "forward",
        destinationIds: ["dest_1"],
      });
    });
    expect(await screen.findByText(/Catch-all 已设置为转发/)).toBeTruthy();
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

  it("adds and verifies an Outlook shared sender candidate from compose", async () => {
    const api = createApiFixture();
    const accountIdentity = {
      id: "account:account_1",
      accountId: "account_1",
      from: { address: "work@demo.site", name: "Work" },
      source: "account" as const,
      isDefault: true,
      verified: true,
    };
    const pendingCandidate = {
      id: "provider:identity_candidate",
      accountId: "account_1",
      from: { address: "shared@example.com", name: "Shared" },
      source: "provider_native" as const,
      isDefault: false,
      verified: false,
      provider: "graph",
      providerIdentityId: "shared@example.com",
      identityType: "shared_mailbox" as const,
      verificationState: "pending" as const,
      enabled: false,
    };
    const verifiedCandidate = {
      ...pendingCandidate,
      verified: true,
      verificationState: "verified" as const,
      enabled: true,
    };
    const targetVerifiedCandidate = {
      ...verifiedCandidate,
      sendMailTargetMode: "users" as const,
      userSendMailEligible: true,
      targetMailbox: {
        userPrincipalName: "shared-mailbox@example.com",
      },
      sentItemsBehavior: "from_mailbox" as const,
    };
    const verifiedIdentity = {
      id: "provider:identity_candidate",
      accountId: "account_1",
      from: { address: "shared@example.com", name: "Shared" },
      source: "provider_native" as const,
      isDefault: false,
      verified: true,
      provider: "graph",
      providerIdentityId: "shared@example.com",
      identityType: "shared_mailbox" as const,
    };

    vi.mocked(api.listSendIdentities)
      .mockResolvedValueOnce({
        accountId: "account_1",
        items: [accountIdentity],
        candidates: [],
      })
      .mockResolvedValueOnce({
        accountId: "account_1",
        items: [accountIdentity, verifiedIdentity],
        candidates: [verifiedCandidate],
      })
      .mockResolvedValueOnce({
        accountId: "account_1",
        items: [accountIdentity, verifiedIdentity],
        candidates: [targetVerifiedCandidate],
      });
    vi.mocked(api.addProviderSendIdentityCandidate).mockResolvedValue(
      pendingCandidate,
    );
    vi.mocked(api.verifyProviderSendIdentityCandidate).mockResolvedValue({
      accountId: "account_1",
      verified: true,
      candidate: verifiedCandidate,
    });
    vi.mocked(api.verifyProviderSendIdentityUserTarget).mockResolvedValue({
      accountId: "account_1",
      verified: true,
      candidate: targetVerifiedCandidate,
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("Outlook shared sender address"), {
      target: { value: "shared@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Outlook shared sender name"), {
      target: { value: "Shared" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Outlook shared sender candidate",
      }),
    );

    await waitFor(() => {
      expect(api.addProviderSendIdentityCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        provider: "graph",
        address: "shared@example.com",
        name: "Shared",
        identityType: "shared_mailbox",
      });
    });
    expect(await screen.findByText("待验证")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Verify Outlook shared sender shared@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.verifyProviderSendIdentityCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "provider:identity_candidate",
      });
    });
    expect(await screen.findByText(/共享发件人已验证：shared@example.com/)).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: /Shared <shared@example.com> · Outlook共享邮箱/,
      }),
    ).toBeTruthy();

    fireEvent.change(
      screen.getByLabelText("Outlook shared mailbox target shared@example.com"),
      {
        target: { value: "shared-mailbox@example.com" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Verify Outlook shared mailbox target shared@example.com",
      }),
    );

    await waitFor(() => {
      expect(api.verifyProviderSendIdentityUserTarget).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "provider:identity_candidate",
        targetMailbox: "shared-mailbox@example.com",
      });
    });
    expect(
      await screen.findByText(/共享发件箱 Sent Items 已启用：shared-mailbox@example.com/),
    ).toBeTruthy();
    expect(await screen.findByText("共享发件箱已启用")).toBeTruthy();
  });

  it("updates the saved composed draft instead of creating duplicates", async () => {
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
      target: { value: "Initial draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    expect(await screen.findByText(/草稿已保存：draft_1/)).toBeTruthy();
    expect(await screen.findByText(/草稿：draft_1/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Updated draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Updated draft body.",
        source: "manual",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/草稿已更新：draft_1/)).toBeTruthy();
  });

  it("sends a saved composed draft after updating the same draft id", async () => {
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
      target: { value: "Initial draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await screen.findByText(/草稿已保存：draft_1/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Ready to send body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Ready to send body.",
        source: "manual",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateMailDraft).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0],
    );
  });

  it("does not send or recreate a saved draft when updating it fails", async () => {
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
      target: { value: "Initial draft body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await screen.findByText(/草稿已保存：draft_1/);

    vi.mocked(api.updateMailDraft).mockRejectedValueOnce(new Error("conflict"));
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "This update will fail." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "This update will fail.",
        source: "manual",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("写信操作失败，请稍后再试。")).toBeTruthy();
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

  it("adds uploaded files to the composed draft payload", async () => {
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
    fireEvent.change(screen.getByLabelText("Attach files to compose"), {
      target: {
        files: [new File(["hello"], "brief.txt", { type: "text/plain" })],
      },
    });

    expect(await screen.findByText("brief.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.uploadComposeAttachment).toHaveBeenCalledWith({
        accountId: "account_1",
        file: expect.objectContaining({
          name: "brief.txt",
          size: 5,
          type: "text/plain",
        }),
      });
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Please review the launch plan.",
        source: "manual",
        attachments: [
          expect.objectContaining({
            source: "uploaded_file",
            filename: "brief.txt",
            contentType: "text/plain",
            byteSize: 5,
            inline: false,
            storageKey: "11111111-1111-4111-8111-111111111111",
          }),
        ],
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
        hermesSkillRunId: "run_rewrite_1",
        hermesDraftText: "Hi Lina,\n\nPlease review the launch plan today.",
      });
    });
  });

  it("keeps the Hermes polished text when the user edits before saving", async () => {
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
      expect(api.rewritePolishDraft).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Hi Lina,\n\nPlease review the launch plan today. Thanks." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Hi Lina,\n\nPlease review the launch plan today. Thanks.",
        source: "manual",
        hermesSkillRunId: "run_rewrite_1",
        hermesDraftText: "Hi Lina,\n\nPlease review the launch plan today.",
      });
    });
  });

  it("sends Hermes-polished composed drafts with rewrite metadata", async () => {
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
      expect(api.rewritePolishDraft).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.createMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        to: [{ address: "lina@example.com" }],
        subject: "Launch plan",
        bodyText: "Hi Lina,\n\nPlease review the launch plan today.",
        source: "manual",
        hermesSkillRunId: "run_rewrite_1",
        hermesDraftText: "Hi Lina,\n\nPlease review the launch plan today.",
      });
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
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

  it("schedules a saved composed draft after updating the same draft id", async () => {
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
      target: { value: "Initial scheduled body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));
    await screen.findByText(/草稿已保存：draft_1/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Updated scheduled body." },
    });
    fireEvent.change(screen.getByLabelText("Compose scheduled time"), {
      target: { value: "2026-06-14T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule composed draft" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        to: [{ address: "lina@example.com" }],
        subject: "Tomorrow review",
        bodyText: "Updated scheduled body.",
        source: "manual",
      });
    });
    await waitFor(() => {
      expect(api.scheduleMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-14T09:30:00.000Z",
      });
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(api.updateMailDraft).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.scheduleMailDraft).mock.invocationCallOrder[0]);
  });

  it("auto-saves new composed drafts after the user pauses", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Auto saved subject" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Auto save this draft after a pause." },
    });

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.createMailDraft).toHaveBeenCalledWith({
      accountId: "account_1",
      to: [{ address: "lina@example.com" }],
      subject: "Auto saved subject",
      bodyText: "Auto save this draft after a pause.",
      source: "manual",
    });
    expect(screen.getByText(/已自动保存/)).toBeTruthy();
    expect(api.listMailDrafts).toHaveBeenCalledTimes(2);
  });

  it("auto-saves edits to a loaded saved draft without creating a replacement", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("Saved subject");
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit saved draft draft_saved" }),
    );

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.updateMailDraft).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Autosaved edited body." },
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.updateMailDraft).toHaveBeenCalledWith({
      accountId: "account_1",
      draftId: "draft_saved",
      to: [{ address: "client@example.com", name: "Client" }],
      subject: "Saved subject",
      bodyText: "Autosaved edited body.",
      source: "manual",
      replyToMessageId: "message_1",
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("does not auto-save scheduled outbox draft edits", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit scheduled draft schedule_1" }),
    );
    await screen.findByText(/待发草稿已载入：schedule_1/);
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Scheduled body should not auto-save." },
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.updateScheduledDraft).not.toHaveBeenCalled();
    expect(api.updateMailDraft).not.toHaveBeenCalled();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("does not auto-save again after sending clears the compose form", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Compose recipients"), {
      target: { value: "lina@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Compose subject"), {
      target: { value: "Send without trailing autosave" },
    });
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send this body now." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.sendMailDraft).toHaveBeenCalledWith({
      accountId: "account_1",
      draftId: "draft_1",
    });

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(api.createMailDraft).toHaveBeenCalledTimes(1);
    expect(api.updateMailDraft).not.toHaveBeenCalled();
  });

  it("loads saved compose drafts into the compose panel for editing", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
          updatedAt: "2026-06-13T11:00:00.000Z",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("Saved subject");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit saved draft draft_saved" }),
    );

    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Saved subject",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Saved body.",
    );
    expect(screen.getAllByText(/草稿：draft_saved/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Edited saved body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_saved",
        to: [{ address: "client@example.com", name: "Client" }],
        subject: "Saved subject",
        bodyText: "Edited saved body.",
        source: "manual",
        replyToMessageId: "message_1",
      });
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api.listMailDrafts).toHaveBeenCalledTimes(2);
    });
  });

  it("sends a loaded saved draft after updating the same draft id", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailDrafts).mockResolvedValue({
      accountId: "account_1",
      items: [
        mailDraftFixture({
          id: "draft_saved",
          subject: "Saved subject",
          bodyText: "Saved body.",
        }),
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("Saved subject");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit saved draft draft_saved" }),
    );
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send edited saved body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateMailDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          draftId: "draft_saved",
          bodyText: "Send edited saved body.",
        }),
      );
    });
    await waitFor(() => {
      expect(api.sendMailDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        draftId: "draft_saved",
      });
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
    expect(
      vi.mocked(api.updateMailDraft).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(api.sendMailDraft).mock.invocationCallOrder[0]);
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

  it("loads an outbox draft into the compose panel for editing", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit scheduled draft schedule_1" }),
    );

    await waitFor(() => {
      expect(api.getScheduledDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });
    expect((screen.getByLabelText("Compose subject") as HTMLInputElement).value).toBe(
      "Scheduled subject",
    );
    expect((screen.getByLabelText("Compose body") as HTMLTextAreaElement).value).toBe(
      "Scheduled body",
    );
    expect((screen.getByLabelText("Compose recipients") as HTMLInputElement).value).toBe(
      "Client <client@example.com>",
    );
    expect(screen.getByText(/待发：schedule_1/)).toBeTruthy();
    expect(screen.getByText("plan.pdf")).toBeTruthy();
  });

  it("updates an edited outbox draft without creating a replacement", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit scheduled draft schedule_1" }),
    );
    await screen.findByText(/待发草稿已载入：schedule_1/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Edited scheduled body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save composed draft" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        to: [{ address: "client@example.com", name: "Client" }],
        subject: "Scheduled subject",
        bodyText: "Edited scheduled body.",
        source: "manual",
        replyToMessageId: "message_1",
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
    });
    expect(api.createMailDraft).not.toHaveBeenCalled();
    expect(api.updateMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText(/待发草稿已更新：draft_1/)).toBeTruthy();
  });

  it("sends an edited outbox draft through the scheduled item", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit scheduled draft schedule_1" }),
    );
    await screen.findByText(/待发草稿已载入：schedule_1/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Send the edited scheduled body now." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          scheduledId: "schedule_1",
          bodyText: "Send the edited scheduled body now.",
        }),
      );
    });
    await waitFor(() => {
      expect(api.sendScheduledNow).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
      });
    });
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("reschedules an edited outbox draft after updating the same scheduled id", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit scheduled draft schedule_1" }),
    );
    await screen.findByText(/待发草稿已载入：schedule_1/);

    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "Edited then rescheduled body." },
    });
    fireEvent.change(screen.getByLabelText("Compose scheduled time"), {
      target: { value: "2026-06-14T12:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule composed draft" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          scheduledId: "schedule_1",
          bodyText: "Edited then rescheduled body.",
        }),
      );
    });
    await waitFor(() => {
      expect(api.rescheduleScheduledSend).toHaveBeenCalledWith({
        accountId: "account_1",
        scheduledId: "schedule_1",
        scheduledAt: "2026-06-14T12:30:00.000Z",
      });
    });
    expect(api.scheduleMailDraft).not.toHaveBeenCalled();
    expect(api.createMailDraft).not.toHaveBeenCalled();
  });

  it("does not send an outbox draft when updating it fails", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByText("draft_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit scheduled draft schedule_1" }),
    );
    await screen.findByText(/待发草稿已载入：schedule_1/);

    vi.mocked(api.updateScheduledDraft).mockRejectedValueOnce(
      new Error("scheduled draft was claimed"),
    );
    fireEvent.change(screen.getByLabelText("Compose body"), {
      target: { value: "This update will fail." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send composed draft now" }));

    await waitFor(() => {
      expect(api.updateScheduledDraft).toHaveBeenCalled();
    });
    expect(api.sendScheduledNow).not.toHaveBeenCalled();
    expect(api.sendMailDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("写信操作失败，请稍后再试。")).toBeTruthy();
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
    downloadAttachment: vi.fn(async () => ({
      blob: new Blob(["proposal"], { type: "application/pdf" }),
      filename: "proposal.pdf",
      contentType: "application/pdf",
    })),
    applyMailAction: vi.fn(async (input) => ({
      accountId: input.accountId,
      messageId: input.messageId,
      action: input.action,
      state: {
        unread:
          input.action === "mark_read"
            ? false
            : input.action === "mark_unread"
              ? true
              : true,
        starred: input.action === "star" ? true : false,
        archived: input.action === "done" || input.action === "archive",
        deleted: input.action === "trash",
        mailboxIds:
          input.action === "done" ||
          input.action === "archive" ||
          input.action === "trash"
            ? []
            : ["mailbox_inbox"],
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
    listHermesMemories: vi.fn(async () => ({
      items: [
        {
          id: "memory_1",
          layer: "writing_style_profile",
          scope: "global",
          content: {
            preference: "Keep replies concise.",
          },
          confidence: 0.82,
          createdAt: "2026-06-14T08:00:00.000Z",
          updatedAt: "2026-06-14T09:00:00.000Z",
        },
      ],
    })),
    updateHermesMemory: vi.fn(async (input) => ({
      id: input.id,
      layer: "writing_style_profile",
      scope: "global",
      content: input.content ?? { preference: "Keep replies concise." },
      confidence: input.confidence ?? 0.82,
      createdAt: "2026-06-14T08:00:00.000Z",
      updatedAt: "2026-06-14T10:00:00.000Z",
    })),
    deleteHermesMemory: vi.fn(async () => undefined),
    previewAccountCsv: vi.fn(async () => ({
      summary: {
        totalRows: 3,
        ready: 1,
        needsOAuth: 1,
        disabled: 0,
        invalid: 1,
      },
      rows: [
        {
          rowNumber: 2,
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password" as const,
          status: "ready" as const,
          errors: [],
          warnings: [],
        },
        {
          rowNumber: 3,
          email: "owner@gmail.com",
          provider: "gmail",
          authMethod: "oauth" as const,
          status: "needs_oauth" as const,
          errors: [],
          warnings: [],
        },
        {
          rowNumber: 4,
          email: "bad",
          provider: "qq",
          authMethod: "password" as const,
          status: "invalid" as const,
          errors: ["email is invalid"],
          warnings: [],
        },
      ],
    })),
    createAccountCsvImport: vi.fn(async () => ({
      summary: {
        totalRows: 3,
        ready: 1,
        needsOAuth: 1,
        disabled: 0,
        invalid: 1,
      },
      rows: [
        {
          rowNumber: 2,
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password" as const,
          status: "ready" as const,
          errors: [],
          warnings: [],
        },
        {
          rowNumber: 3,
          email: "owner@gmail.com",
          provider: "gmail",
          authMethod: "oauth" as const,
          status: "needs_oauth" as const,
          errors: [],
          warnings: [],
        },
        {
          rowNumber: 4,
          email: "bad",
          provider: "qq",
          authMethod: "password" as const,
          status: "invalid" as const,
          errors: ["email is invalid"],
          warnings: [],
        },
      ],
      createdTaskCount: 2,
      tasks: [
        {
          rowNumber: 2,
          id: "task_csv_1",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          status: "pending",
        },
        {
          rowNumber: 3,
          id: "task_csv_2",
          email: "owner@gmail.com",
          provider: "gmail",
          authMethod: "oauth",
          status: "pending",
        },
      ],
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
    completeSyncCenterImapSmtpReauthorization: vi.fn(async (input) => ({
      task: {
        id: input.taskId,
        email: "password-reauth@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "account_password_reauth",
        email: "password-reauth@qq.com",
        provider: "qq",
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    })),
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
    getMailEngineHealth: vi.fn(
      async () =>
        ({
          provider: "emailengine",
          ok: true,
          detail: "adapter boundary ready: http://emailengine:3000",
          checks: {
            url: "configured",
            http: "ok",
            accessToken: "configured",
            webhookSecret: "custom",
          },
          capabilities: {
            urlConfigured: true,
            accessTokenConfigured: true,
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          missing: [],
          warnings: [],
          readiness: {
            status: "ready",
            summary: "EmailEngine 已具备上线配置。",
            setupActions: [],
          },
        }) satisfies MailEngineHealthDto,
    ),
    createDomain: vi.fn(async () => ({
      id: "domain_1",
      domain: "demo.site",
      verificationStatus: "pending",
      dnsRecords: {
        ownershipTxt: {
          type: "TXT",
          name: "_emailhub.demo.site",
          value: "emailhub-domain-verification=domain_1",
        },
        mx: {
          type: "MX",
          name: "demo.site",
          value: "10 mx.emailhub.local",
        },
      },
      createdAt: "2026-06-13T08:00:00.000Z",
    })),
    listDomains: vi.fn(async () => ({
      items: [
        {
          id: "domain_1",
          domain: "demo.site",
          verificationStatus: "pending",
          dnsRecords: {
            ownershipTxt: {
              type: "TXT",
              name: "_emailhub.demo.site",
              value: "emailhub-domain-verification=domain_1",
            },
            mx: {
              type: "MX",
              name: "demo.site",
              value: "10 mx.emailhub.local",
            },
          },
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    })),
    createDomainDestination: vi.fn(async (input) => ({
      id: "dest_1",
      domainId: input.domainId,
      email: input.email,
      verified: false,
      createdAt: "2026-06-13T08:00:00.000Z",
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
    createDomainAlias: vi.fn(async (input) => ({
      id: "alias_2",
      domainId: input.domainId,
      address: `${input.localPart}@demo.site`,
      localPart: input.localPart,
      enabled: true,
      destinationIds: input.destinationIds,
      createdAt: "2026-06-13T08:00:00.000Z",
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
    setDomainCatchAll: vi.fn(async (input) => ({
      id: "rule_1",
      domainId: input.domainId,
      ruleType: "catch_all" as const,
      enabled: true,
      config: {
        mode: input.mode,
        ...(input.destinationIds ? { destinationIds: input.destinationIds } : {}),
      },
      createdAt: "2026-06-13T08:00:00.000Z",
    })),
    getDomainCatchAll: vi.fn(async () => ({
      item: {
        id: "rule_1",
        domainId: "domain_1",
        ruleType: "catch_all" as const,
        enabled: true,
        config: { mode: "reject" as const },
        createdAt: "2026-06-13T08:00:00.000Z",
      },
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
    searchMailWithHermes: vi.fn(async () => ({
      skillRunId: "run_search_1",
      skillId: "email_search_qa",
      answerText: "Lina mentioned the signed contract in the latest thread.",
      searchQuery: "signed contract",
      matches: [
        {
          id: "message_1",
          accountId: "account_1",
          subject: "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "Live snippet",
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["Direct to you"],
          },
        },
      ],
      citations: [
        {
          resultIndex: 1,
          messageId: "message_1",
          accountId: "account_1",
          subject: "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "Live snippet",
          bucket: "P1 Urgent",
          reasons: ["Direct to you"],
        },
      ],
    } satisfies HermesEmailSearchQaResult)),
    triagePriorityWithHermes: vi.fn(async () => ({
      skillRunId: "run_priority_1",
      skillId: "priority_triage",
      priority: "high",
      bucket: "P1 Urgent",
      score: 94,
      reasons: ["deadline today", "direct to you"],
      explanation: "Needs a reply today.",
    } satisfies HermesPriorityTriageResult)),
    suggestLabelsWithHermes: vi.fn(async () => ({
      skillRunId: "run_labels_1",
      skillId: "label_suggest",
      labels: [{ name: "客户", confidence: 0.92, reason: "client thread" }],
      actions: [
        { type: "apply_label", label: "客户", reason: "high confidence" },
      ],
    } satisfies HermesLabelSuggestResult)),
    cleanupNewsletterWithHermes: vi.fn(async () => ({
      skillRunId: "run_newsletter_1",
      skillId: "newsletter_cleanup",
      isNewsletter: false,
      confidence: 0.88,
      senderCategory: "personal",
      reasons: ["direct conversation"],
      actions: [{ type: "keep_in_inbox", reason: "needs reply" }],
    } satisfies HermesNewsletterCleanupResult)),
    extractActionItemsWithHermes: vi.fn(async () => ({
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
    } satisfies HermesActionItemExtractResult)),
    translateText: vi.fn(async () => ({
      skillRunId: "run_translate_1",
      skillId: "translate_text",
      sourceLanguage: "auto",
      targetLanguage: "Chinese",
      translatedText: "你好，请确认发布计划。",
    } satisfies HermesTranslateTextResult)),
    summarizeThread: vi.fn(async () => ({
      skillRunId: "run_summary_1",
      skillId: "thread_summarize",
      mode: "action_points",
      summaryText: "需要确认发布时间，并在今天回复 Lina。",
    } satisfies HermesThreadSummaryResult)),
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
    uploadComposeAttachment: vi.fn(async (input) => ({
      id: "upload_11111111-1111-4111-8111-111111111111",
      source: "uploaded_file" as const,
      attachmentId: "upload_11111111-1111-4111-8111-111111111111",
      storageKey: "11111111-1111-4111-8111-111111111111",
      filename: input.file.name || "attachment",
      contentType: input.file.type || "application/octet-stream",
      byteSize: input.file.size,
      inline: false,
    })),
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
        {
          id: "provider:identity_1",
          accountId: "account_1",
          from: { address: "team@example.com", name: "Team Inbox" },
          source: "provider_native" as const,
          isDefault: false,
          verified: true,
          provider: "graph",
          providerIdentityId: "shared-mailbox/team",
          identityType: "shared_mailbox" as const,
        },
      ],
    })),
    addProviderSendIdentityCandidate: vi.fn(async (input) => ({
      id: "provider:identity_candidate",
      accountId: input.accountId,
      from: {
        address: input.address.toLowerCase(),
        ...(input.name ? { name: input.name } : {}),
      },
      source: "provider_native" as const,
      isDefault: false,
      verified: false,
      provider: "graph",
      providerIdentityId: input.address.toLowerCase(),
      identityType: input.identityType,
      verificationState: "pending" as const,
      enabled: false,
    })),
    verifyProviderSendIdentityCandidate: vi.fn(async (input) => ({
      accountId: input.accountId,
      verified: true,
      candidate: {
        id: input.candidateId,
        accountId: input.accountId,
        from: { address: "shared@example.com", name: "Shared" },
        source: "provider_native" as const,
        isDefault: false,
        verified: true,
        provider: "graph",
        providerIdentityId: "shared@example.com",
        identityType: "shared_mailbox" as const,
        verificationState: "verified" as const,
        enabled: true,
      },
    })),
    verifyProviderSendIdentityUserTarget: vi.fn(async (input) => ({
      accountId: input.accountId,
      verified: true,
      candidate: {
        id: input.candidateId,
        accountId: input.accountId,
        from: { address: "shared@example.com", name: "Shared" },
        source: "provider_native" as const,
        isDefault: false,
        verified: true,
        provider: "graph",
        providerIdentityId: "shared@example.com",
        identityType: "shared_mailbox" as const,
        verificationState: "verified" as const,
        enabled: true,
        sendMailTargetMode: "users" as const,
        userSendMailEligible: true,
        targetMailbox: {
          userPrincipalName: input.targetMailbox,
        },
        sentItemsBehavior: "from_mailbox" as const,
      },
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
    listMailDrafts: vi.fn(async () => ({
      accountId: "account_1",
      items: [],
    })),
    updateMailDraft: vi.fn(async (input) =>
      mailDraftFixture({
        id: input.draftId,
        accountId: input.accountId,
        ...(input.from ? { from: input.from } : {}),
        to: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject ?? "",
        ...(input.bodyText ? { bodyText: input.bodyText } : {}),
        ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
        source: input.source ?? "manual",
        ...(input.replyToMessageId
          ? { replyToMessageId: input.replyToMessageId }
          : {}),
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        ...(input.attachments ? { attachments: input.attachments } : {}),
        ...(input.hermesSkillRunId
          ? { hermesSkillRunId: input.hermesSkillRunId }
          : {}),
        ...(input.hermesDraftText ? { hermesDraftText: input.hermesDraftText } : {}),
      }),
    ),
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
    getScheduledDraft: vi.fn(async () => ({
      scheduledSend: scheduledSendFixture(),
      draft: mailDraftFixture({
        status: "scheduled",
        subject: "Scheduled subject",
        bodyText: "Scheduled body",
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
    })),
    updateScheduledDraft: vi.fn(async (input) => ({
      scheduledSend: scheduledSendFixture({
        id: input.scheduledId,
      }),
      draft: mailDraftFixture({
        status: "scheduled",
        accountId: input.accountId,
        to: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject ?? "",
        ...(input.bodyText ? { bodyText: input.bodyText } : {}),
        ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
        source: input.source ?? "manual",
        ...(input.attachments ? { attachments: input.attachments } : {}),
      }),
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

function restoreUrlDownloadMethod(
  method: "createObjectURL" | "revokeObjectURL",
  original:
    | typeof URL.createObjectURL
    | typeof URL.revokeObjectURL
    | undefined,
): void {
  if (original) {
    Object.defineProperty(URL, method, {
      configurable: true,
      value: original,
    });
    return;
  }

  Reflect.deleteProperty(URL, method);
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
