import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";

let server: Server | undefined;

async function withApi(
  test: (baseUrl: string) => Promise<void>,
  overrides: Record<string, unknown>,
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
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("Hermes account-scoped route access", () => {
  it("rejects rule routes outside the configured account scope", async () => {
    const calls: unknown[] = [];
    const hermesRuleService = {
      async draftRule(input: unknown) {
        calls.push({ method: "draftRule", input });
        return { candidates: [] };
      },
      async suggestRules(input: unknown) {
        calls.push({ method: "suggestRules", input });
        return { candidates: [] };
      },
      async listRules(input: unknown) {
        calls.push({ method: "listRules", input });
        return { items: [] };
      },
      async simulateRule(input: unknown) {
        calls.push({ method: "simulateRule", input });
        return {};
      },
      async runRule(input: unknown) {
        calls.push({ method: "runRule", input });
        return {};
      },
      async updateRule(input: unknown) {
        calls.push({ method: "updateRule", input });
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const responses = [
          await fetch(`${baseUrl}/api/hermes/rules?accountId=account_2`),
          await postJson(`${baseUrl}/api/hermes/rules/draft`, {
            accountId: "account_2",
            command: "帮我创建票据规则",
          }),
          await postJson(`${baseUrl}/api/hermes/rules/suggest`, {
            accountId: "account_2",
            minEvidenceCount: 2,
          }),
          await postJson(
            `${baseUrl}/api/hermes/rules/candidate_codes/simulate`,
            { accountId: "account_2" },
          ),
          await postJson(`${baseUrl}/api/hermes/rules/rule_codes/run`, {
            accountId: "account_2",
          }),
          await patchJson(`${baseUrl}/api/hermes/rules/rule_codes`, {
            accountId: "account_2",
            enabled: false,
          }),
        ];

        for (const response of responses) {
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

  it("rejects action plan routes outside the configured account scope", async () => {
    const calls: unknown[] = [];
    const hermesActionPlanService = {
      async createPlan(input: unknown) {
        calls.push({ method: "createPlan", input });
        return {};
      },
      async confirmPlan(input: unknown) {
        calls.push({ method: "confirmPlan", input });
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const responses = [
          await postJson(`${baseUrl}/api/hermes/action-plans`, {
            accountId: "account_2",
            command: "帮我创建验证码分组规则",
          }),
          await postJson(`${baseUrl}/api/hermes/action-plans/plan_1/confirm`, {
            accountId: "account_2",
            candidateId: "candidate_codes",
          }),
        ];

        for (const response of responses) {
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({
            error: "account_not_found",
          });
        }
      },
      { hermesActionPlanService, apiAccessAccountIds: ["account_1"] },
    );

    expect(calls).toEqual([]);
  });
});

function postJson(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
