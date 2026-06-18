#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const envFile = resolveEnvFile(projectRoot);
const projectName = resolveProjectName(projectRoot);
const composeArgs = [
  "compose",
  "--project-name",
  projectName,
  "--env-file",
  envFile,
  "-f",
  "infra/docker-compose.yml",
  ...options.files.flatMap((file) => ["-f", file]),
  ...options.command,
];

const result = spawnSync("docker", composeArgs, {
  cwd: projectRoot,
  env: {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    EMAILHUB_DOCKER_COMPOSE_PROJECT_NAME: projectName,
    EMAILHUB_ENV_FILE: envFile,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}

process.exitCode = result.status ?? 1;

function parseArgs(args) {
  const files = [];
  const command = [];
  for (const arg of args) {
    if (arg === "--test") {
      files.push("infra/docker-compose.test.yml");
      continue;
    }
    if (arg === "--prod") {
      files.push("infra/docker-compose.prod.yml");
      continue;
    }
    command.push(arg);
  }

  if (command.length === 0) {
    console.error(
      "Usage: node scripts/emailhub-compose.mjs [--test] [--prod] <docker compose args...>",
    );
    process.exit(1);
  }

  return { files, command };
}

function resolveEnvFile(root) {
  const configured = process.env.EMAILHUB_ENV_FILE || ".env";
  const configuredPath = resolve(root, configured);
  return existsSync(configuredPath) ? configured : ".env.example";
}

function resolveProjectName(root) {
  return sanitizeProjectName(
    process.env.EMAILHUB_DOCKER_COMPOSE_PROJECT_NAME ||
      process.env.COMPOSE_PROJECT_NAME ||
      basename(root),
  );
}

function sanitizeProjectName(value) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");

  return sanitized || "email-hub";
}
