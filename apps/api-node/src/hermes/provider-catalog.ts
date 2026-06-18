export type HermesProviderCategory =
  | "gateway"
  | "cloud"
  | "local"
  | "oauth"
  | "custom";

export type HermesProviderAuthType =
  | "none"
  | "api_key"
  | "api_key_optional"
  | "oauth"
  | "aws_credentials";

export type HermesProviderRequestProtocol =
  | "openai_chat_completions"
  | "openai_responses"
  | "anthropic_messages"
  | "gemini_generate_content"
  | "external_oauth"
  | "aws_bedrock";

export interface HermesProviderCatalogItem {
  key: string;
  label: string;
  category: HermesProviderCategory;
  authType: HermesProviderAuthType;
  requestProtocol: HermesProviderRequestProtocol;
  endpointEditable: boolean;
  aliases: string[];
  modelExamples: string[];
  capabilities: string[];
  defaultEndpoint?: string;
  endpointTemplate?: string;
  envKeys?: string[];
  note?: string;
}

const HERMES_PROVIDER_CATALOG: HermesProviderCatalogItem[] = [
  gatewayProvider({
    key: "hermes",
    label: "Hermes 服务",
    aliases: ["external-hermes", "hermes-agent"],
    defaultEndpoint: "http://hermes:4000/v1/chat/completions",
    examples: ["hermes-email"],
    note: "Email Hub 推荐入口。让 Hermes 继续负责模型路由、技能和 memory。",
  }),
  gatewayProvider({
    key: "litellm",
    label: "LiteLLM",
    aliases: ["litellm-proxy", "llm-gateway"],
    defaultEndpoint: "http://litellm:4000/v1/chat/completions",
    examples: ["openai/gpt-5.2", "anthropic/claude-sonnet-4.6"],
    authType: "api_key_optional",
    endpointEditable: true,
    note: "统一接入多家模型服务，适合自托管网关和团队统一配置。",
  }),
  gatewayProvider({
    key: "nous",
    label: "Nous Portal",
    aliases: ["nous-portal", "portal"],
    examples: ["auto", "claude-sonnet-4-6", "gpt-5.4"],
    authType: "oauth",
    endpointEditable: false,
  }),
  cloudProvider({
    key: "openai-api",
    label: "OpenAI",
    aliases: ["openai", "gpt"],
    envKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    defaultEndpoint: "https://api.openai.com/v1/chat/completions",
    examples: ["gpt-5.2", "gpt-5-mini"],
  }),
  cloudProvider({
    key: "openai-responses",
    label: "OpenAI Responses",
    aliases: ["openai-response", "responses"],
    envKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    defaultEndpoint: "https://api.openai.com/v1/responses",
    examples: ["gpt-5.2", "gpt-5-mini"],
    requestProtocol: "openai_responses",
  }),
  cloudProvider({
    key: "openrouter",
    label: "OpenRouter",
    envKeys: ["OPENROUTER_API_KEY"],
    defaultEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    examples: ["openai/gpt-5.2", "anthropic/claude-sonnet-4.6"],
  }),
  cloudProvider({
    key: "anthropic",
    label: "Anthropic",
    aliases: ["claude", "claude-code"],
    envKeys: ["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"],
    defaultEndpoint: "https://api.anthropic.com/v1/messages",
    examples: ["claude-sonnet-4-6"],
    requestProtocol: "anthropic_messages",
  }),
  cloudProvider({
    key: "gemini",
    label: "Google Gemini",
    aliases: ["google", "google-ai"],
    envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    endpointTemplate:
      "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    examples: ["gemini-3-pro", "gemini-3-flash"],
    requestProtocol: "gemini_generate_content",
  }),
  cloudProvider({
    key: "vertex-ai",
    label: "Google Vertex AI",
    aliases: ["vertex", "google-vertex"],
    envKeys: ["GOOGLE_APPLICATION_CREDENTIALS", "VERTEX_PROJECT"],
    examples: ["gemini-3-pro", "claude-sonnet-4-6"],
  }),
  oauthProvider({
    key: "google-gemini-cli",
    label: "Google Gemini 登录",
    aliases: ["gemini-oauth"],
    examples: ["gemini-3-pro"],
  }),
  cloudProvider({
    key: "deepseek",
    label: "DeepSeek",
    envKeys: ["DEEPSEEK_API_KEY"],
    defaultEndpoint: "https://api.deepseek.com/v1/chat/completions",
    examples: ["deepseek-chat", "deepseek-reasoner"],
  }),
  cloudProvider({
    key: "mistral",
    label: "Mistral",
    aliases: ["mistral-ai"],
    envKeys: ["MISTRAL_API_KEY"],
    examples: ["mistral-large-latest", "codestral-latest"],
  }),
  cloudProvider({
    key: "groq",
    label: "Groq",
    envKeys: ["GROQ_API_KEY"],
    examples: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  }),
  cloudProvider({
    key: "together",
    label: "Together AI",
    aliases: ["together-ai"],
    envKeys: ["TOGETHER_API_KEY"],
    examples: ["meta-llama/Llama-4", "Qwen/Qwen3-Coder"],
  }),
  cloudProvider({
    key: "cohere",
    label: "Cohere",
    envKeys: ["COHERE_API_KEY"],
    examples: ["command-a-03-2025"],
  }),
  cloudProvider({
    key: "alibaba",
    label: "Qwen / DashScope",
    aliases: ["qwen", "dashscope"],
    envKeys: ["DASHSCOPE_API_KEY"],
    defaultEndpoint:
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    examples: ["qwen3.5-plus", "qwen3-coder-plus"],
  }),
  cloudProvider({
    key: "alibaba-coding-plan",
    label: "Alibaba Coding Plan",
    aliases: ["alibaba_coding", "qwen-coding"],
    envKeys: ["DASHSCOPE_API_KEY"],
    examples: ["qwen3-coder-plus"],
  }),
  cloudProvider({
    key: "kimi-coding",
    label: "Kimi / Moonshot",
    aliases: ["kimi", "moonshot"],
    envKeys: ["KIMI_API_KEY"],
    defaultEndpoint: "https://api.moonshot.ai/v1/chat/completions",
    examples: ["kimi-for-coding", "moonshot-v1-128k"],
  }),
  cloudProvider({
    key: "kimi-coding-cn",
    label: "Kimi / Moonshot 国内",
    aliases: ["kimi-cn", "moonshot-cn"],
    envKeys: ["KIMI_CN_API_KEY"],
    examples: ["kimi-k2.5"],
  }),
  cloudProvider({
    key: "minimax",
    label: "MiniMax",
    envKeys: ["MINIMAX_API_KEY"],
    examples: ["MiniMax-M2.7"],
  }),
  cloudProvider({
    key: "minimax-cn",
    label: "MiniMax 国内",
    envKeys: ["MINIMAX_CN_API_KEY"],
    examples: ["MiniMax-M2.7"],
  }),
  oauthProvider({
    key: "minimax-oauth",
    label: "MiniMax 登录",
    examples: ["MiniMax-M2.7"],
  }),
  cloudProvider({
    key: "xai",
    label: "xAI Grok",
    aliases: ["grok"],
    envKeys: ["XAI_API_KEY"],
    examples: ["grok-4-fast-reasoning"],
  }),
  oauthProvider({
    key: "xai-oauth",
    label: "xAI Grok 登录",
    aliases: ["supergrok"],
    examples: ["grok-4-fast-reasoning"],
  }),
  cloudProvider({
    key: "huggingface",
    label: "Hugging Face",
    aliases: ["hf"],
    envKeys: ["HF_TOKEN"],
    examples: ["meta-llama/Llama-4"],
  }),
  cloudProvider({
    key: "novita",
    label: "NovitaAI",
    aliases: ["novita-ai"],
    envKeys: ["NOVITA_API_KEY"],
    examples: ["moonshotai/kimi-k2.5", "deepseek/deepseek-v3-0324"],
  }),
  cloudProvider({
    key: "zai",
    label: "z.ai / GLM",
    aliases: ["glm", "zhipu"],
    envKeys: ["GLM_API_KEY"],
    examples: ["glm-5"],
  }),
  cloudProvider({
    key: "arcee",
    label: "Arcee AI",
    aliases: ["arcee-ai", "arceeai"],
    envKeys: ["ARCEEAI_API_KEY"],
    examples: ["trinity-large-thinking"],
  }),
  cloudProvider({
    key: "gmi",
    label: "GMI Cloud",
    aliases: ["gmi-cloud", "gmicloud"],
    envKeys: ["GMI_API_KEY"],
    examples: ["zai-org/GLM-5.1-FP8"],
  }),
  cloudProvider({
    key: "xiaomi",
    label: "Xiaomi MiMo",
    aliases: ["mimo", "xiaomi-mimo"],
    envKeys: ["XIAOMI_API_KEY"],
    examples: ["mimo-v2-pro"],
  }),
  cloudProvider({
    key: "tencent-tokenhub",
    label: "Tencent TokenHub",
    aliases: ["tencent", "tokenhub", "tencentmaas"],
    envKeys: ["TOKENHUB_API_KEY"],
    examples: ["hy3-preview"],
  }),
  cloudProvider({
    key: "kilocode",
    label: "Kilo Code",
    envKeys: ["KILOCODE_API_KEY"],
    examples: ["auto"],
  }),
  cloudProvider({
    key: "opencode-zen",
    label: "OpenCode Zen",
    envKeys: ["OPENCODE_ZEN_API_KEY"],
    examples: ["auto"],
  }),
  cloudProvider({
    key: "opencode-go",
    label: "OpenCode Go",
    envKeys: ["OPENCODE_GO_API_KEY"],
    examples: ["auto"],
  }),
  cloudProvider({
    key: "stepfun",
    label: "StepFun",
    envKeys: ["STEPFUN_API_KEY"],
    examples: ["step-2-mini"],
  }),
  {
    key: "bedrock",
    label: "AWS Bedrock",
    category: "cloud",
    authType: "aws_credentials",
    requestProtocol: "aws_bedrock",
    endpointEditable: false,
    aliases: ["aws-bedrock"],
    modelExamples: ["anthropic.claude-sonnet-4-6"],
    capabilities: baseCapabilities(),
  },
  cloudProvider({
    key: "azure-openai",
    label: "Azure OpenAI",
    aliases: ["azure", "azure-foundry", "azure-ai-foundry"],
    envKeys: ["AZURE_OPENAI_API_KEY"],
    examples: ["gpt-5.2"],
  }),
  cloudProvider({
    key: "nvidia",
    label: "NVIDIA Build",
    aliases: ["nvidia-nim"],
    envKeys: ["NVIDIA_API_KEY"],
    defaultEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    examples: ["nvidia/llama-3.3-nemotron-super-49b-v1"],
  }),
  oauthProvider({
    key: "openai-codex",
    label: "OpenAI Codex 登录",
    aliases: ["codex", "codex-oauth"],
    examples: ["gpt-5.4"],
  }),
  oauthProvider({
    key: "copilot",
    label: "GitHub Copilot",
    aliases: ["github-copilot"],
    examples: ["gpt-5.4", "claude-sonnet-4.6"],
  }),
  {
    key: "copilot-acp",
    label: "GitHub Copilot ACP",
    category: "local",
    authType: "oauth",
    requestProtocol: "external_oauth",
    endpointEditable: false,
    aliases: ["github-copilot-acp"],
    modelExamples: ["copilot-acp"],
    capabilities: baseCapabilities(),
  },
  localProvider({
    key: "ollama",
    label: "Ollama 本地",
    defaultEndpoint: "http://localhost:11434/v1/chat/completions",
    examples: ["qwen3:latest", "llama4:latest"],
  }),
  localProvider({
    key: "ollama-cloud",
    label: "Ollama Cloud",
    examples: ["gpt-oss:120b"],
    authType: "api_key",
  }),
  localProvider({
    key: "vllm",
    label: "vLLM 本地",
    defaultEndpoint: "http://localhost:8000/v1/chat/completions",
    examples: ["Qwen/Qwen3-Coder"],
  }),
  localProvider({
    key: "lmstudio",
    label: "LM Studio",
    defaultEndpoint: "http://localhost:1234/v1/chat/completions",
    examples: ["local-model"],
    authType: "api_key_optional",
  }),
  localProvider({
    key: "llamacpp",
    label: "llama.cpp",
    defaultEndpoint: "http://localhost:8080/v1/chat/completions",
    examples: ["local-model"],
    authType: "api_key_optional",
    aliases: ["llama.cpp", "llama-cpp"],
  }),
  localProvider({
    key: "sglang",
    label: "SGLang",
    defaultEndpoint: "http://localhost:30000/v1/chat/completions",
    examples: ["Qwen/Qwen3-Coder"],
    authType: "api_key_optional",
  }),
  localProvider({
    key: "localai",
    label: "LocalAI",
    defaultEndpoint: "http://localhost:8080/v1/chat/completions",
    examples: ["local-model"],
    authType: "api_key_optional",
    aliases: ["local-ai"],
  }),
  oauthProvider({
    key: "qwen-oauth",
    label: "Qwen 登录",
    aliases: ["qwen-login"],
    examples: ["qwen3.5-plus"],
  }),
  {
    key: "custom",
    label: "自定义兼容服务",
    category: "custom",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["hermes-gateway", "custom-endpoint", "openai-compatible"],
    modelExamples: ["custom-model"],
    capabilities: [...baseCapabilities(), "skills", "memory"],
    note: "用于接入 OpenAI-compatible 自定义服务。",
  },
];

