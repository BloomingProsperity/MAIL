import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  EmailHubApi,
  HermesProviderCatalogItem,
  HermesProviderProbeMissing,
  HermesRuleDto,
  HermesRuntimeMode,
  HermesRuntimeUpdateChannel,
  HermesRuntimeUpdatePolicy,
  HermesRuntimeVersionStatus,
} from "../../lib/emailHubApi";
import {
  HermesAuditLogPanel,
  HermesMemoryManagerPanel,
  formatHermesMemoryLayer,
} from "./HermesLearningPanels";
import { HermesRuleManagerPanel } from "./HermesRuleManagerPanel";
import { HermesSkillSettingsPanel } from "./HermesSkillSettingsPanel";

const fallbackHermesProviders: HermesProviderCatalogItem[] = [
  {
    key: "hermes",
    label: "Hermes 服务",
    category: "gateway",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: [],
    modelExamples: ["hermes-email"],
    capabilities: ["chat", "email_skills", "memory"],
  },
  {
    key: "custom",
    label: "自定义 Hermes 网关",
    category: "custom",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["hermes-gateway"],
    modelExamples: ["hermes-email"],
    capabilities: ["chat", "email_skills", "memory"],
  },
];

function isHermesProviderRuntimeSelectable(
  provider: HermesProviderCatalogItem,
): boolean {
  return (
    isHermesRuntimeGatewayProvider(provider) &&
    provider.requestProtocol !== "external_oauth" &&
    provider.requestProtocol !== "aws_bedrock" &&
    provider.authType !== "oauth" &&
    provider.authType !== "aws_credentials"
  );
}

function isHermesRuntimeGatewayProvider(
  provider: HermesProviderCatalogItem,
): boolean {
  return provider.key === "hermes" || provider.key === "custom";
}

function formatHermesMissingFields(fields: HermesProviderProbeMissing[]): string {
  const labels: Record<HermesProviderProbeMissing, string> = {
    endpoint_url: "服务地址",
    model: "模型名称",
    api_key: "访问密钥",
    oauth_session: "外部登录",
    aws_credentials: "云服务凭证",
  };
  return fields.map((field) => labels[field]).join("、");
}

