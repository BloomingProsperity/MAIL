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

describe("reauthorization routes", () => {
  it("starts OAuth reauthorization through the recovery service", async () => {
    const calls: unknown[] = [];
    const reauthorizationRecoveryService = {
      async startOAuth(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_oauth",
            email: "boss@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
          provider: "gmail",
          state: "state_1",
          authorizationUrl: "https://accounts.example.test/auth?state=state_1",
        };
      },
      async completeImapSmtp() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/sync-center/reauthorizations/task_oauth/oauth/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              redirectUri: "https://app.example.com/oauth/callback",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_oauth",
            email: "boss@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
          provider: "gmail",
          state: "state_1",
          authorizationUrl: "https://accounts.example.test/auth?state=state_1",
        });
        expect(calls).toEqual([
          {
            taskId: "task_oauth",
            redirectUri: "https://app.example.com/oauth/callback",
          },
        ]);
      },
      { reauthorizationRecoveryService },
    );
  });

  it("completes IMAP/SMTP reauthorization through the recovery service", async () => {
    const calls: unknown[] = [];
    const reauthorizationRecoveryService = {
      async startOAuth() {
        throw new Error("not used");
      },
      async completeImapSmtp(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_password",
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
        const response = await fetch(
          `${baseUrl}/api/sync-center/reauthorizations/task_password/imap-smtp`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              username: "support@qq.com",
              secret: "qq-auth-code",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          task: {
            id: "task_password",
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
            taskId: "task_password",
            username: "support@qq.com",
            secret: "qq-auth-code",
          },
        ]);
      },
      { reauthorizationRecoveryService },
    );
  });

  it("rejects invalid reauthorization requests before calling the service", async () => {
    const reauthorizationRecoveryService = {
      async startOAuth() {
        throw new Error("should not be called");
      },
      async completeImapSmtp() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const oauth = await fetch(
          `${baseUrl}/api/sync-center/reauthorizations/task_oauth/oauth/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ redirectUri: "" }),
          },
        );
        const password = await fetch(
          `${baseUrl}/api/sync-center/reauthorizations/task_password/imap-smtp`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: "support@qq.com" }),
          },
        );

        expect(oauth.status).toBe(400);
        expect(await oauth.json()).toEqual({
          error: "invalid_reauthorization_request",
        });
        expect(password.status).toBe(400);
        expect(await password.json()).toEqual({
          error: "invalid_reauthorization_request",
        });
      },
      { reauthorizationRecoveryService },
    );
  });

  it("records IMAP/SMTP reauthorization failures with diagnostics and without secrets", async () => {
    const operationalEvents: unknown[] = [];
    const reauthorizationRecoveryService = {
      async startOAuth() {
        throw new Error("not used");
      },
      async completeImapSmtp() {
        throw Object.assign(
          new Error("EAUTH invalid qq-auth-code for support@qq.com"),
          {
            code: "reauthorization_failed",
            provider: "qq",
            diagnostics: [
              {
                code: "qq_authorization_code_required",
                provider: "qq",
                severity: "action_required",
                affected: "account",
                message:
                  "Use the authorization code generated in QQ Mail settings, not qq-auth-code.",
                recoveryAction: "enable_qq_mail_authorization_code",
              },
            ],
          },
        );
      },
    };
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_event_1",
          occurredAt: "2026-06-14T08:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/sync-center/reauthorizations/task_password/imap-smtp`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_reauth",
            },
            body: JSON.stringify({
              username: "support@qq.com",
              secret: "qq-auth-code",
            }),
          },
        );
        const bodyText = await response.text();

        expect(response.status).toBe(400);
        expect(JSON.parse(bodyText)).toEqual({
          error: "reauthorization_failed",
          provider: "qq",
          diagnostics: [
            {
              code: "qq_authorization_code_required",
              provider: "qq",
              severity: "action_required",
              affected: "account",
              message:
                "Use the authorization code generated in QQ Mail settings, not [redacted].",
              recoveryAction: "enable_qq_mail_authorization_code",
            },
          ],
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "error",
            event: "reauthorization_imap_smtp_failed",
            requestId: "req_reauth",
            lane: "account_reauthorization",
            message: "IMAP/SMTP reauthorization failed for qq",
            context: {
              action: "complete_imap_smtp_reauthorization",
              taskId: "task_password",
              provider: "qq",
              error: {
                name: "Error",
                message: "EAUTH invalid [redacted] for support@qq.com",
              },
              diagnostics: [
                {
                  code: "qq_authorization_code_required",
                  provider: "qq",
                  severity: "action_required",
                  affected: "account",
                  message:
                    "Use the authorization code generated in QQ Mail settings, not [redacted].",
                  recoveryAction: "enable_qq_mail_authorization_code",
                },
              ],
            },
          },
        ]);
        expect(bodyText).not.toContain("qq-auth-code");
        expect(JSON.stringify(operationalEvents)).not.toContain("qq-auth-code");
      },
      { reauthorizationRecoveryService, operationalEventLogService },
    );
  });
});
