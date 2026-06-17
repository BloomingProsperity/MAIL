import { describe, expect, it } from "vitest";

import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

describe("Docker compose health verifier", () => {
  it("passes when all required EmailEngine-first services are running and healthy", async () => {
    const calls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: async (input) => {
        calls.push(input);
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
      },
    });

    expect(result).toMatchObject({
      ok: true,
      gate: "docker_compose_health",
      envFile: ".env",
      composeFiles: [
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ],
      requiredFollowUps: [],
    });
    expect(result.checks.worker).toEqual({
      ok: true,
      service: "worker",
      state: "running",
      health: "healthy",
    });
    expect(result.hostChecks).toEqual({});
    expect(calls).toEqual([
      {
        command: "docker",
        cwd: "/repo",
        args: [
          "compose",
          "--env-file",
          ".env",
          "-f",
          "infra/docker-compose.yml",
          "-f",
          "infra/docker-compose.prod.yml",
          "ps",
          "--format",
          "json",
        ],
      },
    ]);
  });

  it("passes optional host HTTP probes for API, EmailEngine readiness, and web", async () => {
    const httpCalls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: healthyComposeCommand,
      hostChecks: [
        {
          name: "api_health",
          url: "http://127.0.0.1:8080/health",
          expect: "http_ok",
        },
        {
          name: "mail_engine_readiness",
          url: "http://127.0.0.1:8080/api/mail-engine/health",
          expect: "mail_engine_ready",
        },
        {
          name: "web_home",
          url: "http://127.0.0.1:5173/",
          expect: "http_ok",
        },
      ],
      httpGet: async (input) => {
        httpCalls.push(input);
        return {
          status: 200,
          body: input.url.includes("/api/mail-engine/health")
            ? JSON.stringify({ ok: true, readiness: { status: "ready" } })
            : "ok",
        };
      },
      httpTimeoutMs: 250,
    });

    expect(result.ok).toBe(true);
    expect(result.hostChecks.mail_engine_readiness).toEqual({
      ok: true,
      name: "mail_engine_readiness",
      url: "http://127.0.0.1:8080/api/mail-engine/health",
      status: 200,
      readinessStatus: "ready",
    });
    expect(httpCalls).toEqual([
      { url: "http://127.0.0.1:8080/health", timeoutMs: 250 },
      {
        url: "http://127.0.0.1:8080/api/mail-engine/health",
        timeoutMs: 250,
      },
      { url: "http://127.0.0.1:5173/", timeoutMs: 250 },
    ]);
  });

  it("fails when host EmailEngine readiness is not ready", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: healthyComposeCommand,
      hostChecks: [
        {
          name: "mail_engine_readiness",
          url: "http://127.0.0.1:8080/api/mail-engine/health",
          expect: "mail_engine_ready",
        },
      ],
      httpGet: async () => ({
        status: 200,
        body: JSON.stringify({ ok: true, readiness: { status: "blocked" } }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.hostChecks.mail_engine_readiness).toEqual({
      ok: false,
      name: "mail_engine_readiness",
      url: "http://127.0.0.1:8080/api/mail-engine/health",
      status: 200,
      readinessStatus: "blocked",
      detail: "mail_engine_not_ready",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix host HTTP check: mail_engine_readiness url=http://127.0.0.1:8080/api/mail-engine/health detail=mail_engine_not_ready.",
    ]);
  });

  it("fails when a required service is missing or unhealthy", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env.example",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([
          service("postgres"),
          service("redis-engine"),
          service("emailengine", { Health: "unhealthy" }),
          service("api"),
          service("web"),
        ]),
        stderr: "",
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.emailengine).toEqual({
      ok: false,
      service: "emailengine",
      state: "running",
      health: "unhealthy",
      detail: "service_not_healthy",
    });
    expect(result.checks.worker).toEqual({
      ok: false,
      service: "worker",
      detail: "service_missing",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix unhealthy Docker service: emailengine state=running health=unhealthy.",
      "Start missing Docker service: worker.",
    ]);
  });

  it("supports newline-delimited docker compose JSON output", async () => {
    const rows = [
      service("postgres"),
      service("redis-engine"),
      service("emailengine"),
      service("api"),
      service("worker"),
      service("web"),
    ];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml"],
      runCommand: async () => ({
        exitCode: 0,
        stdout: rows.map((row) => JSON.stringify(row)).join("\n"),
        stderr: "",
      }),
    });

    expect(result.ok).toBe(true);
  });

  it("fails closed when docker compose ps cannot run without leaking stderr", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml"],
      runCommand: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "permission denied token=secret",
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.worker).toEqual({
      ok: false,
      service: "worker",
      detail: "docker_compose_ps_failed",
    });
    expect(result.requiredFollowUps).toEqual([
      "Run the Docker compose stack before launch verification and inspect docker compose ps/logs.",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

function service(
  name: string,
  overrides: Partial<Record<"State" | "Health", string>> = {},
): Record<string, unknown> {
  return {
    State: "running",
    Health: "healthy",
    ...overrides,
    Service: name,
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
