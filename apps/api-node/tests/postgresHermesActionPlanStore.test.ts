import { describe, expect, it } from "vitest";

import { createPostgresHermesActionPlanStore } from "../src/hermes/postgres-action-plan-store";

describe("postgres Hermes action plan store", () => {
  it("creates a durable confirmation-required action plan", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [planRow()] };
      },
    };
    const store = createPostgresHermesActionPlanStore(client);

    const result = await store.createPlan({
      id: "plan_1",
      accountId: "account_1",
      command: "帮我创建一个验证码分组规则",
      intent: "create_mailbox_rule",
      candidateId: "candidate_codes",
      simulationId: "simulation_1",
      workspace: workspaceSummary(),
      safety: safety(),
      steps: steps(),
      createdAt: "2026-06-16T08:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO hermes_action_plans/i);
    expect(queries[0].text).toMatch(/candidate_id/i);
    expect(queries[0].text).toMatch(/simulation_id/i);
    expect(queries[0].values).toEqual([
      "plan_1",
      "account_1",
      "帮我创建一个验证码分组规则",
      "create_mailbox_rule",
      "candidate_codes",
      "simulation_1",
      JSON.stringify(workspaceSummary()),
      JSON.stringify(safety()),
      JSON.stringify(steps()),
      "2026-06-16T08:00:00.000Z",
    ]);
    expect(result).toMatchObject({
      id: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
      simulationId: "simulation_1",
      status: "requires_confirmation",
      workspace: { accountCount: 1, unavailableModules: [] },
      safety: { providerWriteback: false },
      steps: [{ id: "confirm_rule" }],
    });
  });

  it("atomically begins confirmation only for the bound pending plan", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            planRow({
              status: "confirming",
              confirming_at: "2026-06-16T08:01:00.000Z",
            }),
          ],
        };
      },
    };
    const store = createPostgresHermesActionPlanStore(client);

    const result = await store.beginConfirmation({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
      confirmingAt: "2026-06-16T08:01:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE hermes_action_plans/i);
    expect(queries[0].text).toMatch(/status = 'confirming'/i);
    expect(queries[0].text).toMatch(/AND account_id = \$2/i);
    expect(queries[0].text).toMatch(/AND candidate_id = \$3/i);
    expect(queries[0].text).toMatch(/AND status = 'requires_confirmation'/i);
    expect(queries[0].values).toEqual([
      "plan_1",
      "account_1",
      "candidate_codes",
      "2026-06-16T08:01:00.000Z",
    ]);
    expect(result).toMatchObject({
      id: "plan_1",
      status: "confirming",
      confirmingAt: "2026-06-16T08:01:00.000Z",
    });
  });

  it("completes a confirming plan with the rule and confirmation audit ids", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            planRow({
              status: "completed",
              confirmation_id: "confirmation_1",
              confirmation_audit_event_id: "audit_confirm_1",
              rule_id: "rule_codes",
              confirmed_at: "2026-06-16T08:02:00.000Z",
            }),
          ],
        };
      },
    };
    const store = createPostgresHermesActionPlanStore(client);

    const result = await store.completePlan({
      planId: "plan_1",
      accountId: "account_1",
      candidateId: "candidate_codes",
      confirmationId: "confirmation_1",
      ruleId: "rule_codes",
      confirmedAt: "2026-06-16T08:02:00.000Z",
      confirmationAuditEventId: "audit_confirm_1",
    });

    expect(queries[0].text).toMatch(/status = 'completed'/i);
    expect(queries[0].text).toMatch(/AND status = 'confirming'/i);
    expect(queries[0].values).toEqual([
      "plan_1",
      "account_1",
      "candidate_codes",
      "confirmation_1",
      "rule_codes",
      "2026-06-16T08:02:00.000Z",
      "audit_confirm_1",
    ]);
    expect(result).toMatchObject({
      status: "completed",
      confirmationId: "confirmation_1",
      confirmationAuditEventId: "audit_confirm_1",
      ruleId: "rule_codes",
    });
  });

  it("returns undefined when the conditional update finds no plan", async () => {
    const client = {
      async query() {
        return { rows: [] };
      },
    };
    const store = createPostgresHermesActionPlanStore(client);

    await expect(
      store.beginConfirmation({
        planId: "plan_missing",
        accountId: "account_1",
        candidateId: "candidate_codes",
        confirmingAt: "2026-06-16T08:01:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});

function planRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "plan_1",
    account_id: "account_1",
    command: "帮我创建一个验证码分组规则",
    intent: "create_mailbox_rule",
    status: "requires_confirmation",
    candidate_id: "candidate_codes",
    simulation_id: "simulation_1",
    workspace: workspaceSummary(),
    safety: safety(),
    steps: steps(),
    audit_event_id: null,
    confirmation_id: null,
    confirmation_audit_event_id: null,
    rule_id: null,
    created_at: "2026-06-16T08:00:00.000Z",
    confirming_at: null,
    confirmed_at: null,
    failure_message: null,
    ...overrides,
  };
}

function workspaceSummary() {
  return {
    accountCount: 1,
    selectedAccountId: "account_1",
    provider: "gmail",
    quickCategoryCount: 4,
    labelCount: 2,
    ruleCount: 0,
    pendingRuleCandidateCount: 0,
    unavailableModules: [],
  };
}

function safety() {
  return {
    requiresUserConfirmation: true,
    providerWriteback: false,
    appliesToHistory: false,
    destructive: false,
  };
}

function steps() {
  return [
    {
      id: "confirm_rule",
      title: "等待用户确认",
      mode: "confirmation_required" as const,
      status: "requires_confirmation" as const,
      detail: "确认后启用。",
    },
  ];
}
