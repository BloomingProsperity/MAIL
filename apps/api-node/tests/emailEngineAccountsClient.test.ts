import { describe, expect, it } from "vitest";

import { createEmailEngineAccountsClient } from "../src/mail-engine/email-engine-accounts-client";

describe("EmailEngine accounts client", () => {
  it("verifies IMAP/SMTP credentials through POST /v1/verifyAccount", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineAccountsClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          imap: { success: true },
          smtp: { success: true },
        });
      },
    });

    const result = await client.verifyImapSmtpAccount({
      email: "support@qq.com",
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
    });

    expect(calls[0].url).toBe("http://emailengine:3000/v1/verifyAccount");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      imap: {
        host: "imap.qq.com",
        port: 993,
        secure: true,
        auth: {
          user: "support@qq.com",
          pass: "imap-auth-code",
        },
      },
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        auth: {
          user: "support@qq.com",
          pass: "smtp-auth-code",
        },
      },
    });
    expect(result).toEqual({
      imap: { success: true },
      smtp: { success: true },
    });
  });

  it("throws a sanitized verification error when credential verification fails", async () => {
    const client = createEmailEngineAccountsClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async () =>
        Response.json(
          { code: "AuthenticationFailed", error: "bad password" },
          { status: 400 },
        ),
    });

    const promise = client.verifyImapSmtpAccount({
      email: "support@qq.com",
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
    });

    await expect(promise).rejects.toThrow(
      "EmailEngine account verification failed: 400 AuthenticationFailed bad password",
    );
    await expect(promise).rejects.not.toThrow("imap-auth-code");
    await expect(promise).rejects.not.toThrow("smtp-auth-code");
  });

  it("registers an IMAP/SMTP account through POST /v1/account", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineAccountsClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          account: "acc_1",
          state: "syncing",
        });
      },
    });

    const result = await client.registerImapSmtpAccount({
      accountId: "acc_1",
      email: "support@qq.com",
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
    });

    expect(calls[0].url).toBe("http://emailengine:3000/v1/account");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      account: "acc_1",
      name: "Support",
      email: "support@qq.com",
      imap: {
        host: "imap.qq.com",
        port: 993,
        secure: true,
        auth: {
          user: "support@qq.com",
          pass: "imap-auth-code",
        },
      },
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        auth: {
          user: "support@qq.com",
          pass: "smtp-auth-code",
        },
      },
    });
    expect(result).toEqual({ account: "acc_1", state: "syncing" });
  });

  it("registers an OAuth account through EmailEngine auth server mode", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineAccountsClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          account: "acc_1",
          state: "syncing",
        });
      },
    });

    const result = await client.registerOAuthAccount({
      accountId: "acc_1",
      email: "me@gmail.com",
      displayName: "Me",
      provider: "gmail",
    });

    expect(calls[0].url).toBe("http://emailengine:3000/v1/account");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      account: "acc_1",
      name: "Me",
      email: "me@gmail.com",
      oauth2: {
        provider: "gmail",
        auth: {
          user: "me@gmail.com",
        },
        useAuthServer: true,
      },
    });
    expect(result).toEqual({ account: "acc_1", state: "syncing" });
  });

  it("throws a useful error when account registration fails", async () => {
    const client = createEmailEngineAccountsClient({
      baseUrl: "http://emailengine:3000/v1/",
      accessToken: "secret-token",
      fetchImpl: async () =>
        Response.json(
          { code: "ConnectionError", error: "invalid credentials" },
          { status: 400 },
        ),
    });

    await expect(
      client.registerImapSmtpAccount({
        accountId: "acc_1",
        email: "support@qq.com",
        imap: {
          host: "imap.qq.com",
          port: 993,
          secure: true,
          username: "support@qq.com",
          secret: "bad-secret",
        },
        smtp: {
          host: "smtp.qq.com",
          port: 465,
          secure: true,
          username: "support@qq.com",
          secret: "bad-secret",
        },
      }),
    ).rejects.toThrow(
      "EmailEngine account registration failed: 400 ConnectionError invalid credentials",
    );
  });
});
