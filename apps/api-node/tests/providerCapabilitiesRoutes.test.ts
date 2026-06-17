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
    }),
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

describe("mail provider capability routes", () => {
  it("returns the provider capability catalog without implementation terms", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mail-providers/capabilities`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: "gmail",
            label: "Gmail",
            connectionLabel: "输入 Google 应用专用密码",
            supportsWebLogin: false,
            supportsAppPassword: true,
            setupHints: ["开启邮箱客户端访问后，使用 Google 应用专用密码"],
          }),
          expect.objectContaining({
            provider: "tencent_exmail",
            label: "腾讯企业邮箱",
            supportsReadReceipts: true,
            supportsSendAsGroup: true,
            supportsCloudAttachment: true,
          }),
        ]),
      );
      expect(JSON.stringify(body)).not.toMatch(/OAuth|Graph|IMAP|SMTP|API/i);
    });
  });

  it("returns web-login provider capabilities when OAuth setup is configured", async () => {
    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/mail-providers/capabilities/gmail`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          provider: "gmail",
          connectionLabel: "登录 Google 账号",
          supportsWebLogin: true,
          supportsServerSearch: true,
          setupHints: ["登录后自动同步邮件"],
        });
      },
      {
        oauthProvidersConfigured: { gmail: true },
      },
    );
  });

  it("resolves aliases when reading one provider capability", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/mail-providers/capabilities/qqmail`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        provider: "qq",
        label: "QQ 邮箱",
        connectionLabel: "输入 QQ 邮箱授权码",
        supportsScanLogin: false,
        supportsMailboxPassword: true,
        supportsRecall: true,
        setupHints: ["在 QQ 邮箱设置里生成授权码"],
      });
    });
  });

  it("returns 404 for unsupported providers", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/mail-providers/capabilities/not-a-provider`,
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "mail_provider_capability_not_found",
      });
    });
  });
});
