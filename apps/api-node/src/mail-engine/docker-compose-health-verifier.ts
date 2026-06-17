import { spawn } from "node:child_process";

export interface DockerComposeHealthVerifierOptions {
  envFile: string;
  composeFiles: string[];
  requiredComposeFiles?: string[];
  projectRoot: string;
  requiredServices?: string[];
  hostChecks?: DockerComposeHostHttpCheckInput[];
  imageInvariants?: DockerComposeImageInvariantInput[];
  envInvariants?: DockerComposeEnvInvariantInput[];
  preparedTokenPairs?: DockerComposePreparedTokenPairInput[];
  httpTimeoutMs?: number;
  waitAttempts?: number;
  waitIntervalMs?: number;
  httpGet?: DockerComposeHttpGetter;
  runCommand?: DockerComposeCommandRunner;
  sleep?: DockerComposeSleeper;
}

export interface DockerComposeHealthVerificationResult {
  ok: boolean;
  gate: "docker_compose_health";
  checkedAt: string;
  attempts: number;
  maxAttempts: number;
  composeFiles: string[];
  envFile: string;
  checks: Record<string, DockerComposeServiceCheck>;
  composeFileChecks: Record<string, DockerComposeConfigFileCheck>;
  hostChecks: Record<string, DockerComposeHostHttpCheck>;
  imageChecks: Record<string, DockerComposeImageInvariantCheck>;
  envChecks: Record<string, DockerComposeEnvInvariantCheck>;
  preparedTokenChecks: Record<string, DockerComposePreparedTokenPairCheck>;
  requiredFollowUps: string[];
}

export interface DockerComposeServiceCheck {
  ok: boolean;
  service: string;
  state?: string;
  health?: string;
  detail?: string;
}

export interface DockerComposeHostHttpCheckInput {
  name: string;
  url: string;
  expect: "http_ok" | "mail_engine_ready";
  headers?: Record<string, string>;
}

export interface DockerComposeHostHttpCheck {
  ok: boolean;
  name: string;
  url: string;
  status?: number;
  readinessStatus?: string;
  detail?: string;
}

export interface DockerComposeEnvInvariantInput {
  service: string;
  name: string;
  expected: string;
  valuePath?: string[];
}

export interface DockerComposeImageInvariantInput {
  service: string;
  name: string;
  expectedImage: string;
}

export interface DockerComposeImageInvariantCheck {
  ok: boolean;
  service: string;
  name: string;
  detail?:
    | "container_id_read_failed"
    | "image_read_failed"
    | "image_mismatch";
}

export interface DockerComposeEnvInvariantCheck {
  ok: boolean;
  service: string;
  name: string;
  detail?:
    | "env_read_failed"
    | "env_json_parse_failed"
    | "env_json_path_missing"
    | "env_value_mismatch";
}

export interface DockerComposePreparedTokenPairInput {
  service: string;
  name: string;
  rawToken: string;
  expectedPreparedToken: string;
  redisUrl?: string;
}

export interface DockerComposePreparedTokenPairCheck {
  ok: boolean;
  service: string;
  name: string;
  detail?: "token_export_failed" | "prepared_token_mismatch";
}

export interface DockerComposeConfigFileCheck {
  ok: boolean;
  service: string;
  missingFiles?: string[];
  unexpectedFiles?: string[];
  detail?:
    | "container_id_read_failed"
    | "config_files_read_failed"
    | "config_file_missing"
    | "config_file_unexpected"
    | "config_file_mismatch";
}

export type DockerComposeHttpGetter = (input: {
  url: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}) => Promise<{
  status: number;
  body: string;
}>;

