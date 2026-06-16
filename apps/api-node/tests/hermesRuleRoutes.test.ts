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
              ruleType: "content_saved_view",
              condition: { anyKeywords: ["验证码", "verification", "otp"] },
              action: {
                type: "ensure_saved_view",
                savedView: { id: "codes", label: "验证码" },
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
          candidates: [{ id: "candidate_codes", ruleType: "content_saved_view" }],
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

  it("approves a candidate into an enabled rule", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async approveRule(input: unknown) {
        calls.push(input);
        return {
          id: "rule_1",
          accountId: "account_1",
          candidateId: "candidate_1",
          title: "Prioritize client@example.com",
          ruleType: "sender_priority",
          condition: { senderEmail: "client@example.com" },
          action: { type: "classify_sender", bucket: "P2 Important" },
          confidence: 0.85,
          enabled: true,
          createdAt: "2026-06-13T10:10:00.000Z",
          approvedAt: "2026-06-13T10:10:00.000Z",
        };
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

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "rule_1",
          candidateId: "candidate_1",
          enabled: true,
        });
      },
      { hermesRuleService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        candidateId: "candidate_1",
      },
    ]);
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
