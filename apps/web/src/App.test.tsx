import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  createApiFixture,
  createDefaultMessageDetail,
  followUpFixture,
  hermesOrganizationResult,
  hermesSkillFixture,
  mailDraftFixture,
  mockTwoMessageReader,
  openAdvancedSenderPanel,
  openComposeWindow,
  restoreUrlDownloadMethod,
  scheduledSendFixture,
} from "./test/appTestFixtures";
import type {
  AttachmentDownload,
  ComposeAttachmentMaintenanceCleanupResultDto,
  ComposeAttachmentMaintenanceStatusDto,
  EmailHubApi,
  ApiHealthDto,
  FollowUpDto,
  FollowUpPage,
  HermesActionItemExtractResult,
  HermesActionPlanDto,
  HermesActionPlanConfirmationDto,
  HermesEmailSearchQaResult,
  HermesFollowupTrackerResult,
  HermesLabelSuggestResult,
  HermesMessageFollowupTrackerResult,
  HermesMessageQuickReplyResult,
  HermesMessageOrganizationResult,
  HermesMessageReplyDraftResult,
  HermesMessageSummaryResult,
  HermesMessageTranslationResult,
  HermesNewsletterCleanupResult,
  HermesPriorityTriageResult,
  HermesQuickReplyResult,
  HermesReplyDraftResult,
  HermesRewritePolishResult,
  HermesRetentionMaintenanceCleanupResultDto,
  HermesRetentionMaintenanceStatusDto,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleExecutionDto,
  HermesRuleSimulationDto,
  HermesResourceProfileDto,
  HermesSkillDto,
  HermesThreadSummaryResult,
  HermesTranslationPreferenceResult,
  HermesTranslateTextResult,
  HermesWorkspaceContextDto,
  MailNavigationSummaryDto,
  MailEngineHealthDto,
  MessageDetailDto,
  MailProviderCapabilityDto,
  MailActionResult,
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
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  function openSearchPageFromTopbar(query = "") {
    fireEvent.change(screen.getByLabelText("全局搜索邮件"), {
      target: { value: query },
    });
    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));
  }

  async function selectCredentialProvider(providerTitle: string) {
    fireEvent.click(
      await screen.findByRole("button", { name: `连接 ${providerTitle}` }),
    );
    await screen.findByLabelText("Add mail secret");
  }

  function submitCredentialProvider(providerTitle: string) {
    fireEvent.click(
      screen.getByRole("button", { name: `接入${providerTitle}` }),
    );
  }

  it("keeps global functions in the left sidebar and mail folders in the second column", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".mail-grid")?.className).toContain("outlook-layout");

    const globalNav = screen.getByRole("navigation");
    const navLabels = within(globalNav).getAllByRole("button").map((button) => button.textContent ?? "");
    expect(navLabels).toContain("邮箱128");
    expect(navLabels).toContain("添加邮箱");
    expect(navLabels).not.toContain("搜索");
    expect(navLabels).toContain("Hermes");
    expect(navLabels).toContain("配置域名");
    expect(navLabels).not.toContain("设置");
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
    expect(navLabels).not.toContain("同步中心");
    expect(navLabels).not.toContain("待办9");
    expect(screen.getByRole("search", { name: "全局邮件搜索" })).toBeTruthy();

    const directory = screen.getByLabelText("邮箱目录栏");
    expect(within(directory).getByRole("button", { name: /收件箱/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /草稿/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /已发送/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /归档/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /垃圾邮件/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /已删除/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /附件/ })).toBeTruthy();
  });

  it("does not show preview mailbox counts before backend data loads", () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);

    const directory = screen.getByLabelText("邮箱目录栏");
    expect(within(directory).queryByRole("button", { name: /收件箱\s*128/ })).toBeNull();
    expect(within(directory).queryByRole("button", { name: /所有邮件\s*912/ })).toBeNull();
    expect(within(directory).getByRole("button", { name: /收件箱\s*0/ })).toBeTruthy();
    expect(within(directory).getByRole("button", { name: /所有邮件\s*0/ })).toBeTruthy();
  });

  it("keeps Outlook virtual folders available inside a selected account", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    const directory = screen.getByLabelText("邮箱目录栏");
    fireEvent.click(
      await within(directory).findByRole("button", { name: /附件\s*0/ }),
    );
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        hasAttachment: true,
        limit: 50,
        sort: "time",
      });
    });

    fireEvent.click(
      await within(directory).findByRole("button", { name: /稍后提醒\s*0/ }),
    );
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        quickFilters: ["snoozed"],
        limit: 50,
        sort: "time",
      });
    });
  });

  it("keeps aggregate navigation counts after aggregate messages finish loading", async () => {
    const api = createApiFixture();
    let resolveMessages:
      | ((value: Awaited<ReturnType<EmailHubApi["listMessages"]>>) => void)
      | undefined;

    vi.mocked(api.getMailNavigationSummary).mockResolvedValue({
      folders: [
        { id: "inbox", label: "收件箱", count: 36 },
        { id: "all", label: "所有邮件", count: 36 },
      ],
      providerGroups: [],
      quickCategories: [],
    });
    vi.mocked(api.listMessages).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMessages = resolve;
        }),
    );

    render(<App api={api} />);

    const directory = screen.getByLabelText("邮箱目录栏");
    expect(
      await within(directory).findByRole("button", { name: /收件箱\s*36/ }),
    ).toBeTruthy();

    await act(async () => {
      resolveMessages?.({
        items: [
          {
            id: "aggregate_message_1",
            accountId: "account_1",
            subject: "Aggregate subject",
            from: { email: "client@example.com", name: "Live Client" },
            receivedAt: "2026-06-13T10:00:00.000Z",
            snippet: "Aggregate snippet",
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
      });
    });

    expect((await screen.findAllByText("Aggregate subject")).length).toBeGreaterThan(0);
    expect(within(directory).getByRole("button", { name: /收件箱\s*36/ })).toBeTruthy();
    expect(within(directory).queryByRole("button", { name: /收件箱\s*0/ })).toBeNull();
    expect(api.listMessages).toHaveBeenCalledWith({
      limit: 50,
      sort: "time",
    });
  });

  it("keeps the sidebar mailbox count stable when switching smart views", async () => {
    const api = createApiFixture();

    vi.mocked(api.getMailNavigationSummary).mockResolvedValue({
      folders: [
        { id: "inbox", label: "收件箱", count: 36 },
        { id: "all", label: "所有邮件", count: 36 },
      ],
      providerGroups: [],
      quickCategories: [
        { id: "codes", label: "验证码", count: 3, tone: "blue" },
        { id: "attachments", label: "大附件", count: 5, tone: "purple" },
      ],
    });
    vi.mocked(api.listMessages).mockImplementation(async (input = {}) => ({
      items:
        input.savedView === "codes"
          ? [
              {
                id: "code_message_1",
                accountId: "account_1",
                subject: "Verification code",
                from: { email: "login@example.com", name: "Login" },
                receivedAt: "2026-06-13T10:00:00.000Z",
                snippet: "123456",
                unread: true,
                starred: false,
                mailboxIds: ["mailbox_inbox"],
                attachmentCount: 0,
                classification: {
                  bucket: "P4 FYI / Updates",
                  priorityScore: 10,
                  reasons: ["Verification"],
                },
              },
            ]
          : [
              {
                id: "aggregate_message_1",
                accountId: "account_1",
                subject: "Aggregate subject",
                from: { email: "client@example.com", name: "Live Client" },
                receivedAt: "2026-06-13T10:00:00.000Z",
                snippet: "Aggregate snippet",
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

    render(<App api={api} />);

    const globalNav = screen.getByRole("navigation");
    await waitFor(() => {
      expect(globalNav.textContent).toContain("邮箱36");
    });

    fireEvent.click(await screen.findByRole("button", { name: /验证码\s*3/ }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenCalledWith(
        expect.objectContaining({ savedView: "codes" }),
      );
    });
    expect(globalNav.textContent).toContain("邮箱36");
    expect(globalNav.textContent).not.toContain("邮箱1");
  });

  it("lets users resize the sidebar and mailbox panes with accessible separators", () => {
    const { container } = render(<App />);

    const sidebarSeparator = screen.getByRole("separator", {
      name: "调整左侧栏宽度",
    });
    const sidebarWidth = Number(sidebarSeparator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(sidebarSeparator, { key: "ArrowRight" });
    expect(container.querySelector(".app-shell")?.getAttribute("style")).toContain(
      `--sidebar-width: ${sidebarWidth + 16}px`,
    );

    const listSeparator = screen.getByRole("separator", {
      name: "调整邮件列表宽度",
    });
    const listWidth = Number(listSeparator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(listSeparator, { key: "ArrowRight" });
    expect(container.querySelector(".mail-grid")?.getAttribute("style")).toContain(
      `--message-list-width: ${listWidth + 16}px`,
    );
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

  it("keeps Settings, Domain setup, and Hermes focused on user-facing work", async () => {
    render(<App />);

    const globalNav = screen.getByRole("navigation");
    expect(within(globalNav).queryByRole("button", { name: "待办9" })).toBeNull();
    expect(within(globalNav).queryByRole("button", { name: "同步中心" })).toBeNull();
    expect(within(globalNav).getByRole("button", { name: "Hermes" })).toBeTruthy();
    expect(within(globalNav).getByRole("button", { name: "配置域名" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "邮箱待办" })).toBeNull();

    fireEvent.click(within(globalNav).getByRole("button", { name: "Hermes" }));
    expect(screen.getByRole("heading", { name: "Hermes", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("助手名称")).toBeTruthy();

    fireEvent.click(within(globalNav).getByRole("button", { name: "配置域名" }));
    expect(screen.getByRole("heading", { name: "配置域名" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "域名管理" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.queryByLabelText("设置目录")).toBeNull();
    expect(screen.queryByRole("button", { name: "待办" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新发件人处理" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "域名管理" })).toBeNull();

    const settingsNav = screen.getByLabelText("设置分类");
    const accountSettings = screen.getByRole("region", { name: "邮箱账号设置" });
    expect(accountSettings).toBeTruthy();
    expect(within(accountSettings).getByText("已连接邮箱")).toBeTruthy();
    expect(within(accountSettings).getByText("添加邮箱")).toBeTruthy();
    fireEvent.click(within(settingsNav).getByRole("button", { name: /收件箱/ }));
    expect(screen.getByRole("region", { name: "收件箱设置" })).toBeTruthy();
    expect(screen.getByText("收件箱布局")).toBeTruthy();
    fireEvent.click(within(settingsNav).getByRole("button", { name: /撰写与阅读/ }));
    expect(screen.getByRole("region", { name: "撰写与阅读设置" })).toBeTruthy();
    expect(screen.getByText("撰写窗口")).toBeTruthy();
    fireEvent.click(within(settingsNav).getByRole("button", { name: /连接/ }));
    const connectionSettings = screen.getByRole("region", { name: "连接设置" });
    expect(connectionSettings).toBeTruthy();
    expect(screen.queryByRole("region", { name: "服务设置" })).toBeNull();
    expect(within(connectionSettings).getByText("Hermes")).toBeTruthy();
    expect(within(connectionSettings).getByText("配置域名")).toBeTruthy();
    expect(within(connectionSettings).getByRole("button", { name: "配置" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "邮箱顶部" })).toBeNull();

    fireEvent.click(within(settingsNav).getByRole("button", { name: /状态与维护/ }));
    expect(screen.getByRole("region", { name: "维护项目" })).toBeTruthy();
    expect(screen.queryByLabelText("存储维护面板")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /维护项目/ }));
    expect(await screen.findByLabelText("存储维护面板")).toBeTruthy();
  });

  it("loads, saves, and tests Hermes connection from its settings page", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="hermes" />);

    expect(await screen.findByText("连接已保存。")).toBeTruthy();
    expect((screen.getByLabelText("助手名称") as HTMLInputElement).value).toBe(
      "Hermes",
    );
    expect(screen.getByLabelText("服务商")).toBeTruthy();
    expect(screen.getByLabelText("访问密钥")).toBeTruthy();
    expect(screen.queryByText(/选择 AI 服务商|API Key|LLM 服务商/)).toBeNull();
    expect(screen.queryByLabelText("服务地址")).toBeNull();
    expect(screen.queryByLabelText("模型名称")).toBeNull();

    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "Mail Copilot" },
    });
    fireEvent.change(screen.getByLabelText("服务商"), {
      target: { value: "nvidia" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "runtime-secret" },
    });

    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
    await waitFor(() => {
      expect(api.probeHermesProvider).toHaveBeenCalledWith({
        providerKey: "nvidia",
        model: "nvidia/llama-3.3-nemotron-super-49b-v1",
        apiKey: "runtime-secret",
      });
    });
    expect(await screen.findByText("连接成功。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(api.updateHermesRuntimeSettings).toHaveBeenCalledWith({
        enabled: true,
        mode: "external_hermes",
        assistantName: "Mail Copilot",
        providerKey: "nvidia",
        endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
        model: "nvidia/llama-3.3-nemotron-super-49b-v1",
        apiKey: "runtime-secret",
        updatePolicy: "manual",
        updateChannel: "stable",
      });
    });
  });

  it("tests the saved Hermes runtime secret when the key field is blank", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="hermes" />);

    expect(await screen.findByText("连接已保存。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));

    await waitFor(() => {
      expect(api.testHermesRuntimeConnection).toHaveBeenCalledTimes(1);
    });
    expect(api.probeHermesProvider).not.toHaveBeenCalled();
    expect(await screen.findByText("连接成功。")).toBeTruthy();
  });

  it("does not expose Hermes ability, rule, memory, or audit controls to users", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="hermes" />);

    expect(await screen.findByText("连接已保存。")).toBeTruthy();
    expect(screen.queryByText("能力选项")).toBeNull();
    expect(screen.queryByText("规则")).toBeNull();
    expect(screen.queryByText("学习记录")).toBeNull();
    expect(screen.queryByText("审计记录")).toBeNull();
    expect(screen.queryByLabelText("Hermes skill settings")).toBeNull();
    expect(screen.queryByLabelText("Hermes 规则管理")).toBeNull();
    expect(screen.queryByLabelText("Hermes 学习记录")).toBeNull();
    expect(screen.queryByLabelText("Hermes 审计日志")).toBeNull();
    expect(api.listHermesSkills).not.toHaveBeenCalled();
    expect(api.listHermesRules).not.toHaveBeenCalled();
    expect(api.listHermesMemories).not.toHaveBeenCalled();
    expect(api.listHermesAuditLog).not.toHaveBeenCalled();
  });

  it("keeps data maintenance inside the Settings advanced drawer", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    fireEvent.click(screen.getByRole("button", { name: "状态与维护按需查看" }));

    expect(screen.getByRole("heading", { name: "维护项目" })).toBeTruthy();
    expect(screen.queryByLabelText("存储维护面板")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /维护项目/ }));
    expect(await screen.findByLabelText("存储维护面板")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "存储维护" })).toBeTruthy();
  });

  it("clears the saved Hermes API key from the Hermes page", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="hermes" />);

    expect(await screen.findByText("连接已保存。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除密钥" }));

    await waitFor(() => {
      expect(api.clearHermesRuntimeApiKey).toHaveBeenCalledWith({
        enabled: true,
        mode: "external_hermes",
        assistantName: "Hermes",
        providerKey: "openai-api",
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        model: "gpt-5.2",
        updatePolicy: "manual",
        updateChannel: "stable",
      });
    });
    expect(await screen.findByText("访问密钥已清除。")).toBeTruthy();
  });

  it("keeps Hermes provider choices user-facing and hides operational providers", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" initialView="hermes" />);

    expect(await screen.findByText("连接已保存。")).toBeTruthy();
    const providerSelect = screen.getByLabelText("服务商");
    expect(within(providerSelect).getByRole("option", { name: "OpenAI" })).toBeTruthy();
    expect(within(providerSelect).getByRole("option", { name: "NVIDIA Build" })).toBeTruthy();
    expect(
      within(providerSelect).getByRole("option", { name: "自定义兼容服务" }),
    ).toBeTruthy();
    expect(within(providerSelect).queryByRole("option", { name: "AWS Bedrock" })).toBeNull();

    fireEvent.change(providerSelect, { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("自定义服务地址"), {
      target: { value: "https://llm.example.com/v1/chat/completions" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "custom-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));

    await screen.findByText("连接成功。");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.updateHermesRuntimeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "external_hermes",
          providerKey: "custom",
          endpointUrl: "https://llm.example.com/v1/chat/completions",
          model: "custom-model",
          apiKey: "custom-secret",
        }),
      );
    });
  });

  it("changes the reading pane when another message is selected", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /新品发布会排期确认/ }));

    const reader = screen.getByRole("article");
    expect(within(reader).getByRole("heading", { name: "新品发布会排期确认" })).toBeTruthy();
    expect(
      within(reader).getByText("以下是新品发布会的初步排期，请确认是否需要调整。"),
    ).toBeTruthy();
    expect(within(reader).queryByText(/重要，直接发给你/)).toBeNull();
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
      sort: "time",
    });
    expect(api.getMessage).toHaveBeenCalledWith({
      accountId: "account_1",
      messageId: "message_1",
    });
  });

  it("renders real reader recipients and detail attachment counts", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockResolvedValueOnce({
      items: [
        {
          id: "message_with_attachments",
          accountId: "account_1",
          subject: "Attachment rich message",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "Detail has two files",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 2,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["Direct to you"],
          },
        },
      ],
    });
    vi.mocked(api.getMessage).mockImplementation(async (input) => {
      if (input.messageId !== "message_with_attachments") {
        return createDefaultMessageDetail();
      }

      return {
        id: "message_with_attachments",
        accountId: "account_1",
        subject: "Attachment rich message",
        from: { email: "client@example.com", name: "Live Client" },
        receivedAt: "2026-06-13T10:00:00.000Z",
        snippet: "Detail has two files",
        unread: true,
        starred: false,
        mailboxIds: ["mailbox_inbox"],
        attachmentCount: 2,
        classification: {
          bucket: "P1 Urgent",
          priorityScore: 96,
          reasons: ["Direct to you"],
        },
        to: ["me@example.com", "ops@example.com"],
        cc: ["pm@example.com"],
        bodyText: "Detail body from backend",
        attachments: [
          {
            id: "att_1",
            filename: "contract.pdf",
            contentType: "application/pdf",
            byteSize: 1200,
            embedded: false,
            inline: false,
          },
          {
            id: "att_2",
            filename: "quote.xlsx",
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byteSize: 2400,
            embedded: false,
            inline: false,
          },
        ],
      };
    });

    render(<App api={api} defaultAccountId="account_1" />);

    expect(await screen.findByRole("heading", { name: "Attachment rich message" })).toBeTruthy();
    expect(await screen.findByText("Detail body from backend")).toBeTruthy();
    const reader = screen.getByRole("article");
    expect(
      within(reader).getByText(
        /收件人：me@example.com、ops@example.com · 抄送：pm@example.com/,
      ),
    ).toBeTruthy();
    expect(within(reader).queryByText(/收件人：我/)).toBeNull();
    expect(within(reader).getByText("2 个附件")).toBeTruthy();
    expect(within(reader).getByText("contract.pdf")).toBeTruthy();
    expect(within(reader).getByText("quote.xlsx")).toBeTruthy();
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

    const directory = screen.getByLabelText("邮箱目录栏");
    fireEvent.click(within(directory).getByRole("button", { name: /Sent/ }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        mailboxId: "mailbox_sent",
        limit: 50,
        sort: "time",
      });
    });
      expect(await screen.findByRole("heading", { name: "Sent subject from backend" })).toBeTruthy();
      expect(await screen.findByText("Sent body from backend")).toBeTruthy();
    });

  it("clears stale reader details while a newly selected message loads", async () => {
    const api = createApiFixture();
    let resolveSecondDetail: (
      value: Awaited<ReturnType<EmailHubApi["getMessage"]>>,
    ) => void = () => {};
    vi.mocked(api.listMessages).mockResolvedValue({
      items: [
        {
          id: "message_1",
          accountId: "account_1",
          subject: "First subject",
          from: { email: "first@example.com", name: "First Sender" },
          receivedAt: "2026-06-13T12:00:00.000Z",
          snippet: "First snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["First reason"],
          },
        },
        {
          id: "message_2",
          accountId: "account_1",
          subject: "Second subject",
          from: { email: "second@example.com", name: "Second Sender" },
          receivedAt: "2026-06-13T11:00:00.000Z",
          snippet: "Second snippet",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 82,
            reasons: ["Second reason"],
          },
        },
      ],
    });
    vi.mocked(api.getMessage).mockImplementation((input) => {
      if (input.messageId === "message_2") {
        return new Promise((resolve) => {
          resolveSecondDetail = resolve;
        });
      }

      return Promise.resolve({
        id: "message_1",
        accountId: "account_1",
        subject: "First subject",
        from: { email: "first@example.com", name: "First Sender" },
        receivedAt: "2026-06-13T12:00:00.000Z",
        snippet: "First snippet",
        unread: true,
        starred: false,
        mailboxIds: ["mailbox_inbox"],
        attachmentCount: 0,
        classification: {
          bucket: "P1 Urgent",
          priorityScore: 96,
          reasons: ["First reason"],
        },
        to: ["me@example.com"],
        cc: [],
        bodyText: "First backend body",
        attachments: [],
      });
    });

    render(<App api={api} defaultAccountId="account_1" />);
    expect(await screen.findByText("First backend body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Second subject/ }));

    expect(await screen.findByRole("heading", { name: "Second subject" })).toBeTruthy();
    expect(screen.queryByText("First backend body")).toBeNull();
    expect(within(screen.getByRole("article")).getByText("Second snippet")).toBeTruthy();

    resolveSecondDetail({
      id: "message_2",
      accountId: "account_1",
      subject: "Second subject",
      from: { email: "second@example.com", name: "Second Sender" },
      receivedAt: "2026-06-13T11:00:00.000Z",
      snippet: "Second snippet",
      unread: false,
      starred: false,
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: 0,
      classification: {
        bucket: "P2 Important",
        priorityScore: 82,
        reasons: ["Second reason"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText: "Second backend body",
      attachments: [],
    });
    expect(await screen.findByText("Second backend body")).toBeTruthy();
  });

  it("ignores stale folder loads when the user changes folders quickly", async () => {
    const api = createApiFixture();
    let resolveSentMessages: (
      value: Awaited<ReturnType<EmailHubApi["listMessages"]>>,
    ) => void = () => {};
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
    vi.mocked(api.listMessages).mockImplementation((input) => {
      if (input.mailboxId === "mailbox_sent") {
        return new Promise((resolve) => {
          resolveSentMessages = resolve;
        });
      }

      return Promise.resolve({
        items: [
          {
            id: "message_inbox",
            accountId: "account_1",
            subject: "Inbox current subject",
            from: { email: "client@example.com", name: "Live Client" },
            receivedAt: "2026-06-13T10:00:00.000Z",
            snippet: "Inbox current snippet",
            unread: true,
            starred: false,
            mailboxIds: ["mailbox_inbox"],
            attachmentCount: 0,
            classification: {
              bucket: "P1 Urgent",
              priorityScore: 96,
              reasons: ["Inbox"],
            },
          },
        ],
      });
    });
    vi.mocked(api.getMessage).mockImplementation(async (input) => ({
      id: input.messageId,
      accountId: input.accountId,
      subject:
        input.messageId === "message_sent"
          ? "Sent stale subject"
          : "Inbox current subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet:
        input.messageId === "message_sent"
          ? "Sent stale snippet"
          : "Inbox current snippet",
      unread: false,
      starred: false,
      mailboxIds: [
        input.messageId === "message_sent" ? "mailbox_sent" : "mailbox_inbox",
      ],
      attachmentCount: 0,
      classification: {
        bucket: "P2 Important",
        priorityScore: 70,
        reasons: ["Loaded"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText:
        input.messageId === "message_sent"
          ? "Sent stale body"
          : "Inbox current body",
      attachments: [],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    expect(await screen.findByRole("heading", { name: "Inbox current subject" })).toBeTruthy();

    const directory = screen.getByLabelText("邮箱目录栏");
    fireEvent.click(within(directory).getByRole("button", { name: /Sent/ }));
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        mailboxId: "mailbox_sent",
        limit: 50,
        sort: "time",
      });
    });
    fireEvent.click(within(directory).getByRole("button", { name: /Inbox/ }));
    expect(await screen.findByRole("heading", { name: "Inbox current subject" })).toBeTruthy();

    resolveSentMessages({
      items: [
        {
          id: "message_sent",
          accountId: "account_1",
          subject: "Sent stale subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "Sent stale snippet",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_sent"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 70,
            reasons: ["Sent"],
          },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.queryByText("Sent stale subject")).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Inbox current subject" })).toBeTruthy();
  });

  it("wires mailbox shell count, refresh, sort, and label creation to backend state", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMailboxes).mockResolvedValue({
      items: [
        {
          id: "mailbox_inbox",
          accountId: "account_1",
          name: "Inbox",
          role: "inbox",
          messageCount: 7,
          unreadCount: 2,
        },
        {
          id: "mailbox_sent",
          accountId: "account_1",
          name: "Sent",
          role: "sent",
          messageCount: 3,
          unreadCount: 0,
        },
      ],
    });
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id:
            input.mailboxId === "mailbox_sent"
              ? "message_sent"
              : input.sort === "time"
                ? "message_time"
                : "message_1",
          accountId: "account_1",
          subject:
            input.mailboxId === "mailbox_sent"
              ? "Sent subject from backend"
              : input.sort === "time"
                ? "Time sorted subject"
                : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt:
            input.sort === "time"
              ? "2026-06-13T11:00:00.000Z"
              : "2026-06-13T10:00:00.000Z",
          snippet: "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: [input.mailboxId ?? "mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.sort === "time" ? 70 : 96,
            reasons: ["Direct to you"],
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
          : input.messageId === "message_time"
            ? "Time sorted subject"
            : "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: "Live snippet",
      unread: false,
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
    }));
    vi.mocked(api.upsertLabel).mockResolvedValueOnce({
      id: "label_vip",
      accountId: "account_1",
      name: "VIP",
      color: "blue",
      messageCount: 0,
      createdAt: "2026-06-13T10:02:00.000Z",
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Time sorted subject" });
    const list = screen.getByRole("region", { name: "邮件列表" });
    expect(within(list).getByRole("heading", { name: "Inbox" })).toBeTruthy();
    expect(within(list).getByText("7 封邮件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Sent/ }));
    await screen.findByRole("heading", { name: "Sent subject from backend" });
    expect(within(list).getByRole("heading", { name: "Sent" })).toBeTruthy();
    expect(within(list).getByText("3 封邮件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "刷新邮箱列表" }));
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        mailboxId: "mailbox_sent",
        limit: 50,
        sort: "time",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "添加标签" }));
    fireEvent.change(screen.getByLabelText("新标签名称"), {
      target: { value: "VIP" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "创建标签" }));

    await waitFor(() => {
      expect(api.upsertLabel).toHaveBeenCalledWith({
        accountId: "account_1",
        name: "VIP",
      });
    });
    expect(await screen.findByText("标签已创建：VIP")).toBeTruthy();
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

    openSearchPageFromTopbar();
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "signed contract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "signed contract",
        sort: "time",
      });
    });
    expect(await screen.findByText("Signed contract found")).toBeTruthy();
    expect(await screen.findByText(/Indexed body hit: signed contract/)).toBeTruthy();
  });

  it("ignores stale search results when a slower query finishes last", async () => {
    const api = createApiFixture();
    let resolveSlowSearch:
      | ((value: Awaited<ReturnType<EmailHubApi["listMessages"]>>) => void)
      | undefined;
    vi.mocked(api.listMessages).mockImplementation((input) => {
      if (input.q === "old contract") {
        return new Promise((resolve) => {
          resolveSlowSearch = resolve;
        });
      }

      return Promise.resolve({
        items: [
          {
            id: input.q ? "message_new_search" : "message_1",
            accountId: "account_1",
            subject: input.q ? "Newest search result" : "Live subject",
            from: { email: "client@example.com", name: "Live Client" },
            receivedAt: "2026-06-13T10:00:00.000Z",
            snippet: input.q ? "Fresh query result" : "Live snippet",
            unread: true,
            starred: false,
            mailboxIds: ["mailbox_inbox"],
            attachmentCount: 0,
            classification: {
              bucket: "P1 Urgent",
              priorityScore: input.q ? 90 : 96,
              reasons: input.q ? ["Fresh search"] : ["Direct to you"],
            },
          },
        ],
      });
    });

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    openSearchPageFromTopbar();
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "old contract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));
    await waitFor(() => {
      expect(resolveSlowSearch).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "new contract" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));
    expect(await screen.findByText("Newest search result")).toBeTruthy();

    resolveSlowSearch?.({
      items: [
        {
          id: "message_old_search",
          accountId: "account_1",
          subject: "Stale search result",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T09:00:00.000Z",
          snippet: "Old query result",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 80,
            reasons: ["Old search"],
          },
        },
      ],
    });

    await waitFor(() => {
      expect(screen.queryByText("Stale search result")).toBeNull();
    });
    expect(screen.getByText("Newest search result")).toBeTruthy();
  });

  it("keeps the search workspace separate from Hermes controls", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    openSearchPageFromTopbar();

    expect(screen.queryByText(/输入关键词后搜索/)).toBeNull();
    expect(screen.queryByText(/关键词、附件、自然语言/)).toBeNull();
    expect(screen.queryByLabelText("Hermes 搜索问题")).toBeNull();
    expect(screen.queryByRole("form", { name: "Hermes 自然语言搜索" })).toBeNull();
    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
    expect(screen.queryByText(/正在理解问题|正在搜索/)).toBeNull();
  });

  it("normalizes natural sender search text into a cross-account keyword search", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q ? "message_bybit_search" : "message_1",
          accountId: "account_1",
          subject: input.q ? "Bybit account notice" : "Live subject",
          from: { email: "notice@bybit.com", name: "Bybit" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched sender across accounts" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 91 : 96,
            reasons: input.q ? ["Sender search"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    openSearchPageFromTopbar();

    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "找一下 Bybit 发件人" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "Bybit",
        sort: "time",
      });
    });
    expect(await screen.findByText("Bybit account notice")).toBeTruthy();
  });

  it("keeps Hermes natural language search off the Search workspace", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q ? "message_search" : "message_1",
          accountId: "account_1",
          subject: input.q ? "Plain search result" : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched by ordinary search" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 90 : 96,
            reasons: input.q ? ["Search"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    openSearchPageFromTopbar();
    expect(screen.queryByLabelText("Hermes 搜索问题")).toBeNull();

    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "客户上次提到的合同在哪里" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "客户上次提到的合同",
        sort: "time",
      });
    });
    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
    expect(await screen.findByText("Plain search result")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("已搜索所有邮箱");
  });

  it("runs manual search independently from Hermes", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q === "manual invoice" ? "message_manual" : "message_1",
          accountId: "account_1",
          subject:
            input.q === "manual invoice"
              ? "Manual search result"
              : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Search snippet" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 90 : 96,
            reasons: input.q ? ["Search"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    openSearchPageFromTopbar();

    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "manual invoice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));
    expect(await screen.findByText("Manual search result")).toBeTruthy();
    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
    expect(screen.getByText("Manual search result")).toBeTruthy();
    expect(screen.queryByLabelText("Hermes 搜索回答")).toBeNull();
  });

  it("opens a cross-account search result in the shared mail reader", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: input.q
        ? [
            {
              id: "message_search",
              accountId: "account_2",
              subject: "Cross-account search result",
              from: { email: "finance@example.com", name: "Finance" },
              receivedAt: "2026-06-13T11:00:00.000Z",
              snippet: "Matched invoice in another account",
              unread: false,
              starred: true,
              mailboxIds: ["mailbox_inbox"],
              attachmentCount: 1,
              searchPreview: {
                source: "indexed_text",
                text: "Indexed attachment hit: Q3 invoice.",
              },
              classification: {
                bucket: "P2 Important",
                priorityScore: 88,
                reasons: ["Matched search"],
              },
            },
          ]
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
    vi.mocked(api.getMessage).mockImplementation(async (input) => ({
      id: input.messageId,
      accountId: input.accountId,
      subject:
        input.messageId === "message_search"
          ? "Cross-account search result"
          : "Live subject",
      from:
        input.messageId === "message_search"
          ? { email: "finance@example.com", name: "Finance" }
          : { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T11:00:00.000Z",
      snippet:
        input.messageId === "message_search"
          ? "Matched invoice in another account"
          : "Live snippet",
      unread: false,
      starred: input.messageId === "message_search",
      mailboxIds: ["mailbox_inbox"],
      attachmentCount: input.messageId === "message_search" ? 1 : 0,
      classification: {
        bucket: input.messageId === "message_search" ? "P2 Important" : "P1 Urgent",
        priorityScore: input.messageId === "message_search" ? 88 : 96,
        reasons:
          input.messageId === "message_search"
            ? ["Matched search"]
            : ["Direct to you"],
      },
      to: ["me@example.com"],
      cc: [],
      bodyText:
        input.messageId === "message_search"
          ? "Invoice details loaded from account 2"
          : "Live body from backend",
      attachments: [],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    openSearchPageFromTopbar();
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "Q3 invoice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索全部账号" }));
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    const result = await screen.findByRole("button", {
      name: "Open search result Cross-account search result",
    });
    expect(within(result).getByText(/Indexed attachment hit/)).toBeTruthy();
    fireEvent.click(result);

    expect(await screen.findByRole("heading", { name: "Cross-account search result" })).toBeTruthy();
    await waitFor(() => {
      expect(api.getMessage).toHaveBeenLastCalledWith({
        accountId: "account_2",
        messageId: "message_search",
      });
    });
    expect(await screen.findByText("Invoice details loaded from account 2")).toBeTruthy();
  });

  it("keeps advanced search controls out of the ordinary search page", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    openSearchPageFromTopbar();

    expect(screen.queryByRole("button", { name: "只看有附件" })).toBeNull();
    expect(screen.queryByRole("button", { name: "只看未读" })).toBeNull();
    expect(screen.queryByLabelText("搜索发件人")).toBeNull();
    expect(screen.queryByLabelText("搜索收件人")).toBeNull();
    expect(screen.queryByLabelText("搜索开始日期")).toBeNull();
    expect(screen.queryByLabelText("搜索结束日期")).toBeNull();
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

    openSearchPageFromTopbar();
    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "missing invoice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "missing invoice",
        sort: "time",
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
        sort: "time",
      });
    });
    expect(await screen.findByText("Top search result")).toBeTruthy();
  });

  it("passes the selected top-bar search range to the search page", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q ? "message_range_search" : "message_1",
          accountId: input.accountId ?? "account_1",
          subject: input.q ? "Range search result" : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched within the selected range" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 88 : 96,
            reasons: input.q ? ["Selected range"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("搜索范围"), {
      target: { value: "current" },
    });
    fireEvent.change(screen.getByLabelText("全局搜索邮件"), {
      target: { value: "invoice" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        mailboxId: "mailbox_inbox",
        q: "invoice",
        sort: "time",
      });
    });
    expect(await screen.findByText("Range search result")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "invoice updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        q: "invoice updated",
        sort: "time",
      });
    });
  });

  it("keeps searches account-scoped when the default account is restricted", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.q ? "message_scoped_search" : "message_1",
          accountId: "account_1",
          subject: input.q ? "Scoped search result" : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: input.q ? "Matched within account 1" : "Live snippet",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: input.q ? 89 : 96,
            reasons: input.q ? ["Scoped token"] : ["Direct to you"],
          },
        },
      ],
    }));

    render(
      <App
        api={api}
        defaultAccountId="account_1"
        restrictToDefaultAccount
      />,
    );
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(screen.getByLabelText("全局搜索邮件"), {
      target: { value: "verification code" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        q: "verification code",
        sort: "time",
      });
    });
    expect(await screen.findByText("Scoped search result")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "搜索全部账号",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("搜索邮件"), {
      target: { value: "launch plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "执行搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        q: "launch plan",
        sort: "time",
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
        sort: "time",
        savedView: "codes",
      });
    });
  });

  it("keeps Smart Inbox bulk controls out of the message list", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockResolvedValue({
      items: [
        {
          id: "urgent_1",
          accountId: "account_1",
          subject: "Selected urgent",
          from: { email: "one@example.com", name: "One Sender" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "selected urgent",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["Selected"],
          },
        },
        {
          id: "urgent_2",
          accountId: "account_1",
          subject: "Unselected urgent",
          from: { email: "two@example.com", name: "Two Sender" },
          receivedAt: "2026-06-13T10:05:00.000Z",
          snippet: "not selected",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 95,
            reasons: ["Unselected"],
          },
        },
        {
          id: "important_1",
          accountId: "account_1",
          subject: "Selected important",
          from: { email: "important@example.com", name: "Important Sender" },
          receivedAt: "2026-06-13T09:55:00.000Z",
          snippet: "selected important",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 80,
            reasons: ["Selected"],
          },
        },
      ],
    });

    render(<App api={api} defaultAccountId="account_1" />);
    const messageList = await screen.findByLabelText("邮件列表");
    await within(messageList).findByText("Selected urgent");

    expect(
      within(messageList).queryByRole("button", { name: "完成选中邮件" }),
    ).toBeNull();
    expect(
      within(messageList).queryByRole("button", { name: /完成当前智能分类/ }),
    ).toBeNull();
    expect(
      within(messageList).queryByRole("button", { name: "将选中邮件移到订阅" }),
    ).toBeNull();
    expect(api.applySmartInboxCardBulkAction).not.toHaveBeenCalled();
  });

  it("shows checked-message count without starting Smart Inbox actions", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockResolvedValue({
      items: [
        {
          id: "feedback_1",
          accountId: "account_1",
          subject: "Selected feedback one",
          from: { email: "one@example.com", name: "One Sender" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "selected feedback one",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P1 Urgent",
            priorityScore: 96,
            reasons: ["Selected"],
          },
        },
        {
          id: "feedback_2",
          accountId: "account_2",
          subject: "Selected feedback two",
          from: { email: "two@example.com", name: "Two Sender" },
          receivedAt: "2026-06-13T10:05:00.000Z",
          snippet: "selected feedback two",
          unread: true,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P2 Important",
            priorityScore: 82,
            reasons: ["Selected"],
          },
        },
        {
          id: "feedback_3",
          accountId: "account_1",
          subject: "Unselected feedback",
          from: { email: "three@example.com", name: "Three Sender" },
          receivedAt: "2026-06-13T09:55:00.000Z",
          snippet: "not selected",
          unread: false,
          starred: false,
          mailboxIds: ["mailbox_inbox"],
          attachmentCount: 0,
          classification: {
            bucket: "P3 Notifications",
            priorityScore: 60,
            reasons: ["Unselected"],
          },
        },
      ],
    });
    vi.mocked(api.recordSmartInboxFeedback).mockImplementation(async (input) => ({
      feedbackEventId: `feedback_event_${input.messageId}`,
      accountId: input.accountId,
      messageId: input.messageId,
      classification: {
        bucket: "P6 Feed",
        priorityScore: 15,
        reasons: [`User moved ${input.messageId} to Feed`],
      },
    }));

    render(<App api={api} defaultAccountId="account_1" />);
    const messageList = await screen.findByLabelText("邮件列表");
    await within(messageList).findByText("Selected feedback one");
    fireEvent.click(screen.getByLabelText("Select message Selected feedback one"));
    fireEvent.click(screen.getByLabelText("Select message Selected feedback two"));

    expect(within(messageList).getByText("已选 2 封")).toBeTruthy();
    expect(api.recordSmartInboxFeedback).not.toHaveBeenCalled();
    expect(api.applySmartInboxCardBulkAction).not.toHaveBeenCalled();
    expect(screen.getAllByText("Unselected feedback").length).toBeGreaterThan(0);
  });

  it("queues Spark done through the backend and exposes a local undo action", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    const initialMessageList = await screen.findByLabelText("邮件列表");
    expect(within(initialMessageList).getByText("Live subject")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "完成当前邮件" }));

    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "done",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Live subject")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "撤销完成" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "撤销完成" }));

    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "undo_done",
        undoToken: "undo_1",
      });
    });
    const restoredMessageList = await screen.findByLabelText("邮件列表");
    expect(await within(restoredMessageList).findByText("Live subject")).toBeTruthy();
  });

  it("keeps the undo action visible when Spark done undo fails", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "完成当前邮件" }));
    expect(await screen.findByRole("button", { name: "撤销完成" })).toBeTruthy();

    vi.mocked(api.applyMailAction).mockRejectedValueOnce(new Error("undo down"));
    fireEvent.click(screen.getByRole("button", { name: "撤销完成" }));

    expect(await screen.findByText("撤销完成暂时不可用。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "撤销完成" })).toBeTruthy();
  });

  it("removes a message from the flagged folder after unstar", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockImplementation(async (input) => ({
      items: [
        {
          id: input.quickFilters?.includes("starred")
            ? "message_starred"
            : "message_1",
          accountId: "account_1",
          subject: input.quickFilters?.includes("starred")
            ? "Starred current subject"
            : "Live subject",
          from: { email: "client@example.com", name: "Live Client" },
          receivedAt: "2026-06-13T10:00:00.000Z",
          snippet: "Starred snippet",
          unread: true,
          starred: input.quickFilters?.includes("starred") ?? false,
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

    const directory = screen.getByLabelText("邮箱目录栏");
    fireEvent.click(within(directory).getByRole("button", { name: /已标记/ }));
    expect(
      (await screen.findAllByText("Starred current subject")).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Unstar selected message" }),
    );
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenLastCalledWith({
        accountId: "account_1",
        messageId: "message_starred",
        action: "unstar",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Starred current subject")).toBeNull();
    });
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
        sort: "time",
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
        sort: "time",
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
        sort: "time",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "account_1",
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBeNull();
  });

  it("does not load compose resources for the preview account in an empty aggregated inbox", async () => {
    const api = createApiFixture();
    vi.mocked(api.listSyncCenterAccounts).mockResolvedValue({
      items: [
        {
          accountId: "55555555-5555-4555-8555-555555555555",
          email: "empty-real@example.com",
          provider: "gmail",
          syncState: "syncing",
        },
      ],
    });
    vi.mocked(api.listMessages).mockResolvedValue({ items: [] });

    render(<App api={api} />);

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenCalledWith({
        limit: 50,
        sort: "time",
      });
    });
    expect(api.listSendIdentities).not.toHaveBeenCalled();
    expect(api.listMailDrafts).not.toHaveBeenCalled();
    expect(api.listOutbox).not.toHaveBeenCalled();
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
        sort: "time",
      });
    });
    expect(api.listMailboxes).not.toHaveBeenCalledWith({
      accountId: "deleted-account",
    });
    expect(sessionStorage.getItem("email-hub:selected-account-id")).toBeNull();
  });


});
