import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const apiBaseUrl = normalizeBaseUrl(
  process.env.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080",
  "http://127.0.0.1:8080",
);
const webBaseUrl = normalizeBaseUrl(
  process.env.EMAILHUB_WEB_BASE_URL ?? "http://127.0.0.1:5173",
  "http://127.0.0.1:5173",
);
const httpTimeoutMs = readPositiveInteger(
  process.env.EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS,
  5_000,
);

try {
  const result = await verifyDockerComposeHealth({
    projectRoot,
    envFile,
    composeFiles,
    httpTimeoutMs,
    hostChecks: [
      {
        name: "api_health",
        url: `${apiBaseUrl}/health`,
        expect: "http_ok",
      },
      {
        name: "mail_engine_readiness",
        url: `${apiBaseUrl}/api/mail-engine/health`,
        expect: "mail_engine_ready",
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

function normalizeBaseUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  return (trimmed || fallback).replace(/\/+$/, "");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
