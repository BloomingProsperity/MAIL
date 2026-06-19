import { describe, expect, it, vi } from "vitest";

import { createEmailHubApi } from "./emailHubApi";

describe("emailHubApi session auth", () => {
  it("uses same-origin session credentials without a browser bearer token by default", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/session/login")) {
        return jsonResponse({
          authenticated: true,
          expiresAt: "2026-06-19T12:00:00.000Z",
        });
      }

      if (url.endsWith("/session/setup")) {
        return jsonResponse({
          authenticated: true,
          expiresAt: "2026-06-19T12:00:00.000Z",
        });
      }

      if (url.endsWith("/session/logout")) {
        return jsonResponse({ authenticated: false });
      }

      if (url.endsWith("/session")) {
        return jsonResponse({ authenticated: false });
      }

      return jsonResponse({ items: [] });
    });
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    await api.getSession();
    await api.createAdmin({
      email: "owner@example.com",
      password: "strong-password",
    });
    await api.login({ email: "owner@example.com", password: "strong-password" });
    await api.logout();
    await api.listMailboxes({ accountId: "account_1" });

    for (const [, init] of fetchMock.mock.calls) {
      const requestInit = init as RequestInit;
      expect(requestInit.credentials).toBe("same-origin");
      expect(requestInit.headers).not.toHaveProperty("authorization");
    }
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/session/setup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          password: "strong-password",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/session/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          password: "strong-password",
        }),
      }),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
