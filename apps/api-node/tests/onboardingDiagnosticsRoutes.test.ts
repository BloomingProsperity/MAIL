import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";
import { ImapSmtpOnboardingFailedError } from "../src/accounts/imap-smtp-onboarding";

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

describe("account onboarding diagnostic events", () => {
  it("records failed OAuth starts with provider and redirect path context", async () => {
    const operationalEvents: unknown[] = [];
    const oauthOnboardingService = {
      async createAuthSession() {
        throw new Error("OAuth provider rejected redirect");
      },
      async completeAuthCallback() {
        throw new Error("not used");
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
          `${baseUrl}/api/accounts/oauth/outlook/start`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_oauth_start",
            },
            body: JSON.stringify({
              redirectUri:
                "https://app.example.com/oauth/callback?code=raw-code",
              loginHint: "me@outlook.com",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "bad_request",
          detail: "OAuth provider rejected redirect",
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "error",
            event: "oauth_onboarding_start_failed",
            requestId: "req_oauth_start",
            lane: "account_onboarding",
            message: "OAuth onboarding start failed for outlook",
            context: {
              action: "start_oauth_onboarding",
              authMethod: "oauth",
              provider: "outlook",
              loginHint: "me@outlook.com",
              redirectPath: "/oauth/callback?code=%5Bredacted%5D",
              error: {
                name: "Error",
                message: "OAuth provider rejected redirect",
              },
            },
          },
        ]);
      },
      { oauthOnboardingService, operationalEventLogService },
    );
  });

  it("records failed OAuth callbacks without leaking authorization codes", async () => {
    const operationalEvents: unknown[] = [];
    const oauthOnboardingService = {
      async createAuthSession() {
        throw new Error("not used");
      },
      async completeAuthCallback() {
        throw new Error("OAuth code raw-oauth-code expired");
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
          `${baseUrl}/api/accounts/oauth/gmail/callback?state=state_1&code=raw-oauth-code`,
          {
            headers: {
              "x-request-id": "req_oauth_callback",
            },
          },
        );
        const bodyText = await response.text();

        expect(response.status).toBe(400);
        expect(JSON.parse(bodyText)).toEqual({
          error: "bad_request",
          detail: "OAuth code [redacted] expired",
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "error",
            event: "oauth_onboarding_callback_failed",
            requestId: "req_oauth_callback",
            lane: "account_onboarding",
            message: "OAuth callback failed for gmail",
            context: {
              action: "complete_oauth_callback",
              authMethod: "oauth",
              provider: "gmail",
              state: "state_1",
              error: {
                name: "Error",
                message: "OAuth code [redacted] expired",
              },
            },
          },
        ]);
        expect(bodyText).not.toContain("raw-oauth-code");
        expect(JSON.stringify(operationalEvents)).not.toContain(
          "raw-oauth-code",
        );
      },
      { oauthOnboardingService, operationalEventLogService },
    );
  });

  it("records failed IMAP/SMTP connection tests without leaking app passwords", async () => {
    const operationalEvents: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("not used");
      },
      async testImapSmtpConnection() {
        return {
          provider: "qq",
          ok: false,
          checks: {
            imap: {
              ok: false,
              code: "EAUTH",
              error: "Invalid qq-auth-code",
            },
            smtp: { ok: true },
          },
          diagnostics: [
            {
              code: "qq_authorization_code_required",
              provider: "qq",
              severity: "action_required",
              affected: "account",
              message:
                "Use qq-auth-code from QQ Mail settings, not your normal account password.",
              recoveryAction: "enable_qq_mail_authorization_code",
            },
          ],
        };
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
          `${baseUrl}/api/accounts/imap-smtp/test`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_add_mail_test",
            },
            body: JSON.stringify({
              email: "support@qq.com",
              provider: "qq",
              secret: "qq-auth-code",
            }),
          },
        );
        const bodyText = await response.text();

        expect(response.status).toBe(200);
        expect(JSON.parse(bodyText)).toEqual({
          provider: "qq",
          ok: false,
          checks: {
            imap: {
              ok: false,
              code: "EAUTH",
              error: "Invalid [redacted]",
            },
            smtp: { ok: true },
          },
          diagnostics: [
            {
              code: "qq_authorization_code_required",
              provider: "qq",
              severity: "action_required",
              affected: "account",
              message:
                "Use [redacted] from QQ Mail settings, not your normal account password.",
              recoveryAction: "enable_qq_mail_authorization_code",
            },
          ],
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "warn",
            event: "account_onboarding_connection_test_failed",
            requestId: "req_add_mail_test",
            lane: "account_onboarding",
            message: "IMAP/SMTP connection test failed for qq",
            context: {
              action: "test_imap_smtp_connection",
              authMethod: "password",
              email: "support@qq.com",
              provider: "qq",
              inputMode: "preset",
              checks: {
                imap: {
                  ok: false,
                  code: "EAUTH",
                  error: "Invalid [redacted]",
                },
                smtp: { ok: true },
              },
              diagnostics: [
                {
                  code: "qq_authorization_code_required",
                  provider: "qq",
                  severity: "action_required",
                  affected: "account",
                  message:
                    "Use [redacted] from QQ Mail settings, not your normal account password.",
                  recoveryAction: "enable_qq_mail_authorization_code",
                },
              ],
            },
          },
        ]);
        expect(bodyText).not.toContain("qq-auth-code");
        expect(JSON.stringify(operationalEvents)).not.toContain("qq-auth-code");
      },
      { accountOnboardingService, operationalEventLogService },
    );
  });

  it("records failed IMAP/SMTP onboarding and keeps the user-facing error sanitized", async () => {
    const operationalEvents: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error(
          "EmailEngine rejected apple-app-specific-password",
        );
      },
      async testImapSmtpConnection() {
        throw new Error("not used");
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
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_add_mail_onboard",
          },
          body: JSON.stringify({
            email: "me@icloud.com",
            provider: "icloud",
            displayName: "iCloud Mail",
            secret: "apple-app-specific-password",
          }),
        });
        const bodyText = await response.text();

        expect(response.status).toBe(400);
        expect(JSON.parse(bodyText)).toEqual({
          error: "bad_request",
          detail: "EmailEngine rejected [redacted]",
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "error",
            event: "account_onboarding_failed",
            requestId: "req_add_mail_onboard",
            lane: "account_onboarding",
            message: "IMAP/SMTP onboarding failed for icloud",
            context: {
              action: "onboard_imap_smtp",
              authMethod: "password",
              email: "me@icloud.com",
              provider: "icloud",
              inputMode: "preset",
              error: {
                name: "Error",
                message: "EmailEngine rejected [redacted]",
              },
            },
          },
        ]);
        expect(bodyText).not.toContain("apple-app-specific-password");
        expect(JSON.stringify(operationalEvents)).not.toContain(
          "apple-app-specific-password",
        );
      },
      { accountOnboardingService, operationalEventLogService },
    );
  });

  it("returns provider recovery diagnostics when initial IMAP/SMTP registration fails", async () => {
    const operationalEvents: unknown[] = [];
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new ImapSmtpOnboardingFailedError({
          provider: "qq",
          message:
            "EmailEngine account registration failed: EAUTH [redacted] rejected",
          diagnostics: [
            {
              code: "qq_authorization_code_required",
              provider: "qq",
              severity: "action_required" as const,
              affected: "account" as const,
              message:
                "Use [redacted] from QQ Mail settings, not your normal account password.",
              recoveryAction: "enable_qq_mail_authorization_code",
            },
          ],
        });
      },
      async testImapSmtpConnection() {
        throw new Error("not used");
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
        const response = await fetch(`${baseUrl}/api/accounts/imap-smtp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_add_mail_onboard_diagnostics",
          },
          body: JSON.stringify({
            email: "support@qq.com",
            provider: "qq",
            secret: "qq-auth-code",
          }),
        });
        const bodyText = await response.text();

        expect(response.status).toBe(400);
        expect(JSON.parse(bodyText)).toEqual({
          error: "imap_smtp_onboarding_failed",
          provider: "qq",
          detail:
            "EmailEngine account registration failed: EAUTH [redacted] rejected",
          diagnostics: [
            {
              code: "qq_authorization_code_required",
              provider: "qq",
              severity: "action_required",
              affected: "account",
              message:
                "Use [redacted] from QQ Mail settings, not your normal account password.",
              recoveryAction: "enable_qq_mail_authorization_code",
            },
          ],
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "error",
            event: "account_onboarding_failed",
            requestId: "req_add_mail_onboard_diagnostics",
            lane: "account_onboarding",
            message: "IMAP/SMTP onboarding failed for qq",
            context: {
              action: "onboard_imap_smtp",
              authMethod: "password",
              email: "support@qq.com",
              provider: "qq",
              inputMode: "preset",
              error: {
                name: "Error",
                message:
                  "EmailEngine account registration failed: EAUTH [redacted] rejected",
              },
              diagnostics: [
                {
                  code: "qq_authorization_code_required",
                  provider: "qq",
                  severity: "action_required",
                  affected: "account",
                  message:
                    "Use [redacted] from QQ Mail settings, not your normal account password.",
                  recoveryAction: "enable_qq_mail_authorization_code",
                },
              ],
            },
          },
        ]);
        expect(bodyText).not.toContain("qq-auth-code");
        expect(JSON.stringify(operationalEvents)).not.toContain("qq-auth-code");
      },
      { accountOnboardingService, operationalEventLogService },
    );
  });

  it("does not fail connection tests when diagnostic event recording is unavailable", async () => {
    const accountOnboardingService = {
      async onboardImapSmtp() {
        throw new Error("not used");
      },
      async testImapSmtpConnection() {
        return {
          provider: "proton_bridge",
          ok: false,
          checks: {
            imap: { ok: false, code: "ECONNREFUSED" },
            smtp: { ok: false, code: "ECONNREFUSED" },
          },
          diagnostics: [
            {
              code: "proton_bridge_unreachable",
              provider: "proton_bridge",
              severity: "action_required",
              affected: "account",
              message:
                "Start Proton Bridge on this computer, keep it signed in, then test this mailbox again.",
              recoveryAction: "start_proton_bridge",
            },
          ],
        };
      },
    };
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent() {
        throw new Error("operational event store is down");
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
              email: "me@proton.me",
              provider: "proton",
              username: "bridge-user",
              secret: "bridge-password",
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          provider: "proton_bridge",
          ok: false,
          checks: {
            imap: { ok: false, code: "ECONNREFUSED" },
            smtp: { ok: false, code: "ECONNREFUSED" },
          },
          diagnostics: [
            {
              code: "proton_bridge_unreachable",
              provider: "proton_bridge",
              severity: "action_required",
              affected: "account",
              message:
                "Start Proton Bridge on this computer, keep it signed in, then test this mailbox again.",
              recoveryAction: "start_proton_bridge",
            },
          ],
        });
      },
      { accountOnboardingService, operationalEventLogService },
    );
  });
});
