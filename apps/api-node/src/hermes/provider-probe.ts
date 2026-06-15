import { createHermesHttpTextProvider } from "./http-provider.js";
import { resolveHermesProviderEndpoint } from "./provider-endpoints.js";
import {
  findHermesProvider,
  type HermesProviderAuthType,
  type HermesProviderCatalogItem,
  type HermesProviderCategory,
} from "./provider-catalog.js";

export type HermesProviderProbeStatus =
  | "ready"
  | "missing_configuration"
  | "external_auth_required"
  | "connection_failed";

export type HermesProviderProbeMissing =
  | "endpoint_url"
  | "model"
  | "api_key"
  | "oauth_session"
  | "aws_credentials";

export interface HermesProviderProbeInput {
  providerKey: string;
  endpointUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface HermesProviderProbeResult {
  ok: boolean;
  status: HermesProviderProbeStatus;
  providerKey: string;
  label: string;
  category: HermesProviderCategory;
  authType: HermesProviderAuthType;
  endpointUrl?: string;
  model?: string;
  missing: HermesProviderProbeMissing[];
  checkedAt: string;
  message?: string;
}

export interface HermesProviderProbeService {
  probe(input: HermesProviderProbeInput): Promise<HermesProviderProbeResult>;
}

export class InvalidHermesProviderProbeRequestError extends Error {
  readonly code = "invalid_hermes_provider_probe_request";

  constructor(message = "invalid Hermes provider probe request") {
    super(message);
  }
}

export function createHermesProviderProbeService(options: {
  fetchImpl?: typeof fetch;
  now?: () => Date;
} = {}): HermesProviderProbeService {
  const now = options.now ?? (() => new Date());

  return {
    async probe(input) {
      const provider = resolveProbeProvider(input.providerKey);
      const model = normalizeOptionalModel(input.model);
      const endpointUrl = resolveProbeEndpoint(
        provider,
        model,
        input.endpointUrl,
      );
      const apiKey = normalizeOptionalApiKey(input.apiKey);
      const checkedAt = now().toISOString();
      const common = {
        providerKey: provider.key,
        label: provider.label,
        category: provider.category,
        authType: provider.authType,
        ...(endpointUrl ? { endpointUrl } : {}),
        ...(model ? { model } : {}),
        checkedAt,
      };

      const externalMissing = externalAuthMissing(provider.authType);
      if (externalMissing) {
        return {
          ok: false,
          status: "external_auth_required",
          ...common,
          missing: [...(model ? [] : (["model"] as const)), externalMissing],
        };
      }

      const missing: HermesProviderProbeMissing[] = [
        ...(endpointUrl ? [] : (["endpoint_url"] as const)),
        ...(model ? [] : (["model"] as const)),
        ...(provider.authType === "api_key" && !apiKey
          ? (["api_key"] as const)
          : []),
      ];
      if (missing.length > 0) {
        return {
          ok: false,
          status: "missing_configuration",
          ...common,
          missing,
        };
      }

      try {
        await createHermesHttpTextProvider({
          providerKey: provider.key,
          endpointUrl: endpointUrl!,
          model: model!,
          ...(apiKey ? { apiKey } : {}),
          fetchImpl: options.fetchImpl,
        }).complete({
          systemPrompt: "You are Hermes. Reply with ok.",
          userPrompt: "health check",
        });

        return {
          ok: true,
          status: "ready",
          ...common,
          missing: [],
        };
      } catch {
        return {
          ok: false,
          status: "connection_failed",
          ...common,
          missing: [],
          message: "Hermes provider health check failed",
        };
      }
    },
  };
}

function resolveProbeProvider(providerKey: string): HermesProviderCatalogItem {
  const normalized = normalizeProviderKey(providerKey);
  const knownProvider = findHermesProvider(normalized);
  if (knownProvider) {
    return knownProvider;
  }

  return {
    key: normalized,
    label: normalized,
    category: "custom",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: [],
    modelExamples: [],
    capabilities: ["chat", "email_skills", "streaming_ready"],
  };
}

function normalizeProviderKey(value: string): string {
  const providerKey = value.trim().toLowerCase();
  if (
    providerKey.length < 2 ||
    providerKey.length > 80 ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(providerKey)
  ) {
    throw new InvalidHermesProviderProbeRequestError();
  }

  return providerKey;
}

function resolveProbeEndpoint(
  provider: HermesProviderCatalogItem,
  model: string | undefined,
  endpointUrl: string | undefined,
): string | undefined {
  try {
    return resolveHermesProviderEndpoint({
      providerKey: provider.key,
      model,
      endpointUrl,
    });
  } catch {
    throw new InvalidHermesProviderProbeRequestError();
  }
}

function normalizeOptionalModel(value: string | undefined): string | undefined {
  const model = value?.trim();
  if (!model) {
    return undefined;
  }
  if (model.length > 160) {
    throw new InvalidHermesProviderProbeRequestError();
  }

  return model;
}

function normalizeOptionalApiKey(value: string | undefined): string | undefined {
  const apiKey = value?.trim();
  return apiKey || undefined;
}

function externalAuthMissing(
  authType: HermesProviderAuthType,
): HermesProviderProbeMissing | undefined {
  if (authType === "oauth") {
    return "oauth_session";
  }
  if (authType === "aws_credentials") {
    return "aws_credentials";
  }

  return undefined;
}
