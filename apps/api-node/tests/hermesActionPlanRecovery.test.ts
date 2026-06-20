import { describe, expect, it } from "vitest";

import { createHermesActionPlanService } from "../src/hermes/action-plan";
import {
  createInMemoryHermesActionPlanStore,
  type HermesActionPlanRecord,
} from "../src/hermes/action-plan-store";
import {
  createHermesRuleService,
  createInMemoryHermesRuleStore,
} from "../src/hermes/rules";

describe("Hermes action plan recovery", () => {
  it("does not return success when the locked plan is lost before completion", async () => {
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
    const lostPlanStore = {
      ...planStore,
      async completePlan() {
        return undefined;
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
      planStore: lostPlanStore,
      createId: nextId(["confirmation_1"]),
      now: () => "2026-06-16T08:03:00.000Z",
    });

    const result = await service.confirmPlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(result).toBeUndefined();
    expect(planStore.listPlans()).toEqual([
      expect.objectContaining({
        id: "plan_1",
        status: "failed",
        failureMessage: "action_plan_confirmation_lost",
      }),
    ]);
    await expect(
      ruleStore.listRules({ accountId: "account_1", enabled: false, limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: "rule_codes", enabled: false }],
    });
  });
});

function createPlanRecord(
  input: Pick<
    HermesActionPlanRecord,
    "id" | "accountId" | "candidateId" | "simulationId"
  >,
): HermesActionPlanRecord {
  return {
    id: input.id,
    accountId: input.accountId,
    command: "帮我创建一个规则，左侧加一个验证码分组",
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

function nextId(ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `id_${index}`;
}
