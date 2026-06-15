import { describe, expect, it } from "vitest";

import {
  createConfiguredNativeAdapters,
  createConfiguredNativeCommandProcessor,
  createConfiguredNativeSendTransports,
} from "../src/mail-provider/native-adapters";

describe("configured native adapters", () => {
  it("registers Gmail lazily and reports missing OAuth config when used", async () => {
    const adapters = createConfiguredNativeAdapters({
      credentialClient: {
        async query() {
          throw new Error("should not query credentials without OAuth config");
        },
      },
      env: {},
      fetchImpl: async () => {
        throw new Error("should not call Google without OAuth config");
      },
    });

    expect(adapters.gmail).toBeDefined();
    await expect(
      adapters.gmail?.sync({ accountId: "acc_1", limit: 1 }),
    ).rejects.toThrow(
      "GOOGLE_OAUTH_CLIENT_ID missing; cannot refresh Gmail access tokens",
    );
  });

  it("wires Gmail through account credential secret refs and OAuth refresh", async () => {
    const calls: Array<{ url?: string; init?: RequestInit; query?: string }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ query: text });
        if (text.includes("stored_secrets")) {
          expect(values).toEqual(["db:secret_1"]);
          return {
            rows: [{ secret_value: "refresh-token-secret" }],
          };
        }

        return {
          rows: [
            {
              account_id: "11111111-1111-1111-1111-111111111111",
              credential_kind: "google_oauth_refresh_token",
              secret_ref: "db:secret_1",
              expires_at: null,
            },
          ],
        };
      },
    };
    const adapters = createConfiguredNativeAdapters({
      credentialClient: client,
      secretClient: client,
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example/gmail/v1",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://oauth.example/token") {
          return Response.json({
            access_token: "access-token",
            expires_in: 3600,
          });
        }

        return Response.json({ messages: [] });
      },
    });

    const result = await adapters.gmail?.sync({
      accountId: "11111111-1111-1111-1111-111111111111",
      limit: 10,
    });

    expect(result).toEqual({
      changes: [],
      cursor: undefined,
      hasMore: false,
    });
    expect(calls.some((call) => call.query?.includes("account_credentials"))).toBe(
      true,
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "https://oauth.example/token",
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "https://gmail.example/gmail/v1/users/me/messages?maxResults=10",
        init: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer access-token",
          }),
        }),
      }),
    );
  });

  it("wires Microsoft Graph through account credential secret refs and OAuth refresh", async () => {
    const calls: Array<{ url?: string; init?: RequestInit; query?: string }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ query: text });
        if (text.includes("stored_secrets")) {
          expect(values).toEqual(["db:outlook_secret"]);
          return {
            rows: [{ secret_value: "outlook-refresh-token" }],
          };
        }

        return {
          rows: [
            {
              account_id: "22222222-2222-2222-2222-222222222222",
              credential_kind: "microsoft_oauth_refresh_token",
              secret_ref: "db:outlook_secret",
              expires_at: null,
            },
          ],
        };
      },
    };
    const adapters = createConfiguredNativeAdapters({
      credentialClient: client,
      secretClient: client,
      env: {
        MICROSOFT_OAUTH_CLIENT_ID: "client-id",
        MICROSOFT_OAUTH_TOKEN_URL: "https://login.example/token",
        MICROSOFT_GRAPH_BASE_URL: "https://graph.example/v1.0",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://login.example/token") {
          return Response.json({
            access_token: "graph-access-token",
            expires_in: 3600,
          });
        }

        return Response.json({ value: [], "@odata.deltaLink": "https://graph.example/delta" });
      },
    });

    const result = await adapters.graph?.sync({
      accountId: "22222222-2222-2222-2222-222222222222",
      limit: 10,
    });

    expect(result).toEqual({
      changes: [],
      cursor: {
        provider: "graph",
        scope: "mailbox",
        mailbox: { provider: "graph", folderId: "inbox" },
        deltaLink: "https://graph.example/delta",
      },
      hasMore: false,
    });
    expect(calls.some((call) => call.query?.includes("account_credentials"))).toBe(
      true,
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "https://login.example/token",
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "https://graph.example/v1.0/me/mailFolders/inbox/messages/delta?%24select=id%2CchangeKey%2CconversationId%2Csubject%2CreceivedDateTime%2Csender%2Cfrom%2CtoRecipients%2CccRecipients%2CbodyPreview%2CisRead%2ChasAttachments",
        init: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer graph-access-token",
          }),
        }),
      }),
    );
  });

  it("wires Gmail native commands through OAuth refresh and Gmail modify", async () => {
    const calls: Array<{ url?: string; init?: RequestInit; query?: string }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ query: text });
        if (text.includes("stored_secrets")) {
          expect(values).toEqual(["db:gmail_secret"]);
          return { rows: [{ secret_value: "gmail-refresh-token" }] };
        }

        return {
          rows: [
            {
              account_id: "33333333-3333-3333-3333-333333333333",
              credential_kind: "google_oauth_refresh_token",
              secret_ref: "db:gmail_secret",
              expires_at: null,
            },
          ],
        };
      },
    };
    const processor = createConfiguredNativeCommandProcessor({
      credentialClient: client,
      secretClient: client,
      targetResolver: {
        resolveMessageTarget: async () => ({ providerMessageId: "gm_msg_1" }),
      },
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_TOKEN_URL: "https://oauth.example/token",
        GMAIL_API_BASE_URL: "https://gmail.example/gmail/v1",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://oauth.example/token") {
          return Response.json({
            access_token: "gmail-access-token",
            expires_in: 3600,
          });
        }

        return Response.json({ id: "gm_msg_1", labelIds: [] });
      },
    });

    await processor.executeCommand({
      provider: "gmail",
      command: {
        id: "cmd_1",
        commandType: "mark_read",
        accountId: "33333333-3333-3333-3333-333333333333",
        target: { messageId: "msg_local" },
        payload: { action: "mark_read" },
        status: "running",
        attempts: 1,
        maxAttempts: 8,
        idempotencyKey: "mail-action:acc:msg:mark_read",
        notBefore: "2026-06-12T09:00:00.000Z",
        createdAt: "2026-06-12T09:00:00.000Z",
        updatedAt: "2026-06-12T09:00:00.000Z",
      },
    });

    expect(calls).toContainEqual(
      expect.objectContaining({ url: "https://oauth.example/token" }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "https://gmail.example/gmail/v1/users/me/messages/gm_msg_1/modify",
        init: expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer gmail-access-token",
          }),
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        }),
      }),
    );
  });

  it("wires IMAP native commands through account settings and secret refs", async () => {
    const calls: Array<{ query?: string; values?: unknown[]; event?: string }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ query: text, values });
        if (text.includes("stored_secrets")) {
          expect(values).toEqual(["db:imap_secret"]);
          return { rows: [{ secret_value: "imap-app-password" }] };
        }

        return {
          rows: [
            {
              settings: {
                imap: {
                  host: "imap.qq.com",
                  port: 993,
                  secure: true,
                  username: "support@qq.com",
                },
              },
              secret_ref: "db:imap_secret",
            },
          ],
        };
      },
    };
    const processor = createConfiguredNativeCommandProcessor({
      credentialClient: client,
      secretClient: client,
      targetResolver: {
        resolveMessageTarget: async () => ({
          providerMessageId: "42",
          providerMailboxId: "INBOX",
        }),
      },
      imapConnect: async (options: unknown) => {
        expect(options).toMatchObject({
          host: "imap.qq.com",
          port: 993,
          secure: true,
          auth: {
            user: "support@qq.com",
            pass: "imap-app-password",
          },
        });
        return {
          async connect() {
            calls.push({ event: "connect" });
          },
          async getMailboxLock(path: string) {
            calls.push({ event: `lock:${path}` });
            return {
              release() {
                calls.push({ event: "release" });
              },
            };
          },
          async messageFlagsAdd() {
            throw new Error("should not add flags for mark_read");
          },
          async messageFlagsRemove(range: string, flags: string[]) {
            calls.push({ event: `remove:${range}:${flags.join(",")}` });
          },
          async messageMove() {
            throw new Error("should not move for mark_read");
          },
          async logout() {
            calls.push({ event: "logout" });
          },
        };
      },
    });

    await processor.executeCommand({
      provider: "imap",
      command: {
        id: "cmd_imap_1",
        commandType: "mark_read",
        accountId: "44444444-4444-4444-4444-444444444444",
        target: { messageId: "msg_local" },
        payload: { action: "mark_read" },
        status: "running",
        attempts: 1,
        maxAttempts: 8,
        idempotencyKey: "mail-action:acc:msg:mark_read",
        notBefore: "2026-06-12T09:00:00.000Z",
        createdAt: "2026-06-12T09:00:00.000Z",
        updatedAt: "2026-06-12T09:00:00.000Z",
      },
    });

    expect(calls.some((call) => call.query?.includes("account_provider_settings"))).toBe(
      true,
    );
    expect(calls.some((call) => call.query?.includes("stored_secrets"))).toBe(true);
    expect(calls.map((call) => call.event).filter(Boolean)).toEqual([
      "connect",
      "lock:INBOX",
      "remove:42:\\Seen",
      "release",
      "logout",
    ]);
    expect(JSON.stringify(calls)).not.toContain("imap-app-password");
  });

  it("marks configured Graph scheduled sends for reauthorization on permission failure", async () => {
    const calls: Array<{ url?: string; init?: RequestInit; query?: string }> = [];
    const marks: unknown[] = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ query: text });
        if (text.includes("stored_secrets")) {
          expect(values).toEqual(["db:outlook_secret"]);
          return {
            rows: [{ secret_value: "outlook-refresh-token" }],
          };
        }

        return {
          rows: [
            {
              account_id: "55555555-5555-5555-5555-555555555555",
              credential_kind: "microsoft_oauth_refresh_token",
              secret_ref: "db:outlook_secret",
              expires_at: null,
            },
          ],
        };
      },
    };
    const transports = createConfiguredNativeSendTransports({
      credentialClient: client,
      secretClient: client,
      reauthorizationMarker: {
        async markRequired(input) {
          marks.push(input);
          return { taskId: "task_reauth_1" };
        },
      },
      env: {
        MICROSOFT_OAUTH_CLIENT_ID: "client-id",
        MICROSOFT_OAUTH_TOKEN_URL: "https://login.example/token",
        MICROSOFT_GRAPH_BASE_URL: "https://graph.example/v1.0",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://login.example/token") {
          return Response.json({
            access_token: "graph-access-token",
            expires_in: 3600,
          });
        }

        return Response.json(
          {
            error: {
              code: "ErrorAccessDenied",
              message: "Mail.Send consent is missing",
            },
          },
          { status: 403 },
        );
      },
    });

    await expect(
      transports.graph?.submitMessage({
        accountId: "55555555-5555-5555-5555-555555555555",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        to: [{ address: "client@example.com" }],
        cc: [],
        bcc: [],
        subject: "Status",
        bodyText: "Ready",
      }),
    ).rejects.toThrow("Microsoft Graph request failed: 403 ErrorAccessDenied");

    expect(calls).toContainEqual(
      expect.objectContaining({ url: "https://login.example/token" }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        url: "https://graph.example/v1.0/me/sendMail",
        init: expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer graph-access-token",
          }),
        }),
      }),
    );
    expect(marks).toEqual([
      {
        accountId: "55555555-5555-5555-5555-555555555555",
        provider: "outlook",
        reason: "Microsoft Graph 403 ErrorAccessDenied",
      },
    ]);
  });
});
