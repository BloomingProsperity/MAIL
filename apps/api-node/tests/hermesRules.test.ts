import { describe, expect, it } from "vitest";

import {
  createHermesRuleService,
  createInMemoryHermesRuleStore,
  InvalidHermesRuleRequestError,
} from "../src/hermes/rules";

describe("Hermes rule learning service", () => {
  it("drafts a safe content label rule from a mailbox rule command", async () => {
    const store = createInMemoryHermesRuleStore({
      messages: [
        message("msg_1", "login@example.com", "Your OTP verification code"),
        message("msg_2", "client@example.com", "Contract update"),
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["candidate_codes", "run_1"]),
      now: () => "2026-06-13T10:00:00.000Z",
    });

    const draft = await service.draftRule({
      accountId: "account_1",
      command: "帮我创建一个规则，左侧加一个验证码分组，验证码邮件都进这个分组",
    });

    expect(draft.candidates).toEqual([
      expect.objectContaining({
        id: "candidate_codes",
        accountId: "account_1",
        title: "启用验证码智能分组",
        ruleType: "content_label",
        condition: {
          anyKeywords: expect.arrayContaining(["验证码", "verification", "otp"]),
        },
        action: expect.objectContaining({
          type: "apply_label",
          labelName: "验证码",
          labelColor: "blue",
          savedView: expect.objectContaining({
            id: "codes",
            label: "验证码",
            kind: "keyword",
            keywords: expect.arrayContaining(["验证码", "verification", "otp"]),
          }),
          providerWriteback: false,
          requiresConfirmation: true,
        }),
        status: "shadow",
      }),
    ]);

    await expect(
      service.simulateRule({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 10,
      }),
    ).resolves.toMatchObject({
      matchedCount: 1,
      sampleMessageIds: ["msg_1"],
    });
  });

  it("drafts built-in semantic groups for common mailbox rule commands", async () => {
    const cases = [
      {
        command: "把所有发票和账单邮件放到账单分组",
        expectedId: "receipts",
        expectedLabel: "发票/账单",
        expectedKeywords: ["发票", "账单", "invoice", "receipt"],
      },
      {
        command: "快递物流邮件自动进物流分组",
        expectedId: "shipping",
        expectedLabel: "快递/物流",
        expectedKeywords: ["快递", "物流", "tracking", "delivery"],
      },
      {
        command: "会议邀请和日程邮件归到日程分组",
        expectedId: "meetings",
        expectedLabel: "会议/日程",
        expectedKeywords: ["会议", "日程", "meeting", "calendar"],
      },
      {
        command: "把订阅 newsletter 和营销邮件自动移到订阅分组",
        expectedId: "newsletters",
        expectedLabel: "订阅/营销",
        expectedKeywords: ["订阅", "newsletter", "promotion"],
      },
    ];

    for (const item of cases) {
      const store = createInMemoryHermesRuleStore();
      const service = createHermesRuleService({
        store,
        createId: nextId([`candidate_${item.expectedId}`]),
        now: () => "2026-06-13T10:00:00.000Z",
      });

      const draft = await service.draftRule({
        accountId: "account_1",
        command: item.command,
      });

      expect(draft.candidates[0]).toMatchObject({
        id: `candidate_${item.expectedId}`,
        title: `启用${item.expectedLabel}智能分组`,
        condition: {
          anyKeywords: expect.arrayContaining(item.expectedKeywords),
        },
        action: {
          type: "apply_label",
          labelName: item.expectedLabel,
          savedView: {
            id: item.expectedId,
            label: item.expectedLabel,
            keywords: expect.arrayContaining(item.expectedKeywords),
          },
          providerWriteback: false,
          requiresConfirmation: true,
        },
      });
    }
  });

  it("marks explicit all-mail commands for local history backfill", async () => {
    const store = createInMemoryHermesRuleStore({
      messages: [
        message("msg_1", "login@example.com", "Your OTP verification code"),
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["candidate_codes"]),
      now: () => "2026-06-13T10:00:00.000Z",
    });

    const draft = await service.draftRule({
      accountId: "account_1",
      command: "帮我创建一个规则，账号里的所有验证码邮件都进验证码分组",
    });

    expect(draft.candidates[0]).toMatchObject({
      action: {
        type: "apply_label",
        applyToHistory: true,
        providerWriteback: false,
        requiresConfirmation: true,
      },
    });
  });

  it("updates shadow content label candidates before simulation and approval", async () => {
    const upsertedLabels: unknown[] = [];
    const store = createInMemoryHermesRuleStore({
      messages: [
        message("msg_receipt", "billing@example.com", "Invoice receipt"),
        message("msg_code", "login@example.com", "Your OTP verification code"),
      ],
    });
    const service = createHermesRuleService({
      store,
      labelService: {
        async upsertLabel(input) {
          upsertedLabels.push(input);
          return {
            id: "label_receipts",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-13T10:09:00.000Z",
          };
        },
      },
      createId: nextId(["candidate_codes", "run_receipts", "rule_receipts"]),
      now: () => "2026-06-13T10:00:00.000Z",
    });

    await service.draftRule({
      accountId: "account_1",
      command: "帮我创建一个验证码分组规则",
    });

    const updated = await service.updateRuleCandidate({
      accountId: "account_1",
      candidateId: "candidate_codes",
      labelName: "票据",
      keywords: ["receipt", "invoice", "发票", "receipt"],
      applyToHistory: true,
    });

    expect(updated).toMatchObject({
      id: "candidate_codes",
      title: "创建票据智能分组",
      condition: { anyKeywords: ["receipt", "invoice", "发票"] },
      action: {
        type: "apply_label",
        labelName: "票据",
        applyToHistory: true,
        providerWriteback: false,
        requiresConfirmation: true,
      },
      status: "shadow",
    });

    await expect(
      service.simulateRule({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 10,
      }),
    ).resolves.toMatchObject({
      id: "run_receipts",
      matchedCount: 1,
      sampleMessageIds: ["msg_receipt"],
      actionPreview: expect.objectContaining({
        labelName: "票据",
        applyToHistory: true,
      }),
    });

    const rule = await service.approveRule({
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(upsertedLabels).toEqual([
      { accountId: "account_1", name: "票据", color: "blue" },
    ]);
    expect(rule).toMatchObject({
      id: "rule_receipts",
      title: "创建票据智能分组",
      condition: { anyKeywords: ["receipt", "invoice", "发票"] },
      action: {
        labelId: "label_receipts",
        labelName: "票据",
        applyToHistory: true,
        providerWriteback: false,
        requiresConfirmation: false,
      },
    });
  });

  it("does not update approved rule candidates", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: {
            type: "apply_label",
            labelName: "验证码",
            labelColor: "blue",
            providerWriteback: false,
            requiresConfirmation: false,
          },
          confidence: 0.9,
          status: "approved",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId([]),
      now: () => "2026-06-13T10:00:00.000Z",
    });

    await expect(
      service.updateRuleCandidate({
        accountId: "account_1",
        candidateId: "candidate_codes",
        labelName: "票据",
        keywords: ["receipt"],
      }),
    ).resolves.toBeUndefined();
  });

  it("dismisses only shadow rule candidates before approval", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: {
            type: "apply_label",
            labelName: "验证码",
            labelColor: "blue",
            providerWriteback: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-13T10:00:00.000Z",
    });

    await expect(
      service.dismissRuleCandidate({
        accountId: "account_1",
        candidateId: "candidate_codes",
      }),
    ).resolves.toMatchObject({
      id: "candidate_codes",
      accountId: "account_1",
      status: "dismissed",
    });

    await expect(
      service.approveRule({
        accountId: "account_1",
        candidateId: "candidate_codes",
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.listRuleCandidates({
        accountId: "account_1",
        status: "shadow",
        limit: 20,
      }),
    ).resolves.toEqual({ items: [] });
    await expect(
      service.dismissRuleCandidate({
        accountId: "account_1",
        candidateId: "candidate_codes",
      }),
    ).resolves.toBeUndefined();
  });

  it("approves a content label candidate by upserting the account label", async () => {
    const upsertedLabels: unknown[] = [];
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "verification", "otp"] },
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
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      labelService: {
        async upsertLabel(input) {
          upsertedLabels.push(input);
          return {
            id: "label_codes",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-13T10:09:00.000Z",
          };
        },
      },
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    const result = await service.approveRule({
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(upsertedLabels).toEqual([
      { accountId: "account_1", name: "验证码", color: "blue" },
    ]);
    expect(result).toMatchObject({
      id: "rule_codes",
      accountId: "account_1",
      candidateId: "candidate_codes",
      ruleType: "content_label",
      action: {
        type: "apply_label",
        labelId: "label_codes",
        labelName: "验证码",
        labelColor: "blue",
        savedView: {
          id: "codes",
          label: "验证码",
          tone: "blue",
          kind: "keyword",
          keywords: expect.arrayContaining(["验证码", "verification", "otp"]),
        },
        applyToHistory: false,
        providerWriteback: false,
        requiresConfirmation: false,
      },
      enabled: true,
    });
    expect(store.listSavedViews()).toEqual([]);
  });

  it("backfills approved local labels across matching history", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: {
            type: "apply_label",
            labelName: "验证码",
            labelColor: "blue",
            providerWriteback: false,
            applyToHistory: true,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
      messages: [
        message("msg_1", "login@example.com", "Your OTP verification code"),
        message("msg_2", "login@example.com", "验证码 482911"),
        message("msg_3", "client@example.com", "Contract update"),
      ],
    });
    const service = createHermesRuleService({
      store,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_codes",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-13T10:09:00.000Z",
          };
        },
      },
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    const rule = await service.approveRule({
      accountId: "account_1",
      candidateId: "candidate_codes",
    });
    const firstBackfill = await service.backfillRuleHistory({
      accountId: "account_1",
      ruleId: rule!.id,
      limit: 100,
    });
    const secondBackfill = await service.backfillRuleHistory({
      accountId: "account_1",
      ruleId: rule!.id,
      limit: 100,
    });

    expect(rule?.action).toMatchObject({
      type: "apply_label",
      labelId: "label_codes",
      applyToHistory: true,
      providerWriteback: false,
    });
    expect(firstBackfill).toEqual({
      accountId: "account_1",
      ruleId: "rule_codes",
      matchedCount: 2,
      appliedCount: 2,
      sampleMessageIds: ["msg_1", "msg_2"],
    });
    expect(secondBackfill).toEqual({
      accountId: "account_1",
      ruleId: "rule_codes",
      matchedCount: 2,
      appliedCount: 0,
      sampleMessageIds: ["msg_1", "msg_2"],
    });
  });

  it("manually runs an enabled content label rule and records an active execution", async () => {
    const store = createInMemoryHermesRuleStore({
      rules: [
        {
          id: "rule_codes",
          accountId: "account_1",
          candidateId: "candidate_codes",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: {
            type: "apply_label",
            labelId: "label_codes",
            labelName: "验证码",
          },
          confidence: 0.9,
          enabled: true,
          sortOrder: 1000,
          createdAt: "2026-06-13T10:10:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        },
      ],
      messages: [
        message("msg_1", "login@example.com", "Your OTP verification code"),
        message("msg_2", "login@example.com", "验证码 482911"),
        message("msg_3", "client@example.com", "Contract update"),
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["run_active_1", "run_active_2"]),
      now: () => "2026-06-13T10:30:00.000Z",
    });

    const firstRun = await service.runRule({
      accountId: "account_1",
      ruleId: "rule_codes",
      limit: 100,
    });
    const secondRun = await service.runRule({
      accountId: "account_1",
      ruleId: "rule_codes",
      limit: 100,
    });

    expect(firstRun).toEqual({
      id: "run_active_1",
      mode: "active",
      accountId: "account_1",
      ruleId: "rule_codes",
      matchedCount: 2,
      appliedCount: 2,
      sampleMessageIds: ["msg_1", "msg_2"],
      actionPreview: {
        type: "apply_label",
        labelId: "label_codes",
        labelName: "验证码",
      },
      createdAt: "2026-06-13T10:30:00.000Z",
    });
    expect(secondRun).toMatchObject({
      id: "run_active_2",
      mode: "active",
      matchedCount: 2,
      appliedCount: 0,
    });
    expect(store.listRuns()).toEqual([
      firstRun,
      secondRun,
    ]);
    await expect(
      service.listRuleExecutions({
        accountId: "account_1",
        ruleId: "rule_codes",
        limit: 10,
      }),
    ).resolves.toEqual({
      items: [secondRun, firstRun],
    });
  });

  it("does not manually run disabled Hermes rules", async () => {
    const store = createInMemoryHermesRuleStore({
      rules: [
        {
          id: "rule_codes",
          accountId: "account_1",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: {
            type: "apply_label",
            labelId: "label_codes",
            labelName: "验证码",
          },
          confidence: 0.9,
          enabled: false,
          sortOrder: 1000,
          createdAt: "2026-06-13T10:10:00.000Z",
        },
      ],
      messages: [
        message("msg_1", "login@example.com", "验证码 482911"),
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: () => "run_should_not_exist",
      now: () => "2026-06-13T10:30:00.000Z",
    });

    await expect(
      service.runRule({
        accountId: "account_1",
        ruleId: "rule_codes",
      }),
    ).resolves.toBeUndefined();
    expect(store.listRuns()).toEqual([]);
  });

  it("does not upsert labels for content candidates that already left shadow mode", async () => {
    const upsertedLabels: unknown[] = [];
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_codes",
          accountId: "account_1",
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
          status: "approved",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      labelService: {
        async upsertLabel(input) {
          upsertedLabels.push(input);
          throw new Error("should not upsert");
        },
      },
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    await expect(
      service.approveRule({
        accountId: "account_1",
        candidateId: "candidate_codes",
      }),
    ).resolves.toBeUndefined();
    expect(upsertedLabels).toEqual([]);
  });

  it("derives a saved view when approving older content label candidates", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_invoices",
          accountId: "account_1",
          title: "创建 Invoices 智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["invoice", "receipt"] },
          action: {
            type: "apply_label",
            labelName: "Invoices",
            labelColor: "green",
            providerWriteback: false,
            requiresConfirmation: true,
          },
          confidence: 0.78,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_invoices",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-13T10:09:00.000Z",
          };
        },
      },
      createId: nextId(["rule_invoices"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    await service.approveRule({
      accountId: "account_1",
      candidateId: "candidate_invoices",
    });

    expect(store.listSavedViews()).toEqual([
      {
        id: "hermes_invoices",
        label: "Invoices",
        tone: "green",
        kind: "keyword",
        keywords: ["invoice", "receipt"],
      },
    ]);
  });

  it("suggests a shadow sender rule after repeated user feedback", async () => {
    const store = createInMemoryHermesRuleStore({
      observedBehaviors: [
        behavior("msg_1", "client@example.com", "always_important_sender"),
        behavior("msg_2", "client@example.com", "always_important_sender"),
        behavior("msg_3", "news@example.com", "move_to_feed"),
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["candidate_1"]),
      now: () => "2026-06-13T10:00:00.000Z",
    });

    const result = await service.suggestRules({
      accountId: "account_1",
      behaviorWindowDays: 30,
      minEvidenceCount: 2,
    });

    expect(result.candidates).toEqual([
      {
        id: "candidate_1",
        accountId: "account_1",
        title: "Prioritize client@example.com",
        ruleType: "sender_priority",
        condition: { senderEmail: "client@example.com" },
        action: {
          type: "classify_sender",
          bucket: "P2 Important",
          priorityScore: 90,
          reason: "Hermes learned you often mark this sender important.",
        },
        confidence: 0.85,
        status: "shadow",
        evidenceMessageIds: ["msg_1", "msg_2"],
        createdAt: "2026-06-13T10:00:00.000Z",
      },
    ]);
  });

  it("simulates a candidate in shadow mode without enabling the rule", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_1",
          accountId: "account_1",
          title: "Prioritize client@example.com",
          ruleType: "sender_priority",
          condition: { senderEmail: "client@example.com" },
          action: {
            type: "classify_sender",
            bucket: "P2 Important",
            priorityScore: 90,
            reason: "Hermes learned you often mark this sender important.",
          },
          confidence: 0.85,
          status: "shadow",
          evidenceMessageIds: ["msg_1", "msg_2"],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
      messages: [
        message("msg_1", "client@example.com", "Contract update"),
        message("msg_2", "client@example.com", "Invoice follow-up"),
        message("msg_3", "other@example.com", "FYI"),
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["run_1"]),
      now: () => "2026-06-13T10:05:00.000Z",
    });

    const result = await service.simulateRule({
      accountId: "account_1",
      candidateId: "candidate_1",
      sampleLimit: 10,
    });

    expect(result).toEqual({
      id: "run_1",
      accountId: "account_1",
      candidateId: "candidate_1",
      mode: "shadow",
      matchedCount: 2,
      sampleMessageIds: ["msg_1", "msg_2"],
      actionPreview: {
        type: "classify_sender",
        bucket: "P2 Important",
        priorityScore: 90,
        reason: "Hermes learned you often mark this sender important.",
      },
      createdAt: "2026-06-13T10:05:00.000Z",
    });
    expect(store.listRuns()).toHaveLength(1);
    await expect(
      store.listRules({ accountId: "account_1", limit: 10 }),
    ).resolves.toEqual({
      items: [],
    });
  });

  it("approves a shadow candidate into an enabled rule", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_1",
          accountId: "account_1",
          title: "Move newsletters to Feed",
          ruleType: "sender_feed",
          condition: { senderEmail: "news@example.com" },
          action: {
            type: "classify_sender",
            bucket: "P6 Feed",
            priorityScore: 15,
            reason: "Hermes learned you move this sender to Feed.",
          },
          confidence: 0.85,
          status: "shadow",
          evidenceMessageIds: ["msg_1", "msg_2"],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["rule_1"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    const result = await service.approveRule({
      accountId: "account_1",
      candidateId: "candidate_1",
    });

    expect(result).toEqual({
      id: "rule_1",
      accountId: "account_1",
      candidateId: "candidate_1",
      title: "Move newsletters to Feed",
      ruleType: "sender_feed",
      condition: { senderEmail: "news@example.com" },
      action: {
        type: "classify_sender",
        bucket: "P6 Feed",
        priorityScore: 15,
        reason: "Hermes learned you move this sender to Feed.",
      },
      confidence: 0.85,
      enabled: true,
      sortOrder: 1000,
      createdAt: "2026-06-13T10:10:00.000Z",
      approvedAt: "2026-06-13T10:10:00.000Z",
    });
    await expect(
      store.listRuleCandidates({
        accountId: "account_1",
        status: "approved",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ id: "candidate_1", status: "approved" }],
    });
  });

  it("disables and restores approved rules without deleting them", async () => {
    const store = createInMemoryHermesRuleStore({
      rules: [
        {
          id: "rule_codes",
          accountId: "account_1",
          candidateId: "candidate_codes",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: {
            type: "apply_label",
            labelId: "label_codes",
            labelName: "验证码",
          },
          confidence: 0.9,
          enabled: true,
          sortOrder: 1000,
          createdAt: "2026-06-13T10:10:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId([]),
      now: () => "2026-06-13T10:20:00.000Z",
    });

    await expect(
      service.updateRule({
        accountId: "account_1",
        ruleId: "rule_codes",
        enabled: false,
      }),
    ).resolves.toMatchObject({
      id: "rule_codes",
      enabled: false,
    });
    await expect(
      store.listRules({ accountId: "account_1", enabled: false, limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: "rule_codes", enabled: false }],
    });

    await expect(
      service.updateRule({
        accountId: "account_1",
        ruleId: "rule_codes",
        enabled: true,
      }),
    ).resolves.toMatchObject({
      id: "rule_codes",
      enabled: true,
    });
  });

  it("orders approved rules by editable account-scoped priority", async () => {
    const store = createInMemoryHermesRuleStore({
      rules: [
        {
          id: "rule_late",
          accountId: "account_1",
          title: "Late rule",
          ruleType: "sender_priority",
          condition: { senderEmail: "late@example.com" },
          action: { type: "classify_sender", bucket: "P2 Important" },
          confidence: 0.8,
          enabled: true,
          sortOrder: 3000,
          createdAt: "2026-06-13T10:30:00.000Z",
        },
        {
          id: "rule_first",
          accountId: "account_1",
          title: "First rule",
          ruleType: "sender_feed",
          condition: { senderEmail: "first@example.com" },
          action: { type: "classify_sender", bucket: "P6 Feed" },
          confidence: 0.9,
          enabled: true,
          sortOrder: 1000,
          createdAt: "2026-06-13T10:00:00.000Z",
        },
        {
          id: "rule_second",
          accountId: "account_1",
          title: "Second rule",
          ruleType: "sender_feed",
          condition: { senderEmail: "second@example.com" },
          action: { type: "classify_sender", bucket: "P6 Feed" },
          confidence: 0.7,
          enabled: true,
          sortOrder: 2000,
          createdAt: "2026-06-13T10:10:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId([]),
      now: () => "2026-06-13T10:20:00.000Z",
    });

    await expect(
      service.listRules({ accountId: "account_1", limit: 10 }),
    ).resolves.toMatchObject({
      items: [
        { id: "rule_first", sortOrder: 1000 },
        { id: "rule_second", sortOrder: 2000 },
        { id: "rule_late", sortOrder: 3000 },
      ],
    });

    await expect(
      service.updateRule({
        accountId: "account_1",
        ruleId: "rule_late",
        sortOrder: 500,
      }),
    ).resolves.toMatchObject({
      id: "rule_late",
      sortOrder: 500,
    });
    await expect(
      service.listRules({ accountId: "account_1", limit: 10 }),
    ).resolves.toMatchObject({
      items: [
        { id: "rule_late", sortOrder: 500 },
        { id: "rule_first", sortOrder: 1000 },
        { id: "rule_second", sortOrder: 2000 },
      ],
    });
  });

  it("does not approve a candidate that already left shadow mode", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_1",
          accountId: "account_1",
          title: "Move newsletters to Feed",
          ruleType: "sender_feed",
          condition: { senderEmail: "news@example.com" },
          action: { type: "classify_sender", bucket: "P6 Feed" },
          confidence: 0.85,
          status: "approved",
          evidenceMessageIds: ["msg_1", "msg_2"],
          createdAt: "2026-06-13T10:00:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        },
      ],
    });
    const service = createHermesRuleService({
      store,
      createId: nextId(["rule_1"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    await expect(
      service.approveRule({
        accountId: "account_1",
        candidateId: "candidate_1",
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.listRules({ accountId: "account_1", limit: 10 }),
    ).resolves.toEqual({ items: [] });
  });

  it("rejects invalid rule requests before touching the store", async () => {
    const store = createInMemoryHermesRuleStore();
    const service = createHermesRuleService({
      store,
      createId: () => "unused",
      now: () => "2026-06-13T10:00:00.000Z",
    });

    await expect(
      service.suggestRules({ accountId: "", behaviorWindowDays: 0 }),
    ).rejects.toBeInstanceOf(InvalidHermesRuleRequestError);
    await expect(
      service.simulateRule({
        accountId: "account_1",
        candidateId: "candidate_1",
        sampleLimit: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidHermesRuleRequestError);
  });
});

function behavior(
  messageId: string,
  senderEmail: string,
  action: "always_important_sender" | "move_to_feed" | "mute_sender",
) {
  return {
    accountId: "account_1",
    messageId,
    senderEmail,
    action,
    occurredAt: "2026-06-13T09:00:00.000Z",
  };
}

function message(messageId: string, senderEmail: string, subject: string) {
  return {
    messageId,
    senderEmail,
    subject,
    receivedAt: "2026-06-13T09:00:00.000Z",
  };
}

function nextId(ids: string[]): () => string {
  return () => ids.shift() ?? "unexpected";
}
