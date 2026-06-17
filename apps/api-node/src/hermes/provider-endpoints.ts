import { isIP } from "node:net";

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

export function normalizeSafeHermesEndpointUrl(input: {
  providerKey: string;
  endpointUrl: string;
}): string {
  const endpointUrl = normalizeHermesEndpointUrl(input.endpointUrl);
  if (isTrustedGatewayDefaultEndpoint(input.providerKey, endpointUrl)) {
    return endpointUrl;
  }

  const parsed = new URL(endpointUrl);
  if (parsed.username || parsed.password) {
    throw new Error("unsafe_hermes_endpoint_url");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("unsafe_hermes_endpoint_url");
  }
  if (isUnsafeHermesEndpointHost(parsed.hostname)) {
    throw new Error("unsafe_hermes_endpoint_url");
  }

  return endpointUrl;
}

function isTrustedGatewayDefaultEndpoint(
  providerKey: string,
  endpointUrl: string,
): boolean {
  const provider = findHermesProvider(providerKey);
  if (
    !provider?.defaultEndpoint ||
    provider.category !== "gateway" ||
    (provider.key !== "hermes" && provider.key !== "litellm")
  ) {
    return false;
  }

  try {
    return normalizeHermesEndpointUrl(provider.defaultEndpoint) === endpointUrl;
  } catch {
    return false;
  }
}

function isUnsafeHermesEndpointHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) {
    return true;
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return isUnsafeIpv4(host);
  }
  if (ipVersion === 6) {
    return isUnsafeIpv6(host);
  }

  return !host.includes(".");
}

function isUnsafeIpv4(host: string): boolean {
  const octets = host.split(".").map((value) => Number.parseInt(value, 10));
  const [a, b] = octets;
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return true;
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isUnsafeIpv6(host: string): boolean {
  const normalized = host.split("%", 1)[0].toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:")
  ) {
    return true;
  }

  const firstSegment = normalized.split(":", 1)[0] ?? "";
  const first = Number.parseInt(firstSegment || "0", 16);
  if (!Number.isFinite(first)) {
    return true;
  }

  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}
