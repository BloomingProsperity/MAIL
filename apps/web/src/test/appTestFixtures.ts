import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import type {
  AccountImportCreateResult,
  AccountImportPreview,
  AccountTransferImportResult,
  ApiHealthDto,
  AttachmentDownload,
  ComposeAttachmentMaintenanceCleanupResultDto,
  ComposeAttachmentMaintenanceStatusDto,
  EmailHubApi,
  FollowUpDto,
  FollowUpPage,
  HermesActionItemExtractResult,
  HermesActionPlanConfirmationDto,
  HermesActionPlanDto,
  HermesEmailSearchQaResult,
  HermesFollowupTrackerResult,
  HermesLabelSuggestResult,
  HermesMessageFollowupTrackerResult,
  HermesMessageOrganizationResult,
  HermesMessageQuickReplyResult,
  HermesMessageReplyDraftResult,
  HermesMessageSummaryResult,
  HermesMessageTranslationResult,
  HermesNewsletterCleanupResult,
  HermesPriorityTriageResult,
  HermesQuickReplyResult,
  HermesReplyDraftResult,
  HermesResourceProfileDto,
  HermesRetentionMaintenanceCleanupResultDto,
  HermesRetentionMaintenanceStatusDto,
  HermesRewritePolishResult,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleExecutionDto,
  HermesRuleSimulationDto,
  HermesSkillDto,
  HermesThreadSummaryResult,
  HermesTranslationPreferenceResult,
  HermesTranslateTextResult,
  HermesWorkspaceContextDto,
  MailActionResult,
  MailDraftDto,
  MailEngineHealthDto,
  MailNavigationSummaryDto,
  MailProviderCapabilityDto,
  MessageDetailDto,
  OAuthStartResult,
  ReauthorizationTaskDto,
  ScheduledSendDto,
  SyncManualResyncResult,
  SyncPauseResult,
  SyncResumeResult,
  SyncRetryFailedResult,
} from "../lib/emailHubApi";

export function hermesOrganizationResult(
  overrides: Partial<HermesMessageOrganizationResult> = {},
): HermesMessageOrganizationResult {
  return {
    accountId: "account_1",
    messageId: "message_1",
    priority: {
      skillRunId: "run_priority_1",
      skillId: "priority_triage",
      priority: "high",
      bucket: "P1 Urgent",
      score: 94,
      reasons: ["deadline today", "direct to you"],
      explanation: "Needs a reply today.",
    },
    labels: {
      skillRunId: "run_labels_1",
      skillId: "label_suggest",
      labels: [{ name: "客户", confidence: 0.92, reason: "client thread" }],
      actions: [
        { type: "apply_label", label: "客户", reason: "high confidence" },
      ],
    },
    newsletter: {
      skillRunId: "run_newsletter_1",
      skillId: "newsletter_cleanup",
      isNewsletter: false,
      confidence: 0.88,
      senderCategory: "personal",
      reasons: ["direct conversation"],
      actions: [{ type: "keep_in_inbox", reason: "needs reply" }],
    },
    actionItems: {
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
    },
    ...overrides,
  };
}

export function hermesSkillFixture(
  overrides: Partial<Omit<HermesSkillDto, "settings" | "settingBounds">> & {
    settings?: Partial<HermesSkillDto["settings"]>;
    settingBounds?: Partial<HermesSkillDto["settingBounds"]>;
  } = {},
): HermesSkillDto {
  return {
    id: "translate_text",
    title: "翻译邮件",
    mode: "read",
    description: "翻译邮件正文",
    ...overrides,
    settings: {
      enabled: true,
      maxContextChars: 24000,
      memoryLimit: 6,
      allowBodyRead: true,
      allowMemoryWrite: false,
      requireConfirmation: false,
      customInstructions: "",
      ...(overrides.settings ?? {}),
    },
    settingBounds: {
      maxContextChars: { min: 1000, max: 200000, step: 1000 },
      memoryLimit: { min: 0, max: 50, step: 1 },
      customInstructions: { maxLength: 2000 },
      ...(overrides.settingBounds ?? {}),
    },
  };
}

