import { describe, expect, it } from "vitest";

import {
  createHermesActionPlanService,
  InvalidHermesActionPlanRequestError,
} from "../src/hermes/action-plan";
import {
  createInMemoryHermesActionPlanStore,
  type HermesActionPlanRecord,
} from "../src/hermes/action-plan-store";
import {
  createHermesRuleService,
  createInMemoryHermesRuleStore,
} from "../src/hermes/rules";

describe("Hermes action plan service", () => {
  it("creates an auditable confirmation-required plan for mailbox rules", async () => {
    const runStoreCalls: unknown[] = [];
    const planStore = createInMemoryHermesActionPlanStore();
    const ruleStore = createInMemoryHermesRuleStore({
      messages: [
        {
          accountId: "account_1",
          messageId: "message_code",
          senderEmail: "login@example.com",
          subject: "Your OTP verification code",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      createId: nextId(["candidate_codes", "simulation_1"]),
      now: () => "2026-06-16T08:00:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext(input) {
          return {
            generatedAt: "2026-06-16T08:00:00.000Z",
            accountScope: {
              requestedAccountId: input.accountId,
              availableAccountIds: ["account_1"],
              selectedAccount: {
                accountId: "account_1",
                email: "lina@example.com",
                provider: "gmail",
                authMethod: "oauth",
                syncState: "syncing",
                engineProvider: "emailengine",
                reauthRequired: false,
                nextAction: "none",
                accountUpdatedAt: "2026-06-16T00:00:00.000Z",
              },
            },
            accounts: [],
            navigation: {
              providerGroups: [],
              quickCategories: [
                { id: "codes", label: "验证码", count: 1, tone: "blue" },
              ],
            },
            labels: [],
            rules: [],
            pendingRuleCandidates: [],
            skills: [],
            operationBoundaries: [],
            unavailableModules: [],
          };
        },
      },
      planStore,
      runStore: {
        async recordCompletedSkillRun(input) {
          runStoreCalls.push(input);
        },
      },
      createId: nextId(["plan_1", "audit_plan_1"]),
      now: () => "2026-06-16T08:01:00.000Z",
    });

    const plan = await service.createPlan({
      accountId: "account_1",
      command: "把验证码邮件自动放到左侧验证码",
      sampleLimit: 10,
    });

    expect(plan).toMatchObject({
      id: "plan_1",
      auditEventId: "audit_plan_1",
      accountId: "account_1",
      intent: "create_mailbox_rule",
      status: "requires_confirmation",
      candidate: { id: "candidate_codes", ruleType: "content_label" },
      simulation: {
        id: "simulation_1",
        matchedCount: 1,
        sampleMessageIds: ["message_code"],
      },
      safety: {
        requiresUserConfirmation: true,
        providerWriteback: false,
        appliesToHistory: false,
        destructive: false,
      },
    });
    expect(plan.steps.map((step) => step.id)).toEqual([
      "read_workspace_context",
      "draft_rule_candidate",
      "shadow_simulation",
      "confirm_rule",
    ]);
    expect(runStoreCalls).toEqual([
      expect.objectContaining({
        run: expect.objectContaining({
          id: "plan_1",
          skillId: "action_plan",
          input: expect.objectContaining({
            accountId: "account_1",
            intent: "create_mailbox_rule",
          }),
        }),
        auditEvent: expect.objectContaining({
          id: "audit_plan_1",
          eventType: "hermes.action_plan.created",
          readMessageIds: ["message_code"],
          action: expect.objectContaining({
            type: "create_action_plan",
            planId: "plan_1",
            candidateId: "candidate_codes",
          }),
        }),
      }),
    ]);
    expect(planStore.listPlans()).toEqual([
      expect.objectContaining({
        id: "plan_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
        simulationId: "simulation_1",
        status: "requires_confirmation",
        auditEventId: "audit_plan_1",
      }),
    ]);
  });

  it("creates an action plan from an existing shadow rule candidate", async () => {
    const planStore = createInMemoryHermesActionPlanStore();
    const ruleStore = createInMemoryHermesRuleStore({
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
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
      messages: [
        {
          accountId: "account_1",
          messageId: "message_code",
          senderEmail: "login@example.com",
          subject: "验证码 482911",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      createId: nextId(["simulation_1"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext(input) {
          return {
            generatedAt: "2026-06-16T08:02:00.000Z",
            accountScope: {
              requestedAccountId: input.accountId,
              availableAccountIds: ["account_1"],
              selectedAccount: {
                accountId: "account_1",
                email: "lina@example.com",
                provider: "gmail",
                authMethod: "oauth",
                syncState: "syncing",
                engineProvider: "emailengine",
                reauthRequired: false,
                nextAction: "none",
                accountUpdatedAt: "2026-06-16T00:00:00.000Z",
              },
            },
            accounts: [],
            navigation: { providerGroups: [], quickCategories: [] },
            labels: [],
            rules: [],
            pendingRuleCandidates: [],
            skills: [],
            operationBoundaries: [],
            unavailableModules: [],
          };
        },
      },
      planStore,
      createId: nextId(["plan_1"]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const plan = await service.createPlan({
      accountId: "account_1",
      candidateId: "candidate_codes",
      sampleLimit: 10,
    });

    expect(plan).toMatchObject({
      id: "plan_1",
      command: "确认 Hermes 规则候选：启用验证码智能分组",
      candidate: { id: "candidate_codes" },
      simulation: {
        id: "simulation_1",
        candidateId: "candidate_codes",
        matchedCount: 1,
      },
    });
    expect(
      await ruleStore.listRuleCandidates({
        accountId: "account_1",
        status: "shadow",
        limit: 10,
      }),
    ).toMatchObject({
      items: [{ id: "candidate_codes", status: "shadow" }],
    });
    expect(planStore.listPlans()).toEqual([
      expect.objectContaining({
        id: "plan_1",
        command: "确认 Hermes 规则候选：启用验证码智能分组",
        candidateId: "candidate_codes",
        simulationId: "simulation_1",
      }),
    ]);
  });

  it("confirms a planned content label rule and records audit", async () => {
    const runStoreCalls: unknown[] = [];
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord({
          id: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          simulationId: "simulation_1",
        }),
      ],
    });
    const ruleStore = createInMemoryHermesRuleStore({
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
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_codes",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-16T08:01:00.000Z",
          };
        },
      },
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore,
      runStore: {
        async recordCompletedSkillRun(input) {
          runStoreCalls.push(input);
        },
      },
      createId: nextId(["confirmation_1", "audit_confirm_1"]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const result = await service.confirmPlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(result).toMatchObject({
      id: "confirmation_1",
      auditEventId: "audit_confirm_1",
      planId: "plan_1",
      status: "completed",
      rule: {
        id: "rule_codes",
        action: {
          type: "apply_label",
          labelId: "label_codes",
          requiresConfirmation: false,
        },
      },
    });
    expect(runStoreCalls).toEqual([
      expect.objectContaining({
        run: expect.objectContaining({
          id: "confirmation_1",
          skillId: "action_plan",
        }),
        auditEvent: expect.objectContaining({
          id: "audit_confirm_1",
          eventType: "hermes.action_plan.confirmed",
          action: expect.objectContaining({
            type: "confirm_action_plan",
            planId: "plan_1",
            candidateId: "candidate_codes",
            ruleId: "rule_codes",
          }),
        }),
      }),
    ]);
    expect(planStore.listPlans()).toEqual([
      expect.objectContaining({
        id: "plan_1",
        candidateId: "candidate_codes",
        status: "completed",
        confirmationId: "confirmation_1",
        confirmationAuditEventId: "audit_confirm_1",
        ruleId: "rule_codes",
      }),
    ]);
  });

  it("marks action plans failed when confirmation throws after locking", async () => {
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord({
          id: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          simulationId: "simulation_1",
        }),
      ],
    });
    const ruleStore = createInMemoryHermesRuleStore({
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
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      labelService: {
        async upsertLabel() {
          throw new Error("label_store_unavailable");
        },
      },
      createId: nextId(["rule_should_not_commit"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore,
      createId: nextId([]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    await expect(
      service.confirmPlan({
        planId: "plan_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
      }),
    ).rejects.toThrow("label_store_unavailable");
    expect(planStore.listPlans()).toEqual([
      expect.objectContaining({
        id: "plan_1",
        status: "failed",
        failureMessage:
          "confirm_action_plan_failed:label_store_unavailable",
      }),
    ]);
  });

  it("disables approved rules when confirmation fails after rule creation", async () => {
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord({
          id: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          simulationId: "simulation_1",
        }),
      ],
    });
    const failingPlanStore = {
      ...planStore,
      async completePlan() {
        throw new Error("plan_store_unavailable");
      },
    };
    const ruleStore = createInMemoryHermesRuleStore({
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
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_codes",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-16T08:01:00.000Z",
          };
        },
      },
      createId: nextId(["rule_codes", "confirmation_1"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore: failingPlanStore,
      createId: nextId(["confirmation_1"]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    await expect(
      service.confirmPlan({
        planId: "plan_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
      }),
    ).rejects.toThrow("plan_store_unavailable");
    expect(planStore.listPlans()).toEqual([
      expect.objectContaining({
        id: "plan_1",
        status: "failed",
        failureMessage:
          "confirm_action_plan_failed:plan_store_unavailable",
      }),
    ]);
    await expect(
      ruleStore.listRules({ accountId: "account_1", enabled: false, limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: "rule_codes", enabled: false }],
    });
  });

  it("confirms explicit all-mail plans and backfills matching local labels", async () => {
    const runStoreCalls: unknown[] = [];
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord(
          {
            id: "plan_1",
            accountId: "account_1",
            candidateId: "candidate_codes",
            simulationId: "simulation_1",
          },
          {
            appliesToHistory: true,
          },
        ),
      ],
    });
    const ruleStore = createInMemoryHermesRuleStore({
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
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
      messages: [
        {
          accountId: "account_1",
          messageId: "message_code_1",
          senderEmail: "login@example.com",
          subject: "Your OTP verification code",
        },
        {
          accountId: "account_1",
          messageId: "message_code_2",
          senderEmail: "auth@example.com",
          subject: "验证码 482911",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_codes",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-16T08:01:00.000Z",
          };
        },
      },
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore,
      runStore: {
        async recordCompletedSkillRun(input) {
          runStoreCalls.push(input);
        },
      },
      createId: nextId(["confirmation_1", "audit_confirm_1"]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const result = await service.confirmPlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(result).toMatchObject({
      id: "confirmation_1",
      auditEventId: "audit_confirm_1",
      safety: {
        requiresUserConfirmation: false,
        providerWriteback: false,
        appliesToHistory: true,
        destructive: false,
      },
      historyBackfill: {
        accountId: "account_1",
        ruleId: "rule_codes",
        matchedCount: 2,
        appliedCount: 2,
        sampleMessageIds: ["message_code_1", "message_code_2"],
      },
    });
    expect(result?.steps.map((step) => step.id)).toEqual([
      "approve_rule_candidate",
      "backfill_history_labels",
      "refresh_workspace_context",
    ]);
    expect(runStoreCalls).toEqual([
      expect.objectContaining({
        auditEvent: expect.objectContaining({
          readMessageIds: ["message_code_1", "message_code_2"],
          action: expect.objectContaining({
            historyBackfill: {
              matchedCount: 2,
              appliedCount: 2,
            },
          }),
        }),
      }),
    ]);
  });

  it("learns confirmed mailbox rules as procedural memory", async () => {
    const runStoreCalls: unknown[] = [];
    const createdMemories: unknown[] = [];
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord({
          id: "plan_1",
          accountId: "account_1",
          command: "把验证码邮件自动放到左侧验证码",
          candidateId: "candidate_codes",
          simulationId: "simulation_1",
        }),
      ],
    });
    const ruleStore = createInMemoryHermesRuleStore({
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
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_codes",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-16T08:01:00.000Z",
          };
        },
      },
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore,
      memoryStore: {
        async createMemory(input) {
          createdMemories.push(input);
          return {
            ...input,
            createdAt: "2026-06-16T08:03:00.000Z",
            updatedAt: "2026-06-16T08:03:00.000Z",
          };
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          runStoreCalls.push(input);
        },
      },
      createId: nextId(["memory_rule_1", "confirmation_1", "audit_confirm_1"]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const result = await service.confirmPlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(result).toMatchObject({
      id: "confirmation_1",
      auditEventId: "audit_confirm_1",
      memory: {
        id: "memory_rule_1",
        layer: "procedural_memory",
        scope: "global",
      },
      steps: [
        expect.objectContaining({ id: "approve_rule_candidate" }),
        expect.objectContaining({ id: "learn_procedural_memory" }),
        expect.objectContaining({ id: "refresh_workspace_context" }),
      ],
    });
    expect(createdMemories).toEqual([
      expect.objectContaining({
        id: "memory_rule_1",
        layer: "procedural_memory",
        scope: "global",
        confidence: 0.9,
        content: expect.objectContaining({
          source: "hermes_action_plan",
          planId: "plan_1",
          ruleId: "rule_codes",
          candidateId: "candidate_codes",
          accountId: "account_1",
          command: "把验证码邮件自动放到左侧验证码",
          ruleType: "content_label",
          title: "启用验证码智能分组",
          preference: expect.stringContaining("\"验证码\" left-side group"),
        }),
      }),
    ]);
    expect((createdMemories[0] as any).content.action).toMatchObject({
      type: "apply_label",
      labelId: "label_codes",
      labelName: "验证码",
      providerWriteback: false,
    });
    expect((createdMemories[0] as any).content.action).not.toHaveProperty(
      "requiresConfirmation",
    );
    expect(runStoreCalls).toEqual([
      expect.objectContaining({
        auditEvent: expect.objectContaining({
          action: expect.objectContaining({
            type: "confirm_action_plan",
            memoryId: "memory_rule_1",
          }),
        }),
      }),
    ]);
  });

  it("does not confirm a candidate without a matching pending plan", async () => {
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord({
          id: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          simulationId: "simulation_1",
        }),
      ],
    });
    const ruleStore = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_other",
          accountId: "account_1",
          title: "启用其他智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["other"] },
          action: {
            type: "apply_label",
            labelName: "其他",
            providerWriteback: false,
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.7,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      createId: nextId(["rule_other"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore,
      createId: nextId([]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const result = await service.confirmPlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_other",
    });

    expect(result).toBeUndefined();
    expect(
      await ruleStore.listRuleCandidates({
        accountId: "account_1",
        status: "shadow",
        limit: 10,
      }),
    ).toMatchObject({
      items: [{ id: "candidate_other", status: "shadow" }],
    });
    expect(planStore.listPlans()[0]).toMatchObject({
      id: "plan_1",
      status: "requires_confirmation",
    });
  });

  it("fails a plan instead of approving when the candidate is no longer shadow", async () => {
    const planStore = createInMemoryHermesActionPlanStore({
      plans: [
        createPlanRecord({
          id: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          simulationId: "simulation_1",
        }),
      ],
    });
    const ruleStore = createInMemoryHermesRuleStore({
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
            providerWriteback: false,
            applyToHistory: false,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "approved",
          evidenceMessageIds: [],
          createdAt: "2026-06-16T08:00:00.000Z",
          approvedAt: "2026-06-16T08:01:00.000Z",
        },
      ],
    });
    const ruleService = createHermesRuleService({
      store: ruleStore,
      createId: nextId(["rule_codes"]),
      now: () => "2026-06-16T08:02:00.000Z",
    });
    const service = createHermesActionPlanService({
      ruleService,
      workspaceContextService: {
        async getContext() {
          throw new Error("not used while confirming");
        },
      },
      planStore,
      createId: nextId([]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const result = await service.confirmPlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(result).toBeUndefined();
    expect(planStore.listPlans()[0]).toMatchObject({
      status: "failed",
      failureMessage: "rule_candidate_unavailable",
    });
  });

  it("rejects unsupported natural-language operations in v1", async () => {
    const service = createHermesActionPlanService({
      ruleService: {
        async draftRule() {
          throw new Error("should not draft");
        },
        async simulateRule() {
          throw new Error("should not simulate");
        },
        async approveRule() {
          throw new Error("should not approve");
        },
        async backfillRuleHistory() {
          throw new Error("should not backfill");
        },
      },
      workspaceContextService: {
        async getContext() {
          throw new Error("should not read context");
        },
      },
      planStore: createInMemoryHermesActionPlanStore(),
      createId: nextId([]),
      now: () => "2026-06-16T08:00:00.000Z",
    });

    await expect(
      service.createPlan({
        accountId: "account_1",
        command: "帮我删除所有邮件",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesActionPlanRequestError);
  });

  it("rejects mail search prompts that mention labels instead of drafting rules", async () => {
    const service = createHermesActionPlanService({
      ruleService: {
        async draftRule() {
          throw new Error("should not draft");
        },
        async simulateRule() {
          throw new Error("should not simulate");
        },
        async approveRule() {
          throw new Error("should not approve");
        },
        async backfillRuleHistory() {
          throw new Error("should not backfill");
        },
      },
      workspaceContextService: {
        async getContext() {
          throw new Error("should not read context");
        },
      },
      planStore: createInMemoryHermesActionPlanStore(),
      createId: nextId([]),
      now: () => "2026-06-16T08:00:00.000Z",
    });

    for (const command of [
      "搜索带客户标签的合同",
      "filter invoices from Alice",
    ]) {
      await expect(
        service.createPlan({
          accountId: "account_1",
          command,
        }),
      ).rejects.toBeInstanceOf(InvalidHermesActionPlanRequestError);
    }
  });
});

function nextId(ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `id_${index}`;
}

function createPlanRecord(
  input: Pick<
    HermesActionPlanRecord,
    "id" | "accountId" | "candidateId" | "simulationId"
  > & { command?: string },
  safety: Partial<HermesActionPlanRecord["safety"]> = {},
): HermesActionPlanRecord {
  return {
    id: input.id,
    accountId: input.accountId,
    command: input.command ?? "帮我创建一个规则，左侧加一个验证码分组",
    intent: "create_mailbox_rule",
    status: "requires_confirmation",
    candidateId: input.candidateId,
    simulationId: input.simulationId,
    workspace: {
      accountCount: 1,
      selectedAccountId: input.accountId,
      provider: "gmail",
      quickCategoryCount: 1,
      labelCount: 0,
      ruleCount: 0,
      pendingRuleCandidateCount: 0,
      unavailableModules: [],
    },
    safety: {
      requiresUserConfirmation: true,
      providerWriteback: false,
      appliesToHistory: false,
      destructive: false,
      ...safety,
    },
    steps: [
      {
        id: "confirm_rule",
        title: "等待用户确认",
        mode: "confirmation_required",
        status: "requires_confirmation",
        detail: "确认后启用。",
      },
    ],
    createdAt: "2026-06-16T08:00:00.000Z",
  };
}
