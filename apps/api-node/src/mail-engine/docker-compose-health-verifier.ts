import { spawn } from "node:child_process";

export interface DockerComposeHealthVerifierOptions {
  envFile: string;
  composeFiles: string[];
  projectRoot: string;
  requiredServices?: string[];
  runCommand?: DockerComposeCommandRunner;
}

export interface DockerComposeHealthVerificationResult {
  ok: boolean;
  gate: "docker_compose_health";
  checkedAt: string;
  composeFiles: string[];
  envFile: string;
  checks: Record<string, DockerComposeServiceCheck>;
  requiredFollowUps: string[];
}

export interface DockerComposeServiceCheck {
  ok: boolean;
  service: string;
  state?: string;
  health?: string;
  detail?: string;
}

export type DockerComposeCommandRunner = (input: {
  command: string;
  args: string[];
  cwd: string;
}) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const DEFAULT_REQUIRED_SERVICES = [
  "postgres",
  "redis-engine",
  "emailengine",
  "api",
  "worker",
  "web",
];

export async function verifyDockerComposeHealth(
  options: DockerComposeHealthVerifierOptions,
): Promise<DockerComposeHealthVerificationResult> {
  const requiredServices =
    options.requiredServices ?? DEFAULT_REQUIRED_SERVICES;
  const checkedAt = new Date().toISOString();
  const commandResult = await (options.runCommand ?? runDockerComposeCommand)({
    command: "docker",
    args: [
      "compose",
      "--env-file",
      options.envFile,
      ...options.composeFiles.flatMap((file) => ["-f", file]),
      "ps",
      "--format",
      "json",
    ],
    cwd: options.projectRoot,
  });

  if (commandResult.exitCode !== 0) {
    const checks = Object.fromEntries(
      requiredServices.map((service) => [
        service,
        {
          ok: false,
          service,
          detail: "docker_compose_ps_failed",
        },
      ]),
    );
    return {
      ok: false,
      gate: "docker_compose_health",
      checkedAt,
      composeFiles: options.composeFiles,
      envFile: options.envFile,
      checks,
      requiredFollowUps: [
        "Run the Docker compose stack before launch verification and inspect docker compose ps/logs.",
      ],
    };
  }

  const services = parseComposeServices(commandResult.stdout);
  const checks = Object.fromEntries(
    requiredServices.map((service) => [
      service,
      checkComposeService(service, services.get(service)),
    ]),
  );
  const requiredFollowUps = Object.values(checks)
    .filter((check) => !check.ok)
    .map((check) =>
      check.detail === "service_missing"
        ? `Start missing Docker service: ${check.service}.`
        : `Fix unhealthy Docker service: ${check.service} state=${check.state ?? "unknown"} health=${check.health ?? "unknown"}.`,
    );

  return {
    ok: requiredFollowUps.length === 0,
    gate: "docker_compose_health",
    checkedAt,
    composeFiles: options.composeFiles,
    envFile: options.envFile,
    checks,
    requiredFollowUps,
  };
}

function checkComposeService(
  service: string,
  row: Record<string, unknown> | undefined,
): DockerComposeServiceCheck {
  if (!row) {
    return {
      ok: false,
      service,
      detail: "service_missing",
    };
  }

  const state = readString(row.State)?.toLowerCase();
  const health = readString(row.Health)?.toLowerCase();
  const running = state === "running";
  const healthy = health === "healthy";
  return {
    ok: running && healthy,
    service,
    ...(state ? { state } : {}),
    ...(health ? { health } : {}),
    ...(!running
      ? { detail: "service_not_running" }
      : !healthy
        ? { detail: "service_not_healthy" }
        : {}),
  };
}

function parseComposeServices(stdout: string): Map<string, Record<string, unknown>> {
  const parsedRows = parseComposeRows(stdout);
  const services = new Map<string, Record<string, unknown>>();
  for (const row of parsedRows) {
    const service = readString(row.Service);
    if (service) {
      services.set(service, row);
    }
  }
  return services;
}

function parseComposeRows(stdout: string): Array<Record<string, unknown>> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = parseJson(trimmed);
  if (Array.isArray(parsed)) {
    return parsed.map(asRecord).filter((row) => Object.keys(row).length > 0);
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return [asRecord(parsed)];
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => asRecord(parseJson(line)))
    .filter((row) => Object.keys(row).length > 0);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

async function runDockerComposeCommand(input: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: "",
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
