import { runEmailEngineDockerHealthVerifyCli } from "./emailengine-docker-health-verify-runner.js";

process.exitCode = await runEmailEngineDockerHealthVerifyCli();