export type DockerComposeCommandRunner = (input: {
  command: string;
  args: string[];
  cwd: string;
}) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type DockerComposeSleeper = (ms: number) => Promise<void>;

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
  const maxAttempts = Math.max(1, Math.trunc(options.waitAttempts ?? 1));
  const waitIntervalMs = Math.max(0, Math.trunc(options.waitIntervalMs ?? 0));
  const sleep = options.sleep ?? sleepMs;
  let result: DockerComposeHealthVerificationResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await verifyDockerComposeHealthOnce({
      options,
      requiredServices,
      attempt,
      maxAttempts,
    });
    if (result.ok || attempt >= maxAttempts || !shouldRetryHealthCheck(result)) {
      return result;
    }
    if (waitIntervalMs > 0) {
      await sleep(waitIntervalMs);
    }
  }

  return result as DockerComposeHealthVerificationResult;
}

async function verifyDockerComposeHealthOnce(input: {
  options: DockerComposeHealthVerifierOptions;
  requiredServices: string[];
  attempt: number;
  maxAttempts: number;
}): Promise<DockerComposeHealthVerificationResult> {
  const { options, requiredServices } = input;
  const checkedAt = new Date().toISOString();
  const commandResult = await (options.runCommand ?? runDockerComposeCommand)({
    command: "docker",
    args: [
      ...dockerComposeBaseArgs(options),
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
      attempts: input.attempt,
      maxAttempts: input.maxAttempts,
      composeFiles: options.composeFiles,
      envFile: options.envFile,
      checks,
      composeFileChecks: {},
      hostChecks: {},
      imageChecks: {},
      envChecks: {},
      preparedTokenChecks: {},
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
  const composeFileChecks = Object.values(checks).every((check) => check.ok)
    ? await checkComposeConfigFiles(options, requiredServices)
    : {};
  requiredFollowUps.push(
    ...Object.values(composeFileChecks)
      .filter((check) => !check.ok)
      .map(composeConfigFileFollowUp),
  );
  const hostChecks: Record<string, DockerComposeHostHttpCheck> = Object.fromEntries(
    await Promise.all(
      (options.hostChecks ?? []).map(async (check) => [
        check.name,
        await checkHostHttpEndpoint(check, {
          httpGet: options.httpGet ?? fetchHttpEndpoint,
          timeoutMs: options.httpTimeoutMs ?? 5_000,
        }),
      ]),
    ),
  );
  requiredFollowUps.push(
    ...Object.values(hostChecks)
      .filter((check) => !check.ok)
      .map(
        (check) =>
          `Fix host HTTP check: ${check.name} url=${check.url} detail=${check.detail ?? "unknown"}.`,
      ),
  );
  const imageChecks = Object.values(checks).every((check) => check.ok)
    ? await checkComposeImageInvariants(options)
    : {};
  requiredFollowUps.push(
    ...Object.values(imageChecks)
      .filter((check) => !check.ok)
      .map(
        (check) =>
          `Fix Docker image invariant: ${check.service}.${check.name}.`,
      ),
  );
  const envChecks = Object.values(checks).every((check) => check.ok)
    ? await checkComposeEnvInvariants(options)
    : {};
  requiredFollowUps.push(
    ...Object.values(envChecks)
      .filter((check) => !check.ok)
      .map(
        (check) =>
          `Fix Docker env invariant: ${check.service}.${check.name}.`,
      ),
  );
  const preparedTokenChecks = Object.values(checks).every((check) => check.ok)
    ? await checkComposePreparedTokenPairs(options)
    : {};
  requiredFollowUps.push(
    ...Object.values(preparedTokenChecks)
      .filter((check) => !check.ok)
      .map(
        (check) =>
          `Fix Docker prepared token pair: ${check.service}.${check.name}.`,
      ),
  );

  return {
    ok: requiredFollowUps.length === 0,
    gate: "docker_compose_health",
    checkedAt,
    attempts: input.attempt,
    maxAttempts: input.maxAttempts,
    composeFiles: options.composeFiles,
    envFile: options.envFile,
    checks,
    composeFileChecks,
    hostChecks,
    imageChecks,
    envChecks,
    preparedTokenChecks,
    requiredFollowUps,
  };
}

function shouldRetryHealthCheck(
  result: DockerComposeHealthVerificationResult,
): boolean {
  if (Object.values(result.envChecks).some((check) => !check.ok)) {
    return false;
  }
  if (Object.values(result.preparedTokenChecks).some((check) => !check.ok)) {
    return false;
  }
  if (Object.values(result.imageChecks).some((check) => !check.ok)) {
    return false;
  }
  if (Object.values(result.composeFileChecks).some((check) => !check.ok)) {
    return false;
  }

  return (
    Object.values(result.checks).some(isRetryableServiceCheck) ||
    Object.values(result.hostChecks).some(isRetryableHostCheck)
  );
}

function isRetryableServiceCheck(check: DockerComposeServiceCheck): boolean {
  if (check.ok) {
    return false;
  }

  if (check.detail === "docker_compose_ps_failed") {
    return true;
  }

  if (check.detail === "service_not_running") {
    return true;
  }

  return check.detail === "service_not_healthy" && check.health === "starting";
}

function isRetryableHostCheck(check: DockerComposeHostHttpCheck): boolean {
  if (check.ok) {
    return false;
  }

  if (
    check.detail === "http_request_failed" ||
    check.detail === "http_status_not_ok"
  ) {
    return true;
  }

  return (
    check.detail === "mail_engine_not_ready" &&
    check.readinessStatus !== "degraded"
  );
}

async function checkComposeConfigFiles(
  options: DockerComposeHealthVerifierOptions,
  requiredServices: string[],
): Promise<Record<string, DockerComposeConfigFileCheck>> {
  const requiredComposeFiles = options.requiredComposeFiles ?? [];
  if (requiredComposeFiles.length === 0) {
    return {};
  }

  const checks = await Promise.all(
    requiredServices.map(async (service) => [
      service,
      await checkComposeConfigFileLabels(options, {
        service,
        requiredComposeFiles,
      }),
    ]),
  );
  return Object.fromEntries(checks);
}

async function checkComposeConfigFileLabels(
  options: DockerComposeHealthVerifierOptions,
  input: {
    service: string;
    requiredComposeFiles: string[];
  },
): Promise<DockerComposeConfigFileCheck> {
  const runCommand = options.runCommand ?? runDockerComposeCommand;
  const containerResult = await runCommand({
    command: "docker",
    args: [
      ...dockerComposeBaseArgs(options),
      "ps",
      "-q",
      input.service,
    ],
    cwd: options.projectRoot,
  });
  const containerId = containerResult.stdout.trim().split(/\s+/)[0];
  if (containerResult.exitCode !== 0 || !containerId) {
    return {
      ok: false,
      service: input.service,
      detail: "container_id_read_failed",
    };
  }

  const labelResult = await runCommand({
    command: "docker",
    args: [
      "inspect",
      "--format",
      '{{ index .Config.Labels "com.docker.compose.project.config_files" }}',
      containerId,
    ],
    cwd: options.projectRoot,
  });
  if (labelResult.exitCode !== 0) {
    return {
      ok: false,
      service: input.service,
      detail: "config_files_read_failed",
    };
  }

  const actualFiles = parseComposeConfigFilesLabel(labelResult.stdout);
  const missingFiles = input.requiredComposeFiles.filter(
    (file) => !composeConfigFileIncluded(actualFiles, file),
  );
  const unexpectedFiles = actualFiles.filter(
    (file) =>
      !input.requiredComposeFiles.some((expectedFile) =>
        composeConfigFileIncluded([file], expectedFile),
      ),
  );
  const detail = composeConfigFileCheckDetail({
    missingFiles,
    unexpectedFiles,
  });
  return {
    ok: detail === undefined,
    service: input.service,
    ...(missingFiles.length > 0 ? { missingFiles } : {}),
    ...(unexpectedFiles.length > 0 ? { unexpectedFiles } : {}),
    ...(detail ? { detail } : {}),
  };
}

function composeConfigFileCheckDetail(input: {
  missingFiles: string[];
  unexpectedFiles: string[];
}): DockerComposeConfigFileCheck["detail"] | undefined {
  if (input.missingFiles.length > 0 && input.unexpectedFiles.length > 0) {
    return "config_file_mismatch";
  }
  if (input.missingFiles.length > 0) {
    return "config_file_missing";
  }
  if (input.unexpectedFiles.length > 0) {
    return "config_file_unexpected";
  }
  return undefined;
}

function composeConfigFileFollowUp(check: DockerComposeConfigFileCheck): string {
  if (
    check.detail === "config_file_missing" ||
    check.detail === "config_file_unexpected" ||
    check.detail === "config_file_mismatch"
  ) {
    const expected = (check.missingFiles ?? []).join(", ");
    const unexpected = (check.unexpectedFiles ?? []).join(", ");
    return [
      `Restart Docker compose service ${check.service}`,
      expected ? `with required compose files: ${expected}` : "",
      unexpected ? `without unexpected compose files: ${unexpected}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .concat(".");
  }

  return `Inspect Docker compose config file labels for service ${check.service}.`;
}

function parseComposeConfigFilesLabel(value: string): string[] {
  return value
    .split(",")
    .map((file) => normalizeComposeConfigFilePath(file))
    .filter(Boolean);
}

function composeConfigFileIncluded(
  actualFiles: string[],
  expectedFile: string,
): boolean {
  const normalizedExpected = normalizeComposeConfigFilePath(expectedFile);
  return actualFiles.some(
    (actualFile) =>
      actualFile === normalizedExpected ||
      actualFile.endsWith(`/${normalizedExpected}`),
  );
}

function normalizeComposeConfigFilePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

async function checkComposeEnvInvariants(
  options: DockerComposeHealthVerifierOptions,
): Promise<Record<string, DockerComposeEnvInvariantCheck>> {
  const runCommand = options.runCommand ?? runDockerComposeCommand;
  const checks = await Promise.all(
    (options.envInvariants ?? []).map(async (invariant) => {
      const commandResult = await runCommand({
        command: "docker",
        args: [
          ...dockerComposeBaseArgs(options),
          "exec",
          "-T",
          invariant.service,
          "printenv",
          invariant.name,
        ],
        cwd: options.projectRoot,
      });
      const actual =
        commandResult.exitCode === 0
          ? readEnvInvariantActual(commandResult.stdout, invariant)
          : undefined;
      const detail =
        commandResult.exitCode !== 0
          ? "env_read_failed"
          : actual?.detail
            ? actual.detail
            : actual?.value !== invariant.expected
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

function readEnvInvariantActual(
  stdout: string,
  invariant: DockerComposeEnvInvariantInput,
):
  | {
      value: string;
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

  const value = readJsonPathString(parsed, invariant.valuePath);
  if (!value) {
    return { detail: "env_json_path_missing" };
  }

  return { value };
}

function readJsonPathString(
  value: unknown,
  path: string[],
): string | undefined {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return readString(current);
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

async function checkComposeImageInvariants(
  options: DockerComposeHealthVerifierOptions,
): Promise<Record<string, DockerComposeImageInvariantCheck>> {
  const runCommand = options.runCommand ?? runDockerComposeCommand;
  const checks = await Promise.all(
    (options.imageInvariants ?? []).map(async (invariant) => {
      const containerResult = await runCommand({
        command: "docker",
        args: [
          ...dockerComposeBaseArgs(options),
          "ps",
          "-q",
          invariant.service,
        ],
        cwd: options.projectRoot,
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

      const imageResult = await runCommand({
        command: "docker",
        args: [
          "inspect",
          "--format",
          "{{ .Config.Image }}",
          containerId,
        ],
        cwd: options.projectRoot,
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

function imageInvariantKey(input: {
  service: string;
  name: string;
}): string {
  return `${input.service}.${input.name}`;
}

async function checkComposePreparedTokenPairs(
  options: DockerComposeHealthVerifierOptions,
): Promise<Record<string, DockerComposePreparedTokenPairCheck>> {
  const runCommand = options.runCommand ?? runDockerComposeCommand;
  const checks = await Promise.all(
    (options.preparedTokenPairs ?? []).map(async (tokenPair) => {
      const commandResult = await runCommand({
        command: "docker",
        args: [
          ...dockerComposeBaseArgs(options),
          "exec",
          "-T",
          tokenPair.service,
          "emailengine",
          "tokens",
          "export",
          "-t",
          tokenPair.rawToken,
          `--dbs.redis=${tokenPair.redisUrl ?? "redis://redis-engine:6379/0"}`,
        ],
        cwd: options.projectRoot,
      });
      const actualPreparedToken = commandResult.stdout.trim();
      const detail =
        commandResult.exitCode !== 0 || !actualPreparedToken
          ? "token_export_failed"
          : actualPreparedToken !== tokenPair.expectedPreparedToken
            ? "prepared_token_mismatch"
            : undefined;
      const check: DockerComposePreparedTokenPairCheck = {
        ok: detail === undefined,
        service: tokenPair.service,
        name: tokenPair.name,
        ...(detail ? { detail } : {}),
      };
      return [preparedTokenPairKey(tokenPair), check] as const;
    }),
  );

  return Object.fromEntries(checks);
}

function preparedTokenPairKey(input: {
  service: string;
  name: string;
}): string {
  return `${input.service}.${input.name}`;
}

function dockerComposeBaseArgs(
  options: DockerComposeHealthVerifierOptions,
): string[] {
  return [
    "compose",
    "--env-file",
    options.envFile,
    ...options.composeFiles.flatMap((file) => ["-f", file]),
  ];
}

async function checkHostHttpEndpoint(
  check: DockerComposeHostHttpCheckInput,
  input: {
    httpGet: DockerComposeHttpGetter;
    timeoutMs: number;
  },
): Promise<DockerComposeHostHttpCheck> {
  const reportUrl = redactReportUrl(check.url);
  try {
    const response = await input.httpGet({
      url: check.url,
      timeoutMs: input.timeoutMs,
      ...(check.headers ? { headers: check.headers } : {}),
    });
    if (check.expect === "http_ok") {
      return {
        ok: response.status >= 200 && response.status < 300,
        name: check.name,
        url: reportUrl,
        status: response.status,
        ...(response.status >= 200 && response.status < 300
          ? {}
          : { detail: "http_status_not_ok" }),
      };
    }

    const body = asRecord(parseJson(response.body));
    const readiness = asRecord(body.readiness);
    const readinessStatus = readString(readiness.status);
    const provider = readString(body.provider);
    const capabilities = asRecord(body.capabilities);
    const capabilitiesReady =
      capabilities.imapSmtpOnboarding === true &&
      capabilities.attachmentDownload === true &&
      capabilities.send === true;
    const ready =
      response.status >= 200 &&
      response.status < 300 &&
      body.ok === true &&
      readinessStatus === "ready" &&
      provider === "emailengine" &&
      capabilitiesReady;
    return {
      ok: ready,
      name: check.name,
      url: reportUrl,
      status: response.status,
      ...(readinessStatus ? { readinessStatus } : {}),
      ...(ready
        ? {}
        : {
            detail:
              response.status < 200 ||
              response.status >= 300 ||
              body.ok !== true ||
              readinessStatus !== "ready"
                ? "mail_engine_not_ready"
                : provider !== "emailengine"
                  ? "mail_engine_provider_unexpected"
                  : "mail_engine_capabilities_missing",
          }),
    };
  } catch {
    return {
      ok: false,
      name: check.name,
      url: reportUrl,
      detail: "http_request_failed",
    };
  }
}

function redactReportUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid_url]";
  }
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

async function fetchHttpEndpoint(input: {
  url: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      ...(input.headers ? { headers: input.headers } : {}),
      signal: controller.signal,
    });
    return {
      status: response.status,
      body: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