export function hermesResourceProfileFixture(
  overrides: Partial<HermesResourceProfileDto> = {},
): HermesResourceProfileDto {
  return {
    skills: {
      total: 14,
      enabled: 13,
      bodyReadEnabled: 12,
      memoryWriteEnabled: 5,
      confirmationRequired: 4,
      maxContextCharsPerRun: 24000,
      maxMemoryItemsPerRun: 6,
      enabledContextBudgetChars: 312000,
      enabledMemoryBudgetItems: 78,
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
    ...overrides,
  };
}

export function hermesRetentionMaintenanceStatusFixture(
  overrides: Partial<HermesRetentionMaintenanceStatusDto> = {},
): HermesRetentionMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-17T12:00:00.000Z",
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    retentionDays: 30,
    cleanupLimit: 500,
    cutoff: "2026-05-18T12:00:00.000Z",
    tables: [
      {
        table: "hermes_skill_runs",
        timestampColumn: "created_at",
        expiredRows: 12,
        scanLimit: 500,
        scanLimited: false,
      },
      {
        table: "hermes_audit_events",
        timestampColumn: "created_at",
        expiredRows: 6,
        scanLimit: 500,
        scanLimited: false,
      },
    ],
    expiredRows: 18,
    scanLimited: false,
    ...overrides,
  };
}

export function hermesRetentionMaintenanceCleanupFixture(
  overrides: Partial<HermesRetentionMaintenanceCleanupResultDto> = {},
): HermesRetentionMaintenanceCleanupResultDto {
  return {
    generatedAt: "2026-06-17T12:05:00.000Z",
    retentionMs: 14 * 24 * 60 * 60 * 1000,
    retentionDays: 14,
    cleanupLimit: 25,
    cutoff: "2026-06-03T12:05:00.000Z",
    cleanup: {
      messageTranslations: 1,
      messageSummaries: 2,
      staleActionPlanConfirmations: 2,
      actionPlans: 3,
      feedback: 4,
      auditEvents: 5,
      skillRuns: 6,
      deleted: 23,
    },
    after: hermesRetentionMaintenanceStatusFixture({
      generatedAt: "2026-06-17T12:05:00.000Z",
      retentionMs: 14 * 24 * 60 * 60 * 1000,
      retentionDays: 14,
      cleanupLimit: 25,
      cutoff: "2026-06-03T12:05:00.000Z",
      expiredRows: 0,
      tables: [],
    }),
    ...overrides,
  };
}

export function createDefaultMessageDetail(): MessageDetailDto {
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
    to: ["me@example.com"],
    cc: [],
    bodyText: "Live body from backend",
    attachments: [],
  };
}

