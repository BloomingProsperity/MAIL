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

        const response = await fetch(
          `${baseUrl}/api/diagnostics/logs?requestId=req_diag_1&limit=5`,
          {
            headers: { "x-request-id": "req_diag_reader" },
          },
        );

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
      { logger, diagnosticsLogStore },
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

  it("lists messages in a mailbox through the mail read store with cursor and q", async () => {
    const calls: unknown[] = [];
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
              mailboxIds: ["mailbox_1"],
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
          `${baseUrl}/api/accounts/account_1/messages?mailboxId=mailbox_1&limit=25&cursor=${cursor}&q=%20alice%20`,
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
              mailboxIds: ["mailbox_1"],
              attachmentCount: 0,
            },
          ],
        });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            mailboxId: "mailbox_1",
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
          `${baseUrl}/api/accounts/account_1/messages?sort=smart`,
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
            sort: "smart",
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
        const response = await fetch(`${baseUrl}/api/messages?sort=smart&limit=25`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          items: [
            { id: "message_gmail", accountId: "11111111-1111-4111-8111-111111111111" },
            { id: "message_outlook", accountId: "22222222-2222-4222-8222-222222222222" },
          ],
        });
        expect(calls).toEqual([
          {
            limit: 25,
            sort: "smart",
          },
        ]);
      },
      { mailReadStore },
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
          `${baseUrl}/api/accounts/account_1/messages?savedView=codes&sort=smart`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            limit: 50,
            sort: "smart",
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
          `${baseUrl}/api/accounts/account_1/messages?quickFilter=unread&quickFilter=attachments&q=invoice&qScope=sender&qScope=subject&labelId=11111111-1111-4111-8111-111111111111&labelId=22222222-2222-4222-8222-222222222222&tagMode=all`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ items: [] });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            limit: 50,
            q: "invoice",
            quickFilters: ["unread", "attachments"],
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
        const timeOnlyCursor = encodeCursorPayload({
          v: 1,
          receivedAt: "2026-06-12T10:00:00.000Z",
          id: "message_important",
        });
        const cases = [
          "/api/accounts/account_1/messages?limit=0",
          "/api/accounts/account_1/messages?sort=random",
          "/api/accounts/account_1/messages?cursor=not-a-cursor",
          `/api/accounts/account_1/messages?sort=smart&cursor=${timeOnlyCursor}`,
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

  it("rejects unsigned EmailEngine webhooks", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        body: JSON.stringify({ event: "messageNew", account: "acc_1" }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "invalid_emailengine_signature",
      });
    });
  });

  it("accepts signed EmailEngine webhooks, stores events, and queues sync jobs", async () => {
    await withApi(
      async (baseUrl, store) => {
        const body = webhookBody({
          event: "messageDeleted",
          account: "acc_1",
          data: { id: "msg_1" },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

        expect(response.status).toBe(202);
        const payload = await response.json();

        expect(payload).toMatchObject({
          events: [
            {
              source: "emailengine_webhook",
              kind: "message_deleted",
              accountId: "acc_1",
              providerMessageId: "msg_1",
              idempotencyKey: expect.stringMatching(
                /^emailengine:acc_1:messageDeleted:msg_1:/,
              ),
            },
          ],
          duplicateCount: 0,
        });
        expect(payload.storedEvents[0]).toMatchObject({
          kind: "message_deleted",
          accountId: "acc_1",
          providerMessageId: "msg_1",
          duplicate: false,
        });
        expect(payload.syncJobs[0]).toMatchObject({
          jobType: "sync_account",
          accountId: "acc_1",
          status: "queued",
        });
        expect(store.listEvents()).toHaveLength(1);
        expect(store.listSyncJobs()).toHaveLength(1);
      },
      {
        apiAccessToken: "api-secret",
        apiAccessTokenConfigured: true,
        apiAccessTokenRequired: true,
      },
    );
  });

  it("records EmailEngine webhook ingest diagnostics without storing raw payload secrets", async () => {
    const operationalEvents: unknown[] = [];
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_webhook_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const body = webhookBody({
          event: "authenticationError",
          account: "acc_2",
          data: { secret: "raw-webhook-secret" },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-request-id": "req_webhook_1",
          },
          body,
        });

        expect(response.status).toBe(202);
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "info",
            event: "emailengine_webhook_ingested",
            requestId: "req_webhook_1",
            accountId: "acc_2",
            lane: "sync",
            jobId: expect.any(String),
            message: "EmailEngine webhook auth_failed ingested for acc_2",
            context: {
              duplicate: false,
              mailEngineEventId: expect.any(String),
              mailEngineEventKind: "auth_failed",
              mailEngineIdempotencyKey: expect.stringMatching(
                /^emailengine:acc_2:authenticationError:authenticationError:/,
              ),
              syncJobId: expect.any(String),
              syncJobType: "account_state",
            },
          },
        ]);
        expect(JSON.stringify(operationalEvents)).not.toContain(
          "raw-webhook-secret",
        );
      },
      { operationalEventLogService },
    );
  });

  it("records EmailEngine webhook resource identity so real smoke can match the delivered Message-ID", async () => {
    const operationalEvents: unknown[] = [];
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_webhook_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const body = webhookBody({
          event: "messageNew",
          account: "acc_1",
          path: "INBOX",
          data: {
            id: "ee_msg_1",
            emailId: "ee_email_1",
            threadId: "thread_1",
            messageId:
              "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
            secret: "raw-webhook-secret",
          },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-request-id": "req_webhook_msg_1",
          },
          body,
        });

        expect(response.status).toBe(202);
        expect(operationalEvents).toEqual([
          expect.objectContaining({
            event: "emailengine_webhook_ingested",
            accountId: "acc_1",
            lane: "sync",
            context: expect.objectContaining({
              mailEngineEventKind: "message_upserted",
              rfcMessageId:
                "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
              providerMessageId: "ee_msg_1",
              resourceIdentity: {
                emailengineMessageId: "ee_msg_1",
                emailengineEmailId: "ee_email_1",
                internetMessageId:
                  "<emailhub-real-webhook-unique_1@emailhub-smoke.local>",
                mailboxPath: "INBOX",
                threadId: "thread_1",
                resourceKey: "emailengine:acc_1:emailId:ee_email_1",
              },
            }),
          }),
        ]);
        expect(JSON.stringify(operationalEvents)).not.toContain(
          "raw-webhook-secret",
        );
      },
      { operationalEventLogService },
    );
  });

  it("does not enqueue duplicate jobs for repeated signed webhooks", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageNew",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = () =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

      expect((await request()).status).toBe(202);
      const duplicateResponse = await request();

      expect(duplicateResponse.status).toBe(202);
      expect(await duplicateResponse.json()).toMatchObject({
        duplicateCount: 1,
        syncJobs: [],
      });
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("rejects signed EmailEngine webhooks outside the freshness window before ingesting", async () => {
    await withApi(
      async (baseUrl, store) => {
        const body = webhookBody({
          date: "2026-06-17T09:50:00.000Z",
          event: "messageNew",
          account: "acc_1",
          data: { id: "msg_1" },
        });
        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: "stale_emailengine_webhook",
        });
        expect(store.listEvents()).toHaveLength(0);
        expect(store.listSyncJobs()).toHaveLength(0);
      },
      {
        now: () => new Date("2026-06-17T10:00:01.000Z"),
        emailEngineWebhookMaxSkewMs: 10 * 60 * 1000,
      },
    );
  });

  it("rejects signed EmailEngine webhooks without a valid payload date", async () => {
    await withApi(async (baseUrl, store) => {
      const body = JSON.stringify({
        event: "messageNew",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ee-wh-signature": sign(body),
        },
        body,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_emailengine_webhook_date",
      });
      expect(store.listEvents()).toHaveLength(0);
      expect(store.listSyncJobs()).toHaveLength(0);
    });
  });

  it("rejects oversized EmailEngine webhooks before ingesting them", async () => {
    await withApi(
      async (baseUrl, store) => {
        const body = webhookBody({
          event: "messageNew",
          account: "acc_1",
          data: { id: "msg_1" },
          padding: "x".repeat(256),
        });

        const response = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
          },
          body,
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({
          error: "request_body_too_large",
        });
        expect(store.listEvents()).toHaveLength(0);
        expect(store.listSyncJobs()).toHaveLength(0);
      },
      { maxRequestBodyBytes: 64 },
    );
  });

  it("queues later updates for the same EmailEngine message when webhook ids differ", async () => {
    await withApi(async (baseUrl, store) => {
      const messageNew = webhookBody({
        event: "messageNew",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const messageUpdated = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: {
          id: "msg_1",
          changes: { flags: { added: ["\\Seen"], value: ["\\Seen"] } },
        },
      });

      const first = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ee-wh-signature": sign(messageNew),
          "x-ee-wh-event-id": "evt_new",
        },
        body: messageNew,
      });
      const second = await fetch(`${baseUrl}/api/webhooks/emailengine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ee-wh-signature": sign(messageUpdated),
          "x-ee-wh-event-id": "evt_updated",
        },
        body: messageUpdated,
      });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(await second.json()).toMatchObject({
        duplicateCount: 0,
        syncJobs: [
          {
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: expect.stringMatching(
              /^job:emailengine:acc_1:messageUpdated:msg_1:/,
            ),
          },
        ],
      });
      expect(store.listEvents()).toHaveLength(2);
      expect(store.listSyncJobs()).toHaveLength(2);
    });
  });

  it("deduplicates repeated webhook deliveries with the same EmailEngine event id", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = () =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-ee-wh-event-id": "evt_same",
          },
          body,
        });

      expect((await request()).status).toBe(202);
      const duplicate = await request();

      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toMatchObject({
        duplicateCount: 1,
        syncJobs: [],
      });
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("deduplicates replayed signed webhook bodies even when the unsigned event id header changes", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = (eventId: string) =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-ee-wh-event-id": eventId,
          },
          body,
        });

      expect((await request("evt_original")).status).toBe(202);
      const replay = await request("evt_replayed");

      expect(replay.status).toBe(202);
      expect(await replay.json()).toMatchObject({
        duplicateCount: 1,
        syncJobs: [],
      });
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("deduplicates a burst of concurrent repeated webhook deliveries", async () => {
    await withApi(async (baseUrl, store) => {
      const body = webhookBody({
        event: "messageUpdated",
        account: "acc_1",
        data: { id: "msg_1" },
      });
      const request = () =>
        fetch(`${baseUrl}/api/webhooks/emailengine`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ee-wh-signature": sign(body),
            "x-ee-wh-event-id": "evt_burst",
          },
          body,
        });

      const responses = await Promise.all(
        Array.from({ length: 64 }, () => request()),
      );
      const payloads = await Promise.all(
        responses.map(async (response) => ({
          status: response.status,
          body: await response.json(),
        })),
      );

      expect(payloads.every((payload) => payload.status === 202)).toBe(true);
      expect(
        payloads.reduce(
          (total, payload) => total + payload.body.duplicateCount,
          0,
        ),
      ).toBe(63);
      expect(store.listEvents()).toHaveLength(1);
      expect(store.listSyncJobs()).toHaveLength(1);
    });
  });

  it("starts IMAP/SMTP account onboarding through the account service", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "completed",
          },
          account: {
            id: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "support@qq.com",
            provider: "qq",
            displayName: "Support",
            imap: {
              host: "imap.qq.com",
              port: 993,
              secure: true,
              username: "support@qq.com",
              secret: "imap-auth-code",
            },
            smtp: {
              host: "smtp.qq.com",
              port: 465,
              secure: true,
              username: "support@qq.com",
              secret: "smtp-auth-code",
            },
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "completed",
          },
          account: {
            id: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
        });
        expect(calls).toEqual([
          {
            email: "support@qq.com",
            provider: "qq",
            displayName: "Support",
            imap: {
              host: "imap.qq.com",
              port: 993,
              secure: true,
              username: "support@qq.com",
              secret: "imap-auth-code",
            },
            smtp: {
              host: "smtp.qq.com",
              port: 465,
              secure: true,
              username: "support@qq.com",
              secret: "smtp-auth-code",
            },
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("starts iCloud onboarding with provider preset credentials", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_icloud",
            email: "me@icloud.com",
            provider: "icloud",
            authMethod: "password",
            status: "completed",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "me@icloud.com",
            provider: "icloud",
            displayName: "iCloud Mail",
            username: "me@icloud.com",
            secret: "apple-app-specific-password",
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_icloud",
            email: "me@icloud.com",
            provider: "icloud",
            authMethod: "password",
            status: "completed",
          },
        });
        expect(calls).toEqual([
          {
            email: "me@icloud.com",
            provider: "icloud",
            displayName: "iCloud Mail",
            username: "me@icloud.com",
            secret: "apple-app-specific-password",
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("starts preset IMAP/SMTP onboarding without manual server settings", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_163",
            email: "archive@163.com",
            provider: "163",
            authMethod: "password",
            status: "completed",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "archive@163.com",
            provider: "163",
            displayName: "NetEase 163",
            secret: "netease-auth-code",
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_163",
            email: "archive@163.com",
            provider: "163",
            authMethod: "password",
            status: "completed",
          },
        });
        expect(calls).toEqual([
          {
            email: "archive@163.com",
            provider: "163",
            displayName: "NetEase 163",
            secret: "netease-auth-code",
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("rejects invalid IMAP/SMTP onboarding requests before calling the service", async () => {
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "qq",
            imap: { host: "imap.qq.com", port: 993, secure: true },
            smtp: { host: "smtp.qq.com", port: 465, secure: true },
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_imap_smtp_account",
          detail: "email is required",
        });
      },
      { accountOnboardingService },
    );
  });

  it("explains IMAP/SMTP onboarding cannot run until EmailEngine token is configured", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "support@qq.com",
          provider: "qq",
          secret: "qq-auth-code",
        }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "emailengine_configuration_required",
        capability: "imap_smtp_onboarding",
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
      });
    });
  });

  it("tests IMAP/SMTP credentials without starting onboarding", async () => {
    const calls: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("should not start onboarding");
      },
      async testImapSmtpConnection(input: unknown) {
        calls.push(input);
        return {
          provider: "qq",
          ok: true,
          checks: {
            imap: { ok: true },
            smtp: { ok: true },
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/imap-smtp/test`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: "support@qq.com",
              provider: "qq",
              secret: "qq-auth-code",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          provider: "qq",
          ok: true,
          checks: {
            imap: { ok: true },
            smtp: { ok: true },
          },
        });
        expect(calls).toEqual([
          {
            email: "support@qq.com",
            provider: "qq",
            secret: "qq-auth-code",
          },
        ]);
      },
      { accountOnboardingService },
    );
  });

  it("explains IMAP/SMTP connection tests cannot run until EmailEngine token is configured", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/accounts/imap-smtp/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "support@qq.com",
          provider: "qq",
          secret: "qq-auth-code",
        }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "emailengine_configuration_required",
        capability: "imap_smtp_onboarding",
        missing: ["EMAILENGINE_ACCESS_TOKEN"],
      });
    });
  });

  it("rejects invalid IMAP/SMTP connection tests before calling the service", async () => {
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("should not be called");
      },
      async testImapSmtpConnection() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/imap-smtp/test`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              provider: "qq",
              secret: "qq-auth-code",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_imap_smtp_connection_test",
          detail: "email is required",
        });
      },
      { accountOnboardingService },
    );
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
