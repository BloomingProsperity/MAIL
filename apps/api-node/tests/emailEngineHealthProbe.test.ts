import { describe, expect, it, vi } from "vitest";

import { createEmailEngineHealthProbe } from "../src/mail-engine/email-engine-health-probe";

describe("EmailEngine health probe", () => {
  it("checks the EmailEngine health endpoint without exposing credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(probe.check()).resolves.toEqual({
      http: "ok",
      statusCode: 200,
      auth: "skipped",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://emailengine:3000/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it("strips the REST API path when the configured base URL ends with /v1", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000/v1/",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await probe.check();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://emailengine:3000/health",
      expect.any(Object),
    );
  });

  it("marks non-2xx health responses unavailable", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("bad", { status: 503, statusText: "unready" }),
    );
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(probe.check()).resolves.toEqual({
      http: "unavailable",
      statusCode: 503,
      error: "emailengine_health_not_ok",
      auth: "skipped",
    });
  });

  it("verifies the configured access token against the accounts API", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ total: 0, accounts: [] }), {
          status: 200,
        }),
      );
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000/v1/",
      accessToken: "secret-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await probe.check();

    expect(result).toEqual({
      http: "ok",
      statusCode: 200,
      auth: "ok",
      authStatusCode: 200,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://emailengine:3000/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://emailengine:3000/v1/accounts",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer secret-token" },
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("classifies rejected access tokens without exposing token values", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000",
      accessToken: "bad-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await probe.check();

    expect(result).toEqual({
      http: "ok",
      statusCode: 200,
      auth: "unauthorized",
      authStatusCode: 401,
      authError: "emailengine_token_rejected",
    });
    expect(JSON.stringify(result)).not.toContain("bad-token");
  });

  it("classifies non-auth EmailEngine API failures separately from token rejection", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(probe.check()).resolves.toEqual({
      http: "ok",
      statusCode: 200,
      auth: "unavailable",
      authStatusCode: 429,
      authError: "emailengine_auth_not_ok",
    });
  });

  it("classifies EmailEngine account API 5xx as an internal state error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Internal Server Error" }),
          { status: 500 },
        ),
      );
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(probe.check()).resolves.toEqual({
      http: "ok",
      statusCode: 200,
      auth: "unavailable",
      authStatusCode: 500,
      authError: "emailengine_api_internal_error",
    });
  });

  it("redacts network failure details from the health contract", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.10:3000");
    });
    const probe = createEmailEngineHealthProbe({
      baseUrl: "http://emailengine:3000",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(probe.check()).resolves.toEqual({
      http: "unavailable",
      error: "request_failed",
      auth: "skipped",
    });
  });

  it("aborts slow health checks after the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        async (_url: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const probe = createEmailEngineHealthProbe({
        baseUrl: "http://emailengine:3000",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 50,
      });

      const result = probe.check();
      await vi.advanceTimersByTimeAsync(50);

      await expect(result).resolves.toEqual({
        http: "unavailable",
        error: "timeout",
        auth: "skipped",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts slow authenticated probes without failing the public health check", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response("ok", { status: 200 }))
        .mockImplementationOnce(
          async (_url: URL | RequestInfo, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            }),
        );
      const probe = createEmailEngineHealthProbe({
        baseUrl: "http://emailengine:3000",
        accessToken: "secret-token",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 50,
      });

      const result = probe.check();
      await vi.advanceTimersByTimeAsync(50);

      await expect(result).resolves.toEqual({
        http: "ok",
        statusCode: 200,
        auth: "unavailable",
        authError: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
