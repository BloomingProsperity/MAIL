import { describe, expect, it } from "vitest";

import {
  findHermesProvider,
  getHermesProviderCatalog,
} from "../src/hermes/provider-catalog";

describe("Hermes provider catalog", () => {
  it("keeps the supported model interfaces in one backend-owned catalog", () => {
    const providers = getHermesProviderCatalog();
    const keys = providers.map((provider) => provider.key);

    expect(keys).toEqual([...new Set(keys)]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "hermes",
        "nous",
        "openai-api",
        "openai-responses",
        "litellm",
        "openrouter",
        "anthropic",
        "gemini",
        "deepseek",
        "alibaba",
        "mistral",
        "groq",
        "together",
        "cohere",
        "vertex-ai",
        "kimi-coding",
        "minimax",
        "xai",
        "ollama",
        "vllm",
        "lmstudio",
        "llamacpp",
        "sglang",
        "localai",
        "azure-openai",
        "bedrock",
        "custom",
      ]),
    );
    expect(providers.find((provider) => provider.key === "custom")).toMatchObject(
      {
        label: "自定义模型服务",
        category: "custom",
        endpointEditable: true,
        authType: "api_key_optional",
        requestProtocol: "openai_chat_completions",
      },
    );
  });

  it("declares the request protocol for every model provider", () => {
    const providers = getHermesProviderCatalog();

    for (const provider of providers) {
      expect(provider.requestProtocol).toEqual(
        expect.stringMatching(
          /^(openai_chat_completions|openai_responses|anthropic_messages|gemini_generate_content|external_oauth|aws_bedrock)$/,
        ),
      );
    }

    expect(providers.find((provider) => provider.key === "openai-api")).toMatchObject({
      requestProtocol: "openai_chat_completions",
      defaultEndpoint: "https://api.openai.com/v1/chat/completions",
    });
    expect(
      providers.find((provider) => provider.key === "openai-responses"),
    ).toMatchObject({
      label: "OpenAI Responses",
      requestProtocol: "openai_responses",
      defaultEndpoint: "https://api.openai.com/v1/responses",
    });
    expect(providers.find((provider) => provider.key === "anthropic")).toMatchObject({
      requestProtocol: "anthropic_messages",
    });
    expect(providers.find((provider) => provider.key === "gemini")).toMatchObject({
      requestProtocol: "gemini_generate_content",
    });
    expect(providers.find((provider) => provider.key === "ollama")).toMatchObject({
      requestProtocol: "openai_chat_completions",
    });
  });

  it("describes provider capabilities without leaking credential fields", () => {
    const providers = getHermesProviderCatalog();

    expect(providers.find((provider) => provider.key === "ollama")).toMatchObject(
      {
        category: "local",
        endpointEditable: true,
        authType: "none",
      },
    );
    expect(
      providers.find((provider) => provider.key === "openai-api"),
    ).toMatchObject({
      category: "cloud",
      endpointEditable: true,
      authType: "api_key",
    });

    for (const provider of providers) {
      expect(Object.keys(provider)).not.toEqual(
        expect.arrayContaining(["apiKey", "secret", "token", "secretValue"]),
      );
    }
  });

  it("keeps user-facing provider labels clean while retaining internal adapter keys", () => {
    const providers = getHermesProviderCatalog();

    expect(providers.find((provider) => provider.key === "openai-api")).toMatchObject({
      label: "OpenAI",
      aliases: expect.arrayContaining(["openai"]),
    });
    expect(providers.find((provider) => provider.key === "litellm")).toMatchObject({
      label: "LiteLLM",
      category: "gateway",
      capabilities: expect.arrayContaining(["provider_routing", "fallback"]),
    });
    expect(providers.find((provider) => provider.key === "custom")).toMatchObject({
      label: "自定义模型服务",
      aliases: expect.arrayContaining(["openai-compatible", "custom-endpoint"]),
    });

    for (const provider of providers.filter((item) =>
      ["openai-api", "custom", "litellm", "ollama", "llamacpp", "sglang"].includes(
        item.key,
      ),
    )) {
      expect(provider.label).not.toMatch(/\bAPI\b|OpenAI-compatible|OAuth|\/v1/i);
    }
  });

  it("resolves Hermes provider aliases to their canonical keys", () => {
    expect(findHermesProvider("kimi-cn")?.key).toBe("kimi-coding-cn");
    expect(findHermesProvider("moonshot-cn")?.key).toBe("kimi-coding-cn");
    expect(findHermesProvider("hf")?.key).toBe("huggingface");
    expect(findHermesProvider("qwen")?.key).toBe("alibaba");
    expect(findHermesProvider("litellm-proxy")?.key).toBe("litellm");
    expect(findHermesProvider("llama.cpp")?.key).toBe("llamacpp");
    expect(findHermesProvider("azure")?.key).toBe("azure-openai");
    expect(findHermesProvider("unknown-lab-model")).toBeUndefined();
  });
});
