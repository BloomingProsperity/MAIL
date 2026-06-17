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

try {
  const result = await verifyDockerComposeHealth({
    projectRoot,
    envFile,
    composeFiles,
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
