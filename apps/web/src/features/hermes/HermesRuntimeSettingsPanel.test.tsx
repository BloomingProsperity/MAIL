import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EmailHubApi,
  HermesRuntimeSettingsDto,
} from "../../lib/emailHubApi";
import { HermesRuntimeSettingsPanel } from "./HermesRuntimeSettingsPanel";

const childPanelCalls = vi.hoisted(() => ({
  audit: vi.fn(),
  memory: vi.fn(),
  rules: vi.fn(),
}));

vi.mock("./HermesLearningPanels", () => ({
  formatHermesMemoryLayer: (layer: string) => layer,
  HermesAuditLogPanel: (props: { accountId?: string }) => {
    childPanelCalls.audit(props);
    return (
      <div aria-label="mock Hermes audit panel">
        audit:{props.accountId ?? "none"}
      </div>
    );
  },
  HermesMemoryManagerPanel: (props: { accountId?: string }) => {
    childPanelCalls.memory(props);
    return (
      <div aria-label="mock Hermes memory panel">
        memory:{props.accountId ?? "none"}
      </div>
    );
  },
}));

vi.mock("./HermesRuleManagerPanel", () => ({
  HermesRuleManagerPanel: (props: { accountId?: string }) => {
    childPanelCalls.rules(props);
    return (
      <div aria-label="mock Hermes rules panel">
        rules:{props.accountId ?? "none"}
      </div>
    );
  },
}));

vi.mock("./HermesSkillSettingsPanel", () => ({
  HermesSkillSettingsPanel: () => (
    <div aria-label="mock Hermes skill settings" />
  ),
}));

