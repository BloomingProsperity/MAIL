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
