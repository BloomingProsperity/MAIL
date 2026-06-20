import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

describe("Hermes search skill notices", () => {
  it("keeps internal search skill settings hidden when dock mail search is disabled", async () => {
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
    submitDockPrompt("客户上次提到的合同在哪里");

    expect(
      await screen.findByText(
        "Hermes 搜索问答暂时不可用。",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(api.searchMailWithHermes).toHaveBeenCalledWith({
        accountId: "account_1",
        question: "客户上次提到的合同在哪里",
        language: "zh-CN",
        limit: 5,
        memoryScope: "sender:client@example.com",
      });
    });

    expect(screen.queryByRole("button", { name: "打开能力选项" })).toBeNull();
    expect(screen.queryByLabelText("Hermes skill settings")).toBeNull();
  }, 15_000);

  it("opens Hermes runtime settings when the model gateway is not configured", async () => {
    const api = createSearchSkillApiFixture();
    vi.mocked(api.searchMailWithHermes).mockRejectedValueOnce(
      new ApiRequestError(503, "hermes_runtime_not_configured", {
        error: "hermes_runtime_not_configured",
      }),
    );

    render(<App api={api} defaultAccountId="account_1" />);

    await screen.findByRole("heading", { name: "Live subject" });
    submitDockPrompt("客户上次提到的合同在哪里");

    expect(
      await screen.findByText(
        "Hermes 暂时不可用。",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "设置 Hermes" }));

    expect(await screen.findByLabelText("Hermes 配置")).toBeTruthy();
  }, 15_000);

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
        "Hermes 暂时不可用。",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "设置 Hermes" }));

    expect(await screen.findByLabelText("Hermes 配置")).toBeTruthy();
  }, 15_000);

  it("keeps dock skill repairs internal from child sections", async () => {
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
        "Hermes 搜索问答暂时不可用。",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开能力选项" })).toBeNull();
    expect(screen.queryByLabelText("Hermes skill settings")).toBeNull();
  }, 15_000);
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
          key: "openai-api",
          label: "OpenAI",
          category: "cloud",
          authType: "api_key",
          requestProtocol: "openai_chat_completions",
          endpointEditable: true,
          aliases: ["openai"],
          modelExamples: ["gpt-5.2"],
          defaultEndpoint: "https://api.openai.com/v1/chat/completions",
          capabilities: ["chat", "email_skills"],
        },
      ],
    })),
    getHermesRuntimeSettings: vi.fn(async () => ({
      enabled: true,
      mode: "external_hermes",
      assistantName: "Hermes",
      providerKey: "openai-api",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5.2",
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
    getComposeAttachmentMaintenanceStatus: vi.fn(async () => ({
      generatedAt: "2026-06-16T00:00:00.000Z",
      storage: "local",
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      cleanupLimit: 100,
      protectedStorageKeyCount: 0,
      scanned: 0,
      scanLimit: 5000,
      scanLimited: false,
      uploads: 0,
      totalBytes: 0,
      protected: 0,
      fresh: 0,
      staleUnreferenced: 0,
      staleUnreferencedBytes: 0,
      invalid: 0,
    })),
    getHermesRetentionMaintenanceStatus: vi.fn(async () => ({
      generatedAt: "2026-06-17T12:00:00.000Z",
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      retentionDays: 30,
      cleanupLimit: 500,
      cutoff: "2026-05-18T12:00:00.000Z",
      tables: [],
      expiredRows: 0,
      scanLimited: false,
    })),
  };

  return api as unknown as EmailHubApi;
}

async function openAliasSettingsSection() {
  fireEvent.click(screen.getByRole("button", { name: "配置域名" }));
  expect(await screen.findByRole("heading", { name: "配置域名" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "域名管理" })).toBeTruthy();
}

function submitDockPrompt(prompt: string) {
  const openButton = screen.queryByRole("button", { name: "打开 Hermes" });
  if (openButton) {
    fireEvent.click(openButton);
  }
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
