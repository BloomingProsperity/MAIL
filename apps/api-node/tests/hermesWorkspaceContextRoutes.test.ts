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

describe("Hermes workspace context routes", () => {
  it("returns mailbox context for Hermes without exposing secret values", async () => {
    const calls: unknown[] = [];
    const hermesWorkspaceContextService = {
      async getContext(input: unknown) {
        calls.push(input);
        return {
          generatedAt: "2026-06-16T01:00:00.000Z",
          accountScope: {
            requestedAccountId: "account_1",
            availableAccountIds: ["account_1"],
          },
          accounts: [
            {
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
          ],
          navigation: {
            providerGroups: [{ id: "gmail", label: "Gmail", count: 1 }],
            quickCategories: [
              { id: "codes", label: "验证码", tone: "blue", count: 3 },
            ],
          },
          labels: [],
          rules: [],
          pendingRuleCandidates: [],
          skills: [{ id: "translate_text", title: "翻译邮件", mode: "read" }],
          mailEngine: {
            provider: "emailengine",
            ok: false,
            missing: ["EMAILENGINE_ACCESS_TOKEN"],
            warnings: ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"],
            readiness: {
              status: "degraded",
              summary: "EmailEngine 配置未完全就绪。",
            },
            capabilities: {
              imapSmtpOnboarding: false,
              attachmentDownload: false,
              send: false,
            },
          },
          operationBoundaries: [
            {
              id: "create_mailbox_rule",
              title: "创建邮箱规则和左侧分组",
              mode: "confirmation_required",
              description: "先模拟，再确认启用。",
            },
          ],
          unavailableModules: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/workspace/context?accountId=account_1&ruleLimit=5&labelLimit=8`,
        );
        const text = await response.text();

        expect(response.status).toBe(200);
        expect(text).not.toContain("github_pat_");
        expect(text).not.toContain("secret-token");
        expect(JSON.parse(text)).toMatchObject({
          accountScope: { requestedAccountId: "account_1" },
          navigation: {
            quickCategories: [{ id: "codes", label: "验证码" }],
          },
          operationBoundaries: [
            {
              id: "create_mailbox_rule",
              mode: "confirmation_required",
            },
          ],
        });
      },
      { hermesWorkspaceContextService },
    );

    expect(calls).toEqual([
      { accountId: "account_1", ruleLimit: 5, labelLimit: 8 },
    ]);
  });

  it("rejects invalid workspace context query parameters", async () => {
    const hermesWorkspaceContextService = {
      async getContext() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/workspace/context?ruleLimit=0`,
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_workspace_context_request",
        });
      },
      { hermesWorkspaceContextService },
    );
  });

  it("returns 503 when Hermes workspace context is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/workspace/context`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_workspace_context_unavailable",
      });
    });
  });
});
