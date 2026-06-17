import { fileURLToPath } from "node:url";

import { createApiTokenFetch } from "./api-token-fetch.js";
import {
  normalizeApiBaseUrl,
  verifyEmailEngineLaunch,
} from "./mail-engine/launch-verifier.js";
import { sanitizeCliError } from "./cli/safe-error.js";
import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";

export interface EmailEngineLaunchVerifyCliOptions {
  env?: CliEnv;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
  fetchImpl?: typeof fetch;
  verifyLaunch?: typeof verifyEmailEngineLaunch;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export async function runEmailEngineLaunchVerifyCli(
  options: EmailEngineLaunchVerifyCliOptions = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const projectRoot =
    env.EMAILHUB_REPO_ROOT ??
    fileURLToPath(new URL("../../..", import.meta.url));
  const { runtimeEnv } = loadCliEnvFile({
    env,
    projectRoot,
    fileExists: options.fileExists,
    readEnvFile: options.readEnvFile,
  });
  const apiBaseUrl =
    runtimeEnv.EMAILHUB_API_BASE_URL ?? "http://127.0.0.1:8080";
  const timeoutMs = readPositiveInteger(
    runtimeEnv.EMAILHUB_LAUNCH_VERIFY_TIMEOUT_MS,
    10_000,
  );
  const writeStdout = options.writeStdout ?? console.log;
  const writeStderr = options.writeStderr ?? console.error;
  const verifyLaunch = options.verifyLaunch ?? verifyEmailEngineLaunch;

  try {
    const result = await verifyLaunch({
      apiBaseUrl,
      timeoutMs,
      fetchImpl: createApiTokenFetch(
        options.fetchImpl ?? fetch,
        runtimeEnv.EMAILHUB_API_TOKEN,
      ),
    });
    writeStdout(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    writeStderr(
      JSON.stringify(
        {
          ok: false,
          gate: "emailengine_launch",
          apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
          error: sanitizeLaunchVerifyError(error, [
            apiBaseUrl,
            runtimeEnv.EMAILHUB_API_TOKEN,
          ]),
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

export function sanitizeLaunchVerifyError(
  error: unknown,
  secrets: Array<string | undefined> = [],
): string {
  return sanitizeCliError(error, secrets);
}