describe("HermesRuntimeSettingsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    childPanelCalls.audit.mockClear();
    childPanelCalls.memory.mockClear();
    childPanelCalls.rules.mockClear();
  });

  it("keeps Hermes deployment fields in admin details by default", async () => {
    const api = createRuntimeApiFixture();
    vi.mocked(api.getHermesRuntimeSettings).mockResolvedValueOnce(
      runtimeSettingsFixture({
        apiKeyConfigured: false,
        endpointUrl: "http://hermes:4000/v1/chat/completions",
      }),
    );

    render(<HermesRuntimeSettingsPanel api={api} accountId="account_1" />);

    await screen.findByText("Hermes 访问密钥未配置。");
    expect(screen.getByText(/状态：待配置/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Hermes 网关" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "网关地址" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "路由或模型" })).toBeNull();

    fireEvent.click(screen.getByText("管理员高级配置"));

    expect(screen.getByLabelText("Hermes 网关")).toBeTruthy();
    expect((screen.getByLabelText("网关地址") as HTMLInputElement).value).toBe(
      "http://hermes:4000/v1/chat/completions",
    );
    expect((screen.getByLabelText("路由或模型") as HTMLInputElement).value).toBe(
      "hermes-email",
    );
    expect(screen.queryByText("模型接口")).toBeNull();
    expect(screen.queryByText("服务地址")).toBeNull();
    expect(screen.queryByText("模型名称")).toBeNull();
  });

  it("routes the selected account scope to rules, memories, and audit logs", async () => {
    const api = createRuntimeApiFixture();

    render(<HermesRuntimeSettingsPanel api={api} accountId="account_1" />);

    const scopeSelect = await screen.findByRole("combobox", {
      name: "Select Hermes settings account",
    });
    expect((scopeSelect as HTMLSelectElement).value).toBe("account_1");

    await waitFor(() => {
      expect(childPanelCalls.rules).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_1" }),
      );
      expect(childPanelCalls.memory).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_1" }),
      );
      expect(childPanelCalls.audit).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_1" }),
      );
    });

    fireEvent.change(scopeSelect, { target: { value: "account_2" } });

    await waitFor(() => {
      expect(childPanelCalls.rules).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_2" }),
      );
      expect(childPanelCalls.memory).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_2" }),
      );
      expect(childPanelCalls.audit).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account_2" }),
      );
    });
    expect(screen.getByLabelText("mock Hermes rules panel").textContent).toBe(
      "rules:account_2",
    );
    expect(api.listSyncCenterAccounts).toHaveBeenCalledTimes(1);
  });

  it("locks runtime actions and fields while settings are saving", async () => {
    const api = createRuntimeApiFixture();
    const pendingSave = deferred<HermesRuntimeSettingsDto>();
    vi.mocked(api.updateHermesRuntimeSettings).mockReturnValueOnce(
      pendingSave.promise,
    );

    render(<HermesRuntimeSettingsPanel api={api} accountId="account_1" />);

    await screen.findByText("Hermes 已连接访问密钥。");
    fireEvent.click(screen.getByText("管理员高级配置"));
    const saveButton = screen.getByRole("button", {
      name: "保存配置",
    }) as HTMLButtonElement;
    const testButton = screen.getByRole("button", {
      name: "测试连接",
    }) as HTMLButtonElement;
    const clearButton = screen.getByRole("button", {
      name: "清除访问密钥",
    }) as HTMLButtonElement;
    const updateButton = screen.getByRole("button", {
      name: "检查更新",
    }) as HTMLButtonElement;

    fireEvent.click(saveButton);

    expect(await screen.findByText("正在保存 Hermes 配置...")).toBeTruthy();
    await waitFor(() => {
      expect(saveButton.disabled).toBe(true);
      expect(testButton.disabled).toBe(true);
      expect(clearButton.disabled).toBe(true);
      expect(updateButton.disabled).toBe(true);
    });
    expect(
      (
        screen.getByDisplayValue(
          "http://hermes.local/v1/chat/completions",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(saveButton);
    fireEvent.click(testButton);
    fireEvent.click(clearButton);
    fireEvent.click(updateButton);

    expect(api.updateHermesRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(api.testHermesRuntimeConnection).not.toHaveBeenCalled();
    expect(api.clearHermesRuntimeApiKey).not.toHaveBeenCalled();
    expect(api.checkHermesRuntimeUpdate).not.toHaveBeenCalled();

    pendingSave.resolve(
      runtimeSettingsFixture({
        model: "hermes-email-saved",
      }),
    );

    expect(await screen.findByText("Hermes 配置已保存。")).toBeTruthy();
    await waitFor(() => {
      expect(saveButton.disabled).toBe(false);
      expect(testButton.disabled).toBe(false);
      expect(clearButton.disabled).toBe(false);
      expect(updateButton.disabled).toBe(false);
    });
  });
});

function createRuntimeApiFixture(): EmailHubApi {
  return {
    getHermesProviders: vi.fn(async () => ({ providers: [] })),
    getHermesRuntimeSettings: vi.fn(async () => runtimeSettingsFixture()),
    updateHermesRuntimeSettings: vi.fn(async () => runtimeSettingsFixture()),
    testHermesRuntimeConnection: vi.fn(async () => ({
      ok: true,
      checkedAt: "2026-06-14T08:00:00.000Z",
      providerKey: "hermes",
      requestProtocol: "openai_chat_completions",
      endpointUrl: "http://hermes.local/v1/chat/completions",
      model: "hermes-email",
    })),
    clearHermesRuntimeApiKey: vi.fn(async () =>
      runtimeSettingsFixture({ apiKeyConfigured: false }),
    ),
    checkHermesRuntimeUpdate: vi.fn(async () => ({
      installedVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
      updatePolicy: "manual",
      updateChannel: "stable",
      lastCheckedAt: "2026-06-14T08:05:00.000Z",
    })),
    listSyncCenterAccounts: vi.fn(async () => ({
      items: [
        {
          accountId: "account_1",
          email: "work@example.com",
          provider: "gmail",
          displayName: "Work Gmail",
          syncState: "running",
        },
        {
          accountId: "account_2",
          email: "me@example.com",
          provider: "outlook",
          displayName: "Personal Outlook",
          syncState: "running",
        },
      ],
    })),
  } as unknown as EmailHubApi;
}

function runtimeSettingsFixture(
  overrides: Partial<HermesRuntimeSettingsDto> = {},
): HermesRuntimeSettingsDto {
  return {
    enabled: true,
    mode: "external_hermes",
    providerKey: "hermes",
    endpointUrl: "http://hermes.local/v1/chat/completions",
    model: "hermes-email",
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error?: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
