import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EmailHubApi,
  HermesRuntimeSettingsDto,
} from "../../lib/emailHubApi";
import { HermesRuntimeSettingsPanel } from "./HermesRuntimeSettingsPanel";

const runtimeStyles = readFileSync(
  join(process.cwd(), "src", "features", "hermes", "HermesRuntimeSettingsPanel.css"),
  "utf8",
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = runtimeStyles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match?.[1] ?? "";
}

describe("HermesRuntimeSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows only the ordinary Hermes connection controls", async () => {
    const api = createRuntimeApiFixture();
    vi.mocked(api.getHermesRuntimeSettings).mockResolvedValueOnce(
      runtimeSettingsFixture({
        assistantName: "小邮",
        providerKey: "openai-api",
        apiKeyConfigured: false,
      }),
    );

    render(<HermesRuntimeSettingsPanel api={api} />);

    expect(await screen.findByDisplayValue("小邮")).toBeTruthy();
    expect(screen.getByLabelText("服务商")).toBeTruthy();
    expect(screen.getByLabelText("访问密钥")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "检查连接" })).toBeTruthy();
    expect(screen.queryByText(/AI 连接|API Key|LLM 服务商/)).toBeNull();

    expect(screen.queryByText("能力选项")).toBeNull();
    expect(screen.queryByText("规则")).toBeNull();
    expect(screen.queryByText("学习记录")).toBeNull();
    expect(screen.queryByText("检查更新")).toBeNull();
    expect(screen.queryByLabelText("模型名称")).toBeNull();
    expect(screen.queryByLabelText("服务地址")).toBeNull();
  });

  it("requires a successful provider check before saving the runtime settings", async () => {
    const api = createRuntimeApiFixture();

    render(<HermesRuntimeSettingsPanel api={api} />);

    await screen.findByText("连接已保存。");
    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "Mail Copilot" },
    });
    fireEvent.change(screen.getByLabelText("服务商"), {
      target: { value: "nvidia" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "runtime-secret" },
    });

    const saveButton = screen.getByRole("button", { name: "保存" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(api.updateHermesRuntimeSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
    await screen.findByText("连接成功。");
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(api.updateHermesRuntimeSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          mode: "external_hermes",
          assistantName: "Mail Copilot",
          providerKey: "nvidia",
          endpointUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
          model: "nvidia/llama-3.3-nemotron-super-49b-v1",
          apiKey: "runtime-secret",
          updatePolicy: "manual",
          updateChannel: "stable",
        }),
      );
    });
  });

  it("does not unlock saving when the provider check fails", async () => {
    const api = createRuntimeApiFixture();
    vi.mocked(api.probeHermesProvider).mockResolvedValueOnce({
      ok: false,
      status: "connection_failed",
      providerKey: "deepseek",
      label: "DeepSeek",
      category: "cloud",
      authType: "api_key",
      endpointUrl: "https://api.deepseek.com/v1/chat/completions",
      model: "deepseek-chat",
      missing: [],
      checkedAt: "2026-06-14T08:00:00.000Z",
    });

    render(<HermesRuntimeSettingsPanel api={api} />);

    await screen.findByText("连接已保存。");
    fireEvent.change(screen.getByLabelText("服务商"), {
      target: { value: "deepseek" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "bad-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));

    await screen.findByText("连接失败。");
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.updateHermesRuntimeSettings).not.toHaveBeenCalled();
  });

  it("tests unsaved provider input through the provider probe without leaking the key", async () => {
    const api = createRuntimeApiFixture();

    render(<HermesRuntimeSettingsPanel api={api} />);

    await screen.findByText("连接已保存。");
    fireEvent.change(screen.getByLabelText("服务商"), {
      target: { value: "deepseek" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "probe-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));

    await screen.findByText("连接成功。");
    expect(api.probeHermesProvider).toHaveBeenCalledWith({
      providerKey: "deepseek",
      model: "deepseek-chat",
      apiKey: "probe-secret",
    });
    expect(screen.queryByText("probe-secret")).toBeNull();
  });

  it("only asks for a service address when a custom provider is selected", async () => {
    const api = createRuntimeApiFixture();

    render(<HermesRuntimeSettingsPanel api={api} />);

    await screen.findByText("连接已保存。");
    expect(screen.queryByLabelText("自定义服务地址")).toBeNull();

    fireEvent.change(screen.getByLabelText("服务商"), {
      target: { value: "custom" },
    });
    expect(screen.getByLabelText("自定义服务地址")).toBeTruthy();
  });

  it("keeps the Hermes settings panel full-width", () => {
    expect(ruleBody(".hermes-connect-panel")).toContain("width: 100%");
    expect(ruleBody(".hermes-connect-panel")).not.toContain("max-width: 760px");
  });
});

function createRuntimeApiFixture(): EmailHubApi {
  return {
    getHermesProviders: vi.fn(async () => ({
      providers: [
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
      ],
    })),
    getHermesRuntimeSettings: vi.fn(async () => runtimeSettingsFixture()),
    updateHermesRuntimeSettings: vi.fn(async (input) =>
      runtimeSettingsFixture({
        assistantName: input.assistantName,
        providerKey: input.providerKey,
        endpointUrl: input.endpointUrl,
        model: input.model,
        apiKeyConfigured: Boolean(input.apiKey),
      }),
    ),
    testHermesRuntimeConnection: vi.fn(async () => ({
      ok: true,
      checkedAt: "2026-06-14T08:00:00.000Z",
      providerKey: "openai-api",
      requestProtocol: "openai_chat_completions",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5.2",
    })),
    probeHermesProvider: vi.fn(async () => ({
      ok: true,
      status: "ready",
      providerKey: "deepseek",
      label: "DeepSeek",
      category: "cloud",
      authType: "api_key",
      endpointUrl: "https://api.deepseek.com/v1/chat/completions",
      model: "deepseek-chat",
      missing: [],
      checkedAt: "2026-06-14T08:00:00.000Z",
    })),
    clearHermesRuntimeApiKey: vi.fn(async () =>
      runtimeSettingsFixture({ apiKeyConfigured: false }),
    ),
  } as unknown as EmailHubApi;
}

function runtimeSettingsFixture(
  overrides: Partial<HermesRuntimeSettingsDto> = {},
): HermesRuntimeSettingsDto {
  return {
    enabled: true,
    mode: "external_hermes",
    assistantName: "Hermes",
    providerKey: "openai-api",
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5.2",
    apiKeyConfigured: true,
    updatePolicy: "manual",
    updateChannel: "stable",
    installedVersion: "0.1.0",
    latestVersion: "0.1.0",
    updateAvailable: false,
    source: "database",
    updatedAt: "2026-06-14T08:00:00.000Z",
    ...overrides,
  };
}
