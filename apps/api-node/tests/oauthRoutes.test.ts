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

describe("OAuth account routes", () => {
  it("starts Gmail OAuth onboarding through the OAuth service", async () => {
    const calls: unknown[] = [];
    const oauthOnboardingService = {
      async createAuthSession(input: unknown) {
        calls.push(input);
        return {
          provider: "gmail",
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          state: "state_1",
          task: {
            id: "task_1",
            email: "pending@gmail.oauth",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          },
        };
      },
      async completeAuthCallback() {
        throw new Error("should not complete callback during start");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/oauth/gmail/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              redirectUri: "https://app.example.com/oauth/callback",
              loginHint: "me@gmail.com",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          provider: "gmail",
          state: "state_1",
          task: { id: "task_1", authMethod: "oauth" },
        });
        expect(calls).toEqual([
          {
            provider: "gmail",
            redirectUri: "https://app.example.com/oauth/callback",
            loginHint: "me@gmail.com",
          },
        ]);
      },
      { oauthOnboardingService },
    );
  });

  it("completes OAuth callback through the OAuth service", async () => {
    const calls: unknown[] = [];
    const oauthOnboardingService = {
      async createAuthSession() {
        throw new Error("should not create session during callback");
      },
      async completeAuthCallback(input: unknown) {
        calls.push(input);
        return {
          task: {
            id: "task_1",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "completed",
          },
          account: {
            id: "acc_1",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/oauth/gmail/callback?state=state_1&code=code_1`,
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          task: { status: "completed" },
          account: { id: "acc_1", engineProvider: "emailengine" },
        });
        expect(calls).toEqual([{ state: "state_1", code: "code_1" }]);
      },
      { oauthOnboardingService },
    );
  });

  it("rejects unsupported OAuth providers before calling services", async () => {
    const oauthOnboardingService = {
      async createAuthSession() {
        throw new Error("should not be called");
      },
      async completeAuthCallback() {
        throw new Error("should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/oauth/yahoo/start`,
          {
            method: "POST",
            body: JSON.stringify({
              redirectUri: "https://app.example.com/oauth/callback",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "unsupported_oauth_provider",
        });
      },
      { oauthOnboardingService },
    );
  });
});
