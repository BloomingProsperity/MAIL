import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiHandler } from "../src/http/router";
import {
  createInMemoryMailEngineIngestStore,
  type InMemoryMailEngineIngestStore,
} from "../src/mail-engine/ingest-store";

let server: Server | undefined;

async function withApi(
  test: (
    baseUrl: string,
    store: InMemoryMailEngineIngestStore,
  ) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const store = createInMemoryMailEngineIngestStore();
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      mailEngineIngestStore: store,
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

  await test(`http://127.0.0.1:${address.port}`, store);
}

function sign(body: string): string {
  return createHmac("sha256", "webhook-secret").update(body).digest("base64url");
}

function webhookBody(payload: Record<string, unknown>): string {
  return JSON.stringify({
    date: new Date().toISOString(),
    ...payload,
  });
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

describe("API routes", () => {
  it("reports API health", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: "email-hub-api",
        ok: true,
      });
    });
  });

  it("keeps the health route public when API token protection is enabled", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          service: "email-hub-api",
          ok: true,
        });
      },
      {
        apiAccessToken: "api-secret",
        apiAccessTokenConfigured: true,
        apiAccessTokenRequired: true,
      },
    );
  });

  it("requires the configured API token before protected API routes", async () => {
    await withApi(
      async (baseUrl) => {
        const noToken = await fetch(`${baseUrl}/api/mail-providers/capabilities`);
        const wrongToken = await fetch(
          `${baseUrl}/api/mail-providers/capabilities`,
          {
            headers: { authorization: "Bearer wrong-secret" },
          },
        );
        const bearerToken = await fetch(
          `${baseUrl}/api/mail-providers/capabilities`,
          {
            headers: { authorization: "Bearer api-secret" },
          },
        );
        const headerToken = await fetch(
          `${baseUrl}/api/mail-providers/capabilities`,
          {
            headers: { "x-emailhub-api-token": "api-secret" },
          },
        );

        expect(noToken.status).toBe(401);
        expect(await noToken.json()).toEqual({ error: "api_unauthorized" });
        expect(wrongToken.status).toBe(401);
        expect(await wrongToken.json()).toEqual({ error: "api_unauthorized" });
        expect(bearerToken.status).toBe(200);
        expect(await bearerToken.json()).toMatchObject({
          providers: expect.any(Array),
        });
        expect(headerToken.status).toBe(200);
      },
      {
        apiAccessToken: "api-secret",
        apiAccessTokenConfigured: true,
        apiAccessTokenRequired: true,
      },
    );
  });

  it("rejects global admin routes for account-scoped API token contexts", async () => {
    await withApi(
      async (baseUrl) => {
        const paths = [
          "/api/admin/modules",
          "/api/messages",
          "/api/maintenance/compose-attachments",
          "/api/maintenance/compose-attachments/cleanup",
          "/api/maintenance/hermes-retention",
          "/api/maintenance/hermes-retention/cleanup",
          "/api/mail-engine/health",
          "/api/mail-providers/capabilities",
          "/api/mail-providers/capabilities/gmail",
          "/api/diagnostics/logs",
          "/api/diagnostics/events",
          "/api/sync-center/accounts",
          "/api/sync-center/reauthorizations",
          "/api/sync-center/reauthorizations/task_1/oauth/start",
          "/api/sync-center/reauthorizations/task_1/imap-smtp",
          "/api/sync-center/reauthorizations/oauth/callback",
          "/api/mail-navigation/summary",
          "/api/hermes/providers",
          "/api/hermes/providers/custom/probe",
          "/api/hermes/resource-profile",
          "/api/hermes/runtime",
          "/api/hermes/runtime/test",
          "/api/hermes/runtime/version",
          "/api/hermes/runtime/update/check",
          "/api/hermes/skills",
          "/api/hermes/skills/translate_text/settings",
          "/api/hermes/skills/translate_text/run",
          "/api/hermes/skills/reply_draft/run",
          "/api/hermes/skills/quick_reply/run",
          "/api/hermes/skills/rewrite_polish/run",
          "/api/hermes/skills/thread_summarize/run",
          "/api/hermes/skills/action_item_extract/run",
          "/api/hermes/skills/label_suggest/run",
          "/api/hermes/skills/newsletter_cleanup/run",
          "/api/hermes/skills/priority_triage/run",
          "/api/hermes/skills/followup_tracker/run",
          "/api/hermes/workspace/context",
          "/api/hermes/audit-log",
          "/api/hermes/rule-runs",
          "/api/hermes/action-plans",
          "/api/hermes/drafts/feedback",
          "/api/hermes/follow-ups/confirm",
          "/api/hermes/memories",
          "/api/hermes/rule-candidates",
          "/api/domains",
          "/api/accounts/import/csv",
          "/api/accounts/imap-smtp",
          "/api/accounts/imap-smtp/test",
          "/api/accounts/oauth/gmail/start",
          "/api/accounts/transfer/export",
          "/api/accounts/transfer/import",
          "/api/follow-ups/follow_1",
        ];

        for (const path of paths) {
          const response = await fetch(`${baseUrl}${path}`);

          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({
            error: "account_scope_required",
          });
        }
      },
      { apiAccessAccountIds: ["account_1"] },
    );
  });

  it("lists admin module APIs for Hermes orchestration boundaries", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/admin/modules`);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.hermesBoundary).toEqual({
          authority: "product_admin",
          allowedScope: expect.arrayContaining([
            "mailboxes",
            "messages",
            "search",
            "drafts",
            "sending",
            "labels",
            "sync",
            "domains",
            "settings",
          ]),
          forbiddenScope: expect.arrayContaining([
            "repository_code",
            "source_files",
            "migrations",
            "deployment_scripts",
            "runtime_process_control",
          ]),
          confirmationRequiredFor: expect.arrayContaining([
            "send_mail",
            "bulk_mail_changes",
            "domain_changes",
            "sync_reauthorization",
          ]),
        });
        expect(body.modules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "mail_read",
              status: "available",
              hermes: expect.objectContaining({
                callable: true,
                toolIds: expect.arrayContaining(["mail.search", "mail.read"]),
                safety: "read_only",
              }),
            }),
            expect.objectContaining({
              id: "mail_compose",
              status: "available",
              hermes: expect.objectContaining({
                callable: true,
                toolIds: expect.arrayContaining([
                  "compose.draft",
                  "compose.send",
                ]),
                safety: "confirmation_required",
              }),
              adminApi: expect.arrayContaining([
                expect.objectContaining({
                  method: "POST",
                  path: "/api/accounts/{accountId}/compose/drafts/{draftId}/send",
                  requiresConfirmation: true,
                }),
              ]),
            }),
            expect.objectContaining({
              id: "hermes",
              status: "available",
              adminApi: expect.arrayContaining([
                expect.objectContaining({
                  path: "/api/hermes/skills/email_search_qa/run",
                }),
                expect.objectContaining({
                  path:
                    "/api/accounts/{accountId}/messages/{messageId}/hermes/reply-draft",
                }),
              ]),
            }),
            expect.objectContaining({
              id: "onboarding",
              hermes: expect.objectContaining({
                safety: "confirmation_required",
              }),
            }),
          ]),
        );
      },
      {
        mailReadStore: { listMessages: vi.fn() },
        mailComposeService: {},
        hermesService: { searchMail: vi.fn() },
        oauthOnboardingService: {},
      },
    );
  });

  it("rejects query and body account scopes outside the configured API token account scope", async () => {
    const calls: unknown[] = [];
    const followUpService = {
      async listFollowUps(input: unknown) {
        calls.push({ method: "listFollowUps", input });
        return { items: [] };
      },
    };
    const senderScreeningStore = {
      async listSenders(input: unknown) {
        calls.push({ method: "listSenders", input });
        return { items: [] };
      },
      async bulkDecideSenders(input: unknown) {
        calls.push({ method: "bulkDecideSenders", input });
        return { items: [] };
      },
    };
    const hermesService = {
      async searchMail(input: unknown) {
        calls.push({ method: "searchMail", input });
        return { answer: "should not run" };
      },
    };

    await withApi(
      async (baseUrl) => {
        const followUps = await fetch(
          `${baseUrl}/api/follow-ups?accountId=account_2`,
        );
        const senders = await fetch(
          `${baseUrl}/api/screening/senders?accountId=account_2`,
        );
        const bulkSenders = await fetch(
          `${baseUrl}/api/screening/senders/bulk`,
          {
            method: "POST",
            body: JSON.stringify({
              accountId: "account_2",
              senderIds: ["sender_1"],
              action: "accept",
            }),
          },
        );
        const hermesSearch = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            body: JSON.stringify({
              accountId: "account_2",
              question: "Find invoices",
            }),
          },
        );
        const hermesAudit = await fetch(
          `${baseUrl}/api/hermes/audit-log?accountId=account_2`,
        );
        const hermesMemories = await fetch(
          `${baseUrl}/api/hermes/memories?accountId=account_2`,
        );
        const hermesRuleRuns = await fetch(
          `${baseUrl}/api/hermes/rule-runs?accountId=account_2`,
        );

        for (const response of [
          followUps,
          senders,
          bulkSenders,
          hermesSearch,
          hermesAudit,
          hermesMemories,
          hermesRuleRuns,
        ]) {
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ error: "account_not_found" });
        }
        expect(calls).toEqual([]);
      },
      {
        followUpService,
        senderScreeningStore,
        hermesService,
        apiAccessAccountIds: ["account_1"],
      },
    );
  });

  it("reports database readiness from the API health route", async () => {
    const databaseHealthCheck = vi.fn(async () => {});

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);

        expect(databaseHealthCheck).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          service: "email-hub-api",
          ok: true,
          checks: {
            database: "ok",
          },
        });
      },
      { databaseHealthCheck },
    );
  });

  it("marks API health unavailable when the database readiness check fails", async () => {
    const databaseHealthCheck = vi.fn(async () => {
      throw new Error("postgres://secret@db/emailhub is down");
    });

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        const bodyText = await response.text();

        expect(databaseHealthCheck).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(503);
        expect(JSON.parse(bodyText)).toEqual({
          service: "email-hub-api",
          ok: false,
          checks: {
            database: "unavailable",
          },
        });
        expect(bodyText).not.toContain("secret");
      },
      { databaseHealthCheck },
    );
  });

  it("adds request ids to responses and emits structured request logs", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const logger = {
      debug(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
      info(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
      warn(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
      error(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`, {
          headers: { "x-request-id": "req_test_1" },
        });

        expect(response.headers.get("x-request-id")).toBe("req_test_1");
        expect(response.status).toBe(200);
        await response.json();
        expect(logs).toContainEqual({
          event: "request_completed",
          fields: expect.objectContaining({
            requestId: "req_test_1",
            method: "GET",
            path: "/health",
            statusCode: 200,
            durationMs: expect.any(Number),
          }),
        });
      },
      { logger },
    );
  });

  it("emits a sanitized request-started log before completion logs", async () => {
    const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    const logger = {
      debug(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
      info(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
      warn(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
      error(event: string, fields?: Record<string, unknown>) {
        logs.push({ event, fields });
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/missing?access_token=raw-token`,
          {
            headers: { "x-request-id": "req_started_1" },
          },
        );

        expect(response.status).toBe(404);
        await response.json();
        expect(logs[0]).toEqual({
          event: "request_started",
          fields: {
            requestId: "req_started_1",
            method: "GET",
            path: "/missing?access_token=%5Bredacted%5D",
          },
        });
        expect(logs).toContainEqual({
          event: "request_completed",
          fields: expect.objectContaining({
            requestId: "req_started_1",
            method: "GET",
            path: "/missing?access_token=%5Bredacted%5D",
            statusCode: 404,
            durationMs: expect.any(Number),
          }),
        });
        expect(JSON.stringify(logs)).not.toContain("raw-token");
      },
      { logger },
    );
  });

  it("lists recent diagnostic logs by request id without leaking secret query values", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const diagnosticsLogStore = {
      append(entry: Record<string, unknown>) {
        entries.push({ ...entry });
      },
      list(input: { requestId?: string; limit?: number }) {
        return {
          items: entries
            .filter((entry) => !input.requestId || entry.requestId === input.requestId)
            .slice()
            .reverse()
            .slice(0, input.limit ?? 50),
        };
      },
    };
    const logger = {
      debug() {},
      info(event: string, fields?: Record<string, unknown>) {
        diagnosticsLogStore.append({
          timestamp: "2026-06-13T00:00:00.000Z",
          level: "info",
          service: "email-hub-api",
          event,
          ...fields,
        });
      },
      warn() {},
      error() {},
    };

    await withApi(
      async (baseUrl) => {
        const health = await fetch(
          `${baseUrl}/health?access_token=raw-token`,
          {
            headers: { "x-request-id": "req_diag_1" },
          },
        );
        expect(health.status).toBe(404);

        const noToken = await fetch(
          `${baseUrl}/api/diagnostics/logs?requestId=req_diag_1&limit=5`,
          {
            headers: { "x-request-id": "req_diag_unauthorized" },
          },
        );
        const response = await fetch(
          `${baseUrl}/api/diagnostics/logs?requestId=req_diag_1&limit=5`,
          {
            headers: {
              authorization: "Bearer diagnostics-secret",
              "x-request-id": "req_diag_reader",
            },
          },
        );

        expect(noToken.status).toBe(401);
        expect(await noToken.json()).toEqual({ error: "api_unauthorized" });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            expect.objectContaining({
              level: "info",
              service: "email-hub-api",
              event: "request_completed",
              requestId: "req_diag_1",
              method: "GET",
              path: "/health?access_token=%5Bredacted%5D",
              statusCode: 404,
              durationMs: expect.any(Number),
            }),
            expect.objectContaining({
              level: "info",
              service: "email-hub-api",
              event: "request_started",
              requestId: "req_diag_1",
              method: "GET",
              path: "/health?access_token=%5Bredacted%5D",
            }),
          ],
        });
      },
      {
        logger,
        diagnosticsLogStore,
        apiAccessToken: "diagnostics-secret",
        apiAccessTokenConfigured: true,
      },
    );
  });

  it("requires an explicit API token before diagnostic log reads", async () => {
    let listCalls = 0;
    const diagnosticsLogStore = {
      append() {},
      list() {
        listCalls += 1;
        return { items: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/diagnostics/logs`, {
          headers: { authorization: "Bearer diagnostics-secret" },
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "api_unauthorized" });
        expect(listCalls).toBe(0);
      },
      { diagnosticsLogStore },
    );
  });

  it("reports missing EmailEngine token in the adapter health response", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mail-engine/health`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: "emailengine",
        ok: false,
        detail: "adapter boundary ready: http://emailengine:3000",
        checks: {
          url: "configured",
          http: "skipped",
          accessToken: "missing",
          apiAuth: "skipped",
          webhookSecret: "custom",
        },
        capabilities: {
          urlConfigured: true,
          accessTokenConfigured: false,
          imapSmtpOnboarding: false,
          attachmentDownload: false,
          send: false,
        },
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
        warnings: [],
        readiness: {
          status: "degraded",
          summary: "EmailEngine 配置未完全就绪，部分上线能力会降级。",
          setupActions: [
            {
              code: "set_emailengine_access_token",
              label: "设置 EmailEngine 访问令牌",
              env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
              effect: "添加邮箱、附件下载、发信和同步任务会失败。",
            },
          ],
        },
      });
    });
  });

  it("reports EmailEngine account capabilities when token-backed services are wired", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          provider: "emailengine",
          ok: true,
          detail: "adapter boundary ready: http://emailengine:3000",
          checks: {
          url: "configured",
          http: "ok",
          accessToken: "configured",
          apiAuth: "ok",
          webhookSecret: "custom",
        },
          capabilities: {
            urlConfigured: true,
            accessTokenConfigured: true,
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          missing: [],
          warnings: [],
          readiness: {
            status: "ready",
            summary: "EmailEngine 已具备上线配置。",
            setupActions: [],
          },
        });
      },
      {
        emailEngineAccessTokenConfigured: true,
        mailEngineHealthProbe: {
          async check() {
            return {
              http: "ok",
              statusCode: 200,
              auth: "ok",
              authStatusCode: 200,
            };
          },
        },
        accountOnboardingService: {
          async onboardImapSmtp() {
            throw new Error("not used");
          },
          async testImapSmtpConnection() {
            throw new Error("not used");
          },
        },
        attachmentDownloadService: {
          async downloadAttachment() {
            throw new Error("not used");
          },
        },
        mailComposeService: {
          async createDraft() {
            throw new Error("not used");
          },
          async sendDraft() {
            throw new Error("not used");
          },
        },
      },
    );
  });

  it("degrades EmailEngine readiness when the configured access token is rejected", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "emailengine",
          ok: false,
          checks: {
            http: "ok",
            accessToken: "configured",
            apiAuth: "unauthorized",
          },
          capabilities: {
            imapSmtpOnboarding: false,
            attachmentDownload: false,
            send: false,
          },
          warnings: ["EMAILENGINE_ACCESS_TOKEN_REJECTED"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "replace_emailengine_access_token",
                label: "更新 EmailEngine 访问令牌",
                env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
                effect:
                  "EmailEngine 拒绝当前访问令牌，添加邮箱、附件下载、发信和同步任务会失败。",
              },
            ],
          },
        });
      },
      {
        emailEngineAccessTokenConfigured: true,
        mailEngineHealthProbe: {
          async check() {
            return {
              http: "ok",
              statusCode: 200,
              auth: "unauthorized",
              authStatusCode: 401,
              authError: "emailengine_token_rejected",
            };
          },
        },
        accountOnboardingService: {},
        attachmentDownloadService: {},
        mailComposeService: {},
      },
    );
  });

  it("degrades EmailEngine readiness when the authenticated API probe fails", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "emailengine",
          ok: false,
          checks: {
            http: "ok",
            accessToken: "configured",
            apiAuth: "unavailable",
          },
          warnings: ["EMAILENGINE_API_AUTH_UNAVAILABLE"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "check_emailengine_api_auth",
                label: "检查 EmailEngine API 认证接口",
                env: ["EMAILENGINE_URL", "EMAILENGINE_ACCESS_TOKEN"],
                effect:
                  "API 当前无法通过 EmailEngine 认证接口，添加邮箱、附件下载、发信和同步任务会失败。",
              },
            ],
          },
        });
      },
      {
        emailEngineAccessTokenConfigured: true,
        mailEngineHealthProbe: {
          async check() {
            return {
              http: "ok",
              statusCode: 200,
              auth: "unavailable",
              authStatusCode: 502,
              authError: "emailengine_auth_not_ok",
            };
          },
        },
      },
    );
  });

  it("degrades EmailEngine launch readiness when the Docker prepared token is missing", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "emailengine",
          ok: true,
          checks: {
            accessToken: "configured",
            preparedToken: "missing",
          },
          missing: ["EENGINE_PREPARED_TOKEN"],
          warnings: ["EENGINE_PREPARED_TOKEN_MISSING"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "set_emailengine_prepared_token",
                label: "设置 EmailEngine 预置令牌",
                env: ["EENGINE_PREPARED_TOKEN"],
                effect:
                  "Docker 无人值守启动时 EmailEngine 容器可能不会导入 API 使用的访问令牌。",
              },
            ],
          },
        });
      },
      {
        emailEngineAccessTokenConfigured: true,
        emailEnginePreparedTokenConfigured: false,
        mailEngineHealthProbe: {
          async check() {
            return { http: "ok", statusCode: 200 };
          },
        },
        accountOnboardingService: {},
        attachmentDownloadService: {},
        mailComposeService: {},
      },
    );
  });

  it("does not expose EmailEngine token values in health responses", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);
        const body = JSON.stringify(await response.json());

        expect(body).not.toContain("super-secret-token");
      },
      {
        emailEngineAccessTokenConfigured: true,
        emailEngineAccessTokenHint: "super-secret-token",
      },
    );
  });

  it("converts EmailEngine runtime probe exceptions into degraded readiness", async () => {
    await withApi(
      async (baseUrl) => {
        const health = await fetch(`${baseUrl}/health`);
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(health.status).toBe(200);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "emailengine",
          ok: false,
          checks: {
            http: "unavailable",
            accessToken: "configured",
          },
          warnings: ["EMAILENGINE_HTTP_UNAVAILABLE"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "check_emailengine_runtime",
              },
            ],
          },
        });
      },
      {
        emailEngineAccessTokenConfigured: true,
        mailEngineHealthProbe: {
          async check() {
            throw new Error("probe crashed with private endpoint detail");
          },
        },
      },
    );
  });

  it("reports EmailEngine runtime probe failures without blocking API health", async () => {
    await withApi(
      async (baseUrl) => {
        const health = await fetch(`${baseUrl}/health`);
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(health.status).toBe(200);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "emailengine",
          ok: false,
          checks: {
            http: "unavailable",
            accessToken: "configured",
          },
          warnings: ["EMAILENGINE_HTTP_UNAVAILABLE"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "check_emailengine_runtime",
                label: "检查 EmailEngine 容器状态",
                env: ["EMAILENGINE_URL"],
                effect: "API 当前无法连通 EmailEngine /health。",
              },
            ],
          },
        });
      },
      {
        emailEngineAccessTokenConfigured: true,
        mailEngineHealthProbe: {
          async check() {
            return {
              http: "unavailable",
              statusCode: 503,
              error: "bad_gateway",
            };
          },
        },
      },
    );
  });

  it("warns when EmailEngine shared secrets are still using development defaults", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({
          provider: "emailengine",
          ok: true,
          missing: [],
          readiness: {
            status: "degraded",
          },
        });
        expect(body.warnings).toEqual([
          "EMAILENGINE_WEBHOOK_SECRET_DEFAULT",
          "EMAILENGINE_AUTH_SERVER_SECRET_DEFAULT",
          "EENGINE_SECRET_DEFAULT",
        ]);
        expect(
          body.readiness.setupActions.map(
            (action: { code: string }) => action.code,
          ),
        ).toEqual([
          "rotate_emailengine_webhook_secret",
          "rotate_emailengine_auth_server_secret",
          "rotate_emailengine_service_secret",
        ]);
      },
      {
        emailEngineAccessTokenConfigured: true,
        emailEngineWebhookSecret: "dev-emailhub-secret",
        emailEngineWebhookSecretUsesDefault: true,
        emailEngineAuthServerSecret: "dev-emailhub-secret",
        emailEngineAuthServerSecretUsesDefault: true,
        emailEngineServiceSecretUsesDefault: true,
      },
    );
  });

  it("reports missing EmailEngine URL and webhook secret setup actions", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-engine/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "emailengine",
          ok: false,
          checks: {
            url: "missing",
            http: "skipped",
            accessToken: "configured",
            webhookSecret: "missing",
          },
          missing: ["EMAILENGINE_URL", "EMAILENGINE_WEBHOOK_SECRET"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "set_emailengine_url",
                env: ["EMAILENGINE_URL"],
              },
              {
                code: "set_emailengine_webhook_secret",
                env: ["EMAILENGINE_WEBHOOK_SECRET", "EENGINE_SECRET"],
              },
            ],
          },
        });
      },
      {
        emailEngineUrl: "",
        emailEngineAccessTokenConfigured: true,
        emailEngineWebhookSecret: "",
        emailEngineWebhookSecretConfigured: false,
        emailEngineWebhookSecretUsesDefault: false,
      },
    );
  });

  it("serves EmailEngine auth server credentials behind Basic auth", async () => {
    const calls: unknown[] = [];
    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/mail-engine/auth-server?account=acc_1&proto=imap`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(
                "emailengine:auth-secret",
              ).toString("base64")}`,
            },
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          user: "me@gmail.com",
          accessToken: "access-token",
        });
        expect(calls).toEqual([{ accountId: "acc_1", proto: "imap" }]);
      },
      {
        apiAccessToken: "api-secret",
        apiAccessTokenConfigured: true,
        apiAccessTokenRequired: true,
        emailEngineAuthServerSecret: "auth-secret",
        emailEngineAuthServerService: {
          async resolveCredentials(input: unknown) {
            calls.push(input);
            return {
              user: "me@gmail.com",
              accessToken: "access-token",
            };
          },
        },
      },
    );
  });

  it("rejects unauthenticated EmailEngine auth server requests", async () => {
    const calls: unknown[] = [];
    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/mail-engine/auth-server?account=acc_1&proto=imap`,
        );

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: "emailengine_auth_server_unauthorized",
        });
        expect(calls).toEqual([]);
      },
      {
        apiAccessToken: "api-secret",
        apiAccessTokenConfigured: true,
        apiAccessTokenRequired: true,
        emailEngineAuthServerSecret: "auth-secret",
        emailEngineAuthServerService: {
          async resolveCredentials(input: unknown) {
            calls.push(input);
            return {
              user: "me@gmail.com",
              accessToken: "access-token",
            };
          },
        },
      },
    );
  });

  it("lists mailboxes through the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "mailbox_1",
              accountId: "account_1",
              name: "Inbox",
              role: "inbox",
              messageCount: 12,
              unreadCount: 3,
            },
          ],
        };
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/mailboxes`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              id: "mailbox_1",
              accountId: "account_1",
              name: "Inbox",
              role: "inbox",
              messageCount: 12,
              unreadCount: 3,
            },
          ],
        });
        expect(calls).toEqual([{ accountId: "account_1" }]);
      },
      { mailReadStore },
    );
  });

  it("rejects account-scoped mail reads outside the configured API token account scope", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes(input: unknown) {
        calls.push({ method: "listMailboxes", input });
        return { items: [] };
      },
      async listMessages(input: unknown) {
        calls.push({ method: "listMessages", input });
        return { items: [] };
      },
      async getMessage(input: unknown) {
        calls.push({ method: "getMessage", input });
        return undefined;
      },
      async getAttachmentDownload(input: unknown) {
        calls.push({ method: "getAttachmentDownload", input });
        return undefined;
      },
    };
    const attachmentDownloadService = {
      async downloadAttachment(input: unknown) {
        calls.push({ method: "downloadAttachment", input });
        return { body: new Response("should not download") };
      },
    };

    await withApi(
      async (baseUrl) => {
        const cases = [
          "/api/accounts/account_2/mailboxes",
          "/api/accounts/account_2/messages",
          "/api/accounts/account_2/messages/message_1",
          "/api/accounts/account_2/attachments/attachment_1/download",
        ];

        for (const path of cases) {
          const response = await fetch(`${baseUrl}${path}`);

          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({ error: "account_not_found" });
        }
        expect(calls).toEqual([]);
      },
      {
        mailReadStore,
        attachmentDownloadService,
        apiAccessAccountIds: ["account_1"],
      },
    );
  });

  it("allows account-scoped mail reads inside the configured API token account scope", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/account_1/messages`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(calls).toEqual([{ accountId: "account_1", limit: 50 }]);
      },
      { mailReadStore, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("lists messages in a mailbox through the mail read store with cursor and q", async () => {
    const calls: unknown[] = [];
    const mailboxId = "00000000-0000-4000-8000-000000000201";
    const cursor = encodeCursorPayload({
      v: 1,
      receivedAt: "2026-06-12T09:00:00.000Z",
      id: "message_1",
    });
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return {
          nextCursor: cursor,
          items: [
            {
              id: "message_1",
              accountId: "account_1",
              subject: "Hello",
              from: { email: "a@example.com", name: "Alice" },
              receivedAt: "2026-06-12T09:00:00.000Z",
              snippet: "Body",
              unread: true,
              starred: false,
              mailboxIds: [mailboxId],
              attachmentCount: 0,
            },
          ],
        };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages?mailboxId=${mailboxId}&limit=25&cursor=${cursor}&q=%20alice%20`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          nextCursor: cursor,
          items: [
            {
              id: "message_1",
              accountId: "account_1",
              subject: "Hello",
              from: { email: "a@example.com", name: "Alice" },
              receivedAt: "2026-06-12T09:00:00.000Z",
              snippet: "Body",
              unread: true,
              starred: false,
              mailboxIds: [mailboxId],
              attachmentCount: 0,
            },
          ],
        });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            mailboxId,
            limit: 25,
            cursor,
            q: "alice",
          },
        ]);
      },
      { mailReadStore },
    );
  });

  it("passes Smart Inbox sorting to the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "message_1",
              accountId: "account_1",
              subject: "Important",
              from: { email: "client@example.com" },
              receivedAt: "2026-06-12T09:00:00.000Z",
              unread: true,
              starred: false,
              mailboxIds: ["mailbox_1"],
              attachmentCount: 0,
              classification: {
                bucket: "P1 Urgent",
                priorityScore: 95,
                reasons: ["今天 17:00 截止"],
              },
            },
          ],
        };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages?sort=time`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [
            {
              id: "message_1",
              classification: {
                bucket: "P1 Urgent",
                priorityScore: 95,
                reasons: ["今天 17:00 截止"],
              },
            },
          ],
        });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            limit: 50,
            sort: "time",
          },
        ]);
      },
      { mailReadStore },
    );
  });

  it("lists Smart Inbox messages across all connected accounts", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "message_gmail",
              accountId: "11111111-1111-4111-8111-111111111111",
              subject: "Gmail customer reply",
              from: { email: "client@example.com" },
              receivedAt: "2026-06-12T09:00:00.000Z",
              unread: true,
              starred: false,
              mailboxIds: ["mailbox_gmail_inbox"],
              attachmentCount: 0,
              classification: {
                bucket: "P1 Urgent",
                priorityScore: 95,
                reasons: ["Direct to you"],
              },
            },
            {
              id: "message_outlook",
              accountId: "22222222-2222-4222-8222-222222222222",
              subject: "Outlook invoice",
              from: { email: "billing@example.com" },
              receivedAt: "2026-06-12T08:00:00.000Z",
              unread: false,
              starred: false,
              mailboxIds: ["mailbox_outlook_inbox"],
              attachmentCount: 1,
              classification: {
                bucket: "P5 Transactions",
                priorityScore: 40,
                reasons: ["Invoice"],
              },
            },
          ],
        };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/messages?sort=time&limit=25`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [
            { id: "message_gmail", accountId: "11111111-1111-4111-8111-111111111111" },
            { id: "message_outlook", accountId: "22222222-2222-4222-8222-222222222222" },
          ],
        });
        expect(calls).toEqual([{ limit: 25, sort: "time" }]);

        expect((await fetch(`${baseUrl}/api/messages?mailboxRole=inbox&sort=time`)).status).toBe(200);
        expect(calls[1]).toEqual({ mailboxRole: "inbox", limit: 50, sort: "time" });
      },
      { mailReadStore },
    );
  });

  it("rejects global mail reads for account-scoped API token contexts", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/messages?sort=time&limit=25`);

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "account_scope_required" });
        expect(calls).toEqual([]);
      },
      { mailReadStore, apiAccessAccountIds: ["account_1"] },
    );
  });

  it("passes saved view filters to the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages?savedView=codes&sort=time`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            limit: 50,
            sort: "time",
            savedViewId: "codes",
          },
        ]);
      },
      { mailReadStore },
    );
  });

  it("passes dynamic saved view ids to the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages?savedView=hermes_contract`,
        );

        expect(response.status).toBe(200);
        expect(calls).toEqual([
          {
            accountId: "account_1",
            limit: 50,
            savedViewId: "hermes_contract",
          },
        ]);
      },
      { mailReadStore },
    );
  });

  it("passes quick filters, label filters, and q scopes to the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages?quickFilter=unread&quickFilter=snoozed&quickFilter=attachments&q=invoice&qScope=sender&qScope=subject&labelId=11111111-1111-4111-8111-111111111111&labelId=22222222-2222-4222-8222-222222222222&tagMode=all`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            limit: 50,
            q: "invoice",
            quickFilters: ["unread", "snoozed", "attachments"],
            qScopes: ["sender", "subject"],
            labelIds: [
              "11111111-1111-4111-8111-111111111111",
              "22222222-2222-4222-8222-222222222222",
            ],
            tagMode: "all",
          },
        ]);
      },
      { mailReadStore },
    );
  });

  it("passes structured search filters to the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/messages?sender=Alice&recipient=legal%40example.com&receivedAfter=2026-06-08&receivedBefore=2026-06-15&hasAttachment=true`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(calls).toEqual([
          {
            limit: 50,
            senderQuery: "Alice",
            recipientQuery: "legal@example.com",
            receivedAfter: "2026-06-08T00:00:00.000Z",
            receivedBefore: "2026-06-15T00:00:00.000Z",
            hasAttachment: true,
          },
        ]);
      },
      { mailReadStore },
    );
  });

  it("rejects invalid mail read query parameters before hitting the store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async getMessage() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const cases = [
          "/api/accounts/account_1/messages?limit=0",
          "/api/accounts/account_1/messages?mailboxId=not-a-uuid",
          "/api/accounts/account_1/messages?sort=random",
          "/api/accounts/account_1/messages?cursor=not-a-cursor",
          `/api/accounts/account_1/messages?q=${"x".repeat(257)}`,
          "/api/accounts/account_1/messages?q=hello%00world",
          "/api/accounts/account_1/messages?savedView=../secret",
          "/api/accounts/account_1/messages?quickFilter=contact",
          "/api/accounts/account_1/messages?qScope=html",
          "/api/accounts/account_1/messages?tagMode=every",
          "/api/accounts/account_1/messages?labelId=not-a-uuid",
          "/api/accounts/account_1/messages?sender=bad%00sender",
          "/api/accounts/account_1/messages?receivedAfter=not-a-date",
          "/api/accounts/account_1/messages?hasAttachment=maybe",
        ];

        for (const path of cases) {
          const response = await fetch(`${baseUrl}${path}`);

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_mail_read_request",
          });
        }
        expect(calls).toEqual([]);
      },
      { mailReadStore },
    );
  });

  it("loads a message detail through the mail read store", async () => {
    const calls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage(input: unknown) {
        calls.push(input);
        return {
          id: "message_1",
          accountId: "account_1",
          subject: "Hello",
          from: { email: "a@example.com" },
          to: ["b@example.com"],
          cc: [],
          receivedAt: "2026-06-12T09:00:00.000Z",
          bodyText: "Plain body",
          bodyHtml: "<p>Body</p>",
          unread: false,
          starred: true,
          mailboxIds: ["mailbox_1"],
          attachmentCount: 0,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          id: "message_1",
          accountId: "account_1",
          subject: "Hello",
          from: { email: "a@example.com" },
          to: ["b@example.com"],
          cc: [],
          receivedAt: "2026-06-12T09:00:00.000Z",
          bodyText: "Plain body",
          bodyHtml: "<p>Body</p>",
          unread: false,
          starred: true,
          mailboxIds: ["mailbox_1"],
          attachmentCount: 0,
        });
        expect(calls).toEqual([
          { accountId: "account_1", messageId: "message_1" },
        ]);
      },
      { mailReadStore },
    );
  });

  it("downloads an attachment through the local attachment id", async () => {
    const mailReadCalls: unknown[] = [];
    const attachmentCalls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
      async getAttachmentDownload(input: unknown) {
        mailReadCalls.push(input);
        return {
          id: "attachment_1",
          accountId: "account_1",
          providerAttachmentId: "ee_attachment_1",
          filename: "invoice 你好.pdf",
          contentType: "application/pdf",
          byteSize: 10,
        };
      },
    };
    const attachmentDownloadService = {
      async downloadAttachment(input: unknown) {
        attachmentCalls.push(input);
        return {
          body: new Response("file-bytes"),
          contentType: "application/pdf",
          contentLength: "10",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/attachments/attachment_1/download`,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/pdf");
        expect(response.headers.get("content-length")).toBe("10");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-disposition")).toBe(
          "attachment; filename=\"invoice __.pdf\"; filename*=UTF-8''invoice%20%E4%BD%A0%E5%A5%BD.pdf",
        );
        expect(await response.text()).toBe("file-bytes");
        expect(mailReadCalls).toEqual([
          { accountId: "account_1", attachmentId: "attachment_1" },
        ]);
        expect(attachmentCalls).toEqual([
          {
            accountId: "account_1",
            providerAttachmentId: "ee_attachment_1",
          },
        ]);
      },
      { mailReadStore, attachmentDownloadService },
    );
  });

  it("downgrades active attachment MIME types to octet-stream", async () => {
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
      async getAttachmentDownload() {
        return {
          id: "attachment_1",
          accountId: "account_1",
          providerAttachmentId: "ee_attachment_1",
          filename: "invoice.html",
          contentType: "text/html",
          byteSize: 21,
        };
      },
    };
    const attachmentDownloadService = {
      async downloadAttachment() {
        return {
          body: new Response("<script>alert(1)</script>"),
          contentType: "text/html",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/attachments/attachment_1/download`,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(
          "application/octet-stream",
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.text()).toBe("<script>alert(1)</script>");
      },
      { mailReadStore, attachmentDownloadService },
    );
  });

  it("rejects attachment downloads when stored byte size exceeds the limit", async () => {
    const attachmentCalls: unknown[] = [];
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
      async getAttachmentDownload() {
        return {
          id: "attachment_1",
          accountId: "account_1",
          providerAttachmentId: "ee_attachment_1",
          filename: "too-large.pdf",
          contentType: "application/pdf",
          byteSize: 11,
        };
      },
    };
    const attachmentDownloadService = {
      async downloadAttachment(input: unknown) {
        attachmentCalls.push(input);
        return {
          body: new Response("should not download"),
          contentType: "application/pdf",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/attachments/attachment_1/download`,
        );

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          error: "request_body_too_large",
        });
        expect(attachmentCalls).toEqual([]);
      },
      { mailReadStore, attachmentDownloadService, maxAttachmentDownloadBytes: 10 },
    );
  });

  it("rejects attachment downloads when upstream content length exceeds the limit", async () => {
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
      async getAttachmentDownload() {
        return {
          id: "attachment_1",
          accountId: "account_1",
          providerAttachmentId: "ee_attachment_1",
          filename: "provider-too-large.pdf",
          contentType: "application/pdf",
          byteSize: 10,
        };
      },
    };
    const attachmentDownloadService = {
      async downloadAttachment() {
        return {
          body: new Response("too-large!!"),
          contentType: "application/pdf",
          contentLength: "11",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/attachments/attachment_1/download`,
        );

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          error: "request_body_too_large",
        });
      },
      { mailReadStore, attachmentDownloadService, maxAttachmentDownloadBytes: 10 },
    );
  });

  it("terminates attachment streams that exceed the download limit without content length", async () => {
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
      async getAttachmentDownload() {
        return {
          id: "attachment_1",
          accountId: "account_1",
          providerAttachmentId: "ee_attachment_1",
          filename: "stream.bin",
          contentType: "application/octet-stream",
          byteSize: 10,
        };
      },
    };
    const attachmentDownloadService = {
      async downloadAttachment() {
        return {
          body: new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("12345"));
                controller.enqueue(new TextEncoder().encode("678901"));
                controller.close();
              },
            }),
          ),
          contentType: "application/octet-stream",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        await expect(
          fetch(
            `${baseUrl}/api/accounts/account_1/attachments/attachment_1/download`,
          ).then(async (response) => {
            expect(response.status).toBe(200);
            await response.arrayBuffer();
          }),
        ).rejects.toThrow();
      },
      { mailReadStore, attachmentDownloadService, maxAttachmentDownloadBytes: 10 },
    );
  });

  it("explains attachment download cannot run until EmailEngine token is configured", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/attachments/attachment_1/download`,
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "emailengine_configuration_required",
        capability: "attachment_download",
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
      });
    });
  });

  it("returns 404 when a local attachment id is not visible for the account", async () => {
    const attachmentDownloadService = {
      async downloadAttachment() {
        throw new Error("should not be called");
      },
    };
    const mailReadStore = {
      async listMailboxes() {
        throw new Error("not used");
      },
      async listMessages() {
        throw new Error("not used");
      },
      async getMessage() {
        throw new Error("not used");
      },
      async getAttachmentDownload() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/attachments/missing/download`,
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "attachment_not_found" });
      },
      { mailReadStore, attachmentDownloadService },
    );
  });

  it("returns 503 for mail read routes when Postgres is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/accounts/account_1/messages`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "mail_read_unavailable" });
    });
  });

  it("records Smart Inbox feedback for a message", async () => {
    const calls: unknown[] = [];
    const smartInboxFeedbackStore = {
      async recordFeedback(input: unknown) {
        calls.push(input);
        return {
          feedbackEventId: "feedback_1",
          accountId: "account_1",
          messageId: "message_1",
          classification: {
            bucket: "P2 Important",
            priorityScore: 85,
            reasons: ["用户标记重要"],
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/smart-inbox/feedback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "move_to_personal" }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          feedbackEventId: "feedback_1",
          accountId: "account_1",
          messageId: "message_1",
          classification: {
            bucket: "P2 Important",
            priorityScore: 85,
            reasons: ["用户标记重要"],
          },
        });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            messageId: "message_1",
            action: "move_to_personal",
          },
        ]);
      },
      { smartInboxFeedbackStore },
    );
  });

  it("rejects invalid Smart Inbox feedback actions before hitting the store", async () => {
    const calls: unknown[] = [];
    const smartInboxFeedbackStore = {
      async recordFeedback(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/smart-inbox/feedback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "random" }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_smart_inbox_feedback",
        });
        expect(calls).toEqual([]);
      },
      { smartInboxFeedbackStore },
    );
  });

  it("returns 503 for Smart Inbox feedback when Postgres is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/messages/message_1/smart-inbox/feedback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "move_to_feed" }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "smart_inbox_feedback_unavailable",
      });
    });
  });

  it("lists Gatekeeper sender screening rows", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async listSenders(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              senderId: "screen_1",
              email: "new@example.com",
              domain: "example.com",
              status: "unknown",
              messageCount: 2,
              latestMessageId: "message_2",
              bulkAvailable: true,
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/screening/senders?accountId=account_1`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              senderId: "screen_1",
              email: "new@example.com",
              domain: "example.com",
              status: "unknown",
              messageCount: 2,
              latestMessageId: "message_2",
              bulkAvailable: true,
            },
          ],
        });
        expect(calls).toEqual([{ accountId: "account_1" }]);
      },
      { senderScreeningStore },
    );
  });

  it("accepts and blocks Gatekeeper senders through local sender ids", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async acceptSender(input: unknown) {
        calls.push({ action: "accept", input });
        return {
          senderId: "screen_1",
          email: "new@example.com",
          domain: "example.com",
          status: "accepted",
          action: "accept",
          eventId: "event_1",
        };
      },
      async blockSender(input: unknown) {
        calls.push({ action: "block", input });
        return {
          senderId: "screen_2",
          email: "bad@example.com",
          domain: "example.com",
          status: "blocked",
          action: "block_sender",
          eventId: "event_2",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const acceptResponse = await fetch(
          `${baseUrl}/api/screening/senders/screen_1/accept`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1" }),
          },
        );
        const blockResponse = await fetch(
          `${baseUrl}/api/screening/senders/screen_2/block`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1" }),
          },
        );

        expect(acceptResponse.status).toBe(202);
        expect(await acceptResponse.json()).toMatchObject({
          senderId: "screen_1",
          status: "accepted",
          action: "accept",
        });
        expect(blockResponse.status).toBe(202);
        expect(await blockResponse.json()).toMatchObject({
          senderId: "screen_2",
          status: "blocked",
          action: "block_sender",
        });
        expect(calls).toEqual([
          {
            action: "accept",
            input: { accountId: "account_1", senderId: "screen_1" },
          },
          {
            action: "block",
            input: { accountId: "account_1", senderId: "screen_2" },
          },
        ]);
      },
      { senderScreeningStore },
    );
  });

  it("rejects Gatekeeper sender decisions without an account id", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async acceptSender(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/screening/senders/screen_1/accept`,
          { method: "POST" },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_sender_screening_request",
        });
        expect(calls).toEqual([]);
      },
      { senderScreeningStore },
    );
  });

  it("bulk accepts Gatekeeper senders and reports missing ids", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async bulkDecideSenders(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              senderId: "screen_1",
              email: "new@example.com",
              domain: "example.com",
              status: "accepted",
              action: "accept",
              eventId: "event_1",
            },
          ],
          missingSenderIds: ["missing_sender"],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/screening/senders/bulk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            senderIds: ["screen_1", "missing_sender"],
            action: "accept",
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          items: [
            {
              senderId: "screen_1",
              email: "new@example.com",
              domain: "example.com",
              status: "accepted",
              action: "accept",
              eventId: "event_1",
            },
          ],
          missingSenderIds: ["missing_sender"],
        });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            senderIds: ["screen_1", "missing_sender"],
            action: "accept",
          },
        ]);
      },
      { senderScreeningStore },
    );
  });

  it("rejects invalid Gatekeeper bulk sender payloads before hitting the store", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async bulkDecideSenders(input: unknown) {
        calls.push(input);
        return { items: [], missingSenderIds: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/screening/senders/bulk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account_1",
            senderIds: [],
            action: "accept",
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_sender_screening_request",
        });
        expect(calls).toEqual([]);
      },
      { senderScreeningStore },
    );
  });

  it("rejects Gatekeeper bulk sender payloads without an account id", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async bulkDecideSenders(input: unknown) {
        calls.push(input);
        return { items: [], missingSenderIds: [] };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/screening/senders/bulk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            senderIds: ["screen_1"],
            action: "accept",
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_sender_screening_request",
        });
        expect(calls).toEqual([]);
      },
      { senderScreeningStore },
    );
  });

  it("blocks Gatekeeper domains by account without exposing provider ids", async () => {
    const calls: unknown[] = [];
    const senderScreeningStore = {
      async blockDomain(input: unknown) {
        calls.push(input);
        return {
          senderId: "domain_rule_1",
          domain: "example.com",
          status: "blocked",
          action: "block_domain",
          eventId: "event_1",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/screening/domains/Example.COM/block`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: "account_1" }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          senderId: "domain_rule_1",
          domain: "example.com",
          status: "blocked",
          action: "block_domain",
          eventId: "event_1",
        });
        expect(calls).toEqual([
          { accountId: "account_1", domain: "Example.COM" },
        ]);
      },
      { senderScreeningStore },
    );
  });

  it("returns 503 for Gatekeeper routes when the store is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/screening/senders?accountId=account_1`,
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "sender_screening_unavailable",
      });
    });
  });

  it("reads and updates Gatekeeper mode through the account settings route", async () => {
    const calls: unknown[] = [];
    const gatekeeperSettingsService = {
      async getSettings(input: unknown) {
        calls.push({ action: "get", input });
        return {
          accountId: "account_1",
          mode: "off_accept_all",
        };
      },
      async updateSettings(input: unknown) {
        calls.push({ action: "update", input });
        return {
          accountId: "account_1",
          mode: "before_inbox",
          updatedAt: "2026-06-14T03:00:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const read = await fetch(
          `${baseUrl}/api/accounts/account_1/gatekeeper/settings`,
        );
        expect(read.status).toBe(200);
        expect(await read.json()).toEqual({
          accountId: "account_1",
          mode: "off_accept_all",
        });

        const update = await fetch(
          `${baseUrl}/api/accounts/account_1/gatekeeper/settings`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "before_inbox" }),
          },
        );
        expect(update.status).toBe(200);
        expect(await update.json()).toEqual({
          accountId: "account_1",
          mode: "before_inbox",
          updatedAt: "2026-06-14T03:00:00.000Z",
        });
        expect(calls).toEqual([
          { action: "get", input: { accountId: "account_1" } },
          {
            action: "update",
            input: { accountId: "account_1", mode: "before_inbox" },
          },
        ]);
      },
      { gatekeeperSettingsService },
    );
  });

  it("returns 503 for Gatekeeper settings when the service is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/gatekeeper/settings`,
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "gatekeeper_settings_unavailable",
      });
    });
  });

  it("previews CSV account imports through the import service", async () => {
    const calls: unknown[] = [];
    const accountImportService = {
      async previewCsv(input: unknown) {
        calls.push(input);
        return {
          summary: {
            totalRows: 1,
            ready: 1,
            needsOAuth: 0,
            disabled: 0,
            invalid: 0,
          },
          rows: [
            {
              rowNumber: 2,
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              status: "ready",
              errors: [],
              warnings: [],
            },
          ],
        };
      },
      async createImport() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/import/csv/preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ csv: "email,provider\na@b.com,qq" }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          summary: {
            totalRows: 1,
            ready: 1,
            needsOAuth: 0,
            disabled: 0,
            invalid: 0,
          },
          rows: [
            {
              rowNumber: 2,
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              status: "ready",
              errors: [],
              warnings: [],
            },
          ],
        });
        expect(calls).toEqual([{ csv: "email,provider\na@b.com,qq" }]);
      },
      { accountImportService },
    );
  });

  it("creates CSV account import tasks through the import service", async () => {
    const calls: unknown[] = [];
    const accountImportService = {
      async previewCsv() {
        throw new Error("not used");
      },
      async createImport(input: unknown) {
        calls.push(input);
        return {
          createdTaskCount: 1,
          summary: {
            totalRows: 1,
            ready: 1,
            needsOAuth: 0,
            disabled: 0,
            invalid: 0,
          },
          rows: [],
          tasks: [
            {
              rowNumber: 2,
              id: "task_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              status: "pending",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/import/csv`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ csv: "email,provider\na@b.com,qq" }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          createdTaskCount: 1,
          summary: {
            totalRows: 1,
            ready: 1,
            needsOAuth: 0,
            disabled: 0,
            invalid: 0,
          },
          rows: [],
          tasks: [
            {
              rowNumber: 2,
              id: "task_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              status: "pending",
            },
          ],
        });
        expect(calls).toEqual([{ csv: "email,provider\na@b.com,qq" }]);
      },
      { accountImportService },
    );
  });

  it("rejects invalid CSV import requests before calling the service", async () => {
    const accountImportService = {
      async previewCsv() {
        throw new Error("should not be called");
      },
      async createImport() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/import/csv/preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ csv: "" }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_csv_import",
        });
      },
      { accountImportService },
    );
  });

  it("exports account transfer configuration through the transfer service", async () => {
    const calls: unknown[] = [];
    const accountTransferService = {
      async exportConfig(input: unknown) {
        calls.push(input);
        return {
          schemaVersion: 1,
          exportedAt: "2026-06-13T08:00:00.000Z",
          accounts: [
            {
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              displayName: "Support",
              engineProvider: "emailengine",
            },
          ],
        };
      },
      async importConfig() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/transfer/export`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountIds: ["acc_1"] }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          schemaVersion: 1,
          exportedAt: "2026-06-13T08:00:00.000Z",
          accounts: [
            {
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              displayName: "Support",
              engineProvider: "emailengine",
            },
          ],
        });
        expect(calls).toEqual([{ accountIds: ["acc_1"] }]);
      },
      { accountTransferService },
    );
  });

  it("imports account transfer configuration through the transfer service", async () => {
    const calls: unknown[] = [];
    const transferPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-12T10:00:00.000Z",
      accounts: [
        {
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          engineProvider: "emailengine",
        },
      ],
    };
    const accountTransferService = {
      async exportConfig() {
        throw new Error("not used");
      },
      async importConfig(input: unknown) {
        calls.push(input);
        return {
          importedTaskCount: 1,
          reauthRequiredCount: 1,
          tasks: [
            {
              id: "task_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              status: "pending",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/transfer/import`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ package: transferPackage }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          importedTaskCount: 1,
          reauthRequiredCount: 1,
          tasks: [
            {
              id: "task_1",
              email: "support@qq.com",
              provider: "qq",
              authMethod: "password",
              status: "pending",
            },
          ],
        });
        expect(calls).toEqual([{ package: transferPackage }]);
      },
      { accountTransferService },
    );
  });

  it("rejects invalid account transfer import requests before calling the service", async () => {
    const accountTransferService = {
      async exportConfig() {
        throw new Error("not used");
      },
      async importConfig() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/transfer/import`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ package: { schemaVersion: 2 } }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_account_transfer",
        });
      },
      { accountTransferService },
    );
  });
});

function encodeCursorPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
