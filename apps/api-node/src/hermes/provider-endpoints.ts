import { findHermesProvider } from "./provider-catalog.js";

export interface ResolveHermesProviderEndpointInput {
  providerKey: string;
  model?: string;
  endpointUrl?: string;
}

export function resolveHermesProviderEndpoint(
  input: ResolveHermesProviderEndpointInput,
): string | undefined {
  if (input.endpointUrl?.trim()) {
    return normalizeHermesEndpointUrl(input.endpointUrl);
  }

  const provider = findHermesProvider(input.providerKey);
  if (!provider) {
    return undefined;
  }

  if (provider.endpointTemplate && input.model?.trim()) {
    return provider.endpointTemplate.replace(
      "{model}",
      encodeURIComponent(input.model.trim()),
    );
  }

  return provider.defaultEndpoint;
}

export function normalizeHermesEndpointUrl(endpointUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl.trim());
  } catch {
    throw new Error("invalid_hermes_endpoint_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_hermes_endpoint_url");
  }

  return parsed.toString();
}
