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

describe("label routes", () => {
  it("lists and upserts account labels", async () => {
    const calls: unknown[] = [];
    const labelService = {
      async listLabels(input: unknown) {
        calls.push(["list", input]);
        return {
          items: [
            {
              id: "label_codes",
              accountId: "account_1",
              name: "验证码",
              color: "blue",
              messageCount: 4,
              createdAt: "2026-06-13T10:00:00.000Z",
            },
          ],
        };
      },
      async upsertLabel(input: unknown) {
        calls.push(["upsert", input]);
        return {
          id: "label_codes",
          accountId: "account_1",
          name: "验证码",
          color: "blue",
          messageCount: 0,
          createdAt: "2026-06-13T10:00:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const listResponse = await fetch(
          `${baseUrl}/api/accounts/account_1/labels`,
        );
        expect(listResponse.status).toBe(200);
        expect(await listResponse.json()).toMatchObject({
          items: [{ id: "label_codes", name: "验证码" }],
        });

        const createResponse = await fetch(
          `${baseUrl}/api/accounts/account_1/labels`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "验证码", color: "blue" }),
          },
        );
        expect(createResponse.status).toBe(201);
        expect(await createResponse.json()).toMatchObject({
          id: "label_codes",
          name: "验证码",
        });
      },
      { labelService },
    );

    expect(calls).toEqual([
      ["list", { accountId: "account_1" }],
      ["upsert", { accountId: "account_1", name: "验证码", color: "blue" }],
    ]);
  });

  it("rejects invalid label requests and reports unavailable service", async () => {
    await withApi(async (baseUrl) => {
      const unavailable = await fetch(`${baseUrl}/api/accounts/account_1/labels`);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ error: "labels_unavailable" });
    });

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts/account_1/labels`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "", color: "orange" }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_label_request" });
      },
      {
        labelService: {
          async listLabels() {
            return { items: [] };
          },
          async upsertLabel() {
            throw new Error("not used");
          },
        },
      },
    );
  });
});
