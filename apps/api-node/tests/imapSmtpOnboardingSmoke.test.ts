import { describe, expect, it } from "vitest";

import {
  buildImapSmtpOnboardingSmokePayload,
  runImapSmtpOnboardingAuthSmoke,
  runImapSmtpOnboardingSmoke,
} from "../src/accounts/imap-smtp-onboarding-smoke";

describe("IMAP/SMTP onboarding smoke helpers", () => {
  it("tests credentials, onboards the account, then verifies sync center visibility", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url: href, body });

      if (href.endsWith("/api/accounts/imap-smtp/test")) {
        return jsonResponse(200, {
          provider: "custom_domain",
          ok: true,
          checks: { imap: { ok: true }, smtp: { ok: true } },
        });
      }

      if (href.endsWith("/api/accounts/imap-smtp")) {
        return jsonResponse(202, {
          task: {
            id: "task_1",
            email: "support@example.com",
            provider: "custom_domain",
            authMethod: "password",
            status: "completed",
          },
          account: {
            id: "acc_1",
            email: "support@example.com",
            provider: "custom_domain",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          syncJob: {
            id: "job_1",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:initial-sync:acc_1",
            status: "queued",
          },
        });
      }

      if (href.endsWith("/api/sync-center/accounts")) {
        return jsonResponse(200, {
          items: [
            {
              accountId: "acc_1",
              email: "support@example.com",
              provider: "custom_domain",
              authMethod: "password",
              syncState: "syncing",
              engineProvider: "emailengine",
              reauthRequired: false,
              nextAction: "wait_for_sync",
              accountUpdatedAt: "2026-06-14T00:00:00.000Z",
              latestSyncJob: {
                id: "job_followup",
                jobType: "sync_account",
                status: "running",
                attempts: 0,
                maxAttempts: 5,
                notBefore: "2026-06-14T00:00:00.000Z",
                updatedAt: "2026-06-14T00:00:00.000Z",
              },
            },
          ],
        });
      }

      throw new Error(`unexpected request ${href}`);
    };

    const payload = buildImapSmtpOnboardingSmokePayload({
      email: "support@example.com",
      provider: "custom_domain",
      displayName: "Smoke Mailbox",
      imap: {
        host: "greenmail-test",
        port: 3143,
        secure: false,
        username: "support@example.com",
        secret: "smoke-secret",
      },
      smtp: {
        host: "greenmail-test",
        port: 3025,
        secure: false,
        username: "support@example.com",
        secret: "smoke-secret",
      },
    });

    const result = await runImapSmtpOnboardingSmoke({
      apiBaseUrl: "http://127.0.0.1:8080/",
      payload,
      fetchImpl: fetchImpl as typeof fetch,
      connectionTestAttempts: 1,
    });

    expect(result).toMatchObject({
      email: "support@example.com",
      provider: "custom_domain",
      accountId: "acc_1",
      syncJobId: "job_1",
      syncJobStatus: "queued",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8080/api/accounts/imap-smtp/test",
      "http://127.0.0.1:8080/api/accounts/imap-smtp",
      "http://127.0.0.1:8080/api/sync-center/accounts",
    ]);
    expect(requests[0].body).toEqual(payload);
    expect(requests[1].body).toEqual(payload);
  });

  it("rejects bad GreenMail credentials before auth-on onboarding", async () => {
    const requests: Array<{ url: string; body?: any }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url: href, body });

      if (href.endsWith("/api/accounts/imap-smtp/test")) {
        return body?.imap?.secret === "emailhub-auth-secret-wrong"
          ? jsonResponse(200, {
              provider: "custom_domain",
              ok: false,
              checks: {
                imap: { ok: false, code: "authentication_failed" },
                smtp: { ok: false, code: "authentication_failed" },
              },
            })
          : jsonResponse(200, {
              provider: "custom_domain",
              ok: true,
              checks: { imap: { ok: true }, smtp: { ok: true } },
            });
      }

      if (href.endsWith("/api/accounts/imap-smtp")) {
        return jsonResponse(202, {
          task: {
            id: "task_1",
            email: "emailhub-auth-smoke@example.com",
            provider: "custom_domain",
            authMethod: "password",
            status: "completed",
          },
          account: {
            id: "acc_auth_1",
            email: "emailhub-auth-smoke@example.com",
            provider: "custom_domain",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          syncJob: {
            id: "job_auth_1",
            jobType: "sync_account",
            accountId: "acc_auth_1",
            idempotencyKey: "job:initial-sync:acc_auth_1",
            status: "queued",
          },
        });
      }

      if (href.endsWith("/api/sync-center/accounts")) {
        return jsonResponse(200, {
          items: [
            {
              accountId: "acc_auth_1",
              email: "emailhub-auth-smoke@example.com",
              provider: "custom_domain",
              authMethod: "password",
              syncState: "syncing",
              engineProvider: "emailengine",
              reauthRequired: false,
              nextAction: "wait_for_sync",
              accountUpdatedAt: "2026-06-14T00:00:00.000Z",
              latestSyncJob: {
                id: "job_auth_followup",
                jobType: "sync_account",
                status: "running",
                attempts: 0,
                maxAttempts: 5,
                notBefore: "2026-06-14T00:00:00.000Z",
                updatedAt: "2026-06-14T00:00:00.000Z",
              },
            },
          ],
        });
      }

      throw new Error(`unexpected request ${href}`);
    };

    const result = await runImapSmtpOnboardingAuthSmoke({
      apiBaseUrl: "http://127.0.0.1:8080",
      payload: authSmokePayload("emailhub-auth-secret"),
      rejectedPayload: authSmokePayload("emailhub-auth-secret-wrong"),
      fetchImpl: fetchImpl as typeof fetch,
      connectionTestAttempts: 1,
    });

    expect(result).toMatchObject({
      email: "emailhub-auth-smoke@example.com",
      provider: "custom_domain",
      accountId: "acc_auth_1",
      syncJobId: "job_auth_1",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8080/api/accounts/imap-smtp/test",
      "http://127.0.0.1:8080/api/accounts/imap-smtp/test",
      "http://127.0.0.1:8080/api/accounts/imap-smtp",
      "http://127.0.0.1:8080/api/sync-center/accounts",
    ]);
    expect(requests[0].body.imap.secret).toBe("emailhub-auth-secret-wrong");
    expect(requests[1].body.imap.secret).toBe("emailhub-auth-secret");
    expect(requests[2].body).toEqual(authSmokePayload("emailhub-auth-secret"));
  });

  it("fails auth-on smoke when invalid credentials are accepted", async () => {
    const fetchImpl = async () =>
      jsonResponse(200, {
        ok: true,
        detail:
          "accepted emailhub-auth-smoke@example.com with emailhub-auth-secret-wrong",
      });

    await expectSanitizedSmokeFailure(
      runImapSmtpOnboardingAuthSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: authSmokePayload("emailhub-auth-secret"),
        rejectedPayload: authSmokePayload("emailhub-auth-secret-wrong"),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
      "accepted invalid credentials",
    );
  });

  it("builds authenticated GreenMail full-email login payloads", () => {
    expect(
      buildImapSmtpOnboardingSmokePayload({
        email: "emailhub-auth-smoke@example.com",
        provider: "custom_domain",
        displayName: "Authenticated Smoke Mailbox",
        imap: {
          host: "greenmail-auth-test",
          port: 3143,
          secure: false,
          username: "emailhub-auth-smoke@example.com",
          secret: "emailhub-auth-secret",
        },
        smtp: {
          host: "greenmail-auth-test",
          port: 3025,
          secure: false,
          username: "emailhub-auth-smoke@example.com",
          secret: "emailhub-auth-secret",
        },
      }),
    ).toEqual({
      email: "emailhub-auth-smoke@example.com",
      provider: "custom_domain",
      displayName: "Authenticated Smoke Mailbox",
      imap: {
        host: "greenmail-auth-test",
        port: 3143,
        secure: false,
        username: "emailhub-auth-smoke@example.com",
        secret: "emailhub-auth-secret",
      },
      smtp: {
        host: "greenmail-auth-test",
        port: 3025,
        secure: false,
        username: "emailhub-auth-smoke@example.com",
        secret: "emailhub-auth-secret",
      },
    });
  });

  it("stops before onboarding when the connection test reports a failure", async () => {
    const requests: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      requests.push(String(url));
      return jsonResponse(200, {
        provider: "custom_domain",
        ok: false,
        checks: {
          imap: { ok: false, code: "ECONNREFUSED" },
          smtp: { ok: true },
        },
        diagnostics: [{ code: "mail_server_unreachable" }],
      });
    };

    await expectSanitizedSmokeFailure(
      runImapSmtpOnboardingSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
      "IMAP/SMTP smoke connection test failed",
    );

    expect(requests).toEqual([
      "http://127.0.0.1:8080/api/accounts/imap-smtp/test",
    ]);
  });

  it("redacts failed connection test response details", async () => {
    const fetchImpl = async () => jsonResponse(200, dangerousFailureBody());

    await expectSanitizedSmokeFailure(
      runImapSmtpOnboardingSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
      "IMAP/SMTP smoke connection test failed",
    );
  });

  it("redacts failed onboarding response details", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/test")) {
        return jsonResponse(200, { ok: true });
      }

      return jsonResponse(500, dangerousFailureBody());
    };

    await expectSanitizedSmokeFailure(
      runImapSmtpOnboardingSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
      "IMAP/SMTP smoke onboarding returned 500",
    );
  });

  it("redacts failed sync center response details", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/test")) {
        return jsonResponse(200, { ok: true });
      }
      if (href.endsWith("/api/accounts/imap-smtp")) {
        return jsonResponse(202, {
          task: { status: "completed" },
          account: {
            id: "acc_1",
            email: "support@example.com",
            provider: "custom_domain",
            engineProvider: "emailengine",
          },
          syncJob: {
            id: "job_1",
            jobType: "sync_account",
            accountId: "acc_1",
            status: "queued",
          },
        });
      }

      return jsonResponse(503, dangerousFailureBody());
    };

    await expectSanitizedSmokeFailure(
      runImapSmtpOnboardingSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
      "IMAP/SMTP smoke sync center returned 503",
    );
  });

  it("requires onboarding to return the initial sync job", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/test")) {
        return jsonResponse(200, { ok: true });
      }

      return jsonResponse(202, {
        task: { status: "completed" },
        account: {
          id: "acc_1",
          email: "support@example.com",
          provider: "custom_domain",
          engineProvider: "emailengine",
        },
      });
    };

    await expect(
      runImapSmtpOnboardingSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
    ).rejects.toThrow("did not return an initial sync job");
  });
});

