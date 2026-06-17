import { describe, expect, it, vi } from "vitest";

import {
  createHermesProviderProbeService,
  InvalidHermesProviderProbeRequestError,
} from "../src/hermes/provider-probe";

describe("Hermes provider probe service", () => {
  it("reports missing API keys for key-only providers without calling the network", async () => {
    const fetchImpl = vi.fn();
    const service = createHermesProviderProbeService({
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-06-14T09:00:00.000Z"),
    });

    const result = await service.probe({
      providerKey: "openai",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5.2",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "missing_configuration",
      providerKey: "openai-api",
      authType: "api_key",
      missing: ["api_key"],
      checkedAt: "2026-06-14T09:00:00.000Z",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/secret|token|apiKey/i);
  });

  it("probes the trusted Hermes gateway default endpoint with no auth header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createHermesProviderProbeService({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ choices: [{ message: { content: "ok" } }] });
      },
      now: () => new Date("2026-06-14T09:00:00.000Z"),
    });

    const result = await service.probe({
      providerKey: "hermes",
      model: "hermes-email",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "ready",
      providerKey: "hermes",
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      missing: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.headers).not.toHaveProperty("authorization");
  });

  it("rejects private provider probe endpoints before any network call", async () => {
    const fetchImpl = vi.fn();
    const service = createHermesProviderProbeService({
      fetchImpl: fetchImpl as any,
    });

    const unsafeEndpoints = [
      "http://127.0.0.1:8080/v1/chat/completions",
      "http://localhost:11434/v1/chat/completions",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.8/v1/chat/completions",
      "http://172.16.0.8/v1/chat/completions",
      "http://192.168.1.8/v1/chat/completions",
      "http://postgres:5432/v1/chat/completions",
      "http://[::1]:8080/v1/chat/completions",
    ];

    for (const endpointUrl of unsafeEndpoints) {
      await expect(
        service.probe({
          providerKey: "custom",
          endpointUrl,
          model: "mail-llm",
        }),
      ).rejects.toBeInstanceOf(InvalidHermesProviderProbeRequestError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an external-auth status for OAuth and AWS providers instead of pretending to test them", async () => {
    const fetchImpl = vi.fn();
    const service = createHermesProviderProbeService({
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-06-14T09:00:00.000Z"),
    });

    await expect(
      service.probe({ providerKey: "nous", model: "auto" }),
    ).resolves.toMatchObject({
      ok: false,
      status: "external_auth_required",
      providerKey: "nous",
      missing: ["oauth_session"],
    });
    await expect(
      service.probe({ providerKey: "bedrock", model: "anthropic.claude" }),
    ).resolves.toMatchObject({
      ok: false,
      status: "external_auth_required",
      providerKey: "bedrock",
      missing: ["aws_credentials"],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fills native default endpoints for Anthropic and Gemini probes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createHermesProviderProbeService({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("anthropic.com")) {
          return Response.json({
            content: [{ type: "text", text: "anthropic ok" }],
          });
        }

        return Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: "gemini ok" }],
              },
            },
          ],
        });
      },
      now: () => new Date("2026-06-14T09:00:00.000Z"),
    });

    await expect(
      service.probe({
        providerKey: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "anthropic-secret",
      }),
    ).resolves.toMatchObject({
      ok: true,
      endpointUrl: "https://api.anthropic.com/v1/messages",
      missing: [],
    });
    await expect(
      service.probe({
        providerKey: "gemini",
        model: "gemini-3-pro",
        apiKey: "gemini-secret",
      }),
    ).resolves.toMatchObject({
      ok: true,
      endpointUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent",
      missing: [],
    });

    expect(calls[0].init?.headers).toMatchObject({
      "x-api-key": "anthropic-secret",
    });
    expect(calls[1].init?.headers).toMatchObject({
      "x-goog-api-key": "gemini-secret",
    });
  });

  it("sanitizes failed probes and keeps custom providers available for new APIs", async () => {
    const service = createHermesProviderProbeService({
      fetchImpl: async () =>
        Response.json(
          { error: { message: "bad key sk-private and prompt" } },
          { status: 401 },
        ),
      now: () => new Date("2026-06-14T09:00:00.000Z"),
    });

    const result = await service.probe({
      providerKey: "new-lab-api",
      endpointUrl: "https://models.example.test/v1/chat/completions",
      model: "mail-llm",
      apiKey: "sk-private",
    });

    expect(result).toMatchObject({
      ok: false,
      status: "connection_failed",
      providerKey: "new-lab-api",
      category: "custom",
      authType: "api_key_optional",
      endpointUrl: "https://models.example.test/v1/chat/completions",
      model: "mail-llm",
    });
    expect(JSON.stringify(result)).not.toMatch(/sk-private|bad key|prompt/i);
  });

  it("rejects malformed provider probe input before any network call", async () => {
    const service = createHermesProviderProbeService({
      fetchImpl: vi.fn() as any,
    });

    await expect(
      service.probe({
        providerKey: "../openai",
        endpointUrl: "ftp://example.test/model",
        model: "",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesProviderProbeRequestError);
  });
});
