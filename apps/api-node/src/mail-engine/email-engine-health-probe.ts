export type EmailEngineHttpProbeStatus = "ok" | "unavailable";
export type EmailEngineHealthProbeError =
  | "timeout"
  | "request_failed"
  | "emailengine_health_not_ok"
  | "probe_failed";

export interface EmailEngineHealthProbeResult {
  http: EmailEngineHttpProbeStatus;
  statusCode?: number;
  error?: EmailEngineHealthProbeError;
}

export interface EmailEngineHealthProbe {
  check(): Promise<EmailEngineHealthProbeResult>;
}

export interface CreateEmailEngineHealthProbeOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createEmailEngineHealthProbe(
  options: CreateEmailEngineHealthProbeOptions,
): EmailEngineHealthProbe {
  const baseUrl = normalizeHealthBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;

  return {
    async check() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/health`, {
          method: "GET",
          signal: controller.signal,
        });

        return response.ok
          ? { http: "ok", statusCode: response.status }
          : {
              http: "unavailable",
              statusCode: response.status,
              error: "emailengine_health_not_ok",
            };
      } catch (error) {
        return {
          http: "unavailable",
          error: error instanceof Error && error.name === "AbortError"
            ? "timeout"
            : "request_failed",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function normalizeHealthBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}
