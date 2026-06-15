import { describe, expect, it, vi } from "vitest";

import {
  createHermesRuntimeConfigService,
  createHermesRuntimeTextProvider,
} from "../src/hermes/runtime-config";
import { createPostgresHermesRuntimeConfigStore } from "../src/hermes/postgres-runtime-config-store";

describe("Hermes runtime config service", () => {
  it("falls back to environment config until runtime settings are saved", async () => {
    const service = createHermesRuntimeConfigService({
      store: emptyStore(),
      env: {
        HERMES_CHAT_COMPLETIONS_URL:
          "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
        HERMES_API_KEY: "env-secret",
      },
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      enabled: true,
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      model: "hermes-email",
      apiKeyConfigured: true,
      source: "environment",
      providerKey: "custom",
    });
    await expect(service.getConnectionSettings()).resolves.toMatchObject({
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      model: "hermes-email",
      apiKey: "env-secret",
      providerKey: "custom",
    });
  });

  it("validates and saves runtime settings without exposing the API key", async () => {
    const calls: unknown[] = [];
    const service = createHermesRuntimeConfigService({
      store: {
        async getSettings() {
          return undefined;
        },
        async getConnectionSettings() {
          return undefined;
        },
        async saveSettings(input) {
          calls.push(input);
          return {
            enabled: input.enabled,
            mode: input.mode,
            providerKey: input.providerKey ?? "custom",
            endpointUrl: input.endpointUrl,
            model: input.model,
            apiKeyConfigured: Boolean(input.apiKey),
            apiKeyUpdatedAt: "2026-06-14T08:00:00.000Z",
            updatePolicy: input.updatePolicy,
            updateChannel: input.updateChannel,
            installedVersion: "0.1.0",
            latestVersion: "0.1.0",
            updateAvailable: false,
            source: "database",
            updatedAt: "2026-06-14T08:00:00.000Z",
          };
        },
        async saveVersionStatus() {
          throw new Error("not used");
        },
      },
    });

    const result = await service.updateSettings({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "ollama",
      endpointUrl: " http://localhost:11434/v1/chat/completions ",
      model: " hermes-2-pro ",
      apiKey: "local-secret",
      updatePolicy: "notify",
      updateChannel: "stable",
    });

    expect(result).toMatchObject({
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-2-pro",
      apiKeyConfigured: true,
      updatePolicy: "notify",
    });
    expect(JSON.stringify(result)).not.toContain("local-secret");
    expect(calls).toEqual([
      {
        enabled: true,
        mode: "openai_compatible",
        providerKey: "ollama",
        endpointUrl: "http://localhost:11434/v1/chat/completions",
        model: "hermes-2-pro",
        apiKey: "local-secret",
        updatePolicy: "notify",
        updateChannel: "stable",
      },
    ]);

    await expect(
      service.updateSettings({
        enabled: true,
        mode: "openai_compatible",
        endpointUrl: "not-a-url",
        model: "hermes",
        updatePolicy: "manual",
        updateChannel: "stable",
      }),
    ).rejects.toMatchObject({ code: "invalid_hermes_runtime_config_request" });
  });

  it("canonicalizes known provider aliases but keeps unknown custom providers", async () => {
    const calls: unknown[] = [];
    const service = createHermesRuntimeConfigService({
      store: {
        async getSettings() {
          return undefined;
        },
        async getConnectionSettings() {
          return undefined;
        },
        async saveSettings(input) {
          calls.push(input);
          return {
            enabled: input.enabled,
            mode: input.mode,
            providerKey: input.providerKey ?? "custom",
            endpointUrl: input.endpointUrl,
            model: input.model,
            apiKeyConfigured: false,
            updatePolicy: input.updatePolicy,
            updateChannel: input.updateChannel,
            updateAvailable: false,
            source: "database",
          };
        },
        async saveVersionStatus() {
          throw new Error("not used");
        },
      },
    });

    await service.updateSettings({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "kimi-cn",
      endpointUrl: "http://localhost:8080/v1/chat/completions",
      model: "kimi-k2.5",
      updatePolicy: "manual",
      updateChannel: "stable",
    });
    await service.updateSettings({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "my-lab-proxy",
      endpointUrl: "http://localhost:8090/v1/chat/completions",
      model: "mail-model",
      updatePolicy: "manual",
      updateChannel: "stable",
    });

    expect(calls).toEqual([
      expect.objectContaining({ providerKey: "kimi-coding-cn" }),
      expect.objectContaining({ providerKey: "my-lab-proxy" }),
    ]);
  });

  it("fills known provider default endpoints when saving runtime settings", async () => {
    const calls: unknown[] = [];
    const service = createHermesRuntimeConfigService({
      store: {
        async getSettings() {
          return undefined;
        },
        async getConnectionSettings() {
          return undefined;
        },
        async saveSettings(input) {
          calls.push(input);
          return {
            enabled: input.enabled,
            mode: input.mode,
            providerKey: input.providerKey ?? "custom",
            endpointUrl: input.endpointUrl,
            model: input.model,
            apiKeyConfigured: Boolean(input.apiKey),
            updatePolicy: input.updatePolicy,
            updateChannel: input.updateChannel,
            updateAvailable: false,
            source: "database",
          };
        },
        async saveVersionStatus() {
          throw new Error("not used");
        },
      },
    });

    await expect(
      service.updateSettings({
        enabled: true,
        mode: "openai_compatible",
        providerKey: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "anthropic-secret",
        updatePolicy: "manual",
        updateChannel: "stable",
      }),
    ).resolves.toMatchObject({
      endpointUrl: "https://api.anthropic.com/v1/messages",
    });
    await expect(
      service.updateSettings({
        enabled: true,
        mode: "openai_compatible",
        providerKey: "gemini",
        model: "gemini-3-pro",
        apiKey: "gemini-secret",
        updatePolicy: "manual",
        updateChannel: "stable",
      }),
    ).resolves.toMatchObject({
      endpointUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        providerKey: "anthropic",
        endpointUrl: "https://api.anthropic.com/v1/messages",
      }),
      expect.objectContaining({
        providerKey: "gemini",
        endpointUrl:
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent",
      }),
    ]);
  });

  it("canonicalizes known provider aliases from environment settings", async () => {
    const service = createHermesRuntimeConfigService({
      store: emptyStore(),
      env: {
        HERMES_CHAT_COMPLETIONS_URL:
          "http://hermes:8081/v1/chat/completions",
        HERMES_PROVIDER: "QWEN",
        HERMES_MODEL: "qwen3.5-plus",
      },
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      providerKey: "alibaba",
      source: "environment",
    });
    await expect(service.getConnectionSettings()).resolves.toMatchObject({
      providerKey: "alibaba",
    });
  });

  it("tests the current runtime provider with a minimal prompt", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );
    const service = createHermesRuntimeConfigService({
      store: {
        async getSettings() {
          return {
            enabled: true,
            mode: "external_hermes",
            providerKey: "hermes",
            endpointUrl: "http://hermes:8081/v1/chat/completions",
            model: "hermes-email",
            apiKeyConfigured: true,
            updatePolicy: "manual",
            updateChannel: "stable",
            updateAvailable: false,
            source: "database",
          };
        },
        async getConnectionSettings() {
          return {
            enabled: true,
            providerKey: "hermes",
            endpointUrl: "http://hermes:8081/v1/chat/completions",
            model: "hermes-email",
            apiKey: "runtime-secret",
          };
        },
        async saveSettings() {
          throw new Error("not used");
        },
        async saveVersionStatus() {
          throw new Error("not used");
        },
      },
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-06-14T08:00:00.000Z"),
    });

    await expect(service.testConnection()).resolves.toEqual({
      ok: true,
      checkedAt: "2026-06-14T08:00:00.000Z",
      providerKey: "hermes",
      requestProtocol: "openai_chat_completions",
      endpointUrl: "http://hermes:8081/v1/chat/completions",
      model: "hermes-email",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://hermes:8081/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer runtime-secret",
        }),
      }),
    );
  });

  it("lets Hermes skills use updated runtime settings without server restart", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.parse(String(init?.body)).model,
            },
          },
        ],
      }),
    );
    const settings = [
      {
        enabled: true,
        providerKey: "custom",
        endpointUrl: "http://hermes-a/v1/chat/completions",
        model: "hermes-a",
        apiKey: "a-secret",
      },
      {
        enabled: true,
        providerKey: "custom",
        endpointUrl: "http://hermes-b/v1/chat/completions",
        model: "hermes-b",
        apiKey: "b-secret",
      },
    ];
    const provider = createHermesRuntimeTextProvider({
      runtimeConfigService: {
        async getConnectionSettings() {
          return settings.shift();
        },
      },
      fetchImpl: fetchImpl as any,
    });

    await expect(
      provider.complete({ systemPrompt: "system", userPrompt: "hello" }),
    ).resolves.toBe("hermes-a");
    await expect(
      provider.complete({ systemPrompt: "system", userPrompt: "hello" }),
    ).resolves.toBe("hermes-b");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://hermes-a/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer a-secret" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://hermes-b/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer b-secret" }),
      }),
    );
  });

  it("passes the selected provider key into Hermes skill model calls", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        content: [{ type: "text", text: "anthropic runtime ok" }],
      }),
    );
    const provider = createHermesRuntimeTextProvider({
      runtimeConfigService: {
        async getConnectionSettings() {
          return {
            enabled: true,
            providerKey: "anthropic",
            endpointUrl: "https://api.anthropic.com/v1/messages",
            model: "claude-sonnet-4-6",
            apiKey: "anthropic-secret",
          };
        },
      },
      fetchImpl: fetchImpl as any,
    });

    await expect(
      provider.complete({
        systemPrompt: "You are Hermes.",
        userPrompt: "Draft a reply.",
      }),
    ).resolves.toBe("anthropic runtime ok");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "anthropic-secret",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });
});

