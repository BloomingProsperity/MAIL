import type { HermesTextProvider } from "./translation.js";
import {
  findHermesProvider,
  type HermesProviderRequestProtocol,
} from "./provider-catalog.js";

export interface HermesHttpTextProviderOptions {
  providerKey?: string;
  endpointUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}

type HermesHttpTransport =
  | "openai_chat_completions"
  | "openai_responses"
  | "anthropic_messages"
  | "gemini_generate_content";

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface ResponsesApiResponse {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
      type?: unknown;
    }>;
  }>;
}

interface AnthropicMessagesResponse {
  content?: Array<{
    text?: unknown;
    type?: unknown;
  }>;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: unknown;
      }>;
    };
  }>;
}

export function createHermesHttpTextProvider(
  options: HermesHttpTextProviderOptions,
): HermesTextProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(input) {
      const transport = resolveTransport(options);
      const headers = buildProviderHeaders(transport, options.apiKey);

      const response = await fetchImpl(options.endpointUrl, {
        method: "POST",
        redirect: "manual",
        headers,
        body: JSON.stringify(buildProviderRequestBody(transport, options, input)),
      });

      if (response.status >= 300 && response.status < 400) {
        throw new Error("Hermes provider redirect blocked");
      }

      if (!response.ok) {
        throw new Error(`Hermes provider failed: ${response.status}`);
      }

      const payload = await response.json();
      const content = extractProviderText(transport, payload);
      if (!content) {
        throw new Error("Hermes provider returned empty content");
      }

      return content;
    },
  };
}

function buildProviderRequestBody(
  transport: HermesHttpTransport,
  options: HermesHttpTextProviderOptions,
  input: Parameters<HermesTextProvider["complete"]>[0],
): Record<string, unknown> {
  if (transport === "openai_responses") {
    return {
      model: options.model,
      temperature: 0.1,
      instructions: input.systemPrompt,
      input: input.userPrompt,
    };
  }

  if (transport === "anthropic_messages") {
    return {
      model: options.model,
      max_tokens: 2048,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }],
    };
  }

  if (transport === "gemini_generate_content") {
    return {
      systemInstruction: {
        parts: [{ text: input.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
      },
    };
  }

  return {
    model: options.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  };
}

function buildProviderHeaders(
  transport: HermesHttpTransport,
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (!apiKey) {
    return headers;
  }

  if (transport === "anthropic_messages") {
    return {
      ...headers,
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  if (transport === "gemini_generate_content") {
    return {
      ...headers,
      "x-goog-api-key": apiKey,
    };
  }

  return {
    ...headers,
    authorization: `Bearer ${apiKey}`,
  };
}

function extractProviderText(
  transport: HermesHttpTransport,
  payload: unknown,
): string | undefined {
  if (transport === "openai_responses") {
    return extractResponsesText(payload as ResponsesApiResponse);
  }

  if (transport === "anthropic_messages") {
    return extractAnthropicMessagesText(payload as AnthropicMessagesResponse);
  }

  if (transport === "gemini_generate_content") {
    return extractGeminiGenerateContentText(
      payload as GeminiGenerateContentResponse,
    );
  }

  const content = (payload as ChatCompletionsResponse).choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0
    ? content
    : undefined;
}

function extractResponsesText(payload: ResponsesApiResponse): string | undefined {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return undefined;
}

function extractAnthropicMessagesText(
  payload: AnthropicMessagesResponse,
): string | undefined {
  for (const item of payload.content ?? []) {
    if (typeof item.text === "string" && item.text.trim()) {
      return item.text;
    }
  }

  return undefined;
}

function extractGeminiGenerateContentText(
  payload: GeminiGenerateContentResponse,
): string | undefined {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return undefined;
}

function resolveTransport(
  options: HermesHttpTextProviderOptions,
): HermesHttpTransport {
  const providerKey = options.providerKey?.trim().toLowerCase();
  const catalogProtocol = providerKey
    ? findHermesProvider(providerKey)?.requestProtocol
    : undefined;
  const declaredTransport = protocolToHttpTransport(catalogProtocol);
  if (declaredTransport) {
    return declaredTransport;
  }

  const endpointPath = parseEndpointPath(options.endpointUrl);

  if (endpointPath.endsWith("/responses")) {
    return "openai_responses";
  }

  if (
    endpointPath.endsWith("/messages") &&
    (providerKey === "anthropic" || endpointPath.includes("/v1/messages"))
  ) {
    return "anthropic_messages";
  }

  if (endpointPath.endsWith(":generatecontent")) {
    return "gemini_generate_content";
  }

  return "openai_chat_completions";
}

function protocolToHttpTransport(
  protocol: HermesProviderRequestProtocol | undefined,
): HermesHttpTransport | undefined {
  if (
    protocol === "openai_chat_completions" ||
    protocol === "openai_responses" ||
    protocol === "anthropic_messages" ||
    protocol === "gemini_generate_content"
  ) {
    return protocol;
  }

  return undefined;
}

function parseEndpointPath(endpointUrl: string): string {
  try {
    return new URL(endpointUrl).pathname.toLowerCase();
  } catch {
    return endpointUrl.toLowerCase();
  }
}
