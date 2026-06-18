import { fileURLToPath } from "node:url";

import { loadCliEnvFile, type CliEnv } from "./cli/env-file.js";
import { writeSmokeFailureReport } from "./cli/smoke-report.js";
import { productionEnvSecretValues } from "./emailengine-prod-env-verify-runner.js";
import {
  runEmailEngineWebhookSmoke,
  type RunEmailEngineWebhookSmokeInput,
} from "./mail-engine/webhook-smoke.js";

export interface EmailEngineWebhookSmokeCliOptions {
  env?: CliEnv;
  fileExists?: (path: string) => boolean;
  readEnvFile?: (path: string) => string | undefined;
  runWebhookSmoke?: EmailEngineWebhookSmokeRunner;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export type EmailEngineWebhookSmokeRunner = (
  input: RunEmailEngineWebhookSmokeInput,
) => ReturnType<typeof runEmailEngineWebhookSmoke>;

export async function runEmailEngineWebhookSmokeCli(
  options: EmailEngineWebhookSmokeCliOptions = {},
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
  const secret =
    runtimeEnv.EMAILENGINE_WEBHOOK_SECRET ?? "dev-emailhub-secret";
  const accountId = runtimeEnv.EMAILHUB_SMOKE_ACCOUNT_ID;
  const eventName = runtimeEnv.EMAILHUB_SMOKE_WEBHOOK_EVENT;
  const runWebhookSmoke = options.runWebhookSmoke ?? runEmailEngineWebhookSmoke;
  const writeStdout = options.writeStdout ?? console.log;

  try {
    const result = await runWebhookSmoke({
      apiBaseUrl,
      secret,
      accountId,
      eventName,
    });

    writeStdout(
      JSON.stringify(
        {
          ok: true,
          smoke: "emailengine_webhook",
          apiBaseUrl,
          accountId: result.accountId,
          eventId: result.eventId,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    writeSmokeFailureReport({
      smoke: "emailengine_webhook",
      fields: {
        apiBaseUrl,
      },
      secrets: [...productionEnvSecretValues(runtimeEnv), secret],
      error,
      writeStderr: options.writeStderr,
    });
    return 1;
  }
}
