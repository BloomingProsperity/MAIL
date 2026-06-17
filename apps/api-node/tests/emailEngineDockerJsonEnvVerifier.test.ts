import { describe, expect, it } from "vitest";

import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

describe("Docker compose JSON env verifier", () => {
  it("passes boolean and array JSON env invariants", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: [
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["webhooksEnabled"],
          expected: true,
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["webhookEvents"],
          expected: ["*"],
        },
      ],
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            webhooksEnabled: true,
            webhookEvents: ["*"],
          }),
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.envChecks).toEqual({
      "emailengine.EENGINE_SETTINGS.webhooksEnabled": {
        ok: true,
        service: "emailengine",
        name: "EENGINE_SETTINGS.webhooksEnabled",
      },
      "emailengine.EENGINE_SETTINGS.webhookEvents": {
        ok: true,
        service: "emailengine",
        name: "EENGINE_SETTINGS.webhookEvents",
      },
    });
  });

  it("fails without leaking actual or expected JSON values when webhook settings drift", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: [
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["webhooksEnabled"],
          expected: true,
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["webhookEvents"],
          expected: ["*"],
        },
      ],
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            webhooksEnabled: false,
            webhookEvents: ["messageNew"],
          }),
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.envChecks).toEqual({
      "emailengine.EENGINE_SETTINGS.webhooksEnabled": {
        ok: false,
        service: "emailengine",
        name: "EENGINE_SETTINGS.webhooksEnabled",
        detail: "env_value_mismatch",
      },
      "emailengine.EENGINE_SETTINGS.webhookEvents": {
        ok: false,
        service: "emailengine",
        name: "EENGINE_SETTINGS.webhookEvents",
        detail: "env_value_mismatch",
      },
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix Docker env invariant: emailengine.EENGINE_SETTINGS.webhooksEnabled.",
      "Fix Docker env invariant: emailengine.EENGINE_SETTINGS.webhookEvents.",
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("messageNew");
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
    State: "running",
    Health: "healthy",
    Service: name,
  };
}
