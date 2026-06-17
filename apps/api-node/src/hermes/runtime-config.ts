import { createHermesHttpTextProvider } from "./http-provider.js";
import {
  normalizeSafeHermesEndpointUrl,
  resolveHermesProviderEndpoint,
} from "./provider-endpoints.js";
import {
  findHermesProvider,
  type HermesProviderRequestProtocol,
} from "./provider-catalog.js";
import type { HermesTextProvider } from "./translation.js";

export type HermesRuntimeMode =
  | "builtin"
  | "external_hermes"
  | "openai_compatible";
export type HermesRuntimeUpdatePolicy = "manual" | "notify" | "auto_patch";
export type HermesRuntimeUpdateChannel = "stable" | "preview";
export type HermesRuntimeSettingsSource = "database" | "environment" | "default";

export interface HermesRuntimeSettingsDto {
  enabled: boolean;
  mode: HermesRuntimeMode;
  providerKey: string;
  endpointUrl?: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyUpdatedAt?: string;
  updatePolicy: HermesRuntimeUpdatePolicy;
  updateChannel: HermesRuntimeUpdateChannel;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  lastCheckedAt?: string;
  source: HermesRuntimeSettingsSource;
  updatedAt?: string;
}

export interface HermesRuntimeConnectionSettings {
  enabled: boolean;
  providerKey: string;
  endpointUrl: string;
  model: string;
  apiKey?: string;
}

export interface HermesRuntimeUpdateInput {
  enabled: boolean;
  mode: HermesRuntimeMode;
  providerKey?: string;
  endpointUrl?: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  updatePolicy: HermesRuntimeUpdatePolicy;
  updateChannel: HermesRuntimeUpdateChannel;
}

export interface HermesRuntimeVersionStatus {
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  updatePolicy: HermesRuntimeUpdatePolicy;
  updateChannel: HermesRuntimeUpdateChannel;
  lastCheckedAt?: string;
}

export interface HermesRuntimeTestResult {
  ok: boolean;
  checkedAt: string;
  providerKey: string;
  requestProtocol: HermesProviderRequestProtocol;
  endpointUrl: string;
  model: string;
}

export interface HermesRuntimeConfigStore {
  getSettings(): Promise<HermesRuntimeSettingsDto | undefined>;
  getConnectionSettings(): Promise<HermesRuntimeConnectionSettings | undefined>;
  saveSettings(
    input: HermesRuntimeUpdateInput,
  ): Promise<HermesRuntimeSettingsDto>;
  saveVersionStatus(input: {
    installedVersion?: string;
    latestVersion?: string;
    lastCheckedAt: string;
  }): Promise<HermesRuntimeSettingsDto>;
}

export interface HermesRuntimeConfigService {
  getSettings(): Promise<HermesRuntimeSettingsDto>;
  updateSettings(
    input: HermesRuntimeUpdateInput,
  ): Promise<HermesRuntimeSettingsDto>;
  getConnectionSettings(): Promise<HermesRuntimeConnectionSettings | undefined>;
  testConnection(): Promise<HermesRuntimeTestResult>;
  getVersionStatus(): Promise<HermesRuntimeVersionStatus>;
  checkForUpdates(): Promise<HermesRuntimeVersionStatus>;
}

export class InvalidHermesRuntimeConfigRequestError extends Error {
  readonly code = "invalid_hermes_runtime_config_request";

  constructor(message = "invalid Hermes runtime config request") {
    super(message);
  }
}

export class HermesRuntimeNotConfiguredError extends Error {
  readonly code = "hermes_runtime_not_configured";
  readonly statusCode = 503;

  constructor(message = "Hermes runtime is not configured") {
    super(message);
  }
}

