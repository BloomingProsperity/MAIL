import { describe, expect, it } from "vitest";

import {
  buildImapSmtpOnboardingSmokePayload,
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

    await expect(
      runImapSmtpOnboardingSmoke({
        apiBaseUrl: "http://127.0.0.1:8080",
        payload: smokePayload(),
        fetchImpl: fetchImpl as typeof fetch,
        connectionTestAttempts: 1,
      }),
    ).rejects.toThrow("IMAP/SMTP smoke connection test failed");

    expect(requests).toEqual([
      "http://127.0.0.1:8080/api/accounts/imap-smtp/test",
    ]);
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