function smokePayload() {
  return buildImapSmtpOnboardingSmokePayload({
    email: "support@example.com",
    provider: "custom_domain",
    imap: {
      host: "greenmail-test",
      port: 3143,
      secure: false,
      username: "support@example.com",
      secret: "smoke-secret",
    },
    smtp: {
      host: "greenmail-test",
      port: 3025,
      secure: false,
      username: "support@example.com",
      secret: "smoke-secret",
    },
  });
}

function authSmokePayload(secret: string) {
  return buildImapSmtpOnboardingSmokePayload({
    email: "emailhub-auth-smoke@example.com",
    provider: "custom_domain",
    displayName: "Authenticated Smoke Mailbox",
    imap: {
      host: "greenmail-auth-test",
      port: 3143,
      secure: false,
      username: "emailhub-auth-smoke@example.com",
      secret,
    },
    smtp: {
      host: "greenmail-auth-test",
      port: 3025,
      secure: false,
      username: "emailhub-auth-smoke@example.com",
      secret,
    },
  });
}

async function expectSanitizedSmokeFailure(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("expected smoke failure");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain(expectedMessage);
    expect(message).not.toContain("smoke-secret");
    expect(message).not.toContain("emailhub-auth-secret");
    expect(message).not.toContain("emailhub-auth-secret-wrong");
    expect(message).not.toContain("support@example.com");
    expect(message).not.toContain("emailhub-auth-smoke@example.com");
    expect(message).not.toContain("Bearer raw-token");
    expect(message).not.toContain("user:secret");
    expect(message).not.toContain("10.0.0.20");
    expect(message).not.toContain("github_pat_abc");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("token=abc");
  }
}

function dangerousFailureBody() {
  return {
    ok: false,
    email: "support@example.com",
    secret: "smoke-secret",
    authorization: "Bearer raw-token",
    detail:
      "connect http://user:secret@10.0.0.20:8080/path?token=abc with github_pat_abc password=hunter2",
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
