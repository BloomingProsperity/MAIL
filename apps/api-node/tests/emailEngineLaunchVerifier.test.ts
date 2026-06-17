import { describe, expect, it, vi } from "vitest";

import { verifyEmailEngineLaunch } from "../src/mail-engine/launch-verifier";

describe("EmailEngine launch verifier", () => {
  it("passes only when API health, EmailEngine readiness, and token-backed capabilities are ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: true, service: "email-hub-api" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: true,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          missing: [],
          warnings: [],
          readiness: {
            status: "ready",
            setupActions: [],
          },
        }),
      );

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080/",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      gate: "emailengine_launch",
      apiBaseUrl: "http://127.0.0.1:8080",
      checkedAt: "2026-06-17T10:00:00.000Z",
      checks: {
        apiHealth: { ok: true, statusCode: 200 },
        emailEngineReadiness: {
          ok: true,
          statusCode: 200,
          status: "ready",
        },
        tokenBackedCapabilities: {
          ok: true,
          detail:
            "imap_smtp_onboarding, attachment_download, and send are available",
        },
        launchReadinessClean: {
          ok: true,
          detail: "no missing env, warnings, or setup actions",
        },
      },
      readiness: {
        status: "ready",
        missing: [],
        warnings: [],
        setupActions: [],
      },
      requiredFollowUps: [],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8080/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8080/api/mail-engine/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fails with actionable setup steps when EmailEngine readiness is degraded", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: false,
          capabilities: {
            imapSmtpOnboarding: false,
            attachmentDownload: false,
            send: false,
          },
          missing: ["EMAILENGINE_ACCESS_TOKEN"],
          warnings: ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"],
          readiness: {
            status: "degraded",
            setupActions: [
              {
                code: "set_emailengine_access_token",
                label: "设置 EmailEngine 访问令牌",
                env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
                effect: "添加邮箱、附件下载、发信和同步任务会失败。",
              },
            ],
          },
        }),
      );

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.emailEngineReadiness).toEqual({
      ok: false,
      statusCode: 200,
      status: "degraded",
      detail: "emailengine_health_not_ok",
    });
    expect(result.checks.tokenBackedCapabilities).toEqual({
      ok: false,
      detail:
        "missing_capabilities:imapSmtpOnboarding,attachmentDownload,send",
    });
    expect(result.checks.launchReadinessClean).toEqual({
      ok: false,
      detail:
        "missing:EMAILENGINE_ACCESS_TOKEN;warnings:EMAILENGINE_WEBHOOK_SECRET_DEFAULT;setup_actions:set_emailengine_access_token",
    });
    expect(result.readiness).toMatchObject({
      status: "degraded",
      missing: ["EMAILENGINE_ACCESS_TOKEN"],
      warnings: ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"],
    });
    expect(result.requiredFollowUps).toEqual([
      "set_emailengine_access_token | 设置 EmailEngine 访问令牌 | env=EMAILENGINE_ACCESS_TOKEN,EENGINE_PREPARED_TOKEN",
      "Wire token-backed EmailEngine capabilities before launch: imapSmtpOnboarding, attachmentDownload, send.",
      "Resolve EmailEngine launch readiness warnings before launch: missing:EMAILENGINE_ACCESS_TOKEN;warnings:EMAILENGINE_WEBHOOK_SECRET_DEFAULT;setup_actions:set_emailengine_access_token.",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("fails closed when readiness claims ready but launch warnings remain", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: true,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          missing: [],
          warnings: ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"],
          readiness: {
            status: "ready",
            setupActions: [
              {
                code: "rotate_emailengine_webhook_secret",
                label: "替换默认回调密钥",
                env: ["EMAILENGINE_WEBHOOK_SECRET", "EENGINE_SECRET"],
              },
            ],
          },
        }),
      );

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.emailEngineReadiness).toMatchObject({
      ok: true,
      status: "ready",
    });
    expect(result.checks.launchReadinessClean).toEqual({
      ok: false,
      detail:
        "warnings:EMAILENGINE_WEBHOOK_SECRET_DEFAULT;setup_actions:rotate_emailengine_webhook_secret",
    });
    expect(result.requiredFollowUps).toEqual([
      "Resolve EmailEngine launch readiness warnings before launch: warnings:EMAILENGINE_WEBHOOK_SECRET_DEFAULT;setup_actions:rotate_emailengine_webhook_secret.",
    ]);
    expect(JSON.stringify(result)).not.toContain("dev-emailhub-secret");
  });

  it("fails when API health is unavailable even if EmailEngine readiness looks ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: true,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          readiness: {
            status: "ready",
            setupActions: [],
          },
        }),
      );

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.apiHealth).toEqual({
      ok: false,
      statusCode: 503,
      detail: "http_503",
    });
    expect(result.requiredFollowUps).toContain(
      "Fix API /health before launch; check Postgres readiness and api container logs.",
    );
  });

  it("fails when the readiness endpoint does not prove the EmailEngine provider is healthy", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({
          provider: "native",
          ok: true,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          readiness: {
            status: "ready",
            setupActions: [],
          },
        }),
      );

    const wrongProvider = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(wrongProvider.ok).toBe(false);
    expect(wrongProvider.checks.emailEngineReadiness).toMatchObject({
      ok: false,
      status: "ready",
      detail: "emailengine_provider_unexpected",
    });
    expect(wrongProvider.requiredFollowUps).toEqual([
      "Fix EmailEngine launch readiness before launch; /api/mail-engine/health must report provider=emailengine.",
    ]);

    fetchImpl.mockReset();
    fetchImpl
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: false,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          readiness: {
            status: "ready",
            setupActions: [],
          },
        }),
      );

    const unhealthyBody = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(unhealthyBody.ok).toBe(false);
    expect(unhealthyBody.checks.emailEngineReadiness).toMatchObject({
      ok: false,
      status: "ready",
      detail: "emailengine_health_not_ok",
    });
    expect(unhealthyBody.requiredFollowUps).toEqual([
      "Fix EmailEngine launch readiness before launch; EmailEngine health is not ready even though the API responded.",
    ]);
  });

  it("reports API health body failures with an explicit detail", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ok: false, service: "email-hub-api" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: true,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          readiness: {
            status: "ready",
            setupActions: [],
          },
        }),
      );

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.apiHealth).toEqual({
      ok: false,
      statusCode: 200,
      detail: "api_health_not_ok",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix API /health before launch; check Postgres readiness and api container logs.",
    ]);
  });

  it("redacts userinfo, query strings, and fragments from the base URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({
          provider: "emailengine",
          ok: true,
          capabilities: {
            imapSmtpOnboarding: true,
            attachmentDownload: true,
            send: true,
          },
          readiness: {
            status: "ready",
            setupActions: [],
          },
        }),
      );

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://user:secret@127.0.0.1:8080/?token=abc#frag",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.apiBaseUrl).toBe("http://127.0.0.1:8080");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8080/health",
      expect.any(Object),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("token=abc");
  });

  it("rejects invalid explicit API base URLs instead of checking the fallback target", async () => {
    const fetchImpl = vi.fn();

    await expect(
      verifyEmailEngineLaunch({
        apiBaseUrl: "not-a-url",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("EMAILHUB_API_BASE_URL must be a valid http(s) URL.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out stalled launch checks", async () => {
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

      const result = verifyEmailEngineLaunch({
        apiBaseUrl: "http://127.0.0.1:8080",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toMatchObject({
        ok: false,
        checks: {
          apiHealth: { ok: false, detail: "timeout" },
          emailEngineReadiness: { ok: false, detail: "timeout" },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on request failures without leaking transport details", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.20:8080 with token abc");
    });

    const result = await verifyEmailEngineLaunch({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.apiHealth).toEqual({
      ok: false,
      detail: "request_failed",
    });
    expect(result.checks.emailEngineReadiness).toEqual({
      ok: false,
      status: "unknown",
      detail: "request_failed",
    });
    expect(JSON.stringify(result)).not.toContain("10.0.0.20");
    expect(JSON.stringify(result)).not.toContain("abc");
  });
});
