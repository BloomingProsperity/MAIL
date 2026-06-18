import { describe, expect, it } from "vitest";

import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

const nativeEngineEnvInvariants = [
  {
    service: "api",
    name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
    expected: { kind: "absent" as const },
  },
  {
    service: "worker",
    name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
    expected: { kind: "absent" as const },
  },
];

describe("Docker compose native engine launch gate", () => {
  it("passes when API and worker do not expose a Native/Core runtime switch", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: nativeEngineEnvInvariants,
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }

        return {
          exitCode: 1,
          stdout: "",
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.envChecks).toEqual({
      "api.EMAILHUB_NATIVE_ENGINE_ENABLED": {
        ok: true,
        service: "api",
        name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
      },
      "worker.EMAILHUB_NATIVE_ENGINE_ENABLED": {
        ok: true,
        service: "worker",
        name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
      },
    });
  });

  it("fails when running API or worker containers expose a Native/Core switch", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: nativeEngineEnvInvariants,
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }

        return {
          exitCode: 0,
          stdout: "false\n",
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.envChecks).toEqual({
      "api.EMAILHUB_NATIVE_ENGINE_ENABLED": {
        ok: false,
        service: "api",
        name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
        detail: "env_value_mismatch",
      },
      "worker.EMAILHUB_NATIVE_ENGINE_ENABLED": {
        ok: false,
        service: "worker",
        name: "EMAILHUB_NATIVE_ENGINE_ENABLED",
        detail: "env_value_mismatch",
      },
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix Docker env invariant: api.EMAILHUB_NATIVE_ENGINE_ENABLED.",
      "Fix Docker env invariant: worker.EMAILHUB_NATIVE_ENGINE_ENABLED.",
    ]);
  });
});

async function healthyComposeCommand() {
  return {
    exitCode: 0,
    stdout: JSON.stringify([
      service("postgres"),
      service("redis-engine"),
      service("emailengine"),
      service("api"),
      service("worker"),
      service("web"),
    ]),
    stderr: "",
  };
}

function service(name: string): Record<string, unknown> {
  return {
    Service: name,
    State: "running",
    Health: "healthy",
  };
}
