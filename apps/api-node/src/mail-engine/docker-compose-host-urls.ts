export interface DockerComposeHostBaseUrlInput {
  explicitBaseUrl?: string;
  explicitName?: string;
  bind?: string;
  fallback: string;
}

export function resolveDockerComposeHostBaseUrl(
  input: DockerComposeHostBaseUrlInput,
): string {
  if (input.explicitBaseUrl?.trim()) {
    return requireExplicitHttpBaseUrl(
      input.explicitBaseUrl,
      input.explicitName ?? "explicitBaseUrl",
    );
  }

  const parsedBind = parseDockerComposeHostBind(input.bind);
  if (parsedBind) {
    return `http://${parsedBind.host}:${parsedBind.port}`;
  }

  return normalizeHttpBaseUrl(input.fallback) ?? input.fallback;
}

function requireExplicitHttpBaseUrl(value: string, name: string): string {
  const normalized = normalizeHttpBaseUrl(value);
  if (!normalized) {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }

  return normalized;
}

export function parseDockerComposeHostBind(
  value: string | undefined,
): { host: string; port: number } | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = normalizeHttpBaseUrl(trimmed);
    if (!url) {
      return undefined;
    }
    const parsed = new URL(url);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isInteger(port) && port > 0
      ? { host: hostForLocalProbe(parsed.hostname), port }
      : undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const port = Number.parseInt(trimmed, 10);
    return port > 0 ? { host: "127.0.0.1", port } : undefined;
  }

  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(trimmed);
  if (bracketed) {
    const port = Number.parseInt(bracketed[2], 10);
    return port > 0
      ? { host: hostForLocalProbe(bracketed[1]), port }
      : undefined;
  }

  if ((trimmed.match(/:/g) ?? []).length !== 1) {
    return undefined;
  }

  const [rawHost, rawPort] = trimmed.split(":");
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0) {
    return undefined;
  }

  return {
    host: hostForLocalProbe(rawHost),
    port,
  };
}

function normalizeHttpBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function hostForLocalProbe(host: string | undefined): string {
  const trimmed = host?.trim() ?? "";
  if (
    !trimmed ||
    trimmed === "*" ||
    trimmed === "0.0.0.0" ||
    trimmed === "::" ||
    trimmed === "[::]"
  ) {
    return "127.0.0.1";
  }

  return trimmed;
}
