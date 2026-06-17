import { fileURLToPath } from "node:url";

import { sanitizeCliError } from "./cli/safe-error.js";
import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";
import { resolveDockerComposeHostBaseUrl } from "./mail-engine/docker-compose-host-urls.js";
import { verifyDockerComposeHealth } from "./mail-engine/docker-compose-health-verifier.js";

export interface EmailEngineDockerHealthVerifyCliOptions {
  env?: CliEnv;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
  verifyHealth?: typeof verifyDockerComposeHealth;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export async function runEmailEngineDockerHealthVerifyCli(
  options: EmailEngineDockerHealthVerifyCliOptions = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const projectRoot =
    env.EMAILHUB_REPO_ROOT ??
    fileURLToPath(new URL("../../..", import.meta.url));
  const { envFile, runtimeEnv } = loadCliEnvFile({
    env,
    projectRoot,
    fileExists: options.fileExists,
    readEnvFile: options.readEnvFile,
  });
  const composeFiles = [
    "infra/docker-compose.yml",
    "infra/docker-compose.prod.yml",
  ];
  const apiBaseUrl = resolveDockerComposeHostBaseUrl({
    explicitBaseUrl: runtimeEnv.EMAILHUB_API_BASE_URL,
    bind: runtimeEnv.API_BIND,
    fallback: "http://127.0.0.1:8080",
  });
  const webBaseUrl = resolveDockerComposeHostBaseUrl({
    explicitBaseUrl: runtimeEnv.EMAILHUB_WEB_BASE_URL,
    bind: runtimeEnv.WEB_BIND,
    fallback: "http://127.0.0.1:5173",
  });
  const httpTimeoutMs = readPositiveInteger(
    runtimeEnv.EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS,
    5_000,
  );
  const waitAttempts = readPositiveInteger(
    runtimeEnv.EMAILHUB_DOCKER_HEALTH_ATTEMPTS,
    12,
  );
  const waitIntervalMs = readNonNegativeInteger(
    runtimeEnv.EMAILHUB_DOCKER_HEALTH_WAIT_MS,
    5_000,
  );
  const apiHeaders = bearerTokenHeaders(runtimeEnv.EMAILHUB_API_TOKEN);
  const writeStdout = options.writeStdout ?? console.log;
  const writeStderr = options.writeStderr ?? console.error;
  const verifyHealth = options.verifyHealth ?? verifyDockerComposeHealth;

  try {
    assertProductionApiTokenConfigured(runtimeEnv);
    assertCompatibleWebApiToken(runtimeEnv);
    const result = await verifyHealth({
      projectRoot,
      envFile,
      composeFiles,
      requiredComposeFiles: composeFiles,
      httpTimeoutMs,
      waitAttempts,
      waitIntervalMs,
      envInvariants: [
        {
          service: "api",
          name: "NODE_ENV",
          expected: "production",
        },
        {
          service: "api",
          name: "EMAILHUB_ALLOW_DEV_SECRETS",
          expected: "false",
        },
        {
          service: "api",
          name: "EMAILHUB_REQUIRE_API_TOKEN",
          expected: "true",
        },
        {
          service: "worker",
          name: "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN",
          expected: "true",
        },
      ],
      hostChecks: [
        {
          name: "api_health",
          url: `${apiBaseUrl}/health`,
          expect: "http_ok",
          ...(apiHeaders ? { headers: apiHeaders } : {}),
        },
        {
          name: "mail_engine_readiness",
          url: `${apiBaseUrl}/api/mail-engine/health`,
          expect: "mail_engine_ready",
          ...(apiHeaders ? { headers: apiHeaders } : {}),
        },
        {
          name: "web_home",
          url: `${webBaseUrl}/`,
          expect: "http_ok",
        },
      ],
    });
    writeStdout(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    const reportSecrets = [
      runtimeEnv.EMAILHUB_API_TOKEN,
      runtimeEnv.VITE_EMAILHUB_API_TOKEN,
      runtimeEnv.EMAILHUB_API_BASE_URL,
      runtimeEnv.EMAILHUB_WEB_BASE_URL,
      runtimeEnv.API_BIND,
      runtimeEnv.WEB_BIND,
    ];
    const errorSecrets = [
      ...reportSecrets,
      projectRoot,
      envFile,
    ];
    writeStderr(
      JSON.stringify(
        {
          ok: false,
          gate: "docker_compose_health",
          projectRoot: sanitizeCliError(projectRoot, reportSecrets),
          envFile: sanitizeCliError(envFile, reportSecrets),
          error: sanitizeCliError(error, errorSecrets),
        },
        null,
        2,
      ),
    );
    return 1;
  }
}

export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function bearerTokenHeaders(
  token: string | undefined,
): Record<string, string> | undefined {
  const trimmed = token?.trim();
  return trimmed ? { authorization: `Bearer ${trimmed}` } : undefined;
}

function assertProductionApiTokenConfigured(env: CliEnv): void {
  const apiToken = env.EMAILHUB_API_TOKEN?.trim();
  if (!apiToken || apiToken === "dev-emailhub-token") {
    throw new Error(
      "EMAILHUB_API_TOKEN must be set to a non-default value before running the production Docker health gate.",
    );
  }
}

function assertCompatibleWebApiToken(env: CliEnv): void {
  const apiToken = env.EMAILHUB_API_TOKEN?.trim();
  const webToken = env.VITE_EMAILHUB_API_TOKEN?.trim();
  if (apiToken && webToken && apiToken !== webToken) {
    throw new Error(
      "VITE_EMAILHUB_API_TOKEN must match EMAILHUB_API_TOKEN for the protected self-hosted web build.",
    );
  }
}