export function createHermesRuntimeConfigService(options: {
  store: HermesRuntimeConfigStore;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  versionChecker?: (input: {
    installedVersion?: string;
    updateChannel: HermesRuntimeUpdateChannel;
  }) => Promise<{ latestVersion?: string }>;
}): HermesRuntimeConfigService {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());

  return {
    async getSettings() {
      const stored = await options.store.getSettings();
      return (
        (stored ? normalizePublicRuntimeSettings(stored) : undefined) ??
        envToPublicSettings(env) ??
        defaultSettings()
      );
    },

    async updateSettings(input) {
      return options.store.saveSettings(normalizeRuntimeUpdate(input));
    },

    async getConnectionSettings() {
      const stored = normalizeConnectionSettings(
        await options.store.getConnectionSettings(),
      );
      return stored ?? envToConnectionSettings(env);
    },

    async testConnection() {
      const settings =
        normalizeConnectionSettings(await options.store.getConnectionSettings()) ??
        envToConnectionSettings(env);
      if (!settings?.enabled || !settings.endpointUrl.trim()) {
        throw new InvalidHermesRuntimeConfigRequestError(
          "Hermes runtime is not configured",
        );
      }

      const providerKey = normalizeRuntimeProviderKey(settings.providerKey);
      await createHermesHttpTextProvider({
        providerKey,
        endpointUrl: settings.endpointUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        fetchImpl: options.fetchImpl,
      }).complete({
        systemPrompt: "You are Hermes. Reply with ok.",
        userPrompt: "health check",
      });

      return {
        ok: true,
        checkedAt: now().toISOString(),
        providerKey,
        requestProtocol: requestProtocolForProvider(providerKey),
        endpointUrl: settings.endpointUrl,
        model: settings.model,
      };
    },

    async getVersionStatus() {
      return settingsToVersionStatus(await this.getSettings());
    },

    async checkForUpdates() {
      const current = await this.getSettings();
      const checkedAt = now().toISOString();
      const latest = options.versionChecker
        ? await options.versionChecker({
            installedVersion: current.installedVersion,
            updateChannel: current.updateChannel,
          })
        : { latestVersion: current.latestVersion ?? current.installedVersion };
      const saved = await options.store.saveVersionStatus({
        installedVersion: current.installedVersion,
        latestVersion: latest.latestVersion,
        lastCheckedAt: checkedAt,
      });

      return settingsToVersionStatus(saved);
    },
  };
}

export function createHermesRuntimeTextProvider(options: {
  runtimeConfigService: Pick<
    HermesRuntimeConfigService,
    "getConnectionSettings"
  >;
  fetchImpl?: typeof fetch;
}): HermesTextProvider {
  return {
    async complete(input) {
      const settings = await options.runtimeConfigService.getConnectionSettings();
      if (!settings?.enabled || !settings.endpointUrl.trim()) {
        throw new HermesRuntimeNotConfiguredError();
      }
      const providerKey = normalizeRuntimeProviderKey(settings.providerKey);

      return createHermesHttpTextProvider({
        providerKey,
        endpointUrl: settings.endpointUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        fetchImpl: options.fetchImpl,
      }).complete(input);
    },
  };
}

function normalizePublicRuntimeSettings(
  settings: HermesRuntimeSettingsDto,
): HermesRuntimeSettingsDto {
  try {
    const providerKey = normalizeRuntimeProviderKey(settings.providerKey);
    return {
      ...settings,
      mode: "external_hermes",
      providerKey,
      ...(settings.endpointUrl
        ? {
            endpointUrl: normalizeSafeHermesEndpointUrl({
              providerKey,
              endpointUrl: settings.endpointUrl,
            }),
          }
        : {}),
    };
  } catch {
    return defaultSettings();
  }
}

function normalizeConnectionSettings(
  settings: HermesRuntimeConnectionSettings | undefined,
): HermesRuntimeConnectionSettings | undefined {
  if (!settings) {
    return undefined;
  }

  try {
    const providerKey = normalizeRuntimeProviderKey(settings.providerKey);
    return {
      ...settings,
      providerKey,
      endpointUrl: normalizeSafeHermesEndpointUrl({
        providerKey,
        endpointUrl: settings.endpointUrl,
      }),
    };
  } catch {
    return undefined;
  }
}

function requestProtocolForProvider(
  providerKey: string,
): HermesProviderRequestProtocol {
  return (
    findHermesProvider(providerKey)?.requestProtocol ??
    "openai_chat_completions"
  );
}

function normalizeRuntimeUpdate(
  input: HermesRuntimeUpdateInput,
): HermesRuntimeUpdateInput {
  if (!isHermesRuntimeMode(input.mode)) {
    throw new InvalidHermesRuntimeConfigRequestError();
  }
  if (!isHermesRuntimeUpdatePolicy(input.updatePolicy)) {
    throw new InvalidHermesRuntimeConfigRequestError();
  }
  if (!isHermesRuntimeUpdateChannel(input.updateChannel)) {
    throw new InvalidHermesRuntimeConfigRequestError();
  }

  const model = normalizeModel(input.model);
  const providerKey = normalizeRuntimeProviderKey(
    input.providerKey ?? defaultProviderKey(input.mode),
  );
  const endpointUrl = normalizeEndpointUrl(
    input.endpointUrl,
    input.enabled,
    providerKey,
    model,
  );
  const apiKey =
    typeof input.apiKey === "string" && input.apiKey.trim().length > 0
      ? input.apiKey.trim()
      : undefined;

  return {
    enabled: Boolean(input.enabled),
    mode: "external_hermes",
    providerKey,
    ...(endpointUrl ? { endpointUrl } : {}),
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(input.clearApiKey ? { clearApiKey: true } : {}),
    updatePolicy: input.updatePolicy,
    updateChannel: input.updateChannel,
  };
}

