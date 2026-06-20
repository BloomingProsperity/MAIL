import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ApiRequestError } from "./lib/emailHubApi";
import {
  createApiFixture,
  followUpFixture,
  hermesOrganizationResult,
  hermesSkillFixture,
  mockTwoMessageReader,
} from "./test/appTestFixtures";
import type {
  FollowUpDto,
  HermesActionPlanDto,
  HermesEmailSearchQaResult,
  HermesMessageSummaryResult,
  HermesMessageTranslationResult,
  HermesTranslationPreferenceResult,
  MailActionResult,
  MessageDetailDto,
} from "./lib/emailHubApi";

describe("Email Hub Hermes dock and reader", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("keeps Hermes as a blurred compact dock that opens on demand and closes manually", () => {
    render(<App />);

    const dock = screen.getByLabelText("Hermes 底部输入");
    expect(dock.className).toContain("is-blurred");
    expect(dock.className).toContain("is-collapsed");
    expect(within(dock).getByRole("button", { name: "打开 Hermes" })).toBeTruthy();
    expect(within(dock).queryByLabelText("Hermes 指令")).toBeNull();

    fireEvent.click(within(dock).getByRole("button", { name: "打开 Hermes" }));

    expect(dock.className).toContain("is-open");
    const commandInput = within(dock).getByLabelText("Hermes 指令") as HTMLInputElement;
    expect(commandInput.placeholder).toBe("搜索邮件、总结、翻译或整理收件箱...");
    expect(commandInput.value).toBe("");
    expect(within(dock).queryByRole("button", { name: "搜索邮件" })).toBeNull();

    fireEvent.click(within(dock).getByRole("button", { name: "收起 Hermes" }));

    expect(dock.className).toContain("is-collapsed");
    expect(within(dock).getByRole("button", { name: "打开 Hermes" })).toBeTruthy();
  });

  it("keeps the Hermes command dock open until the user collapses it", () => {
    const { container } = render(<App />);

    const dock = container.querySelector(".hermes-dock");
    expect(dock?.className).toContain("is-collapsed");

    const launcher = container.querySelector(".dock-launcher");
    expect(launcher).toBeTruthy();
    fireEvent.click(launcher as HTMLElement);

    expect(dock?.className).toContain("is-open");
    expect(dock?.className).not.toContain("dock-short");
    expect(container.querySelector(".dock-command-input")).toBeTruthy();

    fireEvent.mouseMove(dock as HTMLElement);
    expect(dock?.className).toContain("is-open");

    fireEvent.click(screen.getByRole("button", { name: "收起 Hermes" }));
    expect(dock?.className).toContain("is-collapsed");
  });

  it("runs Hermes mail search QA from the compact dock and can open the Search workspace", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    const context = await screen.findByLabelText("Hermes 邮箱信息");
    expect(within(context).getByText("1 个邮箱")).toBeTruthy();
    expect(within(context).getByText("2 个分组")).toBeTruthy();
    expect(within(context).queryByText("规则需确认")).toBeNull();
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
        memoryScope: "sender:client@example.com",
      });
    });
    expect(
      await screen.findByText("Lina mentioned the signed contract in the latest thread."),
    ).toBeTruthy();
    expect(within(screen.getByLabelText("Hermes 搜索回答")).getByText("Live subject")).toBeTruthy();
    expect(within(screen.getByLabelText("Hermes 搜索条件")).getByText("有附件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开搜索结果" }));

    expect(await screen.findByRole("heading", { name: "搜索" })).toBeTruthy();
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        q: "signed contract",
        qScopes: ["sender", "recipients", "subject", "body"],
        quickFilters: ["attachments"],
        hasAttachment: true,
        sort: "time",
      });
    });

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", { name: "邮箱" }),
    );
    fireEvent.change(screen.getByLabelText("全局搜索邮件"), {
      target: { value: "company policy" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        limit: 50,
        q: "company policy",
        sort: "time",
      });
    });
  });

  it("ignores stale Hermes dock search results after the prompt changes", async () => {
    const api = createApiFixture();
    let resolveOldSearch: (value: HermesEmailSearchQaResult) => void = () => {};
    const searchResult = (
      answerText: string,
      searchQuery: string,
    ): HermesEmailSearchQaResult => ({
      skillRunId: `run_${searchQuery.replace(/\s+/g, "_")}`,
      skillId: "email_search_qa",
      answerText,
      searchQuery,
      searchPlan: {
        searchQuery,
        quickFilters: [],
        qScopes: ["sender", "recipients", "subject", "body"],
        filters: [],
        listMessagesInput: {
          q: searchQuery,
        },
        explanation: [`Search ${searchQuery}.`],
      },
      matches: [],
      citations: [],
    });
    vi.mocked(api.searchMailWithHermes)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldSearch = resolve;
          }),
      )
      .mockResolvedValueOnce(searchResult("Fresh answer should stay visible.", "new query"));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "old query" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith(
        expect.objectContaining({ question: "old query" }),
      );
    });

    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "new query" },
    });
    expect(
      (screen.getByRole("button", { name: "发送给 Hermes" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    expect(await screen.findByText("Fresh answer should stay visible.")).toBeTruthy();
    await act(async () => {
      resolveOldSearch(searchResult("Stale answer should not render.", "old query"));
    });

    expect(screen.queryByText("Stale answer should not render.")).toBeNull();
    expect(screen.getByText("Fresh answer should stay visible.")).toBeTruthy();
  });

  it("keeps Hermes dock search scoped when the selected inbox is empty", async () => {
    const api = createApiFixture();
    vi.mocked(api.listMessages).mockResolvedValue({ items: [] });
    vi.mocked(api.searchMailWithHermes).mockResolvedValueOnce({
      skillRunId: "run_empty_search_1",
      skillId: "email_search_qa",
      answerText: "没有找到验证码邮件。",
      searchQuery: "verification code",
      searchPlan: {
        searchQuery: "verification code",
        quickFilters: [],
        qScopes: ["sender", "recipients", "subject", "body"],
        filters: [],
        listMessagesInput: {
          q: "verification code",
        },
        explanation: ["搜索验证码相关邮件。"],
      },
      matches: [],
      citations: [],
    } satisfies HermesEmailSearchQaResult);

    render(<App api={api} defaultAccountId="account_1" />);
    expect(await screen.findByLabelText("空白邮件阅读区")).toBeTruthy();
    expect(screen.queryByText("当前邮箱还没有已同步邮件。")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开同步中心" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "查一下验证码邮件" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith({
        accountId: "account_1",
        question: "查一下验证码邮件",
        language: "zh-CN",
        limit: 5,
        memoryScope: "global",
      });
    });
    expect(await screen.findByText("没有找到验证码邮件。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开搜索结果" }));

    expect(await screen.findByRole("heading", { name: "搜索" })).toBeTruthy();
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        q: "verification code",
        sort: "time",
      });
    });
  });

  it("keeps label-filtered search prompts in Hermes mail search instead of action plans", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "搜索带客户标签的合同" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith({
        accountId: "account_1",
        question: "搜索带客户标签的合同",
        language: "zh-CN",
        limit: 5,
        memoryScope: "sender:client@example.com",
      });
    });
    expect(api.createHermesActionPlan).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Lina mentioned the signed contract in the latest thread."),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "filter invoices from Alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenLastCalledWith({
        accountId: "account_1",
        question: "filter invoices from Alice",
        language: "zh-CN",
        limit: 5,
        memoryScope: "sender:client@example.com",
      });
    });
    expect(api.createHermesActionPlan).not.toHaveBeenCalled();
  });

  it("creates and confirms a Hermes mailbox action plan from the compact dock", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: {
        value: "把验证码邮件自动放到左侧验证码，账号里的所有验证码邮件都这样处理",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    await waitFor(() => {
      expect(api.getHermesWorkspaceContext).toHaveBeenCalledWith({
        accountId: "account_1",
        ruleLimit: 10,
        labelLimit: 20,
      });
      expect(api.createHermesActionPlan).toHaveBeenCalledWith({
        accountId: "account_1",
        command:
          "把验证码邮件自动放到左侧验证码，账号里的所有验证码邮件都这样处理",
        sampleLimit: 25,
      });
    });
    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
    expect(api.draftHermesRule).not.toHaveBeenCalled();
    expect(api.simulateHermesRule).not.toHaveBeenCalled();

    const plan = await screen.findByLabelText("Hermes 整理建议");
    expect(within(plan).getByText("启用验证码智能分组")).toBeTruthy();
    expect(within(plan).queryByText(/audit_plan_1/)).toBeNull();
    expect(within(plan).queryByText(/执行计划|安全边界|执行步骤/)).toBeNull();
    expect(within(plan).getByText(/影响预览：命中 4 封邮件/)).toBeTruthy();

    fireEvent.click(within(plan).getByRole("button", { name: "确认整理" }));

    await waitFor(() => {
      expect(api.confirmHermesActionPlan).toHaveBeenCalledWith({
        planId: "plan_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
      });
    });
    expect(api.getMailNavigationSummary).toHaveBeenCalled();
    expect(api.listLabels).toHaveBeenCalledWith({ accountId: "account_1" });
    expect(
      await screen.findByText(
        "Hermes 已完成整理：启用验证码智能分组，已整理 4 封历史邮件。已打开验证码。",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        sort: "time",
        savedView: "codes",
      });
    });
    expect(within(plan).getByText("已整理 4 封历史邮件。")).toBeTruthy();
    expect(within(plan).queryByText(/历史回填|用户习惯学习|procedural_memory/)).toBeNull();
  });

  it("ignores a stale Hermes dock action plan after the prompt changes", async () => {
    const api = createApiFixture();
    const stalePlan = await api.createHermesActionPlan({
      accountId: "account_1",
      command: "把验证码邮件自动放到左侧验证码，账号里的所有验证码邮件都这样处理",
      sampleLimit: 25,
    });
    let resolveOldPlan: (value: HermesActionPlanDto) => void = () => {};
    vi.mocked(api.createHermesActionPlan).mockClear();
    vi.mocked(api.createHermesActionPlan).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldPlan = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: {
        value: "把验证码邮件自动放到左侧验证码，账号里的所有验证码邮件都这样处理",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
    await waitFor(() => {
      expect(api.createHermesActionPlan).toHaveBeenCalledWith({
        accountId: "account_1",
        command:
          "把验证码邮件自动放到左侧验证码，账号里的所有验证码邮件都这样处理",
        sampleLimit: 25,
      });
    });

    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "客户上次提到的合同是什么" },
    });
    expect(
      (screen.getByRole("button", { name: "发送给 Hermes" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    await act(async () => {
      resolveOldPlan(stalePlan);
    });

    expect(screen.queryByLabelText("Hermes 整理建议")).toBeNull();
    expect(screen.queryByText("启用验证码智能分组")).toBeNull();
    expect(api.confirmHermesActionPlan).not.toHaveBeenCalled();
  });

  it("explains when Hermes action plan creation is disabled by skill settings", async () => {
    const api = createApiFixture();
    vi.mocked(api.createHermesActionPlan).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: {
        value: "帮我创建一个规则，把验证码邮件放到验证码分组",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    expect(
      await screen.findByText(
        "Hermes 整理建议暂时不可用。",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Hermes 整理建议")).toBeNull();
    expect(api.searchMailWithHermes).not.toHaveBeenCalled();
  });

  it("explains when Hermes action plan confirmation is disabled by skill settings", async () => {
    const api = createApiFixture();
    vi.mocked(api.confirmHermesActionPlan).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: {
        value: "把验证码邮件自动放到左侧验证码，账号里的所有验证码邮件都这样处理",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    const plan = await screen.findByLabelText("Hermes 整理建议");
    fireEvent.click(within(plan).getByRole("button", { name: "确认整理" }));

    expect(
      await screen.findByText(
        "Hermes 整理建议暂时不可用。",
      ),
    ).toBeTruthy();
    expect(within(plan).getByRole("button", { name: "确认整理" })).toBeTruthy();
  });

  it("loads account labels into the directory and filters mail by label", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    const labelSection = screen.getByText("标签/项目").closest(".directory-section");
    expect(labelSection).toBeTruthy();
    expect(await within(labelSection as HTMLElement).findByRole("button", { name: /客户/ })).toBeTruthy();

    fireEvent.click(
      within(labelSection as HTMLElement).getByRole("button", { name: /验证码/ }),
    );

    await waitFor(() => {
      expect(api.listMessages).toHaveBeenLastCalledWith({
        accountId: "account_1",
        limit: 50,
        sort: "time",
        labelIds: ["label_code"],
        tagMode: "any",
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

  it("points dock Hermes users to runtime settings when the model gateway is not configured", async () => {
    const api = createApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(503, "hermes_runtime_not_configured", {
        error: "hermes_runtime_not_configured",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "找一下合同" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    expect(
      await screen.findByText(
        "Hermes 暂时不可用。",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Hermes 搜索回答")).toBeNull();
  });

  it("explains when Hermes mail search is disabled by skill settings", async () => {
    const api = createApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
        skillId: "email_search_qa",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "找一下合同" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));

    expect(
      await screen.findByText(
        "Hermes 搜索问答暂时不可用。",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Hermes 搜索回答")).toBeNull();
  });

  it("runs Hermes summary and translation from the message reader", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");
    await waitFor(() => {
      expect(api.listLabels).toHaveBeenCalledWith({ accountId: "account_1" });
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 总结当前邮件",
      }),
    );

    await waitFor(() => {
      expect(api.summarizeMessage).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        mode: "action_points",
        focus: "decisions, deadlines, blockers, and reply needs",
        language: "zh-CN",
        memoryScope: "global",
      });
    });
    expect(await screen.findByText("需要确认发布时间，并在今天回复 Lina。")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 翻译当前邮件",
      }),
    );

    await waitFor(() => {
      expect(api.translateMessage).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        targetLanguage: "Chinese",
        tone: "preserve original meaning and formatting",
        memoryScope: "sender:client@example.com",
      });
    });
    expect(await screen.findByText("你好，请确认发布计划。")).toBeTruthy();
    expect(
      within(screen.getByLabelText("Hermes 邮件翻译")).getByText(
        /刚刚完成翻译/,
      ),
    ).toBeTruthy();
    const rememberPreferenceButton = within(
      screen.getByLabelText("Hermes 邮件翻译"),
    ).getByRole("button", {
      name: "Remember Hermes translation preference",
    }) as HTMLButtonElement;
    expect(rememberPreferenceButton.disabled).toBe(true);
    fireEvent.click(rememberPreferenceButton);
    expect(api.confirmTranslationPreference).not.toHaveBeenCalled();
    expect(
      screen.queryByText("请选择明确源语言后，再让 Hermes 记住翻译习惯。"),
    ).toBeNull();
  });

  it("renders untrusted email HTML and Hermes output as inert text", async () => {
    const api = createApiFixture();
    vi.mocked(api.getMessage).mockResolvedValueOnce({
      id: "message_1",
      accountId: "account_1",
      subject: "Live subject",
      from: { email: "client@example.com", name: "Live Client" },
      receivedAt: "2026-06-13T10:00:00.000Z",
      snippet: "Unsafe snippet",
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
      bodyText: "",
      bodyHtml:
        '<p>Safe body text</p><img src=x onerror="window.__emailHubXss=1"><script>window.__emailHubXss=1</script><style>.secret{display:none}</style>',
      attachments: [],
    } satisfies MessageDetailDto);
    vi.mocked(api.summarizeMessage).mockResolvedValueOnce({
      skillRunId: "run_summary_xss",
      skillId: "thread_summarize",
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      summaryText: '<img src=x onerror="window.__hermesSummaryXss=1">Summary',
      cached: false,
    } satisfies HermesMessageSummaryResult);
    vi.mocked(api.translateMessage).mockResolvedValueOnce({
      skillRunId: "run_translate_xss",
      auditEventId: "audit_translate_xss",
      skillId: "translate_text",
      accountId: "account_1",
      messageId: "message_1",
      sourceLanguage: "auto",
      targetLanguage: "Chinese",
      translatedText:
        '<svg onload="window.__hermesTranslateXss=1"></svg>Translated',
      cached: false,
    } satisfies HermesMessageTranslationResult);
    vi.mocked(api.searchMailWithHermes).mockResolvedValueOnce({
      skillRunId: "run_search_xss",
      skillId: "email_search_qa",
      searchQuery: "unsafe",
      answerText: '<img src=x onerror="window.__hermesSearchXss=1">Answer',
      searchPlan: {
        searchQuery: "unsafe",
        quickFilters: [],
        qScopes: ["sender", "recipients", "subject", "body"],
        filters: [],
        listMessagesInput: {
          q: "unsafe",
        },
        explanation: ["Validate inert rendering for untrusted Hermes output."],
      },
      matches: [],
      citations: [],
    } satisfies HermesEmailSearchQaResult);

    render(<App api={api} defaultAccountId="account_1" />);

    expect(await screen.findByText("Safe body text")).toBeTruthy();
    const messageBody = document.querySelector(".message-body");
    expect(messageBody?.innerHTML).not.toContain("<img");
    expect(messageBody?.textContent).not.toContain("__emailHubXss");
    expect(
      (window as Window & { __emailHubXss?: number }).__emailHubXss,
    ).toBeUndefined();

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 总结当前邮件",
      }),
    );
    expect(
      await screen.findByText(
        '<img src=x onerror="window.__hermesSummaryXss=1">Summary',
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 翻译当前邮件",
      }),
    );
    expect(
      await screen.findByText(
        '<svg onload="window.__hermesTranslateXss=1"></svg>Translated',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.change(screen.getByLabelText("Hermes 指令"), {
      target: { value: "unsafe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
    expect(
      await screen.findByText(
        '<img src=x onerror="window.__hermesSearchXss=1">Answer',
      ),
    ).toBeTruthy();

    expect(document.querySelector(".message-body img")).toBeNull();
    expect(document.querySelector(".hermes-reader-result img")).toBeNull();
    expect(document.querySelector(".hermes-reader-result svg[onload]")).toBeNull();
    expect(document.querySelector(".dock-result img")).toBeNull();
    expect(
      (window as Window & { __hermesSummaryXss?: number }).__hermesSummaryXss,
    ).toBeUndefined();
    expect(
      (window as Window & { __hermesTranslateXss?: number })
        .__hermesTranslateXss,
    ).toBeUndefined();
    expect(
      (window as Window & { __hermesSearchXss?: number }).__hermesSearchXss,
    ).toBeUndefined();
  });

  it("translates reader mail to the selected target language and saves a Hermes preference", async () => {
    const api = createApiFixture();
    vi.mocked(api.translateMessage).mockResolvedValueOnce({
      skillRunId: "run_translate_cached",
      auditEventId: "audit_cached_translate",
      skillId: "translate_text",
      accountId: "account_1",
      messageId: "message_1",
      sourceLanguage: "Chinese",
      targetLanguage: "English",
      translatedText: "Hello, please confirm the launch plan.",
      cached: true,
    } satisfies HermesMessageTranslationResult);

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(
      screen.getByRole("combobox", { name: "Hermes translation source language" }),
      { target: { value: "Chinese" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Hermes translation target language" }),
      { target: { value: "English" } },
    );
    await waitFor(() => {
      expect(
        (
          screen.getByRole("combobox", {
            name: "Hermes translation source language",
          }) as HTMLSelectElement
        ).value,
      ).toBe("Chinese");
      expect(
        (
          screen.getByRole("combobox", {
            name: "Hermes translation target language",
          }) as HTMLSelectElement
        ).value,
      ).toBe("English");
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 翻译当前邮件",
      }),
    );

    await waitFor(() => {
      expect(api.translateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "Chinese",
          targetLanguage: "English",
          memoryScope: "sender:client@example.com",
        }),
      );
    });
    const translation = await screen.findByLabelText("Hermes 邮件翻译");
    expect(within(translation).getByText("Hello, please confirm the launch plan.")).toBeTruthy();
    expect(
      within(translation).getByText(
        /使用上次翻译结果/,
      ),
    ).toBeTruthy();
    expect(api.translateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLanguage: "Chinese",
        targetLanguage: "English",
      }),
    );

    fireEvent.click(
      within(translation).getByRole("button", {
        name: "Remember Hermes translation preference",
      }),
    );

    await waitFor(() => {
      expect(api.confirmTranslationPreference).toHaveBeenCalledWith({
        accountId: "account_1",
        mode: "always",
        sourceLanguage: "Chinese",
        targetLanguage: "English",
        memoryScope: "sender:client@example.com",
        reason: "Reader translation preference for client@example.com",
      });
    });
    expect(await screen.findByText("Hermes 已记住这个翻译习惯。")).toBeTruthy();
  });

  it("refreshes cached reader translations with Hermes force refresh", async () => {
    const api = createApiFixture();
    vi.mocked(api.translateMessage)
      .mockResolvedValueOnce({
        skillRunId: "run_translate_cached",
        auditEventId: "audit_cached_translate",
        skillId: "translate_text",
        accountId: "account_1",
        messageId: "message_1",
        sourceLanguage: "Chinese",
        targetLanguage: "English",
        translatedText: "Cached translation.",
        cached: true,
      } satisfies HermesMessageTranslationResult)
      .mockResolvedValueOnce({
        skillRunId: "run_translate_refreshed",
        auditEventId: "audit_refreshed_translate",
        skillId: "translate_text",
        accountId: "account_1",
        messageId: "message_1",
        sourceLanguage: "Chinese",
        targetLanguage: "English",
        translatedText: "Fresh translation.",
        cached: false,
      } satisfies HermesMessageTranslationResult);

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });

    fireEvent.change(
      screen.getByRole("combobox", { name: "Hermes translation source language" }),
      { target: { value: "Chinese" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Hermes translation target language" }),
      { target: { value: "English" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 翻译当前邮件",
      }),
    );

    const translation = await screen.findByLabelText("Hermes 邮件翻译");
    expect(within(translation).getByText("Cached translation.")).toBeTruthy();
    expect(
      within(translation).getByText(
        /使用上次翻译结果/,
      ),
    ).toBeTruthy();

    fireEvent.click(
      within(translation).getByRole("button", {
        name: "Refresh Hermes translation",
      }),
    );

    await waitFor(() => {
      expect(api.translateMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "Chinese",
          targetLanguage: "English",
          memoryScope: "sender:client@example.com",
          forceRefresh: true,
        }),
      );
    });
    expect(await screen.findByText("Fresh translation.")).toBeTruthy();
    expect(await screen.findByText("Hermes 已重新翻译。")).toBeTruthy();
    expect(screen.queryByText(/run_translate_refreshed/)).toBeNull();
  });

  it("ignores a stale Hermes translation preference after switching messages", async () => {
    const api = createApiFixture();
    let resolvePreference: (value: HermesTranslationPreferenceResult) => void =
      () => {};
    mockTwoMessageReader(api);
    vi.mocked(api.translateMessage).mockResolvedValueOnce({
      skillRunId: "run_translate_before_switch",
      auditEventId: "audit_translate_before_switch",
      skillId: "translate_text",
      accountId: "account_1",
      messageId: "message_1",
      sourceLanguage: "Chinese",
      targetLanguage: "English",
      translatedText: "Hello before switch.",
      cached: false,
    } satisfies HermesMessageTranslationResult);
    vi.mocked(api.confirmTranslationPreference).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreference = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "First subject" });
    await screen.findByText("First backend body");

    fireEvent.change(
      screen.getByRole("combobox", { name: "Hermes translation source language" }),
      { target: { value: "Chinese" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Hermes translation target language" }),
      { target: { value: "English" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 翻译当前邮件",
      }),
    );
    const translation = await screen.findByLabelText("Hermes 邮件翻译");
    fireEvent.click(
      within(translation).getByRole("button", {
        name: "Remember Hermes translation preference",
      }),
    );
    await waitFor(() => {
      expect(api.confirmTranslationPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          memoryScope: "sender:first@example.com",
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
      resolvePreference({
        memory: {
          id: "memory_stale_translation",
          accountId: "account_1",
          layer: "procedural_memory",
          scope: "sender:first@example.com",
          confidence: 0.92,
          content: { source: "translation_preference" },
          createdAt: "2026-06-13T10:00:00.000Z",
          updatedAt: "2026-06-13T10:00:00.000Z",
        },
      });
    });

    expect(screen.queryByText("Hermes 已记住这个翻译习惯。")).toBeNull();
    expect(screen.getByText("Second backend body")).toBeTruthy();
  });

  it("runs Hermes organization skills from the message reader", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );

    await waitFor(() => {
      expect(api.organizeMessage).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        language: "zh-CN",
        memoryScope: "sender:client@example.com",
        memoryLayers: [
          "contact_memory",
          "procedural_memory",
          "semantic_profile",
          "writing_style_profile",
        ],
      });
    });
    expect(api.triagePriorityWithHermes).not.toHaveBeenCalled();
    expect(api.suggestLabelsWithHermes).not.toHaveBeenCalled();
    expect(api.cleanupNewsletterWithHermes).not.toHaveBeenCalled();
    expect(api.extractActionItemsWithHermes).not.toHaveBeenCalled();
    const result = await screen.findByLabelText("Hermes 整理建议");
    expect(within(result).getByText(/优先级：优先/)).toBeTruthy();
    expect(within(result).getByText(/标签： 客户/)).toBeTruthy();
    expect(within(result).getByText(/订阅判断：个人邮件/)).toBeTruthy();
    expect(within(result).getByText(/Confirm launch schedule/)).toBeTruthy();
  }, 30_000);

  it("does not execute Hermes organization suggestions before explicit confirmation", async () => {
    const api = createApiFixture();
    vi.mocked(api.organizeMessage).mockResolvedValueOnce(
      hermesOrganizationResult({
        labels: {
          skillRunId: "run_labels_confirm",
          skillId: "label_suggest",
          labels: [{ name: "客户", confidence: 0.92, reason: "client thread" }],
          actions: [
            { type: "mark_important", reason: "deadline today" },
            { type: "apply_label", label: "客户", reason: "high confidence" },
          ],
        },
        newsletter: {
          skillRunId: "run_newsletter_confirm",
          skillId: "newsletter_cleanup",
          isNewsletter: true,
          confidence: 0.9,
          senderCategory: "newsletter",
          reasons: ["list sender"],
          actions: [
            { type: "move_to_feed", reason: "newsletter sender" },
            {
              type: "unsubscribe_later",
              unsubscribeUrl: "https://example.com/off",
            },
          ],
        },
        actionItems: {
          skillRunId: "run_actions_confirm",
          skillId: "action_item_extract",
          items: [
            {
              title: "Confirm launch schedule",
              owner: "me",
              dueAt: "2026-06-14T09:00:00.000Z",
              priority: "high",
              status: "open",
            },
          ],
        },
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");
    vi.mocked(api.applyMailAction).mockClear();
    vi.mocked(api.recordSmartInboxFeedback).mockClear();
    vi.mocked(api.createFollowUp).mockClear();

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );

    const result = await screen.findByLabelText("Hermes 整理建议");
    expect(
      within(result).getByRole("button", {
        name: "执行 Hermes 整理动作：标为重要",
      }),
    ).toBeTruthy();
    expect(
      within(result).getByRole("button", {
        name: "执行 Hermes 整理动作：移到动态",
      }),
    ).toBeTruthy();
    expect(
      within(result).getByRole("button", {
        name: "执行 Hermes 整理动作：应用标签 客户",
      }),
    ).toBeTruthy();
    expect(
      within(result).getByRole("button", {
        name: "创建 Hermes 跟进提醒：Confirm launch schedule",
      }),
    ).toBeTruthy();
    expect(within(result).getByText(/还有 1 条建议/)).toBeTruthy();
    expect(api.applyMailAction).not.toHaveBeenCalled();
    expect(api.upsertLabel).not.toHaveBeenCalled();
    expect(api.recordSmartInboxFeedback).not.toHaveBeenCalled();
    expect(api.createFollowUp).not.toHaveBeenCalled();
    expect(screen.queryByText(/正在|应用中|创建中/)).toBeNull();
  }, 30_000);

  it("keeps stale Hermes organization label results off a newly selected message", async () => {
    const api = createApiFixture();
    let resolveApplyLabel: MailActionResult | undefined;
    let completeApplyLabel: (value: MailActionResult) => void = () => {};

    mockTwoMessageReader(api);
    vi.mocked(api.organizeMessage).mockResolvedValueOnce(
      hermesOrganizationResult({
        labels: {
          skillRunId: "run_labels_stale",
          skillId: "label_suggest",
          labels: [],
          actions: [
            { type: "apply_label", label: "客户", reason: "high confidence" },
          ],
        },
      }),
    );
    vi.mocked(api.applyMailAction).mockImplementationOnce(
      (input) =>
        new Promise<MailActionResult>((resolve) => {
          completeApplyLabel = resolve;
          resolveApplyLabel = {
            accountId: input.accountId,
            messageId: input.messageId,
            action: input.action,
            state: {
              unread: false,
              starred: false,
              archived: false,
              deleted: false,
              mailboxIds: ["mailbox_inbox"],
              labelIds: input.labelIds ?? [],
              doneAt: null,
              undoToken: null,
              undoExpiresAt: null,
            },
            command: {
              id: "cmd_stale_label",
              commandType: "apply_labels",
              accountId: input.accountId,
              messageId: input.messageId,
              idempotencyKey: "mail-action",
              status: "queued",
            },
          };
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "First subject" });
    await screen.findByText("First backend body");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );
    await screen.findByLabelText("Hermes 整理建议", {}, { timeout: 10_000 });
    fireEvent.click(
      screen.getByRole("button", {
        name: "执行 Hermes 整理动作：应用标签 客户",
      }),
    );
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "apply_labels",
        labelIds: ["label_customer"],
      });
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
      completeApplyLabel(resolveApplyLabel!);
    });

    expect(screen.queryByText(/Hermes 建议已应用：应用标签 客户/)).toBeNull();
    expect(screen.getByText("Second backend body")).toBeTruthy();
  }, 30_000);

  it("applies safe Hermes organization suggestions through existing backend actions", async () => {
    const api = createApiFixture();
    vi.mocked(api.organizeMessage).mockResolvedValueOnce(
      hermesOrganizationResult({
        labels: {
          skillRunId: "run_labels_apply",
          skillId: "label_suggest",
          labels: [],
          actions: [
            { type: "mark_important", reason: "deadline today" },
            { type: "apply_label", label: "客户", reason: "high confidence" },
            { type: "apply_label", label: "项目", reason: "new project thread" },
            { type: "archive", reason: "cleanup" },
          ],
        },
        newsletter: {
          skillRunId: "run_newsletter_apply",
          skillId: "newsletter_cleanup",
          isNewsletter: false,
          confidence: 0.8,
          senderCategory: "personal",
          reasons: [],
          actions: [{ type: "mark_not_important", reason: "low value" }],
        },
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");
    vi.mocked(api.applyMailAction).mockClear();
    vi.mocked(api.recordSmartInboxFeedback).mockClear();

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );
    await screen.findByLabelText("Hermes 整理建议", {}, { timeout: 10_000 });
    vi.mocked(api.upsertLabel).mockClear();

    fireEvent.click(
      screen.getByRole("button", {
        name: "执行 Hermes 整理动作：标为重要",
      }),
    );
    await waitFor(() => {
      expect(api.recordSmartInboxFeedback).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "mark_important",
      });
    });
    expect(await screen.findByText("Hermes 建议已应用：标为重要。")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "执行 Hermes 整理动作：应用标签 客户",
      }),
    );
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "apply_labels",
        labelIds: ["label_customer"],
      });
    });
    expect(api.upsertLabel).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Hermes 建议已应用：应用标签 客户。写回状态：queued。"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "执行 Hermes 整理动作：应用标签 项目",
      }),
    );
    await waitFor(() => {
      expect(api.upsertLabel).toHaveBeenCalledWith({
        accountId: "account_1",
        name: "项目",
        color: "blue",
      });
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "apply_labels",
        labelIds: ["label_项目"],
      });
    });
    expect(
      await screen.findByText("Hermes 建议已应用：应用标签 项目。写回状态：queued。"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "执行 Hermes 整理动作：归档",
      }),
    );
    await waitFor(() => {
      expect(api.applyMailAction).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        action: "archive",
      });
    });
  }, 30_000);

  it("creates explicit follow-ups from dated Hermes action items", async () => {
    const api = createApiFixture();
    vi.mocked(api.organizeMessage).mockResolvedValueOnce(
      hermesOrganizationResult({
        actionItems: {
          skillRunId: "run_actions_due",
          skillId: "action_item_extract",
          items: [
            {
              title: "Confirm launch schedule",
              owner: "me",
              dueAt: "2026-06-14T09:00:00.000Z",
              priority: "high",
              status: "open",
              sourceQuote: "please confirm today",
            },
          ],
        },
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );
    await screen.findByLabelText("Hermes 整理建议", {}, { timeout: 10_000 });

    fireEvent.click(
      screen.getByRole("button", {
        name: "创建 Hermes 跟进提醒：Confirm launch schedule",
      }),
    );

    await waitFor(() => {
      expect(api.createFollowUp).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        dueAt: "2026-06-14T09:00:00.000Z",
        kind: "manual",
        title: "Confirm launch schedule",
        note: expect.stringContaining("负责人：me"),
        source: "hermes_followup",
        hermesSkillRunId: "run_actions_due",
      });
    });
  }, 30_000);

  it("keeps stale Hermes follow-up results off a newly selected message", async () => {
    const api = createApiFixture();
    let resolveFollowUp: (value: FollowUpDto) => void = () => {};

    mockTwoMessageReader(api);
    vi.mocked(api.organizeMessage).mockResolvedValueOnce(
      hermesOrganizationResult({
        actionItems: {
          skillRunId: "run_actions_stale",
          skillId: "action_item_extract",
          items: [
            {
              title: "Confirm launch schedule",
              owner: "me",
              dueAt: "2026-06-14T09:00:00.000Z",
              priority: "high",
              status: "open",
              sourceQuote: "please confirm today",
            },
          ],
        },
      }),
    );
    vi.mocked(api.createFollowUp).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFollowUp = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "First subject" });
    await screen.findByText("First backend body");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );
    await screen.findByLabelText("Hermes 整理建议", {}, { timeout: 10_000 });
    fireEvent.click(
      screen.getByRole("button", {
        name: "创建 Hermes 跟进提醒：Confirm launch schedule",
      }),
    );
    await waitFor(() => {
      expect(api.createFollowUp).toHaveBeenCalledWith({
        accountId: "account_1",
        messageId: "message_1",
        dueAt: "2026-06-14T09:00:00.000Z",
        kind: "manual",
        title: "Confirm launch schedule",
        note: expect.stringContaining("负责人：me"),
        source: "hermes_followup",
        hermesSkillRunId: "run_actions_stale",
      });
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
      resolveFollowUp(followUpFixture({ title: "Confirm launch schedule" }));
    });

    expect(screen.queryByText(/Hermes 待办提醒已创建/)).toBeNull();
    expect(screen.getByText("Second backend body")).toBeTruthy();
  }, 30_000);

  it("shows a safe Hermes organization apply failure without leaking backend details", async () => {
    const api = createApiFixture();
    vi.mocked(api.organizeMessage).mockResolvedValueOnce(
      hermesOrganizationResult({
        priority: {
          skillRunId: "run_priority_fail",
          skillId: "priority_triage",
          priority: "medium",
          bucket: "P2 Important",
          score: 72,
          reasons: ["needs review"],
          explanation: "Review when possible.",
        },
        labels: {
          skillRunId: "run_labels_fail",
          skillId: "label_suggest",
          labels: [],
          actions: [],
        },
        newsletter: {
          skillRunId: "run_newsletter_fail",
          skillId: "newsletter_cleanup",
          isNewsletter: false,
          confidence: 0.7,
          senderCategory: "personal",
          reasons: [],
          actions: [{ type: "mark_not_important", reason: "low value" }],
        },
        actionItems: {
          skillRunId: "run_actions_fail",
          skillId: "action_item_extract",
          items: [],
        },
      }),
    );
    vi.mocked(api.recordSmartInboxFeedback).mockRejectedValueOnce(
      new ApiRequestError(500, "internal_error", {
        error: "internal_error",
        detail: "postgres leaked token hermes-secret",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 整理当前邮件",
      }),
    );
    await screen.findByLabelText("Hermes 整理建议", {}, { timeout: 10_000 });

    fireEvent.click(
      screen.getByRole("button", {
        name: "执行 Hermes 整理动作：降低优先级",
      }),
    );

    expect(await screen.findByText("Hermes 建议应用失败：降低优先级。")).toBeTruthy();
    const pageText = document.body.textContent ?? "";
    expect(pageText).not.toContain("internal_error");
    expect(pageText).not.toContain("hermes-secret");
  }, 30_000);

  it("shows a reader-level Hermes error without replacing the message body", async () => {
    const api = createApiFixture();
    vi.mocked(api.summarizeMessage).mockRejectedValueOnce(new Error("offline"));

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 总结当前邮件",
      }),
    );

    expect(await screen.findByText("Hermes 总结暂时不可用。")).toBeTruthy();
    expect(screen.getByText("Live body from backend")).toBeTruthy();
    expect(screen.queryByText("需要确认发布时间，并在今天回复 Lina。")).toBeNull();
  });

  it("points reader Hermes users to runtime settings when the model gateway is not configured", async () => {
    const api = createApiFixture();
    vi.mocked(api.summarizeMessage).mockRejectedValueOnce(
      new ApiRequestError(503, "hermes_runtime_not_configured", {
        error: "hermes_runtime_not_configured",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 总结当前邮件",
      }),
    );

    expect(
      await screen.findByText(
        "Hermes 暂时不可用。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Live body from backend")).toBeTruthy();
  });

  it("explains when Hermes reader summary is disabled by skill settings", async () => {
    const api = createApiFixture();
    vi.mocked(api.listHermesSkills).mockResolvedValueOnce([
      hermesSkillFixture({
        id: "thread_summarize",
        title: "邮件总结",
        mode: "read",
        description: "总结邮件正文",
      }),
    ]);
    vi.mocked(api.summarizeMessage).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
        skillId: "thread_summarize",
        requiredPermission: "body_read",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 总结当前邮件",
      }),
    );

    expect(
      await screen.findByText(
        "Hermes 邮件总结暂时不可用。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Live body from backend")).toBeTruthy();
    expect(screen.queryByText("需要确认发布时间，并在今天回复 Lina。")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开能力选项" })).toBeNull();
  });

  it("ignores a stale Hermes reader summary after switching messages", async () => {
    const api = createApiFixture();
    let resolveSummary: (value: HermesMessageSummaryResult) => void = () => {};
    mockTwoMessageReader(api);
    vi.mocked(api.summarizeMessage).mockImplementationOnce(
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
        name: "让 Hermes 总结当前邮件",
      }),
    );
    await waitFor(() => {
      expect(api.summarizeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          messageId: "message_1",
          mode: "action_points",
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
        accountId: "account_1",
        messageId: "message_1",
        mode: "action_points",
        summaryText: "Stale summary should not render.",
        cached: false,
      });
    });

    expect(screen.queryByText("Stale summary should not render.")).toBeNull();
    expect(screen.getByText("Second backend body")).toBeTruthy();
  });

  it("ignores a stale Hermes reader translation after switching messages", async () => {
    const api = createApiFixture();
    let resolveTranslation: (value: HermesMessageTranslationResult) => void =
      () => {};
    mockTwoMessageReader(api);
    vi.mocked(api.translateMessage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranslation = resolve;
        }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "First subject" });
    await screen.findByText("First backend body");

    fireEvent.click(
      screen.getByRole("button", {
        name: "让 Hermes 翻译当前邮件",
      }),
    );
    await waitFor(() => {
      expect(api.translateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account_1",
          messageId: "message_1",
          targetLanguage: "Chinese",
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
      resolveTranslation({
        skillRunId: "run_stale_translation",
        auditEventId: "audit_stale_translation",
        skillId: "translate_text",
        accountId: "account_1",
        messageId: "message_1",
        sourceLanguage: "auto",
        targetLanguage: "Chinese",
        translatedText: "Stale translation should not render.",
        cached: false,
      });
    });

    expect(screen.queryByText("Stale translation should not render.")).toBeNull();
    expect(screen.queryByLabelText("Hermes 邮件翻译")).toBeNull();
    expect(screen.getByText("Second backend body")).toBeTruthy();
  });

  it("uses Hermes to suggest and confirm a follow-up reminder from the reader", async () => {
    const api = createApiFixture();

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", { name: "让 Hermes 跟进当前邮件" }),
    );

    expect(await screen.findByText("Check whether Lina replied")).toBeTruthy();
    expect(api.trackMessageFollowup).toHaveBeenCalledWith({
      accountId: "account_1",
      messageId: "message_1",
      language: "zh-CN",
      memoryScope: "sender:client@example.com",
      memoryLayers: [
        "contact_memory",
        "procedural_memory",
        "semantic_profile",
        "writing_style_profile",
      ],
    });
    expect(api.trackFollowup).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "确认 Hermes 跟进" }),
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

  it("keeps the Hermes follow-up suggestion when confirmation storage is unavailable", async () => {
    const api = createApiFixture();
    vi.mocked(api.confirmHermesFollowUp).mockRejectedValueOnce(
      new ApiRequestError(503, "hermes_follow_up_unavailable", {
        error: "hermes_follow_up_unavailable",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);
    await screen.findByRole("heading", { name: "Live subject" });
    await screen.findByText("Live body from backend");

    fireEvent.click(
      screen.getByRole("button", { name: "让 Hermes 跟进当前邮件" }),
    );

    const suggestionTitle = await screen.findByText("Hermes 跟进建议");
    expect(suggestionTitle.closest(".reason-box")?.textContent).toContain(
      "Check whether Lina replied",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "确认 Hermes 跟进" }),
    );

    expect(
      await screen.findByText(
        "Hermes 跟进保存失败。",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Hermes 跟进建议").closest(".reason-box")?.textContent,
    ).toContain("Check whether Lina replied");
  });
});
