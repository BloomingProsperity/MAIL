import { runEmailEngineProdEnvVerifyCli } from "./emailengine-prod-env-verify-runner.js";

process.exitCode = await runEmailEngineProdEnvVerifyCli();
