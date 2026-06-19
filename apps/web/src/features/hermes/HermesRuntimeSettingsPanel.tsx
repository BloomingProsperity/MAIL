import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  EmailHubApi,
  HermesProviderCatalogItem,
  HermesProviderProbeMissing,
} from "../../lib/emailHubApi";
import "./HermesRuntimeSettingsPanel.css";

type HermesRuntimeBusyAction = "save" | "test" | "clear-key";

const fallbackHermesProviders: HermesProviderCatalogItem[] = [
  {
    key: "openai-api",
    label: "OpenAI",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["openai"],
    modelExamples: ["gpt-5.2"],
    capabilities: ["chat", "email_skills"],
    defaultEndpoint: "https://api.openai.com/v1/chat/completions",
  },
  {
    key: "anthropic",
    label: "Anthropic",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "anthropic_messages",
    endpointEditable: true,
    aliases: ["claude"],
    modelExamples: ["claude-sonnet-4-6"],
    capabilities: ["chat", "email_skills"],
    defaultEndpoint: "https://api.anthropic.com/v1/messages",
  },
  {
    key: "gemini",
    label: "Google Gemini",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "gemini_generate_content",
    endpointEditable: true,
    aliases: ["google"],
    modelExamples: ["gemini-3-pro"],
    capabilities: ["chat", "email_skills"],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: [],
    modelExamples: ["deepseek-chat"],
    capabilities: ["chat", "email_skills"],
    defaultEndpoint: "https://api.deepseek.com/v1/chat/completions",
  },
  {
    key: "nvidia",
    label: "NVIDIA Build",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["nvidia-nim"],
    modelExamples: ["nvidia/llama-3.3-nemotron-super-49b-v1"],
    capabilities: ["chat", "email_skills"],
    defaultEndpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  },
  {
    key: "custom",
    label: "自定义兼容服务",
    category: "custom",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["openai-compatible"],
    modelExamples: ["custom-model"],
    capabilities: ["chat", "email_skills"],
  },
];

const visibleProviderKeys = new Set([
  "openai-api",
  "anthropic",
  "gemini",
  "deepseek",
  "openrouter",
  "alibaba",
  "kimi-coding",
  "nvidia",
  "custom",
]);

function isUserSelectableProvider(provider: HermesProviderCatalogItem): boolean {
  return (
    visibleProviderKeys.has(provider.key) &&
    provider.requestProtocol !== "external_oauth" &&
    provider.requestProtocol !== "aws_bedrock" &&
    provider.authType !== "oauth" &&
    provider.authType !== "aws_credentials"
  );
}

function providerDefaultModel(provider?: HermesProviderCatalogItem): string {
  return provider?.modelExamples[0] ?? "custom-model";
}

function providerDefaultEndpoint(
  provider?: HermesProviderCatalogItem,
): string | undefined {
  return provider?.defaultEndpoint;
}

function formatHermesMissingFields(fields: HermesProviderProbeMissing[]): string {
  const labels: Record<HermesProviderProbeMissing, string> = {
    endpoint_url: "服务地址",
    model: "模型",
    api_key: "访问密钥",
    oauth_session: "登录授权",
    aws_credentials: "云服务凭证",
  };
  return fields.map((field) => labels[field]).join("、");
}

