export type EmailEngineHttpProbeStatus = "ok" | "unavailable";
export type EmailEngineAuthProbeStatus =
  | "ok"
  | "unauthorized"
  | "unavailable"
  | "skipped";
export type EmailEngineHealthProbeError =
  | "timeout"
  | "request_failed"
  | "emailengine_health_not_ok"
  | "emailengine_auth_not_ok"
  | "emailengine_api_internal_error"
  | "emailengine_token_rejected"
  | "probe_failed";

export interface EmailEngineHealthProbeResult {
  http: EmailEngineHttpProbeStatus;
  statusCode?: number;
  error?: EmailEngineHealthProbeError;
  auth: EmailEngineAuthProbeStatus;
  authStatusCode?: number;
  authError?: EmailEngineHealthProbeError;
}

export interface EmailEngineHealthProbe {
  check(): Promise<EmailEngineHealthProbeResult>;
}

type EmailEngineHttpProbeResult = Pick<
  EmailEngineHealthProbeResult,
  "http" | "statusCode" | "error"
>;

type EmailEngineAuthProbeResult = Pick<
  EmailEngineHealthProbeResult,
  "auth" | "authStatusCode" | "authError"
>;

export interface CreateEmailEngineHealthProbeOptions {
  baseUrl: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createEmailEngineHealthProbe(
  options: CreateEmailEngineHealthProbeOptions,
): EmailEngineHealthProbe {
  const healthBaseUrl = normalizeHealthBaseUrl(options.baseUrl);
  const apiBaseUrl = normalizeApiBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const accessToken = options.accessToken?.trim();

  return {
    async check() {
      const health = await requestHttpWithTimeout(timeoutMs, async (signal) => {
        const response = await fetchImpl(`${healthBaseUrl}/health`, {
          method: "GET",
          signal,
        });

        return response.ok
          ? { http: "ok", statusCode: response.status }
          : {
              http: "unavailable",
              statusCode: response.status,
              error: "emailengine_health_not_ok",
            };
      });

      if (health.http !== "ok" || !accessToken) {
        return { ...health, auth: "skipped" };
      }

      const auth = await requestAuthWithTimeout(timeoutMs, async (signal) => {
        const response = await fetchImpl(`${apiBaseUrl}/accounts`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal,
        });

        if (response.ok) {
          return {
            auth: "ok" as const,
            authStatusCode: response.status,
          };
        }

        if (response.status === 401 || response.status === 403) {
          return {
            auth: "unauthorized" as const,
            authStatusCode: response.status,
            authError: "emailengine_token_rejected" as const,
          };
        }

        return {
          auth: "unavailable" as const,
          authStatusCode: response.status,
          authError:
            response.status >= 500
              ? "emailengine_api_internal_error"
              : "emailengine_auth_not_ok",
        };
      });

      return { ...health, ...auth };
    },
  };
}

function normalizeHealthBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function normalizeApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

async function requestHttpWithTimeout(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<EmailEngineHttpProbeResult>,
): Promise<EmailEngineHttpProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(controller.signal);
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
}

async function requestAuthWithTimeout(
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<EmailEngineAuthProbeResult>,
): Promise<EmailEngineAuthProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(controller.signal);
  } catch (error) {
    return {
      auth: "unavailable",
      authError: error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "request_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
