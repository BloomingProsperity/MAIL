import { describe, expect, it } from "vitest";

import {
  createHermesActionPlanService,
  InvalidHermesActionPlanRequestError,
} from "../src/hermes/action-plan";
import {
  createHermesRuleService,
  createInMemoryHermesRuleStore,
} from "../src/hermes/rules";

describe("Hermes action plan service", () => {
  it("creates an auditable confirmation-required plan for mailbox rules", async () => {
    const runStoreCalls: unknown[] = [];
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
      command: "帮我创建一个规则，左侧加一个验证码分组",
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
  });

  it("confirms a planned content label rule and records audit", async () => {
    const runStoreCalls: unknown[] = [];
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
      },
      workspaceContextService: {
        async getContext() {
          throw new Error("should not read context");
        },
      },
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
});

function nextId(ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `id_${index}`;
}
