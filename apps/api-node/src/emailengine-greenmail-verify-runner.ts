import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";
import { sanitizeCliError } from "./cli/safe-error.js";
import { productionEnvSecretValues } from "./emailengine-prod-env-verify-runner.js";

export interface EmailEngineGreenMailVerifyCliOptions {
  env?: CliEnv;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
  runCommand?: GreenMailVerifyCommandRunner;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export interface GreenMailVerifyCommandInput {
  command: string;
  args: string[];
  cwd: string;
  env: CliEnv;
}

export interface GreenMailVerifyCommandResult {
  status: number | null;
  error?: unknown;
}

export type GreenMailVerifyCommandRunner = (
  input: GreenMailVerifyCommandInput,
) => GreenMailVerifyCommandResult;

interface GreenMailSmokeScript {
  name: string;
  unsetEnv?: string[];
}

const GREENMAIL_SMOKE_SCRIPTS: GreenMailSmokeScript[] = [
  {
    name: "smoke:imap-smtp-onboarding",
    unsetEnv: ["EMAILHUB_SMOKE_MAIL_EMAIL"],
  },
  { name: "smoke:imap-smtp-onboarding:auth" },
  {
    name: "smoke:emailengine-real-webhook",
    unsetEnv: ["EMAILHUB_SMOKE_MAIL_EMAIL"],
  },
  {
    name: "smoke:emailengine-send",
    unsetEnv: ["EMAILHUB_SMOKE_MAIL_EMAIL", "EMAILHUB_SMOKE_RECIPIENT_EMAIL"],
  },
  {
    name: "smoke:emailengine-attachment-download",
    unsetEnv: ["EMAILHUB_SMOKE_MAIL_EMAIL"],
  },
  {
    name: "smoke:emailengine-mail-action",
    unsetEnv: ["EMAILHUB_SMOKE_MAIL_EMAIL"],
  },
];

export async function runEmailEngineGreenMailVerifyCli(
  options: EmailEngineGreenMailVerifyCliOptions = {},
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
  const runCommand = options.runCommand ?? runGreenMailCommand;
  const writeStdout = options.writeStdout ?? console.log;
  const writeStderr = options.writeStderr ?? console.error;
  const commandEnv = {
    ...process.env,
    ...runtimeEnv,
    EMAILHUB_REPO_ROOT: projectRoot,
    EMAILHUB_ENV_FILE: envFile,
  };

  for (const script of GREENMAIL_SMOKE_SCRIPTS) {
    writeStdout(`running ${script.name}`);
    const result = runCommand({
      command: "npm",
      args: ["run", script.name, "-w", "apps/api-node"],
      cwd: projectRoot,
      env: greenMailScriptEnv(commandEnv, script),
    });
    if (result.error) {
      writeStderr(
        failedGreenMailReport({
          envFile,
          script: script.name,
          error: result.error,
          env: commandEnv,
        }),
      );
      return 1;
    }
    if (result.status !== 0) {
      writeStderr(
        failedGreenMailReport({
          envFile,
          script: script.name,
          error: `command exited with ${result.status ?? "unknown"}`,
          env: commandEnv,
        }),
      );
      return result.status ?? 1;
    }
  }

  writeStdout(
    JSON.stringify(
      {
        ok: true,
        gate: "emailengine_greenmail",
        envFile,
        scripts: GREENMAIL_SMOKE_SCRIPTS.map((script) => script.name),
      },
      null,
      2,
    ),
  );
  return 0;
}

function greenMailScriptEnv(
  baseEnv: CliEnv,
  script: GreenMailSmokeScript,
): CliEnv {
  if (!script.unsetEnv?.length) {
    return baseEnv;
  }

  const env = { ...baseEnv };
  for (const key of script.unsetEnv) {
    delete env[key];
  }
  return env;
}

function runGreenMailCommand(
  input: GreenMailVerifyCommandInput,
): GreenMailVerifyCommandResult {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: input.env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  return {
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  };
}

function failedGreenMailReport(input: {
  envFile: string;
  script: string;
  error: unknown;
  env: CliEnv;
}): string {
  return JSON.stringify(
    {
      ok: false,
      gate: "emailengine_greenmail",
      envFile: input.envFile,
      failedScript: input.script,
      error: sanitizeCliError(
        input.error,
        greenMailSecretValues(input.env),
      ),
    },
    null,
    2,
  );
}

function greenMailSecretValues(env: CliEnv): Array<string | undefined> {
  return [
    ...productionEnvSecretValues(env),
    env.EMAILHUB_SMOKE_MAIL_SECRET,
    env.EMAILHUB_SMOKE_IMAP_SECRET,
    env.EMAILHUB_SMOKE_SMTP_SECRET,
    env.EMAILHUB_SMOKE_RECIPIENT_SECRET,
    env.EMAILHUB_AUTH_SMOKE_MAIL_SECRET,
    env.EMAILHUB_AUTH_SMOKE_REJECTED_SECRET,
  ];
}
