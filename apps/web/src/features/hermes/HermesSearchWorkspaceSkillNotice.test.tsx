import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App";
import { ApiRequestError } from "../../lib/emailHubApi";
import type {
  EmailHubApi,
  HermesResourceProfileDto,
  HermesSkillDto,
  MessageDetailDto,
  MessageListItemDto,
} from "../../lib/emailHubApi";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("Hermes Search workspace skill notices", () => {
  it("opens the focused search skill settings when natural-language search is disabled", async () => {
    const api = createSearchSkillApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
        skillId: "email_search_qa",
        requiredPermission: "body_read",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await screen.findByRole("heading", { name: "Live subject" });
    await openSearchWorkspace();
    fireEvent.change(screen.getByLabelText("Hermes 搜索问题"), {
      target: { value: "客户上次提到的合同在哪里" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Hermes 自然语言搜索" }),
    );

    expect(
      await screen.findByText(
        "Hermes 搜索问答能力缺少正文读取权限，请到 Hermes 配置 > 能力选项打开“搜索问答”的“读取正文”开关。",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith({
        accountId: "account_1",
        question: "客户上次提到的合同在哪里",
        language: "zh-CN",
        limit: 10,
        memoryScope: "global",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "打开能力选项" }));

    expect(await screen.findByRole("heading", { name: "Hermes" })).toBeTruthy();
    const skillPanel = await screen.findByLabelText("Hermes skill settings");
    const focusedCard = await within(skillPanel).findByLabelText(
      "Focused Hermes skill 自然语言查邮件",
    );
    const bodyReadToggle = within(focusedCard).getByLabelText(
      "Allow Hermes body reads 自然语言查邮件",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(bodyReadToggle);
    });
  });

  it("opens Hermes runtime settings when the model gateway is not configured", async () => {
    const api = createSearchSkillApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(503, "hermes_runtime_not_configured", {
        error: "hermes_runtime_not_configured",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await screen.findByRole("heading", { name: "Live subject" });
    await openSearchWorkspace();
    fireEvent.change(screen.getByLabelText("Hermes 搜索问题"), {
      target: { value: "客户上次提到的合同在哪里" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Hermes 自然语言搜索" }),
    );

    expect(
      await screen.findByText(
        "Hermes 暂时不可用，请到 Hermes 配置检查网关连接。",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes 配置" }));

    expect(await screen.findByRole("heading", { name: "Hermes" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Hermes 配置" })).toBeTruthy();
  });

  it("routes dock runtime repairs from Settings child sections to Hermes settings", async () => {
    const api = createSearchSkillApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(503, "hermes_runtime_not_configured", {
        error: "hermes_runtime_not_configured",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await screen.findByRole("heading", { name: "Live subject" });
    await openAliasSettingsSection();
    submitDockPrompt("客户上次提到的合同在哪里");

    expect(
      await screen.findByText(
        "Hermes 暂时不可用，请到 Hermes 配置检查网关连接。",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes 配置" }));

    expect(await screen.findByRole("heading", { name: "Hermes 配置" })).toBeTruthy();
  });

  it("routes dock skill repairs from Settings child sections to Hermes skill settings", async () => {
    const api = createSearchSkillApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(403, "hermes_skill_disabled", {
        error: "hermes_skill_disabled",
        skillId: "email_search_qa",
        requiredPermission: "body_read",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await screen.findByRole("heading", { name: "Live subject" });
    await openAliasSettingsSection();
    submitDockPrompt("客户上次提到的合同在哪里");

    expect(
      await screen.findByText(
        "Hermes 搜索问答能力缺少正文读取权限，请到 Hermes 配置 > 能力选项打开“搜索问答”的“读取正文”开关。",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开能力选项" }));

    const skillPanel = await screen.findByLabelText("Hermes skill settings");
    const focusedCard = await within(skillPanel).findByLabelText(
      "Focused Hermes skill 自然语言查邮件",
    );
    const bodyReadToggle = within(focusedCard).getByLabelText(
      "Allow Hermes body reads 自然语言查邮件",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(bodyReadToggle);
    });
  });
});

function createSearchSkillApiFixture(): EmailHubApi {
  const message = messageListItemFixture();
  const api = {
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
    listMessages: vi.fn(async () => ({ items: [message] })),
    listLabels: vi.fn(async () => ({ items: [] })),
    getMessage: vi.fn(async () => messageDetailFixture()),
    listSendIdentities: vi.fn(async () => ({
      accountId: "account_1",
      items: [
        {
          id: "identity_account_1",
          accountId: "account_1",
          from: { address: "client@example.com", name: "Client Mail" },
          source: "account",
          isDefault: true,
          verified: true,
        },
      ],
      candidates: [],
    })),
    listMailDrafts: vi.fn(async () => ({ items: [] })),
    listOutbox: vi.fn(async () => ({ items: [] })),
    getMailNavigationSummary: vi.fn(async () => ({
      providerGroups: [],
      quickCategories: [],
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "client@example.com",
          provider: "gmail",
          authMethod: "oauth",
          displayName: "Client Mail",
          syncState: "running",
          engineProvider: "emailengine",
        },
      ],
    })),
    listDomains: vi.fn(async () => ({ items: [] })),
    searchMailWithHermes: vi.fn(),
    getHermesProviders: vi.fn(async () => ({
      providers: [
        {
          key: "hermes",
          label: "Hermes 服务",
          category: "gateway",
          authType: "api_key_optional",
          requestProtocol: "openai_chat_completions",
          endpointEditable: true,
          aliases: [],
          modelExamples: ["hermes-email"],
          capabilities: ["chat", "email_skills", "memory"],
        },
      ],
    })),
    getHermesRuntimeSettings: vi.fn(async () => ({
      enabled: true,
      mode: "external_hermes",
      providerKey: "hermes",
      endpointUrl: "http://hermes:4000/v1/chat/completions",
      model: "hermes-email",
      apiKeyConfigured: true,
      updatePolicy: "manual",
      updateChannel: "stable",
      installedVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      source: "database",
      updatedAt: "2026-06-14T08:00:00.000Z",
    })),
    listHermesSkills: vi.fn(async () => [searchSkillFixture()]),
    getHermesResourceProfile: vi.fn(async () => hermesResourceProfileFixture()),
    listHermesRules: vi.fn(async () => ({ items: [] })),
    listHermesRuleExecutions: vi.fn(async () => ({ items: [] })),
    listHermesRuleCandidates: vi.fn(async () => ({ items: [] })),
    listHermesMemories: vi.fn(async () => ({ items: [] })),
    listHermesAuditLog: vi.fn(async () => ({ items: [] })),
    listFollowUps: vi.fn(async () => ({ items: [] })),
  };

  return api as unknown as EmailHubApi;
}

async function openAliasSettingsSection() {
  fireEvent.click(
    within(screen.getByRole("navigation")).getByRole("button", {
      name: "设置",
    }),
  );
  const settingsNav = await screen.findByLabelText("设置目录");
  fireEvent.click(within(settingsNav).getByRole("button", { name: "别名转发" }));
  expect(await screen.findByRole("heading", { name: "别名转发" })).toBeTruthy();
}

async function openSearchWorkspace() {
  fireEvent.submit(screen.getByRole("search", { name: "全局邮件搜索" }));
  expect(await screen.findByRole("heading", { name: "搜索" })).toBeTruthy();
}

function submitDockPrompt(prompt: string) {
  fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
  fireEvent.change(screen.getByLabelText("Hermes 指令"), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送给 Hermes" }));
}

function messageListItemFixture(): MessageListItemDto {
  return {
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
  };
}

function messageDetailFixture(): MessageDetailDto {
  return {
    ...messageListItemFixture(),
    to: ["me@example.com"],
    cc: [],
    bodyText: "Live body from backend",
    attachments: [],
  };
}

function searchSkillFixture(): HermesSkillDto {
  return {
    id: "email_search_qa",
    title: "自然语言查邮件",
    mode: "read",
    description: "把问题转成搜索并总结结果",
    settings: {
      enabled: true,
      maxContextChars: 24000,
      memoryLimit: 6,
      allowBodyRead: false,
      allowMemoryWrite: false,
      requireConfirmation: false,
      customInstructions: "",
    },
    settingBounds: {
      maxContextChars: { min: 1000, max: 200000, step: 1000 },
      memoryLimit: { min: 0, max: 50, step: 1 },
      customInstructions: { maxLength: 2000 },
    },
  };
}

function hermesResourceProfileFixture(): HermesResourceProfileDto {
  return {
    skills: {
      total: 1,
      enabled: 1,
      bodyReadEnabled: 0,
      memoryWriteEnabled: 0,
      confirmationRequired: 0,
      maxContextCharsPerRun: 24000,
      maxMemoryItemsPerRun: 6,
      enabledContextBudgetChars: 24000,
      enabledMemoryBudgetItems: 6,
    },
    retention: {
      retentionDays: 30,
      cleanupIntervalMs: 3600000,
      cleanupLimit: 500,
      managedTables: ["hermes_skill_runs"],
    },
    deployment: {
      profile: "medium",
      recommendedMinimum: {
        cpuCores: 2,
        memoryGb: 6,
        diskGb: 30,
      },
      localModelRecommendedMinimum: {
        cpuCores: 6,
        memoryGb: 24,
        diskGb: 80,
      },
    },
    guardrails: ["Prompt context is capped per skill."],
  };
}