export function mockTwoMessageReader(api: EmailHubApi): void {
  vi.mocked(api.listMessages).mockResolvedValue({
    items: [
      {
        id: "message_1",
        accountId: "account_1",
        subject: "First subject",
        from: { email: "first@example.com", name: "First Sender" },
        receivedAt: "2026-06-13T10:05:00.000Z",
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
        receivedAt: "2026-06-13T10:00:00.000Z",
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
    receivedAt: input.messageId === "message_2" ? "2026-06-13T10:00:00.000Z" : "2026-06-13T10:05:00.000Z",
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
      input.messageId === "message_2" ? "Second backend body" : "First backend body",
    attachments: [],
  }));
}

export function createApiFixture(): EmailHubApi {
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
    listLabels: vi.fn(async () => ({
      items: [
        {
          id: "label_customer",
          accountId: "account_1",
          name: "客户",
          color: "green" as const,
          messageCount: 18,
          createdAt: "2026-06-13T10:00:00.000Z",
        },
        {
          id: "label_code",
          accountId: "account_1",
          name: "验证码",
          color: "blue" as const,
          messageCount: 4,
          createdAt: "2026-06-13T10:01:00.000Z",
        },
      ],
    })),
    upsertLabel: vi.fn(async (input) => ({
      id: `label_${input.name}`,
      accountId: input.accountId,
      name: input.name,
      color: input.color ?? "blue",
      messageCount: 0,
      createdAt: "2026-06-13T10:02:00.000Z",
    })),
    getMessage: vi.fn(async () => createDefaultMessageDetail()),
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
        labelIds: input.action === "apply_labels" ? (input.labelIds ?? []) : [],
        doneAt: input.action === "done" ? "2026-06-13T10:00:00.000Z" : null,
        undoToken: input.action === "done" ? "undo_1" : null,
        undoExpiresAt:
          input.action === "done" ? "2026-06-13T10:00:05.000Z" : null,
      },
      command: {
        id: "cmd_1",
        commandType:
          input.action === "done"
            ? "archive"
            : input.action === "apply_labels"
              ? "apply_labels"
              : "move",
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
      assistantName: "Hermes",
      providerKey: "openai-api",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5.2",
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
          key: "openai-api",
          label: "OpenAI",
          category: "cloud" as const,
          authType: "api_key" as const,
          requestProtocol: "openai_chat_completions" as const,
          endpointEditable: true,
          aliases: ["openai"],
          modelExamples: ["gpt-5.2"],
          defaultEndpoint: "https://api.openai.com/v1/chat/completions",
          capabilities: ["chat", "email_skills"],
        },
        {
          key: "deepseek",
          label: "DeepSeek",
          category: "cloud" as const,
          authType: "api_key" as const,
          requestProtocol: "openai_chat_completions" as const,
          endpointEditable: true,
          aliases: [],
          modelExamples: ["deepseek-chat"],
          defaultEndpoint: "https://api.deepseek.com/v1/chat/completions",
          capabilities: ["chat", "email_skills"],
        },
        {
          key: "nvidia",
          label: "NVIDIA Build",
          category: "cloud" as const,
          authType: "api_key" as const,
          requestProtocol: "openai_chat_completions" as const,
          endpointEditable: true,
          aliases: ["nvidia-nim"],
          modelExamples: ["nvidia/llama-3.3-nemotron-super-49b-v1"],
          defaultEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
          capabilities: ["chat", "email_skills"],
        },
        {
          key: "custom",
          label: "自定义兼容服务",
          category: "custom" as const,
          authType: "api_key_optional" as const,
          requestProtocol: "openai_chat_completions" as const,
          endpointEditable: true,
          aliases: ["openai-compatible"],
          modelExamples: ["custom-model"],
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
      assistantName: input.assistantName,
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
      assistantName: input.assistantName,
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
      providerKey: "openai-api",
      requestProtocol: "openai_chat_completions" as const,
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5.2",
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
    listHermesSkills: vi.fn(async () => [
      hermesSkillFixture(),
      hermesSkillFixture({
        id: "reply_draft",
        title: "生成回复草稿",
        mode: "draft",
        description: "根据上下文生成可编辑回复",
        settings: {
          requireConfirmation: true,
        },
      }),
    ]),
    getHermesResourceProfile: vi.fn(async () => hermesResourceProfileFixture()),
    updateHermesSkillSettings: vi.fn(async (input) =>
      hermesSkillFixture({
        id: input.skillId,
        title: input.skillId === "translate_text" ? "翻译邮件" : input.skillId,
        settings: input.patch,
      }),
    ),
    listHermesMemories: vi.fn(async () => ({
      items: [
        {
          id: "memory_1",
          accountId: "account_1",
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
      accountId: input.accountId,
      layer: "writing_style_profile",
      scope: "global",
      content: input.content ?? { preference: "Keep replies concise." },
      confidence: input.confidence ?? 0.82,
      createdAt: "2026-06-14T08:00:00.000Z",
      updatedAt: "2026-06-14T10:00:00.000Z",
    })),
    deleteHermesMemory: vi.fn(async () => undefined),
    listHermesAuditLog: vi.fn(async () => ({
      items: [
        {
          id: "audit_translate_1",
          eventType: "hermes.skill.translate_text",
          skillRunId: "run_translate_1",
          skillId: "translate_text",
          skillTitle: "邮件翻译",
          readMessageIds: ["message_1"],
          memoryIds: ["memory_translation"],
          action: {
            skillId: "translate_text",
            targetLanguage: "zh-CN",
            memoryScope: "global",
          },
          input: {
            threadText: "Raw private body that must stay out of Settings.",
          },
          output: {
            translatedText: "Sensitive translated body that must stay hidden.",
          },
          createdAt: "2026-06-15T09:30:00.000Z",
        },
      ],
    })),
    previewAccountCsv: vi.fn(async () => ({
      summary: {
        totalRows: 3,
        ready: 1,
        needsOAuth: 0,
        disabled: 0,
        invalid: 2,
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
          status: "invalid" as const,
          errors: ["gmail must be added with web login, not CSV import"],
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
        needsOAuth: 0,
        disabled: 0,
        invalid: 2,
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
          status: "invalid" as const,
          errors: ["gmail must be added with web login, not CSV import"],
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
      createdTaskCount: 1,
      tasks: [
        {
          rowNumber: 2,
          id: "task_csv_1",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
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
    listOperationalEvents: vi.fn(async (input) => {
      if (
        input?.service === "email-hub-api" &&
        input.event === "emailengine_webhook_ingested"
      ) {
        return {
          items: [
            {
              id: "op_webhook_1",
              occurredAt: "2026-06-14T08:03:00.000Z",
              service: "email-hub-api",
              level: "info" as const,
              event: "emailengine_webhook_ingested",
              lane: "sync",
              accountId: "account_1",
              jobId: "job_webhook",
              context: {},
            },
          ],
        };
      }

      if (input?.service === "email-hub-worker" && input.lane === "sync") {
        return {
          items: [
            {
              id: "op_worker_1",
              occurredAt: "2026-06-14T08:04:00.000Z",
              service: "email-hub-worker",
              level: "info" as const,
              event: "worker_result",
              lane: "sync",
              accountId: "account_1",
              jobId: "job_sync",
              context: {},
            },
          ],
        };
      }

      return {
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
      };
    }),
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
    completeSyncCenterOAuthReauthorizationCallback: vi.fn(async () =>
      oauthCallbackFixture(),
    ),
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
        folders: [],
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
    getApiHealth: vi.fn(
      async () =>
        ({
          service: "email-hub-api",
          ok: true,
          checks: {
            database: "ok",
          },
        }) satisfies ApiHealthDto,
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
          connectionLabel: "邮箱授权",
          accountGroup: "domestic",
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
        mailProviderCapabilityFixture({
          provider: "qq",
          label: "QQ 邮箱",
          connectionLabel: "邮箱授权",
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
    getComposeAttachmentMaintenanceStatus: vi.fn(
      async () =>
        ({
          generatedAt: "2026-06-16T00:00:00.000Z",
          storage: "local",
          retentionMs: 7 * 24 * 60 * 60 * 1000,
          cleanupLimit: 100,
          protectedStorageKeyCount: 2,
          scanned: 12,
          scanLimit: 5000,
          scanLimited: false,
          uploads: 10,
          totalBytes: 8 * 1024 * 1024,
          protected: 2,
          fresh: 3,
          staleUnreferenced: 5,
          staleUnreferencedBytes: 2 * 1024 * 1024,
          invalid: 0,
        }) satisfies ComposeAttachmentMaintenanceStatusDto,
    ),
    cleanupComposeAttachments: vi.fn(
      async () =>
        ({
          generatedAt: "2026-06-16T00:05:00.000Z",
          storage: "local",
          retentionMs: 48 * 60 * 60 * 1000,
          cleanupLimit: 2,
          protectedStorageKeyCount: 2,
          cleanup: {
            scanned: 4,
            deleted: 2,
            retained: 2,
            skippedFresh: 1,
            skippedProtected: 1,
            skippedInvalid: 0,
            bytesDeleted: 4096,
          },
          after: {
            scanned: 10,
            scanLimit: 5000,
            scanLimited: false,
            uploads: 8,
            totalBytes: 7 * 1024 * 1024,
            protected: 2,
            fresh: 3,
            staleUnreferenced: 0,
            staleUnreferencedBytes: 0,
            invalid: 0,
          },
        }) satisfies ComposeAttachmentMaintenanceCleanupResultDto,
    ),
    getHermesRetentionMaintenanceStatus: vi.fn(
      async () => hermesRetentionMaintenanceStatusFixture(),
    ),
    cleanupHermesRetention: vi.fn(
      async () => hermesRetentionMaintenanceCleanupFixture(),
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
    verifyDomain: vi.fn(async (input) => ({
      id: input.domainId,
      domain: "demo.site",
      verificationStatus: "verified",
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
    configureDomainCloudflare: vi.fn(async () => ({
      zoneId: "zone_1",
      zoneName: "demo.site",
      records: [
        {
          type: "TXT" as const,
          name: "_emailhub.demo.site",
          value: "emailhub-domain-verification=domain_1",
          status: "created" as const,
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
    trackMessageFollowup: vi.fn(async (input) => ({
      skillRunId: "run_followup_1",
      skillId: "followup_tracker",
      accountId: input.accountId,
      messageId: input.messageId,
      status: "waiting_on_them",
      followupNeeded: true,
      owner: "them",
      confidence: 0.86,
      dueAt: "2026-06-14T09:00:00.000Z",
      nextAction: "Check whether Lina replied",
      reasons: ["we asked for confirmation and no reply yet"],
    } satisfies HermesMessageFollowupTrackerResult)),
    draftReply: vi.fn(async () => ({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      draftText: "Hi,\n\nI can confirm this plan.",
    } satisfies HermesReplyDraftResult)),
    draftMessageReply: vi.fn(async () => ({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      accountId: "account_1",
      messageId: "message_1",
      draftText: "Hi,\n\nI can confirm this plan.",
    } satisfies HermesMessageReplyDraftResult)),
    quickReply: vi.fn(async () => ({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    } satisfies HermesQuickReplyResult)),
    quickMessageReply: vi.fn(async () => ({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      accountId: "account_1",
      messageId: "message_1",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    } satisfies HermesMessageQuickReplyResult)),
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
        searchPlan: {
          searchQuery: "signed contract",
          quickFilters: ["attachments"],
          qScopes: ["sender", "recipients", "subject", "body"],
          filters: [
            {
              field: "hasAttachment",
              operator: "eq",
              value: true,
              label: "有附件",
            },
          ],
          listMessagesInput: {
            q: "signed contract",
            quickFilters: ["attachments"],
            qScopes: ["sender", "recipients", "subject", "body"],
            hasAttachment: true,
          },
          explanation: ["限制为带附件的邮件。"],
        },
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
    getHermesWorkspaceContext: vi.fn(async () => ({
      generatedAt: "2026-06-16T01:00:00.000Z",
      accountScope: {
        requestedAccountId: "account_1",
        availableAccountIds: ["account_1"],
        selectedAccount: {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          authMethod: "oauth",
          syncState: "syncing",
          engineProvider: "emailengine",
          reauthRequired: false,
          nextAction: "none",
          accountUpdatedAt: "2026-06-16T00:00:00.000Z",
        },
      },
      accounts: [
        {
          accountId: "account_1",
          email: "sync@example.com",
          provider: "gmail",
          authMethod: "oauth",
          syncState: "syncing",
          engineProvider: "emailengine",
          reauthRequired: false,
          nextAction: "none",
          accountUpdatedAt: "2026-06-16T00:00:00.000Z",
        },
      ],
      navigation: {
        folders: [],
        providerGroups: [{ id: "gmail", label: "Gmail", count: 7 }],
        quickCategories: [
          { id: "codes", label: "验证码", count: 4, tone: "blue" },
          { id: "receipts", label: "账单/收据", count: 2, tone: "green" },
        ],
      },
      labels: [
        {
          id: "label_code",
          accountId: "account_1",
          name: "验证码",
          color: "blue",
          messageCount: 4,
          createdAt: "2026-06-13T10:01:00.000Z",
        },
      ],
      rules: [
        {
          id: "rule_codes",
          accountId: "account_1",
          candidateId: "candidate_codes",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "verification", "otp"] },
          action: {
            type: "apply_label",
            labelId: "label_code",
            requiresConfirmation: false,
          },
          confidence: 0.9,
          enabled: true,
          sortOrder: 1000,
          createdAt: "2026-06-13T10:02:00.000Z",
          approvedAt: "2026-06-13T10:02:00.000Z",
        },
      ],
      pendingRuleCandidates: [],
      skills: [
        hermesSkillFixture({
          id: "translate_text",
          title: "翻译邮件",
          mode: "read",
          description: "翻译邮件正文",
        }),
        hermesSkillFixture({
          id: "rule_suggest",
          title: "规则建议",
          mode: "learn",
          description: "从重复行为生成规则建议",
          settings: {
            requireConfirmation: true,
          },
        }),
      ],
      mailEngine: {
        provider: "emailengine",
        ok: true,
        missing: [],
        warnings: [],
        readiness: {
          status: "ready",
          summary: "EmailEngine 已具备上线配置。",
        },
        capabilities: {
          imapSmtpOnboarding: true,
          attachmentDownload: true,
          send: true,
        },
      },
      operationBoundaries: [
        {
          id: "create_mailbox_rule",
          title: "创建邮箱规则和左侧分组",
          mode: "confirmation_required",
          description: "先模拟，再确认启用。",
        },
      ],
      unavailableModules: [],
    } satisfies HermesWorkspaceContextDto)),
    createHermesActionPlan: vi.fn(async () => ({
      id: "plan_1",
      auditEventId: "audit_plan_1",
      accountId: "account_1",
      command: "帮我创建一个规则，左侧加一个验证码分组，账号里的所有验证码邮件都进这个分组",
      intent: "create_mailbox_rule",
      status: "requires_confirmation",
      createdAt: "2026-06-13T10:00:00.000Z",
      candidate: {
        id: "candidate_codes",
        accountId: "account_1",
        title: "启用验证码智能分组",
        ruleType: "content_label",
        condition: {
          anyKeywords: ["验证码", "verification", "otp"],
        },
        action: {
          type: "apply_label",
          labelName: "验证码",
          labelColor: "blue",
          savedView: {
            id: "codes",
            label: "验证码",
            tone: "blue",
            kind: "keyword",
            keywords: ["验证码", "verification", "otp"],
          },
          providerWriteback: false,
          applyToHistory: true,
          requiresConfirmation: true,
        },
        confidence: 0.9,
        status: "shadow",
        evidenceMessageIds: [],
        createdAt: "2026-06-13T10:00:00.000Z",
      },
      simulation: {
        id: "run_rule_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
        mode: "shadow",
        matchedCount: 4,
        sampleMessageIds: ["message_1", "message_2"],
        actionPreview: {
          type: "apply_label",
          labelName: "验证码",
          labelColor: "blue",
          savedView: {
            id: "codes",
            label: "验证码",
            tone: "blue",
            kind: "keyword",
            keywords: ["验证码", "verification", "otp"],
          },
          providerWriteback: false,
        },
        createdAt: "2026-06-13T10:01:00.000Z",
      },
      workspace: {
        accountCount: 1,
        selectedAccountId: "account_1",
        provider: "gmail",
        quickCategoryCount: 2,
        labelCount: 1,
        ruleCount: 1,
        pendingRuleCandidateCount: 0,
        unavailableModules: [],
      },
      safety: {
        requiresUserConfirmation: true,
        providerWriteback: false,
        appliesToHistory: true,
        destructive: false,
      },
      steps: [
        {
          id: "read_workspace_context",
          title: "读取邮箱信息",
          mode: "read_only",
          status: "completed",
          detail: "Hermes 已读取账号、左侧分组、标签、规则和能力边界。",
        },
        {
          id: "draft_rule_candidate",
          title: "生成规则建议",
          mode: "draft",
          status: "completed",
          detail: "启用验证码智能分组",
        },
        {
          id: "shadow_simulation",
          title: "影子模拟",
          mode: "shadow_simulation",
          status: "completed",
          detail: "命中 4 封已同步邮件。",
        },
        {
          id: "confirm_rule",
          title: "等待用户确认",
          mode: "confirmation_required",
          status: "requires_confirmation",
          detail: "确认后会创建本地标签/左侧分组、启用规则，并回填已同步匹配邮件。",
        },
      ],
    } satisfies HermesActionPlanDto)),
    confirmHermesActionPlan: vi.fn(async () => ({
      id: "confirmation_1",
      auditEventId: "audit_confirm_1",
      memory: {
        id: "memory_rule_1",
        layer: "procedural_memory",
        scope: "global",
        content: {
          source: "hermes_action_plan",
          preference: "Keep verification code emails in the left-side group.",
        },
        confidence: 0.9,
        createdAt: "2026-06-13T10:02:00.000Z",
        updatedAt: "2026-06-13T10:02:00.000Z",
      },
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
      status: "completed",
      confirmedAt: "2026-06-13T10:02:00.000Z",
      rule: {
        id: "rule_codes",
        accountId: "account_1",
        candidateId: "candidate_codes",
        title: "启用验证码智能分组",
        ruleType: "content_label",
        condition: { anyKeywords: ["验证码", "verification", "otp"] },
        action: {
          type: "apply_label",
          labelId: "label_code",
          labelName: "验证码",
          labelColor: "blue",
          savedView: {
            id: "codes",
            label: "验证码",
            tone: "blue",
            kind: "keyword",
            keywords: ["验证码", "verification", "otp"],
          },
          applyToHistory: true,
          providerWriteback: false,
          requiresConfirmation: false,
        },
        confidence: 0.9,
        enabled: true,
        sortOrder: 1000,
        createdAt: "2026-06-13T10:02:00.000Z",
        approvedAt: "2026-06-13T10:02:00.000Z",
      },
      safety: {
        requiresUserConfirmation: false,
        providerWriteback: false,
        appliesToHistory: true,
        destructive: false,
      },
      historyBackfill: {
        accountId: "account_1",
        ruleId: "rule_codes",
        matchedCount: 4,
        appliedCount: 4,
        sampleMessageIds: ["message_1", "message_2"],
      },
      steps: [
        {
          id: "approve_rule_candidate",
          title: "启用规则",
          mode: "mutation",
          status: "completed",
          detail: "启用验证码智能分组",
        },
        {
          id: "backfill_history_labels",
          title: "回填历史邮件",
          mode: "mutation",
          status: "completed",
          detail: "匹配 4 封已同步邮件，新增 4 个标签关联。",
        },
        {
          id: "learn_procedural_memory",
          title: "学习用户习惯",
          mode: "mutation",
          status: "completed",
          detail: "Hermes 已把确认过的邮箱规则写入程序记忆。",
        },
      ],
    } satisfies HermesActionPlanConfirmationDto)),
    listHermesRules: vi.fn(async () => ({
      items: [
        {
          id: "rule_codes",
          accountId: "account_1",
          candidateId: "candidate_codes",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "verification", "otp"] },
          action: {
            type: "apply_label",
            labelId: "label_code",
            labelName: "验证码",
            labelColor: "blue",
            applyToHistory: true,
            providerWriteback: false,
            requiresConfirmation: false,
          },
          confidence: 0.9,
          enabled: true,
          sortOrder: 1000,
          createdAt: "2026-06-13T10:02:00.000Z",
          approvedAt: "2026-06-13T10:02:00.000Z",
        },
      ],
    })),
    updateHermesRule: vi.fn(async (input) => ({
      id: input.ruleId,
      accountId: input.accountId,
      candidateId: "candidate_codes",
      title: "启用验证码智能分组",
      ruleType: "content_label",
      condition: { anyKeywords: ["验证码", "verification", "otp"] },
      action: {
        type: "apply_label",
        labelId: "label_code",
        labelName: "验证码",
        labelColor: "blue",
        applyToHistory: true,
        providerWriteback: false,
        requiresConfirmation: false,
      },
      confidence: 0.9,
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? 1000,
      createdAt: "2026-06-13T10:02:00.000Z",
      approvedAt: "2026-06-13T10:02:00.000Z",
    } satisfies HermesRuleDto)),
    runHermesRule: vi.fn(async (input) => ({
      id: "run_active_1",
      accountId: input.accountId,
      ruleId: input.ruleId,
      mode: "active",
      matchedCount: 7,
      appliedCount: 3,
      sampleMessageIds: ["message_1", "message_2"],
      actionPreview: {
        type: "apply_label",
        labelId: "label_code",
        labelName: "验证码",
      },
      createdAt: "2026-06-13T10:30:00.000Z",
    } satisfies HermesRuleExecutionDto)),
    listHermesRuleExecutions: vi.fn(async () => ({
      items: [],
    })),
    listHermesRuleCandidates: vi.fn(async () => ({
      items: [],
    })),
    updateHermesRuleCandidate: vi.fn(async (input) => ({
      id: input.candidateId,
      accountId: input.accountId,
      title: `创建${input.labelName ?? "验证码"}智能分组`,
      ruleType: "content_label",
      condition: {
        anyKeywords: input.keywords ?? ["验证码", "verification", "otp"],
      },
      action: {
        type: "apply_label",
        labelName: input.labelName ?? "验证码",
        labelColor: input.labelColor ?? "blue",
        providerWriteback: false,
        applyToHistory: input.applyToHistory ?? false,
        requiresConfirmation: true,
      },
      confidence: 0.9,
      status: "shadow",
      evidenceMessageIds: [],
      createdAt: "2026-06-13T10:00:00.000Z",
    } satisfies HermesRuleCandidateDto)),
    draftHermesRule: vi.fn(async () => ({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: {
            anyKeywords: ["验证码", "verification", "otp"],
          },
          action: {
            type: "apply_label",
            labelName: "验证码",
            labelColor: "blue",
            providerWriteback: false,
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    } satisfies { candidates: HermesRuleCandidateDto[] })),
    suggestHermesRules: vi.fn(async () => ({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: {
            anyKeywords: ["验证码", "verification", "otp"],
          },
          action: {
            type: "apply_label",
            labelName: "验证码",
            labelColor: "blue",
            providerWriteback: false,
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    } satisfies { candidates: HermesRuleCandidateDto[] })),
    simulateHermesRule: vi.fn(async (input) => ({
      id: "run_rule_1",
      accountId: input.accountId,
      candidateId: input.candidateId,
      mode: "shadow",
      matchedCount: 4,
      sampleMessageIds: ["message_1", "message_2"],
      actionPreview: {
        type: "apply_label",
        labelName: "验证码",
        labelColor: "blue",
        providerWriteback: false,
      },
      createdAt: "2026-06-13T10:01:00.000Z",
    } satisfies HermesRuleSimulationDto)),
    dismissHermesRuleCandidate: vi.fn(async (input) => ({
      id: input.candidateId,
      accountId: input.accountId,
      title: "启用验证码智能分组",
      ruleType: "content_label",
      condition: { anyKeywords: ["验证码", "verification", "otp"] },
      action: {
        type: "apply_label",
        labelName: "验证码",
        labelColor: "blue",
        providerWriteback: false,
        requiresConfirmation: true,
      },
      confidence: 0.9,
      status: "dismissed",
      evidenceMessageIds: [],
      createdAt: "2026-06-13T10:00:00.000Z",
    } satisfies HermesRuleCandidateDto)),
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
    organizeMessage: vi.fn(async () => hermesOrganizationResult()),
    translateText: vi.fn(async (input) => ({
      skillRunId: "run_translate_1",
      skillId: "translate_text",
      sourceLanguage: "auto",
      targetLanguage: input.targetLanguage,
      translatedText:
        input.targetLanguage === "English"
          ? "Hello, please confirm the launch plan."
          : "你好，请确认发布计划。",
    } satisfies HermesTranslateTextResult)),
    translateMessage: vi.fn(async (input) => ({
      skillRunId: "run_translate_1",
      auditEventId: "audit_translate_1",
      skillId: "translate_text",
      accountId: input.accountId,
      messageId: input.messageId,
      sourceLanguage: input.sourceLanguage ?? "auto",
      targetLanguage: input.targetLanguage,
      translatedText:
        input.targetLanguage === "English"
          ? "Hello, please confirm the launch plan."
          : "你好，请确认发布计划。",
      cached: false,
    } satisfies HermesMessageTranslationResult)),
    confirmTranslationPreference: vi.fn(async (input) => ({
      memory: {
        id: "memory_translation_1",
        layer: "procedural_memory" as const,
        scope: input.memoryScope ?? "global",
        confidence: 0.92,
        content: {
          source: "translation_preference",
          mode: input.mode,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
        },
        createdAt: "2026-06-13T10:00:00.000Z",
        updatedAt: "2026-06-13T10:00:00.000Z",
      },
    } satisfies HermesTranslationPreferenceResult)),
    summarizeThread: vi.fn(async () => ({
      skillRunId: "run_summary_1",
      skillId: "thread_summarize",
      mode: "action_points",
      summaryText: "需要确认发布时间，并在今天回复 Lina。",
    } satisfies HermesThreadSummaryResult)),
    summarizeMessage: vi.fn(async (input) => ({
      skillRunId: "run_summary_1",
      skillId: "thread_summarize",
      accountId: input.accountId,
      messageId: input.messageId,
      mode: input.mode ?? "detailed",
      summaryText: "需要确认发布时间，并在今天回复 Lina。",
      cached: false,
    } satisfies HermesMessageSummaryResult)),
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
    diagnoseProviderSendIdentityCandidate: vi.fn(async (input) => ({
      accountId: input.accountId,
      candidateId: input.candidateId,
      provider: "graph" as const,
      generatedAt: "2026-06-15T20:25:00.000Z",
      from: { address: "shared@example.com", name: "Shared" },
      identityType: "shared_mailbox" as const,
      status: "target_verification_recommended" as const,
      summary:
        "From 可用；如果需要邮件进入共享邮箱 Sent Items，请继续验证目标邮箱。",
      sendPath: "me" as const,
      sentItemsBehavior: "signed_in_user" as const,
      discoverySupported: false as const,
      checks: [
        {
          id: "explicit_candidate",
          status: "info" as const,
          title: "显式共享发件人",
          detail:
            "Microsoft Graph 不能可靠枚举当前用户可用的共享邮箱，本候选项由用户显式添加。",
        },
        {
          id: "from_permission",
          status: "pass" as const,
          title: "From 权限",
          detail: "Graph 已接受 /me/sendMail 携带该 From 地址。",
        },
        {
          id: "sent_items_target",
          status: "warning" as const,
          title: "共享邮箱 Sent Items",
          detail:
            "当前会走 /me/sendMail，发送副本保存在登录账号 Sent Items；可继续验证共享邮箱目标路径。",
          action: "验证共享邮箱目标路径",
        },
      ],
      nextActions: [
        "如需共享邮箱 Sent Items 归档，输入目标邮箱并运行共享邮箱目标验证。",
      ],
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

export async function openComposeWindow() {
  const [composeButton] = await screen.findAllByRole("button", {
    name: "写邮件",
  });
  fireEvent.click(composeButton);
  await screen.findByLabelText("Compose body");
}

export async function openAdvancedSenderPanel() {
  fireEvent.click(
    await screen.findByRole("button", { name: "管理发件身份" }),
  );
  await screen.findByLabelText("Outlook shared sender candidates");
}

export function restoreUrlDownloadMethod(
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

export function mailProviderCapabilityFixture(
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

export function oauthStartFixture(): OAuthStartResult {
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

export function oauthCallbackFixture() {
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

export function reauthorizationTaskFixture(
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

export function followUpFixture(overrides: Partial<FollowUpDto> = {}): FollowUpDto {
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

export function mailDraftFixture(overrides: Partial<MailDraftDto> = {}): MailDraftDto {
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

export function scheduledSendFixture(
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