export function getHermesProviderCatalog(): HermesProviderCatalogItem[] {
  return HERMES_PROVIDER_CATALOG.map(cloneProvider);
}

export function findHermesProvider(
  keyOrAlias: string,
): HermesProviderCatalogItem | undefined {
  const normalized = keyOrAlias.trim().toLowerCase();
  const provider = HERMES_PROVIDER_CATALOG.find(
    (item) =>
      item.key === normalized ||
      item.aliases.some((alias) => alias === normalized),
  );

  return provider ? cloneProvider(provider) : undefined;
}

function gatewayProvider(input: {
  key: string;
  label: string;
  aliases?: string[];
  defaultEndpoint?: string;
  examples: string[];
  authType?: HermesProviderAuthType;
  endpointEditable?: boolean;
  requestProtocol?: HermesProviderRequestProtocol;
  note?: string;
}): HermesProviderCatalogItem {
  return {
    key: input.key,
    label: input.label,
    category: "gateway",
    authType: input.authType ?? "api_key_optional",
    requestProtocol: input.requestProtocol ?? "openai_chat_completions",
    endpointEditable: input.endpointEditable ?? true,
    aliases: input.aliases ?? [],
    modelExamples: input.examples,
    capabilities: [
      ...baseCapabilities(),
      "provider_routing",
      "fallback",
      "skills",
      "memory",
    ],
    ...(input.defaultEndpoint ? { defaultEndpoint: input.defaultEndpoint } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

function cloudProvider(input: {
  key: string;
  label: string;
  aliases?: string[];
  envKeys?: string[];
  defaultEndpoint?: string;
  endpointTemplate?: string;
  examples: string[];
  requestProtocol?: HermesProviderRequestProtocol;
}): HermesProviderCatalogItem {
  return {
    key: input.key,
    label: input.label,
    category: "cloud",
    authType: "api_key",
    requestProtocol: input.requestProtocol ?? "openai_chat_completions",
    endpointEditable: true,
    aliases: input.aliases ?? [],
    modelExamples: input.examples,
    capabilities: baseCapabilities(),
    ...(input.defaultEndpoint ? { defaultEndpoint: input.defaultEndpoint } : {}),
    ...(input.endpointTemplate
      ? { endpointTemplate: input.endpointTemplate }
      : {}),
    ...(input.envKeys ? { envKeys: input.envKeys } : {}),
  };
}

function oauthProvider(input: {
  key: string;
  label: string;
  aliases?: string[];
  examples: string[];
}): HermesProviderCatalogItem {
  return {
    key: input.key,
    label: input.label,
    category: "oauth",
    authType: "oauth",
    requestProtocol: "external_oauth",
    endpointEditable: false,
    aliases: input.aliases ?? [],
    modelExamples: input.examples,
    capabilities: baseCapabilities(),
  };
}

function localProvider(input: {
  key: string;
  label: string;
  defaultEndpoint?: string;
  examples: string[];
  authType?: HermesProviderAuthType;
  requestProtocol?: HermesProviderRequestProtocol;
  aliases?: string[];
}): HermesProviderCatalogItem {
  return {
    key: input.key,
    label: input.label,
    category: "local",
    authType: input.authType ?? "none",
    requestProtocol:
      input.requestProtocol ??
      (input.authType === "oauth"
        ? "external_oauth"
        : "openai_chat_completions"),
    endpointEditable: true,
    aliases: input.aliases ?? [],
    modelExamples: input.examples,
    capabilities: baseCapabilities(),
    ...(input.defaultEndpoint ? { defaultEndpoint: input.defaultEndpoint } : {}),
  };
}

function baseCapabilities(): string[] {
  return ["chat", "email_skills", "streaming_ready"];
}

function cloneProvider(
  provider: HermesProviderCatalogItem,
): HermesProviderCatalogItem {
  return {
    ...provider,
    aliases: [...provider.aliases],
    modelExamples: [...provider.modelExamples],
    capabilities: [...provider.capabilities],
    ...(provider.envKeys ? { envKeys: [...provider.envKeys] } : {}),
    ...(provider.endpointTemplate
      ? { endpointTemplate: provider.endpointTemplate }
      : {}),
  };
}
