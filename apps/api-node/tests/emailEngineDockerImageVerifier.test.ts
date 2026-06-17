import { describe, expect, it } from "vitest";

import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

describe("Docker compose image verifier", () => {
  it("passes when the running EmailEngine container image matches the expected image", async () => {
    const calls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      imageInvariants: [
        {
          service: "emailengine",
          name: "containerImage",
          expectedImage: EXPECTED_IMAGE,
        },
      ],
      runCommand: async (input) => {
        calls.push(input);
        return dockerCommand(input.args, EXPECTED_IMAGE);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.imageChecks).toEqual({
      "emailengine.containerImage": {
        ok: true,
        service: "emailengine",
        name: "containerImage",
      },
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.arrayContaining(["ps", "-q", "emailengine"]),
        }),
        expect.objectContaining({
          args: [
            "inspect",
            "--format",
            "{{ .Config.Image }}",
            "emailengine_container",
          ],
        }),
      ]),
    );
  });

  it("fails without waiting when the running EmailEngine container image drifts", async () => {
    const sleeps: number[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      imageInvariants: [
        {
          service: "emailengine",
          name: "containerImage",
          expectedImage: EXPECTED_IMAGE,
        },
      ],
      runCommand: async (input) => dockerCommand(input.args, "postalsys/emailengine:latest"),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.imageChecks).toEqual({
      "emailengine.containerImage": {
        ok: false,
        service: "emailengine",
        name: "containerImage",
        detail: "image_mismatch",
      },
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix Docker image invariant: emailengine.containerImage.",
    ]);
    expect(JSON.stringify(result)).not.toContain("postalsys/emailengine:latest");
    expect(sleeps).toEqual([]);
  });
});

const EXPECTED_IMAGE =
  "postalsys/emailengine:v2.71.0@sha256:4f732fd40e39f8e3af0b3d1580f1972a7e7270741be510f217a6b07eac5b0efc";

async function dockerCommand(args: string[], image: string) {
  if (args.includes("--format") && args.includes("json")) {
    return healthyComposeCommand();
  }
  if (args.includes("-q")) {
    return {
      exitCode: 0,
      stdout: "emailengine_container\n",
      stderr: "",
    };
  }
  if (args.includes("inspect")) {
    return {
      exitCode: 0,
      stdout: `${image}\n`,
      stderr: "",
    };
  }
  throw new Error(`unexpected docker command: ${args.join(" ")}`);
}

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
