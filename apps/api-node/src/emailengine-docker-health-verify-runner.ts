import { fileURLToPath } from "node:url";

import { sanitizeCliError } from "./cli/safe-error.js";
import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";
import { resolveDockerComposeHostBaseUrl } from "./mail-engine/docker-compose-host-urls.js";
import {
  verifyDockerComposeHealth,
  type DockerComposeEnvInvariantInput,
  type DockerComposeImageInvariantInput,
  type DockerComposePreparedTokenPairInput,
} from "./mail-engine/docker-compose-health-verifier.js";

export const DEFAULT_EMAILENGINE_IMAGE =
  "postalsys/emailengine:v2.71.0@sha256:4f732fd40e39f8e3af0b3d1580f1972a7e7270741be510f217a6b07eac5b0efc";

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
  const composeProjectName = readDockerComposeProjectName(runtimeEnv);
  const apiHeaders = bearerTokenHeaders(runtimeEnv.EMAILHUB_API_TOKEN);
  const writeStdout = options.writeStdout ?? console.log;
  const writeStderr = options.writeStderr ?? console.error;
  const verifyHealth = options.verifyHealth ?? verifyDockerComposeHealth;

  try {
    assertProductionApiTokenConfigured(runtimeEnv);
    assertCompatibleWebApiToken(runtimeEnv);
    const apiBaseUrl = resolveDockerComposeHostBaseUrl({
      explicitBaseUrl: runtimeEnv.EMAILHUB_API_BASE_URL,
      explicitName: "EMAILHUB_API_BASE_URL",
      bind: runtimeEnv.API_BIND,
      fallback: "http://127.0.0.1:8080",
    });
    const webBaseUrl = resolveDockerComposeHostBaseUrl({
      explicitBaseUrl: runtimeEnv.EMAILHUB_WEB_BASE_URL,
      explicitName: "EMAILHUB_WEB_BASE_URL",
      bind: runtimeEnv.WEB_BIND,
      fallback: "http://127.0.0.1:5173",
    });
    const authServerSecret = requireDockerHealthEnvValue(
      runtimeEnv,
      "EMAILENGINE_AUTH_SERVER_SECRET",
    );
    const result = await verifyHealth({
      projectRoot,
      envFile,
      composeFiles,
      ...(composeProjectName ? { composeProjectName } : {}),
      requiredComposeFiles: composeFiles,
      httpTimeoutMs,
      waitAttempts,
      waitIntervalMs,
      imageInvariants: dockerHealthImageInvariants(runtimeEnv),
      envInvariants: dockerHealthEnvInvariants(runtimeEnv),
      preparedTokenPairs: dockerHealthPreparedTokenPairs(runtimeEnv),
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
          name: "mail_engine_auth_server",
          url: `${apiBaseUrl}/api/mail-engine/auth-server?account=__emailhub_launch_probe__&proto=health_probe`,
          expect: "emailengine_auth_server_basic",
          headers: basicAuthHeaders("emailengine", authServerSecret),
        },
        {
          name: "mail_engine_auth_server_rejects_unauthorized",
          url: `${apiBaseUrl}/api/mail-engine/auth-server?account=__emailhub_launch_probe__&proto=health_probe`,
          expect: "emailengine_auth_server_unauthorized",
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
      runtimeEnv.EMAILENGINE_ACCESS_TOKEN,
      runtimeEnv.EENGINE_PREPARED_TOKEN,
      runtimeEnv.EENGINE_SECRET,
      runtimeEnv.EMAILENGINE_WEBHOOK_SECRET,
      runtimeEnv.EMAILENGINE_AUTH_SERVER_SECRET,
      runtimeEnv.EMAILENGINE_WEBHOOK_URL,
      runtimeEnv.EMAILENGINE_AUTH_SERVER_URL,
      dockerHealthDefaultAuthServerUrl(runtimeEnv.EMAILENGINE_AUTH_SERVER_SECRET),
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

function readDockerComposeProjectName(env: CliEnv): string | undefined {
  const value =
    env.EMAILHUB_DOCKER_COMPOSE_PROJECT_NAME ?? env.COMPOSE_PROJECT_NAME;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function dockerHealthPreparedTokenPairs(
  env: CliEnv,
): DockerComposePreparedTokenPairInput[] {
  const emailEngineAccessToken = requireDockerHealthEnvValue(
    env,
    "EMAILENGINE_ACCESS_TOKEN",
  );
  const preparedToken = requireDockerHealthEnvValue(
    env,
    "EENGINE_PREPARED_TOKEN",
  );

  return [
    {
      service: "emailengine",
      name: "accessTokenPreparedToken",
      rawToken: emailEngineAccessToken,
      expectedPreparedToken: preparedToken,
      redisUrl: "redis://redis-engine:6379/0",
    },
  ];
}

export function dockerHealthImageInvariants(
  env: CliEnv,
): DockerComposeImageInvariantInput[] {
  return [
    {
      service: "emailengine",
      name: "containerImage",
      expectedImage:
        readDockerHealthEnvValue(env, "EMAILENGINE_IMAGE") ??
        DEFAULT_EMAILENGINE_IMAGE,
    },
  ];
}

export function dockerHealthEnvInvariants(
  env: CliEnv,
): DockerComposeEnvInvariantInput[] {
  const emailEngineAccessToken = requireDockerHealthEnvValue(
    env,
    "EMAILENGINE_ACCESS_TOKEN",
  );
  const preparedToken = requireDockerHealthEnvValue(
    env,
    "EENGINE_PREPARED_TOKEN",
  );
  const serviceSecret = requireDockerHealthEnvValue(env, "EENGINE_SECRET");
  const webhookSecret = requireDockerHealthEnvValue(
    env,
    "EMAILENGINE_WEBHOOK_SECRET",
  );
  const authServerSecret = requireDockerHealthEnvValue(
    env,
    "EMAILENGINE_AUTH_SERVER_SECRET",
  );
  const webhookUrl =
    readDockerHealthEnvValue(env, "EMAILENGINE_WEBHOOK_URL") ??
    "http://api:8080/api/webhooks/emailengine";
  const authServerUrl =
    readDockerHealthEnvValue(env, "EMAILENGINE_AUTH_SERVER_URL") ??
    dockerHealthDefaultAuthServerUrl(authServerSecret);

  return [
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
      service: "api",
      name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
      expected: "false",
    },
    {
      service: "worker",
      name: "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN",
      expected: "true",
    },
    {
      service: "worker",
      name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
      expected: "false",
    },
    {
      service: "emailengine",
      name: "EENGINE_PREPARED_TOKEN",
      expected: preparedToken,
    },
    {
      service: "emailengine",
      name: "EENGINE_SECRET",
      expected: serviceSecret,
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["serviceSecret"],
      expected: webhookSecret,
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["authServer"],
      expected: authServerUrl,
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["webhooks"],
      expected: webhookUrl,
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["webhooksEnabled"],
      expected: true,
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["webhookEvents"],
      expected: ["*"],
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["notifyText"],
      expected: false,
    },
    {
      service: "emailengine",
      name: "EENGINE_SETTINGS",
      valuePath: ["notifyAttachments"],
      expected: false,
    },
    {
      service: "api",
      name: "EMAILENGINE_ACCESS_TOKEN",
      expected: emailEngineAccessToken,
    },
    {
      service: "api",
      name: "EMAILENGINE_URL",
      expected: "http://emailengine:3000",
    },
    {
      service: "api",
      name: "EENGINE_PREPARED_TOKEN",
      expected: preparedToken,
    },
    {
      service: "api",
      name: "EENGINE_SECRET",
      expected: serviceSecret,
    },
    {
      service: "api",
      name: "EMAILENGINE_WEBHOOK_SECRET",
      expected: webhookSecret,
    },
    {
      service: "api",
      name: "EMAILENGINE_AUTH_SERVER_SECRET",
      expected: authServerSecret,
    },
    {
      service: "worker",
      name: "EMAILENGINE_ACCESS_TOKEN",
      expected: emailEngineAccessToken,
    },
    {
      service: "worker",
      name: "EMAILENGINE_URL",
      expected: "http://emailengine:3000",
    },
    {
      service: "worker",
      name: "EENGINE_PREPARED_TOKEN",
      expected: preparedToken,
    },
    {
      service: "worker",
      name: "EMAILENGINE_WEBHOOK_SECRET",
      expected: webhookSecret,
    },
  ];
}

function requireDockerHealthEnvValue(env: CliEnv, name: string): string {
  const value = readDockerHealthEnvValue(env, name);
  if (!value) {
    throw new Error(
      `${name} must be set before running the production Docker health gate.`,
    );
  }
  return value;
}

function readDockerHealthEnvValue(
  env: CliEnv,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function dockerHealthDefaultAuthServerUrl(authServerSecret: string): string;
function dockerHealthDefaultAuthServerUrl(
  authServerSecret: string | undefined,
): string | undefined;
function dockerHealthDefaultAuthServerUrl(
  authServerSecret: string | undefined,
): string | undefined {
  const secret = authServerSecret?.trim();
  return secret
    ? `http://emailengine:${secret}@api:8080/api/mail-engine/auth-server`
    : undefined;
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

export function basicAuthHeaders(
  username: string,
  password: string,
): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
      "base64",
    )}`,
  };
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