function normalizeEndpointUrl(
  value: string | undefined,
  enabled: boolean,
  providerKey: string,
  model: string,
): string | undefined {
  try {
    const endpointUrl = resolveHermesProviderEndpoint({
      providerKey,
      model,
      endpointUrl: value,
    });
    if (endpointUrl) {
      return normalizeSafeHermesEndpointUrl({ providerKey, endpointUrl });
    }
  } catch {
    throw new InvalidHermesRuntimeConfigRequestError();
  }

  if (!enabled) {
    return undefined;
  }

  throw new InvalidHermesRuntimeConfigRequestError();
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (!model || model.length > 160) {
    throw new InvalidHermesRuntimeConfigRequestError();
  }

  return model;
}

function normalizeProviderKey(value: string): string {
  const providerKey = value.trim().toLowerCase();
  if (
    providerKey.length < 2 ||
    providerKey.length > 80 ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(providerKey)
  ) {
    throw new InvalidHermesRuntimeConfigRequestError();
  }

  return findHermesProvider(providerKey)?.key ?? providerKey;
}

function normalizeRuntimeProviderKey(value: string): string {
  const providerKey = normalizeProviderKey(value);
  if (providerKey !== "hermes" && providerKey !== "custom") {
    throw new InvalidHermesRuntimeConfigRequestError();
  }

  return providerKey;
}

function defaultProviderKey(mode: HermesRuntimeMode): string {
  return mode === "external_hermes" ? "hermes" : "custom";
}

function envToPublicSettings(
  env: NodeJS.ProcessEnv,
): HermesRuntimeSettingsDto | undefined {
  const connection = envToConnectionSettings(env);
  if (!connection) {
    return undefined;
  }

  return {
    enabled: true,
    mode: "external_hermes",
    providerKey: connection.providerKey,
    endpointUrl: connection.endpointUrl,
    model: connection.model,
    apiKeyConfigured: Boolean(connection.apiKey),
    updatePolicy: "manual",
    updateChannel: "stable",
    updateAvailable: false,
    source: "environment",
  };
}

function envToConnectionSettings(
  env: NodeJS.ProcessEnv,
): HermesRuntimeConnectionSettings | undefined {
  const endpointUrl = env.HERMES_CHAT_COMPLETIONS_URL?.trim();
  if (!endpointUrl) {
    return undefined;
  }

  return {
    enabled: true,
    providerKey: normalizeRuntimeProviderKey(
      env.HERMES_PROVIDER?.trim() || "custom",
    ),
    endpointUrl,
    model: env.HERMES_MODEL?.trim() || "hermes-email",
    ...(env.HERMES_API_KEY?.trim()
      ? { apiKey: env.HERMES_API_KEY.trim() }
      : {}),
  };
}

function defaultSettings(): HermesRuntimeSettingsDto {
  return {
    enabled: false,
    mode: "external_hermes",
    providerKey: "hermes",
    model: "hermes-email",
    apiKeyConfigured: false,
    updatePolicy: "manual",
    updateChannel: "stable",
    updateAvailable: false,
    source: "default",
  };
}

function settingsToVersionStatus(
  settings: HermesRuntimeSettingsDto,
): HermesRuntimeVersionStatus {
  return {
    ...(settings.installedVersion
      ? { installedVersion: settings.installedVersion }
      : {}),
    ...(settings.latestVersion ? { latestVersion: settings.latestVersion } : {}),
    updateAvailable:
      Boolean(settings.installedVersion && settings.latestVersion) &&
      settings.installedVersion !== settings.latestVersion,
    updatePolicy: settings.updatePolicy,
    updateChannel: settings.updateChannel,
    ...(settings.lastCheckedAt ? { lastCheckedAt: settings.lastCheckedAt } : {}),
  };
}

function isHermesRuntimeMode(value: unknown): value is HermesRuntimeMode {
  return value === "external_hermes";
}

function isHermesRuntimeUpdatePolicy(
  value: unknown,
): value is HermesRuntimeUpdatePolicy {
  return value === "manual" || value === "notify" || value === "auto_patch";
}

function isHermesRuntimeUpdateChannel(
  value: unknown,
): value is HermesRuntimeUpdateChannel {
  return value === "stable" || value === "preview";
}
