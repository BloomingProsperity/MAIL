import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";

let server: Server | undefined;

async function withApi(
  test: (baseUrl: string) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      ...overrides,
    } as any),
  );

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }

  await test(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("Hermes action plan routes", () => {
  it("creates a confirmation-required action plan", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async createPlan(input: unknown) {
        calls.push(input);
        return {
          id: "plan_1",
          auditEventId: "audit_plan_1",
          accountId: "account_1",
          command: "帮我创建一个验证码分组规则",
          intent: "create_mailbox_rule",
          status: "requires_confirmation",
          createdAt: "2026-06-16T08:00:00.000Z",
          candidate: {
            id: "candidate_codes",
            accountId: "account_1",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: {
              type: "apply_label",
              labelName: "验证码",
              requiresConfirmation: true,
            },
            confidence: 0.9,
            status: "shadow",
            evidenceMessageIds: [],
            createdAt: "2026-06-16T08:00:00.000Z",
          },
          simulation: {
            id: "simulation_1",
            accountId: "account_1",
            candidateId: "candidate_codes",
            mode: "shadow",
            matchedCount: 3,
            sampleMessageIds: ["message_1"],
            actionPreview: { type: "apply_label", labelName: "验证码" },
            createdAt: "2026-06-16T08:00:01.000Z",
          },
          workspace: {
            accountCount: 1,
            selectedAccountId: "account_1",
            provider: "gmail",
            quickCategoryCount: 8,
            labelCount: 2,
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
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/action-plans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            command: "帮我创建一个验证码分组规则",
            sampleLimit: 12,
          }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "plan_1",
          auditEventId: "audit_plan_1",
          status: "requires_confirmation",
          candidate: { id: "candidate_codes" },
          safety: {
            requiresUserConfirmation: true,
            providerWriteback: false,
          },
        });
      },
      { hermesActionPlanService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        command: "帮我创建一个验证码分组规则",
        sampleLimit: 12,
      },
    ]);
  });

  it("creates an action plan from an existing candidate id", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async createPlan(input: unknown) {
        calls.push(input);
        return {
          id: "plan_1",
          auditEventId: "audit_plan_1",
          accountId: "account_1",
          command: "确认 Hermes 规则候选：启用验证码智能分组",
          intent: "create_mailbox_rule",
          status: "requires_confirmation",
          createdAt: "2026-06-16T08:00:00.000Z",
          candidate: {
            id: "candidate_codes",
            accountId: "account_1",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: {
              type: "apply_label",
              labelName: "验证码",
              requiresConfirmation: true,
            },
            confidence: 0.9,
            status: "shadow",
            evidenceMessageIds: [],
            createdAt: "2026-06-16T08:00:00.000Z",
          },
          simulation: {
            id: "simulation_1",
            accountId: "account_1",
            candidateId: "candidate_codes",
            mode: "shadow",
            matchedCount: 3,
            sampleMessageIds: ["message_1"],
            actionPreview: { type: "apply_label", labelName: "验证码" },
            createdAt: "2026-06-16T08:00:01.000Z",
          },
          workspace: {
            accountCount: 1,
            selectedAccountId: "account_1",
            provider: "gmail",
            quickCategoryCount: 8,
            labelCount: 2,
            ruleCount: 0,
            pendingRuleCandidateCount: 1,
            unavailableModules: [],
          },
          safety: {
            requiresUserConfirmation: true,
            providerWriteback: false,
            appliesToHistory: false,
            destructive: false,
          },
          steps: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/action-plans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            candidateId: "candidate_codes",
            sampleLimit: 12,
          }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "plan_1",
          command: "确认 Hermes 规则候选：启用验证码智能分组",
          candidate: { id: "candidate_codes" },
        });
      },
      { hermesActionPlanService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 12,
      },
    ]);
  });

  it("confirms an action plan through the service", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async confirmPlan(input: unknown) {
        calls.push(input);
        return {
          id: "confirmation_1",
          auditEventId: "audit_confirm_1",
          planId: "plan_1",
          accountId: "account_1",
          candidateId: "candidate_codes",
          status: "completed",
          confirmedAt: "2026-06-16T08:01:00.000Z",
          rule: {
            id: "rule_codes",
            accountId: "account_1",
            candidateId: "candidate_codes",
            title: "启用验证码智能分组",
            ruleType: "content_label",
            condition: { anyKeywords: ["验证码", "otp"] },
            action: { type: "apply_label", labelId: "label_codes" },
            confidence: 0.9,
            enabled: true,
            createdAt: "2026-06-16T08:01:00.000Z",
            approvedAt: "2026-06-16T08:01:00.000Z",
          },
          safety: {
            requiresUserConfirmation: false,
            providerWriteback: false,
            appliesToHistory: false,
            destructive: false,
          },
          steps: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/action-plans/plan_1/confirm`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              candidateId: "candidate_codes",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "confirmation_1",
          auditEventId: "audit_confirm_1",
          status: "completed",
          rule: { id: "rule_codes", enabled: true },
        });
      },
      { hermesActionPlanService },
    );

    expect(calls).toEqual([
      {
        planId: "plan_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
      },
    ]);
  });

  it("returns 404 when the confirmation target is gone", async () => {
    const hermesActionPlanService = {
      async confirmPlan() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/action-plans/plan_1/confirm`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              candidateId: "missing_candidate",
            }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
          error: "action_plan_target_not_found",
        });
      },
      { hermesActionPlanService },
    );
  });

  it("blocks action plan confirmation when memory writes are disabled", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async confirmPlan(input: unknown) {
        calls.push(input);
        return {};
      },
    };
    const hermesSkillSettingsService = {
      async listSkills() {
        throw new Error("not used");
      },
      async updateSkillSettings() {
        throw new Error("not used");
      },
      async getSkill(skillId: string) {
        return {
          id: skillId,
          title: "执行计划",
          mode: "learn",
          description: "把自然语言邮箱操作转成可确认计划",
          settings: {
            enabled: true,
            maxContextChars: 24000,
            memoryLimit: 6,
            allowBodyRead: true,
            allowMemoryWrite: false,
            requireConfirmation: true,
          },
          settingBounds: {
            maxContextChars: { min: 1000, max: 200000, step: 1000 },
            memoryLimit: { min: 0, max: 50, step: 1 },
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/action-plans/plan_1/confirm`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              candidateId: "candidate_codes",
            }),
          },
        );

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: "hermes_skill_disabled",
          skillId: "action_plan",
        });
      },
      { hermesActionPlanService, hermesSkillSettingsService },
    );

    expect(calls).toEqual([]);
  });

  it("blocks action plan creation when the action_plan skill is disabled", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async createPlan(input: unknown) {
        calls.push(input);
        return {};
      },
    };
    const hermesSkillSettingsService = {
      async listSkills() {
        throw new Error("not used");
      },
      async updateSkillSettings() {
        throw new Error("not used");
      },
      async getSkill(skillId: string) {
        return {
          id: skillId,
          title: "执行计划",
          mode: "learn",
          description: "把自然语言邮箱操作转成可确认计划",
          settings: {
            enabled: false,
            maxContextChars: 24000,
            memoryLimit: 6,
            allowBodyRead: true,
            allowMemoryWrite: true,
            requireConfirmation: true,
          },
          settingBounds: {
            maxContextChars: { min: 1000, max: 200000, step: 1000 },
            memoryLimit: { min: 0, max: 50, step: 1 },
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/action-plans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            command: "帮我创建一个验证码分组规则",
          }),
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: "hermes_skill_disabled",
          skillId: "action_plan",
        });
      },
      { hermesActionPlanService, hermesSkillSettingsService },
    );

    expect(calls).toEqual([]);
  });

  it("rejects invalid create requests before hitting the service", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async createPlan(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/action-plans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            command: "",
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_action_plan_request",
        });
      },
      { hermesActionPlanService },
    );

    expect(calls).toEqual([]);
  });

  it("returns 503 when action plans are unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/action-plans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: "account_1",
          command: "帮我创建规则",
        }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_action_plans_unavailable",
      });
    });
  });
});
