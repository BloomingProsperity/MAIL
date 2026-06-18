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

describe("EmailEngine auth-server route", () => {
  it("rejects health probes before resolving credentials", async () => {
    const calls: unknown[] = [];

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/mail-engine/auth-server?account=__emailhub_launch_probe__&proto=health_probe`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(
                "emailengine:auth-secret",
              ).toString("base64")}`,
            },
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_emailengine_auth_server_request",
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
});
