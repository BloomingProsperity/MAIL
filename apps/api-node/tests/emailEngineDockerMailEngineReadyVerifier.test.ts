import { describe, expect, it } from "vitest";

import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

describe("Docker EmailEngine readiness host probe", () => {
  it("fails without waiting when the ready provider is not EmailEngine", async () => {
    const sleeps: number[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      runCommand: healthyComposeCommand,
      hostChecks: [mailEngineReadinessCheck()],
      httpGet: async () => ({
        status: 200,
        body: JSON.stringify(
          mailEngineReadyBody({
            provider: "native",
          }),
        ),
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.hostChecks.mail_engine_readiness).toEqual({
      ok: false,
      name: "mail_engine_readiness",
      url: "http://127.0.0.1:8080/api/mail-engine/health",
      status: 200,
      readinessStatus: "ready",
      detail: "mail_engine_provider_unexpected",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix host HTTP check: mail_engine_readiness url=http://127.0.0.1:8080/api/mail-engine/health detail=mail_engine_provider_unexpected.",
    ]);
    expect(sleeps).toEqual([]);
  });

  it("fails without waiting when launch-critical capabilities are missing", async () => {
    const sleeps: number[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      runCommand: healthyComposeCommand,
      hostChecks: [mailEngineReadinessCheck()],
      httpGet: async () => ({
        status: 200,
        body: JSON.stringify(
          mailEngineReadyBody({
            capabilities: {
              imapSmtpOnboarding: true,
              attachmentDownload: false,
              send: true,
            },
          }),
        ),
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.hostChecks.mail_engine_readiness).toEqual({
      ok: false,
      name: "mail_engine_readiness",
      url: "http://127.0.0.1:8080/api/mail-engine/health",
      status: 200,
      readinessStatus: "ready",
      detail: "mail_engine_capabilities_missing",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix host HTTP check: mail_engine_readiness url=http://127.0.0.1:8080/api/mail-engine/health detail=mail_engine_capabilities_missing.",
    ]);
    expect(sleeps).toEqual([]);
  });
});

function mailEngineReadinessCheck() {
  return {
    name: "mail_engine_readiness",
    url: "http://127.0.0.1:8080/api/mail-engine/health",
    expect: "mail_engine_ready" as const,
  };
}

function mailEngineReadyBody(
  overrides: {
    provider?: string;
    capabilities?: {
      imapSmtpOnboarding?: boolean;
      attachmentDownload?: boolean;
      send?: boolean;
    };
  } = {},
): Record<string, unknown> {
  return {
    ok: true,
    provider: overrides.provider ?? "emailengine",
    readiness: {
      status: "ready",
    },
    capabilities: {
      imapSmtpOnboarding: true,
      attachmentDownload: true,
      send: true,
      ...overrides.capabilities,
    },
  };
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
