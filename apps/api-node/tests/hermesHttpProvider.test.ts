import { describe, expect, it } from "vitest";

import { createHermesHttpTextProvider } from "../src/hermes/http-provider";

describe("Hermes HTTP text provider", () => {
  it("sends prompts to a Hermes-compatible chat completions endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createHermesHttpTextProvider({
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      apiKey: "hermes-secret",
      model: "hermes-email",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [{ message: { content: "你好，张三" } }],
        });
      },
    });

    const result = await provider.complete({
      systemPrompt: "system",
      userPrompt: "translate hello",
    });

    expect(result).toBe("你好，张三");
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer hermes-secret",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "hermes-email",
      temperature: 0.1,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "translate hello" },
      ],
    });
  });

  it("supports OpenAI Responses-compatible endpoints from the same runtime provider", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createHermesHttpTextProvider({
      endpointUrl: "http://localhost:11434/v1/responses",
      apiKey: "local-key",
      model: "qwen3:8b",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          output_text: "ok from responses",
        });
      },
    });

    const result = await provider.complete({
      systemPrompt: "You are Hermes.",
      userPrompt: "health check",
    });

    expect(result).toBe("ok from responses");
    expect(calls[0].url).toBe("http://localhost:11434/v1/responses");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "qwen3:8b",
      temperature: 0.1,
      instructions: "You are Hermes.",
      input: "health check",
    });
  });

  it("uses the catalog-declared protocol even when endpoint names are not enough", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createHermesHttpTextProvider({
      providerKey: "openai-responses",
      endpointUrl: "https://models.example.test/custom-openai-endpoint",
      apiKey: "responses-secret",
      model: "gpt-5.2",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          output: [
            {
              content: [{ type: "output_text", text: "responses ok" }],
            },
          ],
        });
      },
    });

    await expect(
      provider.complete({
        systemPrompt: "You are Hermes.",
        userPrompt: "Summarize this thread.",
      }),
    ).resolves.toBe("responses ok");

    expect(calls[0].url).toBe(
      "https://models.example.test/custom-openai-endpoint",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "gpt-5.2",
      temperature: 0.1,
      instructions: "You are Hermes.",
      input: "Summarize this thread.",
    });
  });

  it("speaks Anthropic Messages API when the runtime provider is Anthropic", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createHermesHttpTextProvider({
      providerKey: "anthropic",
      endpointUrl: "https://api.anthropic.com/v1/messages",
      apiKey: "anthropic-secret",
      model: "claude-sonnet-4-6",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          content: [{ type: "text", text: "anthropic ok" }],
        });
      },
    } as any);

    await expect(
      provider.complete({
        systemPrompt: "You are Hermes.",
        userPrompt: "Summarize this mail.",
      }),
    ).resolves.toBe("anthropic ok");

    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.stringify(calls[0].init?.headers)).not.toContain(
      "authorization",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: "You are Hermes.",
      messages: [{ role: "user", content: "Summarize this mail." }],
    });
  });

  it("speaks Gemini generateContent when the runtime provider is Gemini", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createHermesHttpTextProvider({
      providerKey: "gemini",
      endpointUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent",
      apiKey: "gemini-secret",
      model: "gemini-3-pro",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: "gemini ok" }],
                role: "model",
              },
            },
          ],
        });
      },
    } as any);

    await expect(
      provider.complete({
        systemPrompt: "You are Hermes.",
        userPrompt: "Translate this mail.",
      }),
    ).resolves.toBe("gemini ok");

    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent",
    );
    expect(calls[0].init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-goog-api-key": "gemini-secret",
    });
    expect(JSON.stringify(calls[0].init?.headers)).not.toContain(
      "authorization",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      systemInstruction: {
        parts: [{ text: "You are Hermes." }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "Translate this mail." }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
      },
    });
  });

  it("throws sanitized provider errors without leaking prompts or api keys", async () => {
    const provider = createHermesHttpTextProvider({
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      apiKey: "hermes-secret",
      model: "hermes-email",
      fetchImpl: async () =>
        Response.json(
          { error: { message: "prompt contained private customer text" } },
          { status: 502 },
        ),
    });

    await expect(
      provider.complete({
        systemPrompt: "system",
        userPrompt: "private customer text",
      }),
    ).rejects.toThrow("Hermes provider failed: 502");

    await expect(
      provider.complete({
        systemPrompt: "system",
        userPrompt: "private customer text",
      }),
    ).rejects.not.toThrow(/private customer text|hermes-secret/);
  });
});
