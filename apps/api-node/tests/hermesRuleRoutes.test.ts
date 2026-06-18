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

describe("Hermes rule routes", () => {
  it("drafts a rule candidate from a natural-language Hermes command", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async draftRule(input: unknown) {
        calls.push(input);
        return {
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
              status: "shadow",
              evidenceMessageIds: [],
              createdAt: "2026-06-13T10:00:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/rules/draft`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            command: "帮我创建一个验证码分组规则",
          }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          candidates: [{ id: "candidate_codes", ruleType: "content_label" }],
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        command: "帮我创建一个验证码分组规则",
      },
    ]);
  });

  it("suggests shadow rules through the Hermes rule service", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async suggestRules(input: unknown) {
        calls.push(input);
        return {
          candidates: [
            {
              id: "candidate_1",
              accountId: "account_1",
              title: "Prioritize client@example.com",
              ruleType: "sender_priority",
              condition: { senderEmail: "client@example.com" },
              action: { type: "classify_sender", bucket: "P2 Important" },
              confidence: 0.85,
              status: "shadow",
              evidenceMessageIds: ["message_1", "message_2"],
              createdAt: "2026-06-13T10:00:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/rules/suggest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            behaviorWindowDays: 30,
            minEvidenceCount: 2,
          }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          candidates: [{ id: "candidate_1", status: "shadow" }],
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        behaviorWindowDays: 30,
        minEvidenceCount: 2,
      },
    ]);
  });

  it("blocks Hermes rule suggestion routes when the rule_suggest skill is disabled", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async draftRule(input: unknown) {
        calls.push(["draft", input]);
        return { candidates: [] };
      },
      async suggestRules(input: unknown) {
        calls.push(["suggest", input]);
        return { candidates: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const responses = await Promise.all([
          fetch(`${baseUrl}/api/hermes/rules/draft`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              command: "创建验证码规则",
            }),
          }),
          fetch(`${baseUrl}/api/hermes/rules/suggest`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
            }),
          }),
        ]);

        for (const response of responses) {
          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({
            error: "hermes_skill_disabled",
            skillId: "rule_suggest",
          });
        }
      },
      {
        hermesRuleService,
        hermesSkillSettingsService: disabledHermesSkillSettingsService(
          "rule_suggest",
        ),
      },
    );

    expect(calls).toEqual([]);
  });

  it("runs a rule simulation in shadow mode", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async simulateRule(input: unknown) {
        calls.push(input);
        return {
          id: "run_1",
          accountId: "account_1",
          candidateId: "candidate_1",
          mode: "shadow",
          matchedCount: 2,
          sampleMessageIds: ["message_1", "message_2"],
          actionPreview: { type: "classify_sender", bucket: "P2 Important" },
          createdAt: "2026-06-13T10:05:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rules/candidate_1/simulate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              sampleLimit: 10,
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "run_1",
          mode: "shadow",
          matchedCount: 2,
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        candidateId: "candidate_1",
        sampleLimit: 10,
      },
    ]);
  });

  it("lists pending Hermes rule candidates", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async listRuleCandidates(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "candidate_codes",
              accountId: "account_1",
              title: "启用验证码智能分组",
              ruleType: "content_label",
              condition: { anyKeywords: ["验证码", "otp"] },
              action: { type: "apply_label", labelName: "验证码" },
              confidence: 0.9,
              status: "shadow",
              evidenceMessageIds: [],
              createdAt: "2026-06-13T10:00:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rule-candidates?accountId=account_1&status=shadow&limit=20`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [{ id: "candidate_codes", status: "shadow" }],
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        status: "shadow",
        limit: 20,
      },
    ]);
  });

  it("updates an editable Hermes rule candidate", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async updateRuleCandidate(input: unknown) {
        calls.push(input);
        return {
          id: "candidate_codes",
          accountId: "account_1",
          title: "创建票据智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["receipt", "invoice", "发票"] },
          action: {
            type: "apply_label",
            labelName: "票据",
            labelColor: "blue",
            providerWriteback: false,
            applyToHistory: true,
            requiresConfirmation: true,
          },
          confidence: 0.9,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rule-candidates/candidate_codes`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              labelName: "票据",
              keywords: ["receipt", "invoice", "发票"],
              applyToHistory: true,
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "candidate_codes",
          title: "创建票据智能分组",
          status: "shadow",
          action: {
            labelName: "票据",
            applyToHistory: true,
          },
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        candidateId: "candidate_codes",
        labelName: "票据",
        keywords: ["receipt", "invoice", "发票"],
        applyToHistory: true,
      },
    ]);
  });

  it("dismisses a shadow Hermes rule candidate", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async dismissRuleCandidate(input: unknown) {
        calls.push(input);
        return {
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
          status: "dismissed",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rule-candidates/candidate_codes/dismiss`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "candidate_codes",
          status: "dismissed",
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        candidateId: "candidate_codes",
      },
    ]);
  });

  it("rejects rule candidate routes outside the configured API token account scope", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async listRuleCandidates(input: unknown) {
        calls.push({ method: "listRuleCandidates", input });
        return { items: [] };
      },
      async updateRuleCandidate(input: unknown) {
        calls.push({ method: "updateRuleCandidate", input });
        return {};
      },
      async dismissRuleCandidate(input: unknown) {
        calls.push({ method: "dismissRuleCandidate", input });
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const list = await fetch(
          `${baseUrl}/api/hermes/rule-candidates?accountId=account_2`,
        );
        const update = await fetch(
          `${baseUrl}/api/hermes/rule-candidates/candidate_codes`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_2",
              labelName: "票据",
              keywords: ["receipt"],
            }),
          },
        );
        const dismiss = await fetch(
          `${baseUrl}/api/hermes/rule-candidates/candidate_codes/dismiss`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_2",
            }),
          },
        );

        for (const response of [list, update, dismiss]) {
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({
            error: "account_not_found",
          });
        }
      },
      { hermesRuleService, apiAccessAccountIds: ["account_1"] },
    );

    expect(calls).toEqual([]);
  });

  it("returns not found when dismissing a non-shadow Hermes rule candidate", async () => {
    const hermesRuleService = {
      async dismissRuleCandidate() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rule-candidates/candidate_codes/dismiss`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
            }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
          error: "rule_candidate_not_found",
        });
      },
      { hermesRuleService },
    );
  });

  it("rejects invalid Hermes rule candidate updates before hitting the service", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async updateRuleCandidate(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rule-candidates/candidate_codes`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              labelName: "票据",
              keywords: "receipt",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_rule_request",
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([]);
  });

  it("rejects direct rule approval in favor of action plans", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async approveRule(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rules/candidate_1/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1" }),
          },
        );

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "hermes_rule_approval_requires_action_plan",
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([]);
  });

  it("updates an enabled rule without approving another candidate", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async updateRule(input: unknown) {
        calls.push(input);
        return {
          id: "rule_codes",
          accountId: "account_1",
          candidateId: "candidate_codes",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: { type: "apply_label", labelId: "label_codes" },
          confidence: 0.9,
          enabled: false,
          sortOrder: 2000,
          createdAt: "2026-06-13T10:10:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/rules/rule_codes`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: "account_1", enabled: false }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "rule_codes",
          enabled: false,
          sortOrder: 2000,
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        ruleId: "rule_codes",
        enabled: false,
      },
    ]);
  });

  it("updates Hermes rule order without toggling the rule", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async updateRule(input: unknown) {
        calls.push(input);
        return {
          id: "rule_codes",
          accountId: "account_1",
          candidateId: "candidate_codes",
          title: "启用验证码智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["验证码", "otp"] },
          action: { type: "apply_label", labelId: "label_codes" },
          confidence: 0.9,
          enabled: true,
          sortOrder: 500,
          createdAt: "2026-06-13T10:10:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/rules/rule_codes`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: "account_1", sortOrder: 500 }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "rule_codes",
          enabled: true,
          sortOrder: 500,
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        ruleId: "rule_codes",
        sortOrder: 500,
      },
    ]);
  });

  it("manually runs an approved Hermes rule", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async runRule(input: unknown) {
        calls.push(input);
        return {
          id: "run_active_1",
          accountId: "account_1",
          ruleId: "rule_codes",
          mode: "active",
          matchedCount: 7,
          appliedCount: 3,
          sampleMessageIds: ["message_1", "message_2"],
          actionPreview: {
            type: "apply_label",
            labelId: "label_codes",
            labelName: "验证码",
          },
          createdAt: "2026-06-13T10:30:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rules/rule_codes/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1", limit: 1000 }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "run_active_1",
          ruleId: "rule_codes",
          mode: "active",
          matchedCount: 7,
          appliedCount: 3,
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        ruleId: "rule_codes",
        limit: 1000,
      },
    ]);
  });

  it("lists recent active Hermes rule executions", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async listRuleExecutions(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "run_active_1",
              accountId: "account_1",
              ruleId: "rule_codes",
              mode: "active",
              matchedCount: 7,
              appliedCount: 3,
              sampleMessageIds: ["message_1", "message_2"],
              actionPreview: {
                type: "apply_label",
                labelId: "label_codes",
                labelName: "验证码",
              },
              createdAt: "2026-06-13T10:30:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rule-runs?accountId=account_1&ruleId=rule_codes&limit=20`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [
            {
              id: "run_active_1",
              ruleId: "rule_codes",
              mode: "active",
              matchedCount: 7,
              appliedCount: 3,
            },
          ],
        });
      },
      { hermesRuleService, apiAccessAccountIds: ["account_1"] },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        ruleId: "rule_codes",
        limit: 20,
      },
    ]);
  });

  it("returns 404 when manually running a missing or disabled Hermes rule", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async runRule(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rules/rule_missing/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1" }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "rule_not_found" });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        ruleId: "rule_missing",
      },
    ]);
  });

  it("returns 404 when updating a missing Hermes rule", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async updateRule(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/rules/missing_rule`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1", enabled: false }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "rule_not_found" });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        ruleId: "missing_rule",
        enabled: false,
      },
    ]);
  });

  it("rejects invalid Hermes rule updates before hitting the service", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async updateRule(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/rules/rule_codes`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: "account_1", enabled: "false" }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_rule_request",
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([]);
  });

  it("rejects invalid rule requests before hitting the service", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async suggestRules(input: unknown) {
        calls.push(input);
        return { candidates: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/rules/suggest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: "", behaviorWindowDays: 0 }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_rule_request",
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([]);
  });

  it("returns 503 when Hermes rule learning is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/rules/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "account_1" }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_rules_unavailable",
      });
    });
  });
});

function disabledHermesSkillSettingsService(skillId: string) {
  return {
    async getSkill(requestedSkillId: string) {
      if (requestedSkillId !== skillId) {
        return undefined;
      }

      return {
        id: skillId,
        settings: {
          enabled: false,
        },
      };
    },
  };
}
