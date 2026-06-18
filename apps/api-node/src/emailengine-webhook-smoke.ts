import { runEmailEngineWebhookSmokeCli } from "./emailengine-webhook-smoke-runner.js";

process.exitCode = await runEmailEngineWebhookSmokeCli();
