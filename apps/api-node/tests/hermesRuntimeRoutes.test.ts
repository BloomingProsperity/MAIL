import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiHandler } from "../src/http/router";
import { createHermesProviderProbeService } from "../src/hermes/provider-probe";
import { createHermesRuntimeConfigService } from "../src/hermes/runtime-config";

let server: Server | undefined;

async function withApi(
  test: (baseUrl: string) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      ...overrides,
    } as any),
  );

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }

  await test(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("Hermes runtime routes", () => {
  it("returns the Hermes provider catalog without requiring runtime storage", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/providers`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.providers.map((provider: { key: string }) => provider.key)).toEqual(
        expect.arrayContaining([
          "hermes",
          "openai-api",
          "openrouter",
          "ollama",
          "vllm",
          "custom",
        ]),
      );
      expect(JSON.stringify(body)).not.toContain("runtime-secret");
      expect(
        body.providers.find((provider: { key: string }) => provider.key === "custom"),
      ).toMatchObject({
        endpointEditable: true,
        authType: "api_key_optional",
      });
    });
  });

  it("probes a Hermes provider through a backend-owned route", async () => {
    const calls: unknown[] = [];
    const operationalEvents: unknown[] = [];
    const hermesProviderProbeService = {
      async probe(input: unknown) {
        calls.push(input);
        return {
          ok: true,
          status: "ready",
          providerKey: "hermes",
          label: "Hermes 服务",
          category: "gateway",
          authType: "none",
          endpointUrl: "http://hermes:4000/v1/chat/completions",
          model: "hermes-email",
          missing: [],
          checkedAt: "2026-06-14T09:00:00.000Z",
        };
      },
    };
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_event_1",
          occurredAt: "2026-06-14T09:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/providers/hermes/probe`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_1",
            },
            body: JSON.stringify({
              model: "hermes-email",
              apiKey: "local-secret",
            }),
          },
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({
          ok: true,
          status: "ready",
          providerKey: "hermes",
        });
        expect(JSON.stringify(body)).not.toContain("local-secret");
        expect(calls).toEqual([
          {
            providerKey: "hermes",
            model: "hermes-email",
            apiKey: "local-secret",
          },
        ]);
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "info",
            event: "hermes_provider_probe_completed",
            requestId: "req_1",
            lane: "hermes",
            message: "Hermes provider probe ready for hermes",
            context: {
              providerKey: "hermes",
              status: "ready",
              ok: true,
              authType: "none",
              category: "gateway",
              endpointUrl: "http://hermes:4000/v1/chat/completions",
              model: "hermes-email",
              missing: [],
            },
          },
        ]);
        expect(JSON.stringify(operationalEvents)).not.toContain("local-secret");
      },
      { hermesProviderProbeService, operationalEventLogService },
    );
  });

  it("records failed Hermes runtime connection tests without leaking API keys", async () => {
    const operationalEvents: unknown[] = [];
    const hermesRuntimeConfigService = {
      async getSettings() {
        throw new Error("not used");
      },
      async updateSettings() {
        throw new Error("not used");
      },
      async testConnection() {
        throw new Error("Provider rejected runtime-secret");
      },
      async getVersionStatus() {
        throw new Error("not used");
      },
      async checkForUpdates() {
        throw new Error("not used");
      },
    };
    const operationalEventLogService = {
      async listEvents() {
        throw new Error("not used");
      },
      async recordEvent(input: unknown) {
        operationalEvents.push(input);
        return {
          id: "op_event_1",
          occurredAt: "2026-06-14T09:00:00.000Z",
          ...(input as Record<string, unknown>),
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/runtime/test`, {
          method: "POST",
          headers: {
            "x-request-id": "req_runtime_test",
          },
        });
        const bodyText = await response.text();

        expect(response.status).toBe(400);
        expect(JSON.parse(bodyText)).toEqual({
          error: "hermes_runtime_connection_test_failed",
        });
        expect(operationalEvents).toEqual([
          {
            service: "email-hub-api",
            level: "error",
            event: "hermes_runtime_connection_test_failed",
            requestId: "req_runtime_test",
            lane: "hermes",
            message: "Hermes runtime connection test failed",
            context: {
              action: "test_runtime_connection",
              error: {
                name: "Error",
                message: "Hermes runtime connection test failed",
              },
            },
          },
        ]);
        expect(bodyText).not.toContain("runtime-secret");
        expect(JSON.stringify(operationalEvents)).not.toContain("runtime-secret");
      },
      { hermesRuntimeConfigService, operationalEventLogService },
    );
  });

  it("rejects malformed Hermes provider probe bodies", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/hermes/providers/openai/probe`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: 42 }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_hermes_provider_probe_request",
      });
    });
  });

  it("rejects private Hermes provider probe endpoints before network calls", async () => {
    const fetchImpl = vi.fn();
    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/providers/custom/probe`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              endpointUrl: "http://169.254.169.254/latest/meta-data",
              model: "mail-llm",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_provider_probe_request",
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      },
      {
        hermesProviderProbeService: createHermesProviderProbeService({
          fetchImpl: fetchImpl as any,
        }),
      },
    );
  });

  it("loads and saves Hermes runtime settings without returning API keys", async () => {
    const calls: unknown[] = [];
    const hermesRuntimeConfigService = {
      async getSettings() {
        return {
          enabled: true,
          mode: "external_hermes",
          providerKey: "hermes",
          endpointUrl: "http://hermes:4000/v1/chat/completions",
          model: "hermes-email",
          apiKeyConfigured: true,
          updatePolicy: "manual",
          updateChannel: "stable",
          installedVersion: "0.1.0",
          latestVersion: "0.1.0",
          updateAvailable: false,
          source: "database",
          updatedAt: "2026-06-14T08:00:00.000Z",
        };
      },
      async updateSettings(input: unknown) {
        calls.push(input);
        return {
          enabled: true,
          mode: "external_hermes",
          providerKey: "custom",
          endpointUrl: "https://gateway.example.test/v1/chat/completions",
          model: "hermes-2-pro",
          apiKeyConfigured: true,
          updatePolicy: "notify",
          updateChannel: "stable",
          installedVersion: "0.1.0",
          latestVersion: "0.1.0",
          updateAvailable: false,
          source: "database",
          updatedAt: "2026-06-14T08:05:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const current = await fetch(`${baseUrl}/api/hermes/runtime`);
        const saved = await fetch(`${baseUrl}/api/hermes/runtime`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            mode: "external_hermes",
            providerKey: "custom",
            endpointUrl: "https://gateway.example.test/v1/chat/completions",
            model: "hermes-2-pro",
            apiKey: "runtime-secret",
            updatePolicy: "notify",
            updateChannel: "stable",
          }),
        });

        expect(current.status).toBe(200);
        expect(JSON.stringify(await current.json())).not.toContain(
          "runtime-secret",
        );
        expect(saved.status).toBe(200);
        const savedBody = await saved.json();
        expect(savedBody).toMatchObject({
          endpointUrl: "https://gateway.example.test/v1/chat/completions",
          model: "hermes-2-pro",
          apiKeyConfigured: true,
        });
        expect(JSON.stringify(savedBody)).not.toContain("runtime-secret");
        expect(calls).toEqual([
          {
            enabled: true,
            mode: "external_hermes",
            providerKey: "custom",
            endpointUrl: "https://gateway.example.test/v1/chat/completions",
            model: "hermes-2-pro",
            apiKey: "runtime-secret",
            updatePolicy: "notify",
            updateChannel: "stable",
          },
        ]);
      },
      { hermesRuntimeConfigService },
    );
  });

  it("rejects private Hermes runtime endpoints before saving settings", async () => {
    const savedInputs: unknown[] = [];
    const hermesRuntimeConfigService = createHermesRuntimeConfigService({
      store: {
        async getSettings() {
          return undefined;
        },
        async getConnectionSettings() {
          return undefined;
        },
        async saveSettings(input) {
          savedInputs.push(input);
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
            source: "database" as const,
          };
        },
        async saveVersionStatus() {
          throw new Error("not used");
        },
      },
    });

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/runtime`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            mode: "external_hermes",
            providerKey: "custom",
            endpointUrl: "http://postgres:5432/v1/chat/completions",
            model: "hermes-email",
            updatePolicy: "manual",
            updateChannel: "stable",
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_runtime_config_request",
        });
        expect(savedInputs).toEqual([]);
      },
      { hermesRuntimeConfigService },
    );
  });

  it("tests Hermes connectivity and exposes version status separately", async () => {
    const calls: string[] = [];
    const operationalEvents: unknown[] = [];
    const hermesRuntimeConfigService = {
      async getSettings() {
        throw new Error("not used");
      },
      async updateSettings() {
        throw new Error("not used");
      },
      async testConnection() {
        calls.push("test");
        return {
          ok: true,
          checkedAt: "2026-06-14T08:00:00.000Z",
          providerKey: "openai-responses",
          requestProtocol: "openai_responses",
          endpointUrl: "http://hermes:4000/v1/chat/completions",
          model: "hermes-email",
        };
      },
      async getVersionStatus() {
        calls.push("version");
        return {
          installedVersion: "0.1.0",
          latestVersion: "0.2.0",
          updateAvailable: true,
          updatePolicy: "manual",
          updateChannel: "stable",
          lastCheckedAt: "2026-06-14T08:00:00.000Z",
        };
      },
      async checkForUpdates() {
        calls.push("check");
        return {
          installedVersion: "0.1.0",
          latestVersion: "0.2.0",
          updateAvailable: true,
          updatePolicy: "manual",
          updateChannel: "stable",
          lastCheckedAt: "2026-06-14T08:05:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const testResponse = await fetch(`${baseUrl}/api/hermes/runtime/test`, {
          method: "POST",
        });
        const versionResponse = await fetch(
          `${baseUrl}/api/hermes/runtime/version`,
        );
        const checkResponse = await fetch(
          `${baseUrl}/api/hermes/runtime/update/check`,
          { method: "POST" },
        );

        expect(testResponse.status).toBe(200);
        expect(await testResponse.json()).toMatchObject({
          ok: true,
          providerKey: "openai-responses",
          requestProtocol: "openai_responses",
        });
        expect(versionResponse.status).toBe(200);
        expect(await versionResponse.json()).toMatchObject({
          updateAvailable: true,
        });
        expect(checkResponse.status).toBe(200);
        expect(await checkResponse.json()).toMatchObject({
          lastCheckedAt: "2026-06-14T08:05:00.000Z",
        });
        expect(calls).toEqual(["test", "version", "check"]);
        expect(operationalEvents).toEqual([
          expect.objectContaining({
            event: "hermes_runtime_connection_test_completed",
            context: expect.objectContaining({
              action: "test_runtime_connection",
              providerKey: "openai-responses",
              requestProtocol: "openai_responses",
              endpointUrl: "http://hermes:4000/v1/chat/completions",
              model: "hermes-email",
            }),
          }),
        ]);
      },
      {
        hermesRuntimeConfigService,
        operationalEventLogService: {
          async listEvents() {
            throw new Error("not used");
          },
          async recordEvent(input: unknown) {
            operationalEvents.push(input);
            return {
              id: "op_event_1",
              occurredAt: "2026-06-14T08:00:00.000Z",
              ...(input as Record<string, unknown>),
            };
          },
        },
      },
    );
  });

  it("returns 503 when Hermes runtime config storage is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/runtime`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_runtime_config_unavailable",
      });
    });
  });
});
