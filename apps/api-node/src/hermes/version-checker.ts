import type { HermesRuntimeUpdateChannel } from "./runtime-config.js";

export interface HermesVersionCheckerInput {
  installedVersion?: string;
  updateChannel: HermesRuntimeUpdateChannel;
}

export interface HermesVersionCheckerResult {
  latestVersion?: string;
}

export type HermesVersionChecker = (
  input: HermesVersionCheckerInput,
) => Promise<HermesVersionCheckerResult>;

export function createHermesHttpVersionChecker(options: {
  url?: string;
  fetchImpl?: typeof fetch;
}): HermesVersionChecker | undefined {
  const endpoint = options.url?.trim();
  if (!endpoint) {
    return undefined;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  return async (input) => {
    const url = buildVersionCheckUrl(endpoint, input);
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("hermes_version_check_failed");
    }

    const payload = (await response.json()) as { latestVersion?: unknown };
    if (
      payload.latestVersion !== undefined &&
      typeof payload.latestVersion !== "string"
    ) {
      throw new Error("hermes_version_check_failed");
    }

    return {
      ...(payload.latestVersion?.trim()
        ? { latestVersion: payload.latestVersion.trim() }
        : {}),
    };
  };
}

function buildVersionCheckUrl(
  endpoint: string,
  input: HermesVersionCheckerInput,
): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("hermes_version_check_failed");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("hermes_version_check_failed");
  }

  parsed.searchParams.set("channel", input.updateChannel);
  if (input.installedVersion?.trim()) {
    parsed.searchParams.set("installedVersion", input.installedVersion.trim());
  }

  return parsed.toString();
}
