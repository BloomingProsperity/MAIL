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

describe("Hermes global skill account routes", () => {
  it("allows unscoped tokens to run email_search_qa across all accounts", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async searchMail(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_search_global",
          skillId: "email_search_qa",
          answerText: "Found messages across accounts.",
          searchQuery: "contract",
          citations: [],
          matches: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              question: "所有邮箱里谁发过合同？",
              limit: 5,
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(calls).toEqual([
          {
            question: "所有邮箱里谁发过合同？",
            limit: 5,
          },
        ]);
      },
      { hermesService },
    );
  });

  it("allows account-scoped tokens to run translate_text with a query account scope", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_translate_1",
          skillId: "translate_text",
          sourceLanguage: "auto",
          targetLanguage: "Chinese",
          translatedText: "你好",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/translate_text/run?accountId=account_1`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: "Hello",
              targetLanguage: "Chinese",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(calls).toEqual([
          {
            accountId: "account_1",
            text: "Hello",
            targetLanguage: "Chinese",
          },
        ]);
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("allows account-scoped tokens to run rewrite_polish with a body account scope", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async rewritePolish(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_rewrite_1",
          skillId: "rewrite_polish",
          action: "polish",
          rewrittenText: "Please review the launch plan.",
          editable: true,
          sendsDirectly: false,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/rewrite_polish/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              text: "please review launch plan",
              action: "polish",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(calls).toEqual([
          {
            accountId: "account_1",
            text: "please review launch plan",
            action: "polish",
          },
        ]);
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("allows account-scoped tokens to run email_search_qa with a body account scope", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async searchMail(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_search_1",
          skillId: "email_search_qa",
          answerText: "Found the latest contract thread.",
          searchQuery: "contract",
          citations: [],
          matches: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "account_1",
              question: "找合同",
              limit: 5,
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(calls).toEqual([
          {
            accountId: "account_1",
            question: "找合同",
            limit: 5,
          },
        ]);
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("allows account-scoped tokens to run email_search_qa with a query account scope", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async searchMail(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_search_1",
          skillId: "email_search_qa",
          answerText: "Found the latest contract thread.",
          searchQuery: "contract",
          citations: [],
          matches: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run?accountId=account_1`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              question: "找合同",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(calls).toEqual([
          {
            accountId: "account_1",
            question: "找合同",
          },
        ]);
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("rejects mismatched query and body account scopes before calling Hermes", async () => {
    const hermesService = {
      async translate() {
        throw new Error("translate should not be called");
      },
      async rewritePolish() {
        throw new Error("rewritePolish should not be called");
      },
      async searchMail() {
        throw new Error("searchMail should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const cases = [
          {
            path: "/api/hermes/skills/translate_text/run?accountId=account_1",
            body: {
              accountId: "account_2",
              text: "Hello",
              targetLanguage: "Chinese",
            },
            error: "invalid_translation_request",
          },
          {
            path: "/api/hermes/skills/rewrite_polish/run?accountId=account_1",
            body: {
              accountId: "account_2",
              text: "Draft body",
              action: "polish",
            },
            error: "invalid_rewrite_polish_request",
          },
          {
            path: "/api/hermes/skills/email_search_qa/run?accountId=account_1",
            body: {
              accountId: "account_2",
              question: "找合同",
            },
            error: "invalid_email_search_qa_request",
          },
        ];

        for (const testCase of cases) {
          const response = await fetch(`${baseUrl}${testCase.path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(testCase.body),
          });

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({ error: testCase.error });
        }
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("rejects account-scoped direct skill runs without an account scope", async () => {
    const hermesService = {
      async translate() {
        throw new Error("translate should not be called");
      },
      async rewritePolish() {
        throw new Error("rewritePolish should not be called");
      },
      async searchMail() {
        throw new Error("searchMail should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const cases = [
          {
            path: "/api/hermes/skills/translate_text/run",
            body: { text: "Hello", targetLanguage: "Chinese" },
          },
          {
            path: "/api/hermes/skills/rewrite_polish/run",
            body: { text: "Draft body", action: "polish" },
          },
          {
            path: "/api/hermes/skills/email_search_qa/run",
            body: { question: "找合同" },
          },
        ];

        for (const testCase of cases) {
          const response = await fetch(`${baseUrl}${testCase.path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(testCase.body),
          });

          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({
            error: "account_scope_required",
          });
        }
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("rejects direct skill runs outside the token account scope", async () => {
    const hermesService = {
      async translate() {
        throw new Error("translate should not be called");
      },
      async rewritePolish() {
        throw new Error("rewritePolish should not be called");
      },
      async searchMail() {
        throw new Error("searchMail should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const cases = [
          {
            path: "/api/hermes/skills/translate_text/run?accountId=account_2",
            body: { text: "Hello", targetLanguage: "Chinese" },
          },
          {
            path: "/api/hermes/skills/rewrite_polish/run",
            body: {
              accountId: "account_2",
              text: "Draft body",
              action: "polish",
            },
          },
          {
            path: "/api/hermes/skills/email_search_qa/run",
            body: {
              accountId: "account_2",
              question: "找合同",
            },
          },
        ];

        for (const testCase of cases) {
          const response = await fetch(`${baseUrl}${testCase.path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(testCase.body),
          });

          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ error: "account_not_found" });
        }
      },
      { hermesService, apiAccessAccountIds: ["account_1"] },
    );
  });
});
