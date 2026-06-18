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

describe("mail-engine health route", () => {
  it("explains EmailEngine API 5xx can come from stale Docker state", async () => {
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
          warnings: ["EMAILENGINE_API_INTERNAL_ERROR"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "recover_emailengine_api_state",
                label: "修复 EmailEngine API 状态",
                env: [
                  "EENGINE_SECRET",
                  "EENGINE_PREPARED_TOKEN",
                  "EMAILENGINE_ACCESS_TOKEN",
                ],
                effect:
                  "EmailEngine /health 正常但账号 API 返回 5xx，通常是旧 Redis volume 中的加密状态与当前密钥或令牌不匹配；请固定密钥或使用全新 volume 后重启。",
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
              authStatusCode: 500,
              authError: "emailengine_api_internal_error",
            };
          },
        },
      },
    );
  });
});
