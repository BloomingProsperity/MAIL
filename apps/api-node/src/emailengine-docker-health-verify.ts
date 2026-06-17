import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDockerComposeHostBaseUrl } from "./mail-engine/docker-compose-host-urls.js";
import { verifyDockerComposeHealth } from "./mail-engine/docker-compose-health-verifier.js";

const projectRoot =
  process.env.EMAILHUB_REPO_ROOT ??
  fileURLToPath(new URL("../../..", import.meta.url));
const configuredEnvFile = process.env.EMAILHUB_ENV_FILE ?? ".env";
const envFile = existsSync(resolve(projectRoot, configuredEnvFile))
  ? configuredEnvFile
  : ".env.example";
const composeFiles = [
  "infra/docker-compose.yml",
  "infra/docker-compose.prod.yml",
];
const apiBaseUrl = resolveDockerComposeHostBaseUrl({
  explicitBaseUrl: process.env.EMAILHUB_API_BASE_URL,
  bind: process.env.API_BIND,
  fallback: "http://127.0.0.1:8080",
});
const webBaseUrl = resolveDockerComposeHostBaseUrl({
  explicitBaseUrl: process.env.EMAILHUB_WEB_BASE_URL,
  bind: process.env.WEB_BIND,
  fallback: "http://127.0.0.1:5173",
});
const httpTimeoutMs = readPositiveInteger(
  process.env.EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS,
  5_000,
);
const waitAttempts = readPositiveInteger(
  process.env.EMAILHUB_DOCKER_HEALTH_ATTEMPTS,
  12,
);
const waitIntervalMs = readNonNegativeInteger(
  process.env.EMAILHUB_DOCKER_HEALTH_WAIT_MS,
  5_000,
);
const apiHeaders = bearerTokenHeaders(process.env.EMAILHUB_API_TOKEN);

try {
  const result = await verifyDockerComposeHealth({
    projectRoot,
    envFile,
    composeFiles,
    httpTimeoutMs,
    waitAttempts,
    waitIntervalMs,
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
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(
    JSON.stringify(
      {
        ok: false,
        gate: "docker_compose_health",
        projectRoot,
        envFile,
        error: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function bearerTokenHeaders(
  token: string | undefined,
): Record<string, string> | undefined {
  const trimmed = token?.trim();
  return trimmed ? { authorization: `Bearer ${trimmed}` } : undefined;
}
