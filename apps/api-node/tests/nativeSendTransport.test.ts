import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredNativeSendTransport,
  createNativeSendTransport,
  createPostgresNativeAccountSettingsStore,
} from "../src/native-send/native-send-transport";
import { NativeProviderSubmitError } from "../src/native-send/provider-submit-clients";
import { createPostgresNativeSendReauthorizationMarker } from "../src/native-send/reauthorization-marker";

describe("API native send transport", () => {
  it("routes Gmail native sends through Gmail messages.send with RFC 2822 MIME", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const sendMail = vi.fn(async () => ({}));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail },
      createBoundary: () => "boundary_1",
    });

    const result = await transport.submitMessage({
      accountId: "acc_gmail",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [{ address: "team@example.com" }],
      bcc: [],
      subject: "Launch plan",
      bodyText: "Plain body",
      bodyHtml: "<p>HTML body</p>",
    });

    const raw = sendMessage.mock.calls[0][0].raw;
    const decoded = decodeBase64Url(raw);
    expect(result).toEqual({ messageId: "gmail_msg_1" });
    expect(decoded).toContain('To: "Lina" <lina@example.com>');
    expect(decoded).toContain("Cc: team@example.com");
    expect(decoded).toContain("Subject: Launch plan");
    expect(decoded).toContain('Content-Type: multipart/alternative; boundary="boundary_1"');
    expect(decoded).toContain("Plain body");
    expect(decoded).toContain("<p>HTML body</p>");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("routes Graph native sends through Microsoft Graph sendMail", async () => {
    const sendMessage = vi.fn(async () => ({ id: "gmail_msg_1" }));
    const sendMail = vi.fn(async () => ({}));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "graph";
        },
      },
      gmail: { sendMessage },
      graph: { sendMail },
    });

    await transport.submitMessage({
      accountId: "acc_graph",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [{ address: "audit@example.com" }],
      subject: "Launch plan",
      bodyText: "Plain body",
    });

    expect(sendMail).toHaveBeenCalledWith({
      accountId: "acc_graph",
      message: {
        subject: "Launch plan",
        body: {
          contentType: "Text",
          content: "Plain body",
        },
        toRecipients: [
          { emailAddress: { address: "lina@example.com", name: "Lina" } },
        ],
        ccRecipients: [],
        bccRecipients: [
          { emailAddress: { address: "audit@example.com" } },
        ],
      },
      saveToSentItems: true,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("fails explicit unsupported native providers instead of falling back", async () => {
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "imap";
        },
      },
      gmail: { sendMessage: vi.fn(async () => ({})) },
      graph: { sendMail: vi.fn(async () => ({})) },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_imap",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("native send is unsupported for imap");
  });

  it("marks native accounts for reauthorization on provider permission failures", async () => {
    const markRequired = vi.fn(async () => ({ taskId: "task_reauth_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "graph";
        },
      },
      gmail: { sendMessage: vi.fn(async () => ({})) },
      graph: {
        sendMail: vi.fn(async () => {
          throw new NativeProviderSubmitError(
            "Microsoft Graph",
            403,
            "ErrorAccessDenied",
          );
        }),
      },
      reauthorizationMarker: { markRequired },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_graph",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("Microsoft Graph send failed: 403 ErrorAccessDenied");
    expect(markRequired).toHaveBeenCalledWith({
      accountId: "acc_graph",
      provider: "outlook",
      reason: "Microsoft Graph 403 ErrorAccessDenied",
    });
  });

  it("does not mark accounts for reauthorization on transient provider failures", async () => {
    const markRequired = vi.fn(async () => ({ taskId: "task_reauth_1" }));
    const transport = createNativeSendTransport({
      settingsStore: {
        async getNativeProvider() {
          return "gmail";
        },
      },
      gmail: {
        sendMessage: vi.fn(async () => {
          throw new NativeProviderSubmitError("Gmail", 500, "backendError");
        }),
      },
      graph: { sendMail: vi.fn(async () => ({})) },
      reauthorizationMarker: { markRequired },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("Gmail send failed: 500 backendError");
    expect(markRequired).not.toHaveBeenCalled();
  });

  it("loads native provider settings from Postgres", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresNativeAccountSettingsStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [{ native_provider: "gmail" }] };
      },
    });

    await expect(store.getNativeProvider("acc_1")).resolves.toBe("gmail");
    expect(queries[0].text).toMatch(/FROM account_provider_settings/i);
    expect(queries[0].values).toEqual(["acc_1"]);
  });

  it("marks OAuth native send accounts as reauthorization required in Postgres", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const marker = createPostgresNativeSendReauthorizationMarker({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          return { rows: [{ task_id: "task_reauth_1" }] };
        },
      },
      createId: () => "task_reauth_1",
    });

    await expect(
      marker.markRequired({
        accountId: "acc_gmail",
        provider: "gmail",
        reason: "Gmail 403 PERMISSION_DENIED",
      }),
    ).resolves.toEqual({ taskId: "task_reauth_1" });
    expect(queries[0].text).toMatch(/UPDATE connected_accounts/i);
    expect(queries[0].text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries[0].text).toMatch(/INSERT INTO onboarding_tasks/i);
    expect(queries[0].text).toMatch(/'source', 'native_send'/i);
    expect(queries[0].values).toEqual([
      "acc_gmail",
      "task_reauth_1",
      "Gmail 403 PERMISSION_DENIED",
    ]);
  });

  it("refreshes a Gmail access token from stored credentials before provider submit", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://oauth.example/token") {
        expect(String(init?.body)).toContain("refresh_token=refresh-token-1");
        return jsonResponse({
          access_token: "access-token-1",
          expires_in: 3600,
        });
      }

      expect(url).toBe("https://gmail.example/users/me/messages/send");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer access-token-1",
        "content-type": "application/json",
      });
      return jsonResponse({ id: "gmail_msg_1" });
    });
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("account_provider_settings")) {
            return { rows: [{ native_provider: "gmail" }] };
          }
          if (text.includes("account_credentials")) {
            return { rows: [{ secret_ref: "db:refresh_1" }] };
          }
          if (text.includes("stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-1" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example",
      },
      fetchImpl: fetchMock as any,
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).resolves.toEqual({ messageId: "gmail_msg_1" });
    expect(queries.map((query) => query.values)).toEqual([
      ["acc_gmail"],
      ["acc_gmail", "google_oauth_refresh_token"],
      ["db:refresh_1"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates a reauthorization task when OAuth refresh is rejected during native send", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://oauth.example/token");
      return jsonResponse({ error: "invalid_grant" }, 400);
    });
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("account_provider_settings")) {
            return { rows: [{ native_provider: "gmail" }] };
          }
          if (text.includes("account_credentials")) {
            return { rows: [{ secret_ref: "db:refresh_1" }] };
          }
          if (text.includes("stored_secrets")) {
            return { rows: [{ secret_value: "refresh-token-1" }] };
          }
          if (text.includes("UPDATE connected_accounts")) {
            return { rows: [{ task_id: "task_reauth_1" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example",
      },
      fetchImpl: fetchMock as any,
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow("native access token unavailable");
    expect(queries.at(-1)?.text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries.at(-1)?.values).toEqual([
      "acc_gmail",
      "task_reauth_1",
      "native access token unavailable for account acc_gmail: OAuth refresh failed: 400 invalid_grant",
    ]);
  });

  it("creates a reauthorization task when native send is missing a refresh credential", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const transport = createConfiguredNativeSendTransport({
      client: {
        async query(text, values) {
          queries.push({ text, values });
          if (text.includes("account_provider_settings")) {
            return { rows: [{ native_provider: "gmail" }] };
          }
          if (text.includes("account_credentials")) {
            return { rows: [] };
          }
          if (text.includes("UPDATE connected_accounts")) {
            return { rows: [{ task_id: "task_reauth_1" }] };
          }
          throw new Error(`unexpected query: ${text}`);
        },
      },
      createId: () => "task_reauth_1",
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example",
      },
      fetchImpl: async () => {
        throw new Error("should not call Gmail without a refresh credential");
      },
    });

    await expect(
      transport.submitMessage({
        accountId: "acc_gmail",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch plan",
        bodyText: "Plain body",
      }),
    ).rejects.toThrow(
      "missing google_oauth_refresh_token credential for account acc_gmail",
    );
    expect(queries.at(-1)?.text).toMatch(/sync_state = 'reauth_required'/i);
    expect(queries.at(-1)?.values).toEqual([
      "acc_gmail",
      "task_reauth_1",
      "missing google_oauth_refresh_token credential for account acc_gmail",
    ]);
  });
});

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
