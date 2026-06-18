import { fileURLToPath } from "node:url";

import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";
import { sanitizeCliError } from "./cli/safe-error.js";
import {
  createEmailEngineLaunchReadinessReport,
  type EmailEngineLaunchReadinessReport,
} from "./mail-engine/launch-readiness-report.js";

export interface EmailEngineLaunchReadinessReportCliOptions {
  env?: CliEnv;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
  createReport?: typeof createEmailEngineLaunchReadinessReport;
  now?: () => Date;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export async function runEmailEngineLaunchReadinessReportCli(
  options: EmailEngineLaunchReadinessReportCliOptions = {},
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
  const createReport =
    options.createReport ?? createEmailEngineLaunchReadinessReport;

  try {
    const result = createReport({
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
          gate: "emailengine_launch_readiness",
          envFile,
          error: sanitizeCliError(error, launchReadinessSecretValues(runtimeEnv)),
        },
        null,
        2,
      ),
    );
    return 1;
  }
}

export function launchReadinessSecretValues(
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
    env.EMAILHUB_SMOKE_MAIL_SECRET,
    env.EMAILHUB_SMOKE_IMAP_SECRET,
    env.EMAILHUB_SMOKE_SMTP_SECRET,
    env.EMAILHUB_AUTH_SMOKE_MAIL_SECRET,
    env.EMAILHUB_AUTH_SMOKE_REJECTED_SECRET,
  ];
}

export type { EmailEngineLaunchReadinessReport };
