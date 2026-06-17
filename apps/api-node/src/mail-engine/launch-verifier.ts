export interface EmailEngineLaunchVerifierOptions {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface EmailEngineLaunchVerificationResult {
  ok: boolean;
  gate: "emailengine_launch";
  apiBaseUrl: string;
  checkedAt: string;
  checks: {
    apiHealth: LaunchGateCheck;
    emailEngineReadiness: LaunchGateCheck;
    tokenBackedCapabilities: LaunchGateCheck;
    launchReadinessClean: LaunchGateCheck;
  };
  readiness?: {
    status?: string;
    missing: string[];
    warnings: string[];
    setupActions: LaunchSetupAction[];
  };
  requiredFollowUps: string[];
}

export interface LaunchGateCheck {
  ok: boolean;
  statusCode?: number;
  status?: string;
  detail?: string;
}

export interface LaunchSetupAction {
  code?: string;
  label?: string;
  env?: string[];
  effect?: string;
}

type JsonRecord = Record<string, unknown>;

export async function verifyEmailEngineLaunch(
  options: EmailEngineLaunchVerifierOptions,
): Promise<EmailEngineLaunchVerificationResult> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();

  const apiHealth = await readJsonEndpoint({
    fetchImpl,
    url: `${apiBaseUrl}/health`,
    timeoutMs,
  });
  const mailEngineHealth = await readJsonEndpoint({
    fetchImpl,
    url: `${apiBaseUrl}/api/mail-engine/health`,
    timeoutMs,
  });

  const apiHealthBody = asRecord(apiHealth.body);
  const apiHealthCheck: LaunchGateCheck = {
    ok: apiHealth.ok && apiHealthBody.ok === true,
    statusCode: apiHealth.statusCode,
    status: readString(apiHealthBody.status),
    ...(!apiHealth.ok
      ? { detail: apiHealth.error ?? "api_health_unavailable" }
      : apiHealthBody.ok !== true
        ? { detail: "api_health_not_ok" }
        : {}),
  };

  const mailEngineBody = asRecord(mailEngineHealth.body);
  const readiness = asRecord(mailEngineBody.readiness);
  const readinessStatus = readString(readiness.status);
  const missing = readStringArray(mailEngineBody.missing);
  const warnings = readStringArray(mailEngineBody.warnings);
  const setupActions = readSetupActions(readiness.setupActions);
  const providerOk = readString(mailEngineBody.provider) === "emailengine";
  const bodyOk = mailEngineBody.ok === true;
  const emailEngineReadinessCheck: LaunchGateCheck = {
    ok:
      mailEngineHealth.ok &&
      providerOk &&
      bodyOk &&
      readinessStatus === "ready",
    statusCode: mailEngineHealth.statusCode,
    status: readinessStatus ?? "unknown",
    ...(!mailEngineHealth.ok
      ? { detail: mailEngineHealth.error ?? "emailengine_health_unavailable" }
      : !providerOk
        ? { detail: "emailengine_provider_unexpected" }
        : !bodyOk
          ? { detail: "emailengine_health_not_ok" }
          : readinessStatus !== "ready"
            ? { detail: "emailengine_readiness_degraded" }
            : {}),
  };

  const capabilities = asRecord(mailEngineBody.capabilities);
  const missingCapabilities = [
    ...capabilityMissing(capabilities, "imapSmtpOnboarding"),
    ...capabilityMissing(capabilities, "attachmentDownload"),
    ...capabilityMissing(capabilities, "send"),
  ];
  const tokenBackedCapabilities: LaunchGateCheck = {
    ok: missingCapabilities.length === 0,
    detail:
      missingCapabilities.length > 0
        ? `missing_capabilities:${missingCapabilities.join(",")}`
        : "imap_smtp_onboarding, attachment_download, and send are available",
  };
  const launchReadinessClean = buildLaunchReadinessCleanCheck({
    missing,
    warnings,
    setupActions,
  });
  const requiredFollowUps = buildRequiredFollowUps({
    apiHealthCheck,
    emailEngineReadinessCheck,
    missingCapabilities,
    launchReadinessClean,
    setupActions,
  });
  const ok =
    apiHealthCheck.ok &&
    emailEngineReadinessCheck.ok &&
    tokenBackedCapabilities.ok &&
    launchReadinessClean.ok;

  return {
    ok,
    gate: "emailengine_launch",
    apiBaseUrl,
    checkedAt,
    checks: {
      apiHealth: apiHealthCheck,
      emailEngineReadiness: emailEngineReadinessCheck,
      tokenBackedCapabilities,
      launchReadinessClean,
    },
    readiness: {
      status: readinessStatus,
      missing,
      warnings,
      setupActions,
    },
    requiredFollowUps,
  };
}