export function HermesRuntimeSettingsPanel(props: {
  api?: EmailHubApi;
}) {
  const [assistantName, setAssistantName] = useState("Hermes");
  const [providerKey, setProviderKey] = useState("openai-api");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [model, setModel] = useState("gpt-5.2");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [hermesProviders, setHermesProviders] = useState<
    HermesProviderCatalogItem[]
  >(fallbackHermesProviders);
  const [notice, setNotice] = useState("未连接。");
  const [busyAction, setBusyAction] = useState<HermesRuntimeBusyAction>();

  const providerOptions = useMemo(() => {
    const catalog = hermesProviders.filter(isUserSelectableProvider);
    const merged = catalog.length > 0 ? catalog : fallbackHermesProviders;

    if (merged.some((provider) => provider.key === providerKey)) {
      return merged;
    }

    return [
      ...merged,
      {
        key: providerKey,
        label: providerKey,
        category: "custom" as const,
        authType: "api_key_optional" as const,
        requestProtocol: "openai_chat_completions" as const,
        endpointEditable: true,
        aliases: [],
        modelExamples: [model || "custom-model"],
        capabilities: ["chat", "email_skills"],
        ...(endpointUrl ? { defaultEndpoint: endpointUrl } : {}),
      },
    ];
  }, [endpointUrl, hermesProviders, model, providerKey]);

  const selectedProvider = useMemo(
    () => providerOptions.find((provider) => provider.key === providerKey),
    [providerKey, providerOptions],
  );
  const customProviderSelected = providerKey === "custom";
  const isRuntimeBusy = busyAction !== undefined;

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      return () => {
        alive = false;
      };
    }

    void props.api
      .getHermesProviders()
      .then((catalog) => {
        if (!alive) return;
        const runtimeProviders = catalog.providers.filter(isUserSelectableProvider);
        if (runtimeProviders.length > 0) {
          setHermesProviders(runtimeProviders);
        }
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取服务商列表。");
      });

    void props.api
      .getHermesRuntimeSettings()
      .then((settings) => {
        if (!alive) return;
        const nextProviderKey =
          settings.providerKey === "hermes" ? "openai-api" : settings.providerKey;
        const provider = providerOptions.find(
          (item) => item.key === nextProviderKey,
        );
        setAssistantName(settings.assistantName || "Hermes");
        setProviderKey(nextProviderKey);
        setEndpointUrl(settings.endpointUrl ?? providerDefaultEndpoint(provider) ?? "");
        setModel(settings.model || providerDefaultModel(provider));
        setApiKeyConfigured(settings.apiKeyConfigured);
        setNotice(
          settings.apiKeyConfigured
            ? "连接已保存。"
            : "未连接。",
        );
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取连接设置。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  function applyProviderSelection(nextProviderKey: string) {
    const provider = providerOptions.find((item) => item.key === nextProviderKey);
    setProviderKey(nextProviderKey);
    setModel(providerDefaultModel(provider));
    setEndpointUrl(providerDefaultEndpoint(provider) ?? "");
  }

  function runtimePayload() {
    const provider = selectedProvider;
    const nextEndpointUrl = customProviderSelected
      ? endpointUrl.trim()
      : providerDefaultEndpoint(provider);

    return {
      enabled: true,
      mode: "external_hermes" as const,
      assistantName,
      providerKey,
      ...(nextEndpointUrl ? { endpointUrl: nextEndpointUrl } : {}),
      model: model || providerDefaultModel(provider),
      updatePolicy: "manual" as const,
      updateChannel: "stable" as const,
    };
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyAction) {
      return;
    }
    if (customProviderSelected && !endpointUrl.trim()) {
      setNotice("自定义服务地址为空。");
      return;
    }
    if (!props.api) {
      setApiKeyConfigured(Boolean(apiKey.trim()));
      setNotice("连接已保存。");
      return;
    }

    setBusyAction("save");
    setNotice("");
    try {
      const saved = await props.api.updateHermesRuntimeSettings({
        ...runtimePayload(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setAssistantName(saved.assistantName || assistantName || "Hermes");
      setProviderKey(saved.providerKey === "hermes" ? "openai-api" : saved.providerKey);
      setEndpointUrl(saved.endpointUrl ?? "");
      setModel(saved.model);
      setApiKey("");
      setApiKeyConfigured(saved.apiKeyConfigured);
      setNotice("连接已保存。");
    } catch {
      setNotice("保存失败。");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function testConnection() {
    if (busyAction) {
      return;
    }
    if (customProviderSelected && !endpointUrl.trim()) {
      setNotice("自定义服务地址为空。");
      return;
    }
    if (!props.api) {
      setNotice("当前无法连接。");
      return;
    }

    setBusyAction("test");
    setNotice("");
    try {
      const typedApiKey = apiKey.trim();
      const result = typedApiKey
        ? await props.api.probeHermesProvider({
            providerKey,
            ...(customProviderSelected ? { endpointUrl: endpointUrl.trim() } : {}),
            model: model || providerDefaultModel(selectedProvider),
            apiKey: typedApiKey,
          })
        : await props.api.testHermesRuntimeConnection();

      if (result.ok) {
        setNotice("连接成功。");
        return;
      }
      if ("status" in result && result.status === "missing_configuration") {
        setNotice(`缺少：${formatHermesMissingFields(result.missing)}`);
        return;
      }
      setNotice("连接失败。");
    } catch {
      setNotice("连接失败。");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function clearApiKey() {
    if (busyAction) {
      return;
    }
    if (!props.api) {
      setApiKey("");
      setApiKeyConfigured(false);
      setNotice("访问密钥已清除。");
      return;
    }

    setBusyAction("clear-key");
    setNotice("");
    try {
      const saved = await props.api.clearHermesRuntimeApiKey(runtimePayload());
      setApiKey("");
      setApiKeyConfigured(saved.apiKeyConfigured);
      setNotice("访问密钥已清除。");
    } catch {
      setNotice("清除失败。");
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <section className="settings-panel hermes-connect-panel" aria-label="Hermes 配置">
      <header className="settings-panel-head">
        <div>
          <h2>{assistantName || "Hermes"}</h2>
        </div>
      </header>

      <form className="settings-form hermes-connect-form" onSubmit={saveSettings}>
        <article className="settings-module hermes-connect-card">
          <label>
            <span>助手名称</span>
            <input
              aria-label="助手名称"
              value={assistantName}
              disabled={isRuntimeBusy}
              maxLength={40}
              onChange={(event) => setAssistantName(event.target.value)}
              placeholder="Hermes"
            />
          </label>
          <label>
            <span>服务商</span>
            <select
              aria-label="服务商"
              value={providerKey}
              disabled={isRuntimeBusy}
              onChange={(event) => applyProviderSelection(event.target.value)}
            >
              {providerOptions.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          {customProviderSelected ? (
            <label>
              <span>自定义服务地址</span>
              <input
                aria-label="自定义服务地址"
                value={endpointUrl}
                disabled={isRuntimeBusy}
                onChange={(event) => setEndpointUrl(event.target.value)}
                placeholder="https://api.example.com/v1/chat/completions"
              />
            </label>
          ) : null}
          <label>
            <span>访问密钥</span>
            <input
              aria-label="访问密钥"
              value={apiKey}
              disabled={isRuntimeBusy}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={apiKeyConfigured ? "已保存" : "输入访问密钥"}
              type="password"
            />
          </label>
        </article>

        <div className="inline-actions hermes-connect-actions">
          <button className="primary-button" type="submit" disabled={isRuntimeBusy}>
            保存
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={isRuntimeBusy}
            onClick={() => void testConnection()}
          >
            检查连接
          </button>
          {apiKeyConfigured ? (
            <button
              className="ghost-button"
              type="button"
              disabled={isRuntimeBusy}
              onClick={() => void clearApiKey()}
            >
              清除密钥
            </button>
          ) : null}
        </div>
      </form>

      <div className="backend-notice" role="status">
        {notice}
      </div>
    </section>
  );
}
