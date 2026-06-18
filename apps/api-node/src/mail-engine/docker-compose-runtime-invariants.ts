import type {
  DockerComposeCommandRunner,
  DockerComposeEnvInvariantCheck,
  DockerComposeEnvInvariantExpected,
  DockerComposeEnvInvariantInput,
  DockerComposeHealthVerifierOptions,
  DockerComposeImageInvariantCheck,
} from "./docker-compose-health-verifier.js";

export async function checkComposeEnvInvariants(input: {
  options: DockerComposeHealthVerifierOptions;
  baseArgs: string[];
  runCommand: DockerComposeCommandRunner;
}): Promise<Record<string, DockerComposeEnvInvariantCheck>> {
  const checks = await Promise.all(
    (input.options.envInvariants ?? []).map(async (invariant) => {
      const commandResult = await input.runCommand({
        command: "docker",
        args: [
          ...input.baseArgs,
          "exec",
          "-T",
          invariant.service,
          "printenv",
          invariant.name,
        ],
        cwd: input.options.projectRoot,
      });
      const actual =
        commandResult.exitCode === 0
          ? readEnvInvariantActual(commandResult.stdout, invariant)
          : undefined;
      const detail =
        commandResult.exitCode !== 0 &&
        !envInvariantExpectsAbsent(invariant.expected)
          ? "env_read_failed"
          : actual?.detail
            ? actual.detail
            : !envInvariantValuesMatch(actual?.value, invariant.expected)
              ? "env_value_mismatch"
              : undefined;
      const check: DockerComposeEnvInvariantCheck = {
        ok: detail === undefined,
        service: invariant.service,
        name: envInvariantReportName(invariant),
        ...(detail ? { detail } : {}),
      };
      return [envInvariantKey(invariant), check] as const;
    }),
  );

  return Object.fromEntries(checks);
}

export async function checkComposeImageInvariants(input: {
  options: DockerComposeHealthVerifierOptions;
  baseArgs: string[];
  runCommand: DockerComposeCommandRunner;
}): Promise<Record<string, DockerComposeImageInvariantCheck>> {
  const checks = await Promise.all(
    (input.options.imageInvariants ?? []).map(async (invariant) => {
      const containerResult = await input.runCommand({
        command: "docker",
        args: [
          ...input.baseArgs,
          "ps",
          "-q",
          invariant.service,
        ],
        cwd: input.options.projectRoot,
      });
      const containerId = containerResult.stdout.trim().split(/\s+/)[0];
      if (containerResult.exitCode !== 0 || !containerId) {
        return [
          imageInvariantKey(invariant),
          {
            ok: false,
            service: invariant.service,
            name: invariant.name,
            detail: "container_id_read_failed",
          },
        ] as const;
      }

      const imageResult = await input.runCommand({
        command: "docker",
        args: [
          "inspect",
          "--format",
          "{{ .Config.Image }}",
          containerId,
        ],
        cwd: input.options.projectRoot,
      });
      const actualImage = imageResult.stdout.trim();
      const detail =
        imageResult.exitCode !== 0 || !actualImage
          ? "image_read_failed"
          : actualImage !== invariant.expectedImage
            ? "image_mismatch"
            : undefined;
      const check: DockerComposeImageInvariantCheck = {
        ok: detail === undefined,
        service: invariant.service,
        name: invariant.name,
        ...(detail ? { detail } : {}),
      };
      return [imageInvariantKey(invariant), check] as const;
    }),
  );

  return Object.fromEntries(checks);
}

function readEnvInvariantActual(
  stdout: string,
  invariant: DockerComposeEnvInvariantInput,
):
  | {
      value: DockerComposeEnvInvariantExpected;
      detail?: undefined;
    }
  | {
      value?: undefined;
      detail: NonNullable<DockerComposeEnvInvariantCheck["detail"]>;
    } {
  const rawValue = stdout.trim();
  if (!invariant.valuePath || invariant.valuePath.length === 0) {
    return { value: rawValue };
  }

  const parsed = parseJson(rawValue);
  if (!parsed) {
    return { detail: "env_json_parse_failed" };
  }

  const value = readJsonPathValue(parsed, invariant.valuePath);
  if (!isDockerComposeEnvInvariantExpected(value)) {
    return { detail: "env_json_path_missing" };
  }

  return { value };
}

function readJsonPathValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function isDockerComposeEnvInvariantExpected(
  value: unknown,
): value is DockerComposeEnvInvariantExpected {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string")) ||
    envInvariantExpectsAbsent(value)
  );
}

function envInvariantValuesMatch(
  actual: DockerComposeEnvInvariantExpected | undefined,
  expected: DockerComposeEnvInvariantExpected,
): boolean {
  if (envInvariantExpectsAbsent(expected)) {
    return actual === undefined;
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => value === expected[index])
    );
  }

  return actual === expected;
}

function envInvariantExpectsAbsent(
  value: unknown,
): value is { kind: "absent" } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "absent"
  );
}

function envInvariantKey(input: {
  service: string;
  name: string;
  valuePath?: string[];
}): string {
  return `${input.service}.${envInvariantReportName(input)}`;
}

function envInvariantReportName(input: {
  name: string;
  valuePath?: string[];
}): string {
  return [input.name, ...(input.valuePath ?? [])].join(".");
}

function imageInvariantKey(input: {
  service: string;
  name: string;
}): string {
  return `${input.service}.${input.name}`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