async function readJsonEndpoint(input: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  body?: unknown;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.url, {
      signal: controller.signal,
    });
    const body = await response.json().catch(() => undefined);
    return {
      ok: response.ok,
      statusCode: response.status,
      body,
      ...(!response.ok ? { error: `http_${response.status}` } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "request_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRequiredFollowUps(input: {
  apiHealthCheck: LaunchGateCheck;
  emailEngineReadinessCheck: LaunchGateCheck;
  missingCapabilities: string[];
  launchReadinessClean: LaunchGateCheck;
  setupActions: LaunchSetupAction[];
}): string[] {
  const followUps = [
    ...(!input.apiHealthCheck.ok
      ? [
          "Fix API /health before launch; check Postgres readiness and api container logs.",
        ]
      : []),
    ...(!input.emailEngineReadinessCheck.ok
      ? input.setupActions.map((action) =>
          [
            action.code ?? "emailengine_setup_action",
            action.label ?? "Complete EmailEngine setup action",
            action.env && action.env.length > 0
              ? `env=${action.env.join(",")}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" | "),
        )
      : []),
    ...(!input.emailEngineReadinessCheck.ok && input.setupActions.length === 0
      ? [
          emailEngineReadinessFollowUp(
            input.emailEngineReadinessCheck.detail,
          ),
        ]
      : []),
    ...(input.missingCapabilities.length > 0
      ? [
          `Wire token-backed EmailEngine capabilities before launch: ${input.missingCapabilities.join(
            ", ",
          )}.`,
        ]
      : []),
    ...(!input.launchReadinessClean.ok
      ? [
          `Resolve EmailEngine launch readiness warnings before launch: ${input.launchReadinessClean.detail ?? "launch_readiness_not_clean"}.`,
        ]
      : []),
  ];

  return [...new Set(followUps)].filter((item) => item.length > 0);
}

function buildLaunchReadinessCleanCheck(input: {
  missing: string[];
  warnings: string[];
  setupActions: LaunchSetupAction[];
}): LaunchGateCheck {
  const details = [
    input.missing.length > 0 ? `missing:${input.missing.join(",")}` : undefined,
    input.warnings.length > 0
      ? `warnings:${input.warnings.join(",")}`
      : undefined,
    input.setupActions.length > 0
      ? `setup_actions:${input.setupActions
          .map((action) => action.code ?? "emailengine_setup_action")
          .join(",")}`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    ok: details.length === 0,
    detail:
      details.length > 0
        ? details.join(";")
        : "no missing env, warnings, or setup actions",
  };
}

function emailEngineReadinessFollowUp(detail: string | undefined): string {
  if (detail === "emailengine_provider_unexpected") {
    return "Fix EmailEngine launch readiness before launch; /api/mail-engine/health must report provider=emailengine.";
  }

  if (detail === "emailengine_readiness_degraded") {
    return "Fix EmailEngine launch readiness before launch; inspect /api/mail-engine/health readiness warnings and required env.";
  }

  if (detail === "emailengine_health_not_ok") {
    return "Fix EmailEngine launch readiness before launch; EmailEngine health is not ready even though the API responded.";
  }

  if (detail === "timeout" || detail === "request_failed") {
    return "Fix EmailEngine launch readiness before launch; verify the API can reach EmailEngine and check container logs.";
  }

  return "Fix EmailEngine launch readiness before launch; inspect /api/mail-engine/health and EmailEngine container logs.";
}

function capabilityMissing(
  capabilities: JsonRecord,
  key: string,
): string[] {
  return capabilities[key] === true ? [] : [key];
}

function readSetupActions(value: unknown): LaunchSetupAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const raw = asRecord(item);
    return {
      ...(readString(raw.code) ? { code: readString(raw.code) } : {}),
      ...(readString(raw.label) ? { label: readString(raw.label) } : {}),
      ...(readStringArray(raw.env).length > 0
        ? { env: readStringArray(raw.env) }
        : {}),
      ...(readString(raw.effect) ? { effect: readString(raw.effect) } : {}),
    };
  });
}

export function normalizeApiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");
  const fallback = "http://127.0.0.1:8080";
  if (!trimmed) {
    return fallback;
  }

  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