export function HermesRuntimeSettingsPanel(props: {
  api?: EmailHubApi;
  accountId?: string;
  focusedSkillId?: string;
  focusRequestId?: number;
  onHermesRuleApproved?: (rule: HermesRuleDto) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<HermesRuntimeMode>("external_hermes");
  const [providerKey, setProviderKey] = useState("hermes");
  const [endpointUrl, setEndpointUrl] = useState(
    "http://localhost:11434/v1/chat/completions",
  );
  const [model, setModel] = useState("hermes-email");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [updatePolicy, setUpdatePolicy] =
    useState<HermesRuntimeUpdatePolicy>("manual");
  const [updateChannel, setUpdateChannel] =
    useState<HermesRuntimeUpdateChannel>("stable");
  const [version, setVersion] = useState<HermesRuntimeVersionStatus>();
  const [hermesProviders, setHermesProviders] = useState<
    HermesProviderCatalogItem[]
  >(fallbackHermesProviders);
  const [auditMemoryFocus, setAuditMemoryFocus] = useState<
    { memoryId: string; label: string } | undefined
  >();
  const [notice, setNotice] = useState("正在读取 Hermes 配置...");
  const providerOptions = useMemo<HermesProviderCatalogItem[]>(() => {
    const runtimeProviders = hermesProviders.filter(isHermesRuntimeGatewayProvider);
    if (runtimeProviders.some((provider) => provider.key === providerKey)) {
      return runtimeProviders;
    }

    return [
      ...runtimeProviders,
      {
        key: providerKey,
        label: providerKey,
        category: "custom" as const,
        authType: "api_key_optional" as const,
        requestProtocol: "openai_chat_completions" as const,
        endpointEditable: true,
        aliases: [],
        modelExamples: [model],
        capabilities: ["chat", "email_skills"],
      },
    ];
  }, [hermesProviders, model, providerKey]);
  const selectedProvider = useMemo(
    () => providerOptions.find((provider) => provider.key === providerKey),
    [providerKey, providerOptions],
  );

  function applyProviderSelection(nextProviderKey: string) {
    const provider = providerOptions.find((item) => item.key === nextProviderKey);

    if (provider && !isHermesProviderRuntimeSelectable(provider)) {
      setNotice("这个模型接口需要先完成外部配置，暂时不能直接选择。");
      return;
    }

    setProviderKey(nextProviderKey);
    if (!provider) {
      return;
    }

    if (provider.defaultEndpoint !== undefined) {
      setEndpointUrl(provider.defaultEndpoint);
    } else if (!provider.endpointEditable) {
      setEndpointUrl("");
    }

    if (provider.modelExamples[0]) {
      setModel(provider.modelExamples[0]);
    }
  }

  function currentRuntimePayload() {
    return {
      enabled,
      mode,
      providerKey,
      endpointUrl,
      model,
      updatePolicy,
      updateChannel,
    };
  }

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setNotice("本地预览配置，连接后会保存到后端。");
      return () => {
        alive = false;
      };
    }

    void props.api
      .getHermesProviders()
      .then((catalog) => {
        if (!alive) return;
        const runtimeProviders = catalog.providers.filter(
          isHermesRuntimeGatewayProvider,
        );
        if (runtimeProviders.length > 0) {
          setHermesProviders(runtimeProviders);
        }
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取 Hermes 模型接口目录，已使用本地兜底。");
      });

    void props.api
      .getHermesRuntimeSettings()
      .then((settings) => {
        if (!alive) return;
        setEnabled(settings.enabled);
        setMode("external_hermes");
        setProviderKey(
          settings.providerKey === "hermes" || settings.providerKey === "custom"
            ? settings.providerKey
            : "hermes",
        );
        setEndpointUrl(settings.endpointUrl ?? "");
        setModel(settings.model);
        setApiKeyConfigured(settings.apiKeyConfigured);
        setUpdatePolicy(settings.updatePolicy);
        setUpdateChannel(settings.updateChannel);
        setVersion({
          installedVersion: settings.installedVersion,
          latestVersion: settings.latestVersion,
          updateAvailable: settings.updateAvailable,
          updatePolicy: settings.updatePolicy,
          updateChannel: settings.updateChannel,
          lastCheckedAt: settings.lastCheckedAt,
        });
        setNotice(
          settings.providerKey !== "hermes" && settings.providerKey !== "custom"
            ? "Hermes 是唯一 AI 入口，已切回 Hermes 服务。"
            : settings.apiKeyConfigured
              ? "Hermes 已连接访问密钥。"
              : "Hermes 尚未填写访问密钥。",
        );
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取 Hermes 配置。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!props.api) {
      setApiKeyConfigured(Boolean(apiKey.trim()));
      setNotice("预览配置已更新。");
      return;
    }

    setNotice("正在保存 Hermes 配置...");
    try {
      const saved = await props.api.updateHermesRuntimeSettings({
        enabled,
        mode: "external_hermes",
        providerKey,
        endpointUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        updatePolicy,
        updateChannel,
      });
      setEnabled(saved.enabled);
      setMode(saved.mode);
      setProviderKey(saved.providerKey);
      setEndpointUrl(saved.endpointUrl ?? "");
      setModel(saved.model);
      setApiKey("");
      setApiKeyConfigured(saved.apiKeyConfigured);
      setVersion({
        installedVersion: saved.installedVersion,
        latestVersion: saved.latestVersion,
        updateAvailable: saved.updateAvailable,
        updatePolicy: saved.updatePolicy,
        updateChannel: saved.updateChannel,
        lastCheckedAt: saved.lastCheckedAt,
      });
      setNotice("Hermes 配置已保存。");
    } catch {
      setNotice("保存失败，请检查服务地址和模型名称。");
    }
  }

  async function testConnection() {
    if (!props.api) {
      setNotice("预览模式不会发起连接测试。");
      return;
    }

    setNotice("正在测试 Hermes 连接...");
    try {
      const typedApiKey = apiKey.trim();
      const result =
        typedApiKey || !apiKeyConfigured
          ? await props.api.probeHermesProvider({
              providerKey,
              endpointUrl,
              model,
              ...(typedApiKey ? { apiKey: typedApiKey } : {}),
            })
          : await props.api.testHermesRuntimeConnection();
      if (result.ok) {
        setNotice(`当前配置可用：${result.model ?? model}`);
        return;
      }
      if ("status" in result && result.status === "external_auth_required") {
        setNotice("这个模型接口需要先完成外部配置。");
        return;
      }
      if ("status" in result && result.status === "missing_configuration") {
        setNotice(`请补全：${formatHermesMissingFields(result.missing)}`);
        return;
      }
      setNotice("连接失败，请检查服务地址、模型和访问密钥。");
    } catch {
      setNotice("连接失败，请检查服务地址、模型和访问密钥。");
    }
  }

  async function clearApiKey() {
    if (!props.api) {
      setApiKey("");
      setApiKeyConfigured(false);
      setNotice("访问密钥已清除。");
      return;
    }

    setNotice("正在清除访问密钥...");
    try {
      const saved = await props.api.clearHermesRuntimeApiKey(
        currentRuntimePayload(),
      );
      setEnabled(saved.enabled);
      setMode(saved.mode);
      setProviderKey(saved.providerKey);
      setEndpointUrl(saved.endpointUrl ?? "");
      setModel(saved.model);
      setApiKey("");
      setApiKeyConfigured(saved.apiKeyConfigured);
      setUpdatePolicy(saved.updatePolicy);
      setUpdateChannel(saved.updateChannel);
      setNotice("访问密钥已清除。");
    } catch {
      setNotice("清除失败，请稍后再试。");
    }
  }

  async function checkUpdate() {
    if (!props.api) {
      setNotice("预览模式不会检查更新。");
      return;
    }

    setNotice("正在检查 Hermes 版本...");
    try {
      const result = await props.api.checkHermesRuntimeUpdate();
      setVersion(result);
      setNotice(result.updateAvailable ? "发现可用更新。" : "当前版本已是最新。");
    } catch {
      setNotice("暂时无法检查更新。");
    }
  }

  return (
    <section className="settings-panel" aria-label="Hermes 配置">
      <header className="settings-panel-head">
        <div>
          <h2>Hermes 配置</h2>
          <p>助手、写作习惯、版本和访问密钥集中管理；收件箱只保留底部快捷入口。</p>
        </div>
        <button className="ghost-button" type="button" onClick={checkUpdate}>
          检查更新
        </button>
      </header>

      <form className="settings-form" onSubmit={saveSettings}>
        <div className="settings-card-grid">
          <article className="settings-module">
            <label className="field-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>启用 Hermes</span>
            </label>
            <label>
              <span>连接方式</span>
              <select
                value="external_hermes"
                onChange={() => setMode("external_hermes")}
              >
                <option value="external_hermes">Hermes 服务</option>
              </select>
            </label>
            <label>
              <span>模型接口</span>
              <select
                value={providerKey}
                onChange={(event) => applyProviderSelection(event.target.value)}
              >
                {providerOptions.map((provider) => (
                  <option
                    key={provider.key}
                    value={provider.key}
                    disabled={!isHermesProviderRuntimeSelectable(provider)}
                  >
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>服务地址</span>
              <input
                value={endpointUrl}
                onChange={(event) => setEndpointUrl(event.target.value)}
                disabled={selectedProvider?.endpointEditable === false}
                placeholder="http://localhost:11434/v1/chat/completions"
              />
            </label>
          </article>

          <article className="settings-module">
            <label>
              <span>模型名称</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="hermes-email"
              />
            </label>
            <label>
              <span>访问密钥</span>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={apiKeyConfigured ? "已保存，留空则不修改" : "可留空"}
                type="password"
              />
            </label>
            <div className="inline-actions">
              <button className="primary-button" type="submit">
                保存配置
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={testConnection}
              >
                测试连接
              </button>
              {apiKeyConfigured ? (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void clearApiKey()}
                >
                  清除访问密钥
                </button>
              ) : null}
            </div>
          </article>
        </div>

        <div className="settings-card-grid">
          <article className="settings-module">
            <h3>版本策略</h3>
            <label>
              <span>提醒方式</span>
              <select
                value={updatePolicy}
                onChange={(event) =>
                  setUpdatePolicy(
                    event.target.value as HermesRuntimeUpdatePolicy,
                  )
                }
              >
                <option value="manual">手动确认</option>
                <option value="notify">有更新时提醒</option>
                <option value="auto_patch">仅小版本自动</option>
              </select>
            </label>
            <label>
              <span>更新通道</span>
              <select
                value={updateChannel}
                onChange={(event) =>
                  setUpdateChannel(
                    event.target.value as HermesRuntimeUpdateChannel,
                  )
                }
              >
                <option value="stable">稳定</option>
                <option value="preview">预览</option>
              </select>
            </label>
            <p>
              {version?.installedVersion
                ? `当前 ${version.installedVersion}`
                : "当前版本待检测"}
              {version?.latestVersion ? ` · 最新 ${version.latestVersion}` : ""}
            </p>
          </article>
          <article className="settings-module">
            <h3>学习边界</h3>
            <p>写回复、归档、星标、移动标签和你的修改会进入可查看的学习记录。</p>
            <p>写操作默认先预览，不会直接发送邮件。</p>
          </article>
        </div>
      </form>

      <div className="backend-notice" role="status">
        {notice}
      </div>

      <HermesSkillSettingsPanel
        api={props.api}
        focusedSkillId={props.focusedSkillId}
        focusRequestId={props.focusRequestId}
      />

      <HermesRuleManagerPanel
        api={props.api}
        accountId={props.accountId}
        onRuleApproved={props.onHermesRuleApproved}
      />
      <HermesMemoryManagerPanel
        api={props.api}
        accountId={props.accountId}
        onInspectMemoryUsage={(memory) =>
          setAuditMemoryFocus({
            memoryId: memory.id,
            label: `${formatHermesMemoryLayer(memory.layer)} · ${memory.scope}`,
          })
        }
      />
      <HermesAuditLogPanel
        api={props.api}
        accountId={props.accountId}
        focusedMemoryId={auditMemoryFocus?.memoryId}
        focusedMemoryLabel={auditMemoryFocus?.label}
        onClearFocusedMemory={() => setAuditMemoryFocus(undefined)}
      />
    </section>
  );
}
