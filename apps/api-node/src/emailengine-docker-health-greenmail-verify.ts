import { runEmailEngineDockerHealthVerifyCli } from "./emailengine-docker-health-verify-runner.js";

process.exitCode = await runEmailEngineDockerHealthVerifyCli({
  env: {
    ...process.env,
    EMAILHUB_DOCKER_HEALTH_INCLUDE_TEST_OVERLAY: "true",
  },
});
