import { describe, expect, it, vi } from "vitest";

import {
  bearerTokenHeaders,
  readNonNegativeInteger,
  readPositiveInteger,
  runEmailEngineDockerHealthVerifyCli,
} from "../src/emailengine-docker-health-verify-runner";
import type { DockerComposeHealthVerificationResult } from "../src/mail-engine/docker-compose-health-verifier";
import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

describe("EmailEngine Docker health verify CLI runner", () => {
  it("returns zero and wires prod compose health checks when the gate passes", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = dockerHealthResult({ ok: true });
    const verifyHealth = vi.fn(async (input) => {
      expect(input.projectRoot).toBe("/repo");
      expect(input.envFile).toBe(".env.prod");
      expect(input.composeFiles).toEqual([
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ]);
      expect(input.httpTimeoutMs).toBe(1200);
      expect(input.waitAttempts).toBe(2);
      expect(input.waitIntervalMs).toBe(0);
      expect(input.envInvariants).toEqual([
        {
          service: "api",
          name: "NODE_ENV",
          expected: "production",
        },
        {
          service: "api",
          name: "EMAILHUB_ALLOW_DEV_SECRETS",
          expected: "false",
        },
        {
          service: "api",
          name: "EMAILHUB_REQUIRE_API_TOKEN",
          expected: "true",
        },
        {
          service: "worker",
          name: "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN",
          expected: "true",
        },
      ]);
      expect(input.hostChecks).toEqual([
        {
          name: "api_health",
          url: "http://127.0.0.1:9090/health",
          expect: "http_ok",
          headers: { authorization: "Bearer api-token" },
        },
        {
          name: "mail_engine_readiness",
          url: "http://127.0.0.1:9090/api/mail-engine/health",
          expect: "mail_engine_ready",
          headers: { authorization: "Bearer api-token" },
        },
        {
          name: "web_home",
          url: "http://127.0.0.1:3000/",
          expect: "http_ok",
        },
      ]);
      return result;
    }) as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        API_BIND: "0.0.0.0:9090",
        WEB_BIND: "0.0.0.0:3000",
        EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS: "1200",
        EMAILHUB_DOCKER_HEALTH_ATTEMPTS: "2",
        EMAILHUB_DOCKER_HEALTH_WAIT_MS: "0",
        EMAILHUB_API_TOKEN: "api-token",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      verifyHealth,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      ok: true,
      gate: "docker_compose_health",
    });
    expect(JSON.stringify(stdout)).not.toContain("api-token");
  });

  it("uses the selected env file for host probes when process env does not override it", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const readEnvFile = vi.fn(() =>
      [
        "API_BIND=0.0.0.0:9191",
        "WEB_BIND=0.0.0.0:4242",
        "EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS=1800",
        "EMAILHUB_DOCKER_HEALTH_ATTEMPTS=4",
        "EMAILHUB_DOCKER_HEALTH_WAIT_MS=25",
        "EMAILHUB_API_TOKEN=file-token",
        "VITE_EMAILHUB_API_TOKEN=",
      ].join("\n"),
    );
    const result = dockerHealthResult({ ok: true });
    const verifyHealth = vi.fn(async (input) => {
      expect(input.envFile).toBe(".env.prod");
      expect(input.httpTimeoutMs).toBe(1800);
      expect(input.waitAttempts).toBe(4);
      expect(input.waitIntervalMs).toBe(25);
      expect(input.hostChecks).toEqual([
        {
          name: "api_health",
          url: "http://127.0.0.1:9191/health",
          expect: "http_ok",
          headers: { authorization: "Bearer file-token" },
        },
        {
          name: "mail_engine_readiness",
          url: "http://127.0.0.1:9191/api/mail-engine/health",
          expect: "mail_engine_ready",
          headers: { authorization: "Bearer file-token" },
        },
        {
          name: "web_home",
          url: "http://127.0.0.1:4242/",
          expect: "http_ok",
        },
      ]);
      return result;
    }) as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile,
      verifyHealth,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(readEnvFile).toHaveBeenCalledWith("/repo/.env.prod");
    expect(JSON.stringify(stdout)).not.toContain("file-token");
  });

  it("fails before Docker checks when the built web token would not match the API token", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyHealth = vi.fn() as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "EMAILHUB_API_TOKEN=api-token",
          "VITE_EMAILHUB_API_TOKEN=wrong-web-token",
        ].join("\n"),
      verifyHealth,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(verifyHealth).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "docker_compose_health",
      projectRoot: "/repo",
      envFile: ".env.prod",
    });
    expect(JSON.stringify(parsed)).toContain("VITE_EMAILHUB_API_TOKEN");
    expect(JSON.stringify(parsed)).not.toContain("api-token");
    expect(JSON.stringify(parsed)).not.toContain("wrong-web-token");
  });

  it("lets process env override selected env file host probe settings", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = dockerHealthResult({ ok: true });
    const verifyHealth = vi.fn(async (input) => {
      expect(input.httpTimeoutMs).toBe(900);
      expect(input.hostChecks?.[0]).toMatchObject({
        url: "http://127.0.0.1:8088/health",
        headers: { authorization: "Bearer process-token" },
      });
      expect(input.hostChecks?.[2]).toMatchObject({
        url: "http://127.0.0.1:4242/",
      });
      return result;
    }) as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        API_BIND: "0.0.0.0:8088",
        EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS: "900",
        EMAILHUB_API_TOKEN: "process-token",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "API_BIND=0.0.0.0:9191",
          "WEB_BIND=0.0.0.0:4242",
          "EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS=1800",
          "EMAILHUB_API_TOKEN=file-token",
        ].join("\n"),
      verifyHealth,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.stringify(stdout)).not.toContain("process-token");
    expect(JSON.stringify(stdout)).not.toContain("file-token");
  });

  it("returns one and redacts top-level docker health errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyHealth = vi.fn(async () => {
      throw new Error(
        "docker failed api-token Bearer docker-token http://user:secret@10.0.0.20:8080?token=abc github_pat_abc password=hunter2 /repo/.env.prod",
      );
    }) as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_BASE_URL: "http://user:secret@10.0.0.20:8080?token=abc",
        EMAILHUB_WEB_BASE_URL: "http://127.0.0.1:5173/?token=web",
        EMAILHUB_API_TOKEN: "api-token",
      },
      fileExists: () => true,
      verifyHealth,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "docker_compose_health",
      projectRoot: "/repo",
      envFile: ".env.prod",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("api-token");
    expect(serialized).not.toContain("docker-token");
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("10.0.0.20");
    expect(serialized).not.toContain("github_pat_abc");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("token=abc");
  });

  it("parses numeric env values and bearer headers", () => {
    expect(readPositiveInteger("15", 1)).toBe(15);
    expect(readPositiveInteger("0", 1)).toBe(1);
    expect(readNonNegativeInteger("0", 5)).toBe(0);
    expect(readNonNegativeInteger("-1", 5)).toBe(5);
    expect(bearerTokenHeaders(" token ")).toEqual({
      authorization: "Bearer token",
    });
    expect(bearerTokenHeaders(" ")).toBeUndefined();
  });
});

function dockerHealthResult(input: {
  ok: boolean;
}): DockerComposeHealthVerificationResult {
  return {
    ok: input.ok,
    gate: "docker_compose_health",
    checkedAt: "2026-06-17T12:00:00.000Z",
    attempts: 1,
    maxAttempts: 1,
    composeFiles: [
      "infra/docker-compose.yml",
      "infra/docker-compose.prod.yml",
    ],
    envFile: ".env.prod",
    checks: {},
    hostChecks: {},
    envChecks: {},
    requiredFollowUps: [],
  };
}
