import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler, type ApiConfig } from "../src/http/router";
import { createInMemoryWebAuthStore } from "../src/http/web-auth";

let server: Server | undefined;

async function withApi(
  overrides: Partial<ApiConfig>,
  test: (baseUrl: string) => Promise<void>,
): Promise<void> {
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      apiAccessToken: "api-secret",
      apiAccessTokenConfigured: true,
      apiAccessTokenRequired: true,
      webSessionCookieSecure: false,
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

describe("web session auth routes", () => {
  it("creates the first web admin once and then logs in with account and password", async () => {
    const webAuthStore = createInMemoryWebAuthStore();

    await withApi(
      {
        webAuthStore,
        createWebAuthUserId: () => "11111111-1111-4111-8111-111111111111",
      },
      async (baseUrl) => {
        const initialSession = await fetch(`${baseUrl}/api/session`);
        const setup = await fetch(`${baseUrl}/api/session/setup`, {
          method: "POST",
          body: JSON.stringify({
            email: "admin",
            password: "admin",
          }),
        });
        const setupCookie = setup.headers.get("set-cookie") ?? "";
        const sessionCookie = setupCookie.split(";", 1)[0] ?? "";
        const authenticatedApi = await fetch(
          `${baseUrl}/api/mail-providers/capabilities`,
          { headers: { cookie: sessionCookie } },
        );
        const duplicateSetup = await fetch(`${baseUrl}/api/session/setup`, {
          method: "POST",
          body: JSON.stringify({
            email: "next@example.com",
            password: "strong-password",
          }),
        });
        const logout = await fetch(`${baseUrl}/api/session/logout`, {
          method: "POST",
          headers: { cookie: sessionCookie },
        });
        const afterLogout = await fetch(`${baseUrl}/api/session`);
        const failedLogin = await fetch(`${baseUrl}/api/session/login`, {
          method: "POST",
          body: JSON.stringify({
            email: "admin",
            password: "wrong-password",
          }),
        });
        const login = await fetch(`${baseUrl}/api/session/login`, {
          method: "POST",
          body: JSON.stringify({
            email: "admin",
            password: "admin",
          }),
        });

        expect(initialSession.status).toBe(200);
        expect(await initialSession.json()).toEqual({
          authenticated: false,
          setupRequired: true,
        });
        expect(setup.status).toBe(200);
        expect(await setup.json()).toMatchObject({
          authenticated: true,
          user: { email: "admin", role: "owner" },
        });
        expect(setupCookie).toContain("HttpOnly");
        expect(setupCookie).not.toContain("admin");
        expect(authenticatedApi.status).toBe(200);
        expect(duplicateSetup.status).toBe(409);
        expect(await duplicateSetup.json()).toEqual({ error: "setup_closed" });
        expect(logout.status).toBe(200);
        expect(afterLogout.status).toBe(200);
        expect(await afterLogout.json()).toEqual({
          authenticated: false,
          setupRequired: false,
        });
        expect(failedLogin.status).toBe(401);
        expect(await failedLogin.json()).toEqual({ error: "login_failed" });
        expect(login.status).toBe(200);
        expect(await login.json()).toMatchObject({
          authenticated: true,
          user: { email: "admin", role: "owner" },
        });
      },
    );
  }, 15_000);

  it("treats an explicitly open development API as an authenticated web session", async () => {
    await withApi(
      {
        apiAccessToken: undefined,
        apiAccessTokenConfigured: false,
        apiAccessTokenRequired: false,
      },
      async (baseUrl) => {
        const session = await fetch(`${baseUrl}/api/session`);
        const api = await fetch(`${baseUrl}/api/mail-providers/capabilities`);

        expect(session.status).toBe(200);
        expect(await session.json()).toEqual({ authenticated: true });
        expect(api.status).toBe(200);
      },
    );
  });

  it("skips browser login when web auth is disabled for testing", async () => {
    await withApi(
      {
        webAuthDisabled: true,
        operationalEventLogService: {
          async listEvents() {
            return { items: [] };
          },
        } as never,
      },
      async (baseUrl) => {
        const session = await fetch(`${baseUrl}/api/session`);
        const api = await fetch(`${baseUrl}/api/mail-providers/capabilities`);
        const wrongBearerApi = await fetch(
          `${baseUrl}/api/mail-providers/capabilities`,
          { headers: { authorization: "Bearer wrong-secret" } },
        );
        const diagnostics = await fetch(`${baseUrl}/api/diagnostics/events`);
        const logout = await fetch(`${baseUrl}/api/session/logout`, {
          method: "POST",
        });

        expect(session.status).toBe(200);
        expect(await session.json()).toMatchObject({
          authenticated: true,
          authDisabled: true,
          user: { email: "admin", role: "owner" },
        });
        expect(api.status).toBe(200);
        expect(wrongBearerApi.status).toBe(200);
        expect(diagnostics.status).toBe(200);
        expect(await diagnostics.json()).toEqual({ items: [] });
        expect(logout.status).toBe(200);
        expect(await logout.json()).toMatchObject({
          authenticated: true,
          authDisabled: true,
        });
      },
    );
  });

  it("authenticates browser API requests with an HttpOnly session cookie", async () => {
    await withApi({}, async (baseUrl) => {
      const anonymousApi = await fetch(
        `${baseUrl}/api/mail-providers/capabilities`,
      );
      const initialSession = await fetch(`${baseUrl}/api/session`);
      const failedLogin = await fetch(`${baseUrl}/api/session/login`, {
        method: "POST",
        body: JSON.stringify({ password: "wrong-secret" }),
      });
      const login = await fetch(`${baseUrl}/api/session/login`, {
        method: "POST",
        body: JSON.stringify({ password: "api-secret" }),
      });
      const setCookie = login.headers.get("set-cookie") ?? "";
      const sessionCookie = setCookie.split(";", 1)[0] ?? "";
      const sessionApi = await fetch(
        `${baseUrl}/api/mail-providers/capabilities`,
        { headers: { cookie: sessionCookie } },
      );
      const wrongBearerWithSession = await fetch(
        `${baseUrl}/api/mail-providers/capabilities`,
        {
          headers: {
            authorization: "Bearer wrong-secret",
            cookie: sessionCookie,
          },
        },
      );
      const logout = await fetch(`${baseUrl}/api/session/logout`, {
        method: "POST",
        headers: { cookie: sessionCookie },
      });
      const afterLogout = await fetch(
        `${baseUrl}/api/mail-providers/capabilities`,
        { headers: { cookie: sessionCookie } },
      );

      expect(anonymousApi.status).toBe(401);
      expect(await anonymousApi.json()).toEqual({ error: "api_unauthorized" });
      expect(initialSession.status).toBe(200);
      expect(await initialSession.json()).toEqual({ authenticated: false });
      expect(failedLogin.status).toBe(401);
      expect(await failedLogin.json()).toEqual({ error: "login_failed" });
      expect(login.status).toBe(200);
      expect(await login.json()).toMatchObject({ authenticated: true });
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Max-Age=43200");
      expect(setCookie).not.toContain("api-secret");
      expect(sessionApi.status).toBe(200);
      expect(await sessionApi.json()).toHaveProperty("providers");
      expect(wrongBearerWithSession.status).toBe(401);
      expect(await wrongBearerWithSession.json()).toEqual({
        error: "api_unauthorized",
      });
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await logout.json()).toEqual({ authenticated: false });
      expect(afterLogout.status).toBe(401);
    });
  });

  it("preserves account-scoped access checks for browser sessions", async () => {
    await withApi({ apiAccessAccountIds: ["acc_1"] }, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/session/login`, {
        method: "POST",
        body: JSON.stringify({ password: "api-secret" }),
      });
      const sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0];

      const adminRoute = await fetch(`${baseUrl}/api/domains`, {
        headers: { cookie: sessionCookie ?? "" },
      });

      expect(login.status).toBe(200);
      expect(await login.json()).toMatchObject({
        authenticated: true,
        accountIds: ["acc_1"],
      });
      expect(adminRoute.status).toBe(403);
      expect(await adminRoute.json()).toEqual({
        error: "account_scope_required",
      });
    });
  });
});
