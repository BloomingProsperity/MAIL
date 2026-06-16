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
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
