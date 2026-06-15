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

describe("mail navigation routes", () => {
  it("returns provider groups and quick categories for the left navigation", async () => {
    const calls: string[] = [];
    const mailNavigationService = {
      async getSummary() {
        calls.push("getSummary");
        return {
          providerGroups: [
            { id: "gmail", label: "Gmail", count: 2 },
            { id: "outlook", label: "Outlook", count: 1 },
          ],
          quickCategories: [
            { id: "codes", label: "验证码", count: 18, tone: "blue" },
            { id: "receipts", label: "发票/账单", count: 24, tone: "green" },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/mail-navigation/summary`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          providerGroups: [
            { id: "gmail", label: "Gmail", count: 2 },
            { id: "outlook", label: "Outlook", count: 1 },
          ],
          quickCategories: [
            { id: "codes", label: "验证码", count: 18, tone: "blue" },
            { id: "receipts", label: "发票/账单", count: 24, tone: "green" },
          ],
        });
        expect(calls).toEqual(["getSummary"]);
      },
      { mailNavigationService },
    );
  });

  it("returns 503 when the navigation summary is not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mail-navigation/summary`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "mail_navigation_unavailable",
      });
    });
  });
});