describe("Postgres Hermes runtime config store", () => {
  it("writes API keys to stored_secrets and only returns masked public settings", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO stored_secrets")) {
          return { rows: [] };
        }
        if (text.includes("INSERT INTO hermes_runtime_settings")) {
          return {
            rows: [
              {
                enabled: true,
                mode: "openai_compatible",
                provider_key: "ollama",
                endpoint_url: "http://localhost:11434/v1/chat/completions",
                model: "hermes-email",
                api_key_secret_ref: "hermes/default/api-key",
                api_key_updated_at: "2026-06-14T08:00:00.000Z",
                update_policy: "notify",
                update_channel: "stable",
                installed_version: "0.1.0",
                latest_version: "0.1.0",
                last_checked_at: null,
                updated_at: "2026-06-14T08:00:00.000Z",
              },
            ],
          };
        }
        if (text.includes("FROM hermes_runtime_settings")) {
          return {
            rows: [
              {
                enabled: true,
                mode: "openai_compatible",
                provider_key: "ollama",
                endpoint_url: "http://localhost:11434/v1/chat/completions",
                model: "hermes-email",
                api_key_secret_ref: "hermes/default/api-key",
                api_key_updated_at: "2026-06-14T08:00:00.000Z",
                update_policy: "notify",
                update_channel: "stable",
                installed_version: "0.1.0",
                latest_version: "0.1.0",
                last_checked_at: null,
                updated_at: "2026-06-14T08:00:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesRuntimeConfigStore(client);

    const saved = await store.saveSettings({
      enabled: true,
      mode: "openai_compatible",
      providerKey: "ollama",
      endpointUrl: "http://localhost:11434/v1/chat/completions",
      model: "hermes-email",
      apiKey: "runtime-secret",
      updatePolicy: "notify",
      updateChannel: "stable",
    });
    const publicSettings = await store.getSettings();

    expect(saved.apiKeyConfigured).toBe(true);
    expect(publicSettings?.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(publicSettings)).not.toContain("runtime-secret");
    expect(queries[0].text).toMatch(/INSERT INTO stored_secrets/i);
    expect(queries[0].values).toEqual([
      "hermes/default/api-key",
      "runtime-secret",
    ]);
    expect(queries[2].text).not.toMatch(/secret_value/i);
  });
});

function emptyStore() {
  return {
    async getSettings() {
      return undefined;
    },
    async getConnectionSettings() {
      return undefined;
    },
    async saveSettings() {
      throw new Error("not used");
    },
    async saveVersionStatus() {
      throw new Error("not used");
    },
  };
}
