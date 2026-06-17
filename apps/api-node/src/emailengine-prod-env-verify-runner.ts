import { fileURLToPath } from "node:url";

import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";
import { sanitizeCliError } from "./cli/safe-error.js";
import {
  verifyEmailEngineProductionEnv,
  type EmailEngineProductionEnvPreflightResult,
} from "./mail-engine/production-env-preflight.js";

export interface EmailEngineProdEnvVerifyCliOptions {
  env?: CliEnv;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
  verifyPreflight?: typeof verifyEmailEngineProductionEnv;
  now?: () => Date;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export async function runEmailEngineProdEnvVerifyCli(
  options: EmailEngineProdEnvVerifyCliOptions = {},
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
  const writeStdout = options.writeStdout ?? console.log;
  const writeStderr = options.writeStderr ?? console.error;
  const verifyPreflight =
    options.verifyPreflight ?? verifyEmailEngineProductionEnv;

  try {
    const result = verifyPreflight({
      env: runtimeEnv,
      envFile,
      now: options.now,
    });
    writeStdout(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    writeStderr(
      JSON.stringify(
        {
          ok: false,
          gate: "emailengine_prod_env",
          envFile,
          error: sanitizeCliError(error, productionEnvSecretValues(runtimeEnv)),
        },
        null,
        2,
      ),
    );
    return 1;
  }
}

export function productionEnvSecretValues(
  env: CliEnv,
): Array<string | undefined> {
  return [
    env.EMAILHUB_API_TOKEN,
    env.VITE_EMAILHUB_API_TOKEN,
    env.EMAILENGINE_ACCESS_TOKEN,
    env.EENGINE_PREPARED_TOKEN,
    env.EMAILENGINE_WEBHOOK_SECRET,
    env.EMAILENGINE_AUTH_SERVER_SECRET,
    env.EENGINE_SECRET,
    env.POSTGRES_PASSWORD,
    env.HERMES_API_KEY,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.MICROSOFT_OAUTH_CLIENT_SECRET,
  ];
}

export type { EmailEngineProductionEnvPreflightResult };
