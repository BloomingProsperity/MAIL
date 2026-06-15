# Hermes Provider Integration Deep Dive

Date: 2026-06-14

## Decision

Email Hub should keep Hermes as the only AI entry point in the product. Users configure Hermes once in Settings, then all email skills use `/api/hermes/skills/*`. The web app must never call OpenAI, Ollama, OpenRouter, Anthropic, Gemini, or any model provider directly.

## Provider Strategy

Use three layers:

1. Hermes service first: best default when Hermes Agent owns skills, memory, routing, and fallback.
2. Gateway providers: OpenRouter and LiteLLM cover broad model catalogs through one endpoint.
3. Direct or local endpoints: OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Kimi, Groq, Mistral, Together, Cohere, Ollama, vLLM, LM Studio, llama.cpp, SGLang, and LocalAI.

The backend catalog is the source of truth. Frontend labels stay product-facing, while internal keys and aliases preserve technical compatibility.

## Runtime Contract

Store only these user-editable fields:

- enabled
- providerKey
- endpointUrl
- model
- apiKey
- updatePolicy
- updateChannel

Do not store provider-specific payloads in frontend state. API keys go to `stored_secrets`; public settings return only `apiKeyConfigured`.

## Endpoint Compatibility

Default to OpenAI Chat Completions-compatible requests because it is the widest common denominator. The backend catalog now declares the request protocol for every provider, so Settings can show friendly provider names while the API knows which wire format to use.

The backend now has a transport layer instead of a single hard-coded request
shape:

- OpenAI-compatible chat: Hermes service, LiteLLM, OpenRouter, Ollama, vLLM,
  LM Studio, llama.cpp, SGLang, LocalAI, and most custom gateways.
- OpenAI Responses-compatible: `openai-responses` and any endpoint whose path
  ends in `/responses`, using `instructions + input`.
- Anthropic Messages: provider `anthropic` with `/v1/messages`, `x-api-key`,
  `anthropic-version`, top-level `system`, and `messages`.
- Gemini generateContent: provider `gemini` with `x-goog-api-key`,
  `systemInstruction`, `contents`, and generated text from candidates.
- External-auth providers: OAuth-style or AWS-style providers stay in the
  catalog, but health checks return an external-auth status instead of making
  fake direct calls.

Known native providers should provide default endpoint values from the backend
catalog so Settings does not need to expose raw API path details. Unknown or
new providers remain supported through the `custom` provider and an editable
OpenAI-compatible endpoint. If a provider has an unusual native protocol, add a
new backend transport test first, then extend `http-provider.ts` and the
catalog `requestProtocol`.

Runtime health checks return `providerKey` and `requestProtocol` and write the
same fields into operational events. That gives the Settings page and logs a
stable way to explain what was tested without exposing API keys or provider
payloads.

## Update Handling

Hermes updates should not be forced automatically in MVP. Settings expose manual, notify, and small-version auto-patch policy, but deployment remains operator-controlled for Docker users. Email Hub stores installed/latest version status separately from model credentials.

For Docker self-hosting, Email Hub should check and display available Hermes
runtime updates, but the operator still chooses when to pull/recreate the
Hermes container or update an external Hermes install. Auto-patch is only a
policy flag until the deployment runner exists; it must never silently replace
an external user-managed Hermes service.

Hermes Agent itself has its own provider routing, fallback, skills, memory, and
profile configuration. Email Hub should prefer connecting to Hermes as a
service when users want the full Hermes learning loop, and should use direct
provider calls only as a compatibility layer for email skills.

## Sources

- Hermes provider docs: https://hermes-agent.nousresearch.com/docs/integrations/providers
- Hermes skills docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- Hermes configuration docs: https://hermes-agent.nousresearch.com/docs/user-guide/configuration
- Anthropic Messages API: https://platform.claude.com/docs/en/build-with-claude/working-with-messages
- Gemini API reference: https://ai.google.dev/api
- Hermes FAQ provider list and local endpoint guidance: https://hermes-agent.nousresearch.com/docs/reference/faq
- LiteLLM provider catalog: https://docs.litellm.ai/docs/providers
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
