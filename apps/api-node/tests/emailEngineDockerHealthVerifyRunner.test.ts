import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EMAILENGINE_IMAGE,
  bearerTokenHeaders,
  dockerHealthEnvInvariants,
  dockerHealthImageInvariants,
  dockerHealthPreparedTokenPairs,
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
      expect(input.composeProjectName).toBe("emailhub-current-test");
      expect(input.requiredComposeFiles).toEqual([
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ]);
      expect(input.httpTimeoutMs).toBe(1200);
      expect(input.waitAttempts).toBe(2);
      expect(input.waitIntervalMs).toBe(0);
      expect(input.imageInvariants).toEqual([
        {
          service: "emailengine",
          name: "containerImage",
          expectedImage: DEFAULT_EMAILENGINE_IMAGE,
        },
      ]);
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
        {
          service: "emailengine",
          name: "EENGINE_PREPARED_TOKEN",
          expected: "prepared-token",
        },
        {
          service: "emailengine",
          name: "EENGINE_SECRET",
          expected: "service-secret",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["serviceSecret"],
          expected: "webhook-secret",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["authServer"],
          expected:
            "http://emailengine:auth-secret@api:8080/api/mail-engine/auth-server",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["webhooks"],
          expected: "http://api:8080/api/webhooks/emailengine",
        },
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
        {
          service: "api",
          name: "EMAILENGINE_ACCESS_TOKEN",
          expected: "engine-token",
        },
        {
          service: "api",
          name: "EMAILENGINE_URL",
          expected: "http://emailengine:3000",
        },
        {
          service: "api",
          name: "EENGINE_PREPARED_TOKEN",
          expected: "prepared-token",
        },
        {
          service: "api",
          name: "EENGINE_SECRET",
          expected: "service-secret",
        },
        {
          service: "api",
          name: "EMAILENGINE_WEBHOOK_SECRET",
          expected: "webhook-secret",
        },
        {
          service: "api",
          name: "EMAILENGINE_AUTH_SERVER_SECRET",
          expected: "auth-secret",
        },
        {
          service: "worker",
          name: "EMAILENGINE_ACCESS_TOKEN",
          expected: "engine-token",
        },
        {
          service: "worker",
          name: "EMAILENGINE_URL",
          expected: "http://emailengine:3000",
        },
        {
          service: "worker",
          name: "EENGINE_PREPARED_TOKEN",
          expected: "prepared-token",
        },
        {
          service: "worker",
          name: "EMAILENGINE_WEBHOOK_SECRET",
          expected: "webhook-secret",
        },
      ]);
      expect(input.preparedTokenPairs).toEqual([
        {
          service: "emailengine",
          name: "accessTokenPreparedToken",
          rawToken: "engine-token",
          expectedPreparedToken: "prepared-token",
          redisUrl: "redis://redis-engine:6379/0",
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
        EMAILHUB_DOCKER_COMPOSE_PROJECT_NAME: "emailhub-current-test",
        API_BIND: "0.0.0.0:9090",
        WEB_BIND: "0.0.0.0:3000",
        EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS: "1200",
        EMAILHUB_DOCKER_HEALTH_ATTEMPTS: "2",
        EMAILHUB_DOCKER_HEALTH_WAIT_MS: "0",
        EMAILHUB_API_TOKEN: "api-token",
        EMAILENGINE_ACCESS_TOKEN: "engine-token",
        EENGINE_PREPARED_TOKEN: "prepared-token",
        EENGINE_SECRET: "service-secret",
        EMAILENGINE_WEBHOOK_SECRET: "webhook-secret",
        EMAILENGINE_AUTH_SERVER_SECRET: "auth-secret",
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
        "COMPOSE_PROJECT_NAME=file-compose-project",
        "EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS=1800",
        "EMAILHUB_DOCKER_HEALTH_ATTEMPTS=4",
        "EMAILHUB_DOCKER_HEALTH_WAIT_MS=25",
        "EMAILHUB_API_TOKEN=file-token",
        "EMAILENGINE_ACCESS_TOKEN=file-engine-token",
        "EENGINE_PREPARED_TOKEN=file-prepared-token",
        "EENGINE_SECRET=file-service-secret",
        "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
        "EMAILENGINE_AUTH_SERVER_SECRET=file-auth-secret",
        "VITE_EMAILHUB_API_TOKEN=",
      ].join("\n"),
    );
    const result = dockerHealthResult({ ok: true });
    const verifyHealth = vi.fn(async (input) => {
      expect(input.envFile).toBe(".env.prod");
      expect(input.composeProjectName).toBe("file-compose-project");
      expect(input.httpTimeoutMs).toBe(1800);
      expect(input.waitAttempts).toBe(4);
      expect(input.waitIntervalMs).toBe(25);
      expect(input.imageInvariants).toEqual([
        {
          service: "emailengine",
          name: "containerImage",
          expectedImage: DEFAULT_EMAILENGINE_IMAGE,
        },
      ]);
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
          "EMAILENGINE_ACCESS_TOKEN=engine-token",
          "EENGINE_PREPARED_TOKEN=prepared-token",
          "EENGINE_SECRET=service-secret",
          "EMAILENGINE_WEBHOOK_SECRET=webhook-secret",
          "EMAILENGINE_AUTH_SERVER_SECRET=auth-secret",
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

  it.each([
    ["missing", ""],
    ["the development default", "dev-emailhub-token"],
  ])(
    "fails before Docker checks when the production API token is %s",
    async (_label, token) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const verifyHealth = vi.fn() as unknown as typeof verifyDockerComposeHealth;

      const exitCode = await runEmailEngineDockerHealthVerifyCli({
        env: {
          EMAILHUB_REPO_ROOT: "/repo",
          EMAILHUB_ENV_FILE: ".env.prod",
        },
        fileExists: (path) => path === "/repo/.env.prod",
        readEnvFile: () => `EMAILHUB_API_TOKEN=${token}`,
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
      expect(JSON.stringify(parsed)).toContain("EMAILHUB_API_TOKEN");
      expect(JSON.stringify(parsed)).not.toContain("dev-emailhub-token");
    },
  );

  it("fails before Docker checks when an explicit host probe URL is invalid", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyHealth = vi.fn() as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_TOKEN: "api-token",
        EMAILHUB_WEB_BASE_URL: "not-a-url",
      },
      fileExists: (path) => path === "/repo/.env.prod",
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
      error: "EMAILHUB_WEB_BASE_URL must be a valid http(s) URL.",
    });
    expect(JSON.stringify(parsed)).not.toContain("api-token");
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
        EMAILENGINE_ACCESS_TOKEN: "process-engine-token",
        EENGINE_PREPARED_TOKEN: "process-prepared-token",
        EENGINE_SECRET: "process-service-secret",
        EMAILENGINE_WEBHOOK_SECRET: "process-webhook-secret",
        EMAILENGINE_AUTH_SERVER_SECRET: "process-auth-secret",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "API_BIND=0.0.0.0:9191",
          "WEB_BIND=0.0.0.0:4242",
          "EMAILHUB_DOCKER_HEALTH_TIMEOUT_MS=1800",
          "EMAILHUB_API_TOKEN=file-token",
          "EMAILENGINE_ACCESS_TOKEN=file-engine-token",
          "EENGINE_PREPARED_TOKEN=file-prepared-token",
          "EENGINE_SECRET=file-service-secret",
          "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
          "EMAILENGINE_AUTH_SERVER_SECRET=file-auth-secret",
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
        "docker failed api-token Bearer docker-token prepared-token service-secret webhook-secret auth-secret http://emailengine:auth-secret@api:8080/api/mail-engine/auth-server http://user:secret@10.0.0.20:8080?token=abc github_pat_abc password=hunter2 /repo/.env.prod",
      );
    }) as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_BASE_URL: "http://user:secret@10.0.0.20:8080?token=abc",
        EMAILHUB_WEB_BASE_URL: "http://127.0.0.1:5173/?token=web",
        EMAILHUB_API_TOKEN: "api-token",
        EMAILENGINE_ACCESS_TOKEN: "docker-token",
        EENGINE_PREPARED_TOKEN: "prepared-token",
        EENGINE_SECRET: "service-secret",
        EMAILENGINE_WEBHOOK_SECRET: "webhook-secret",
        EMAILENGINE_AUTH_SERVER_SECRET: "auth-secret",
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
    expect(serialized).not.toContain("prepared-token");
    expect(serialized).not.toContain("service-secret");
    expect(serialized).not.toContain("webhook-secret");
    expect(serialized).not.toContain("auth-secret");
    expect(serialized).not.toContain("emailengine:auth-secret");
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

  it("builds Docker env drift invariants from selected runtime env", () => {
    expect(
      dockerHealthEnvInvariants({
        EMAILENGINE_ACCESS_TOKEN: " engine-token ",
        EENGINE_PREPARED_TOKEN: " prepared-token ",
        EENGINE_SECRET: " service-secret ",
        EMAILENGINE_WEBHOOK_SECRET: " webhook-secret ",
        EMAILENGINE_AUTH_SERVER_SECRET: " auth-secret ",
        EMAILENGINE_WEBHOOK_URL: " http://api:8080/custom-webhook ",
        EMAILENGINE_AUTH_SERVER_URL: " http://emailengine:custom-auth@api:8080/custom-auth ",
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          service: "emailengine",
          name: "EENGINE_PREPARED_TOKEN",
          expected: "prepared-token",
        },
        {
          service: "emailengine",
          name: "EENGINE_SECRET",
          expected: "service-secret",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["serviceSecret"],
          expected: "webhook-secret",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["authServer"],
          expected: "http://emailengine:custom-auth@api:8080/custom-auth",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["webhooks"],
          expected: "http://api:8080/custom-webhook",
        },
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
        {
          service: "api",
          name: "EMAILENGINE_ACCESS_TOKEN",
          expected: "engine-token",
        },
        {
          service: "api",
          name: "EMAILENGINE_URL",
          expected: "http://emailengine:3000",
        },
        {
          service: "api",
          name: "EENGINE_PREPARED_TOKEN",
          expected: "prepared-token",
        },
        {
          service: "api",
          name: "EMAILENGINE_WEBHOOK_SECRET",
          expected: "webhook-secret",
        },
        {
          service: "api",
          name: "EMAILENGINE_AUTH_SERVER_SECRET",
          expected: "auth-secret",
        },
        {
          service: "worker",
          name: "EMAILENGINE_ACCESS_TOKEN",
          expected: "engine-token",
        },
        {
          service: "worker",
          name: "EMAILENGINE_URL",
          expected: "http://emailengine:3000",
        },
        {
          service: "worker",
          name: "EENGINE_PREPARED_TOKEN",
          expected: "prepared-token",
        },
        {
          service: "worker",
          name: "EMAILENGINE_WEBHOOK_SECRET",
          expected: "webhook-secret",
        },
      ]),
    );
  });

  it("builds Docker prepared token pair checks from selected runtime env", () => {
    expect(
      dockerHealthPreparedTokenPairs({
        EMAILENGINE_ACCESS_TOKEN: " engine-token ",
        EENGINE_PREPARED_TOKEN: " prepared-token ",
      }),
    ).toEqual([
      {
        service: "emailengine",
        name: "accessTokenPreparedToken",
        rawToken: "engine-token",
        expectedPreparedToken: "prepared-token",
        redisUrl: "redis://redis-engine:6379/0",
      },
    ]);
  });

  it("builds Docker image drift checks from selected runtime env", () => {
    expect(dockerHealthImageInvariants({})).toEqual([
      {
        service: "emailengine",
        name: "containerImage",
        expectedImage: DEFAULT_EMAILENGINE_IMAGE,
      },
    ]);
    expect(
      dockerHealthImageInvariants({
        EMAILENGINE_IMAGE: " postalsys/emailengine:v2.72.0 ",
      }),
    ).toEqual([
      {
        service: "emailengine",
        name: "containerImage",
        expectedImage: "postalsys/emailengine:v2.72.0",
      },
    ]);
  });

  it("fails before Docker checks when a drift source env value is missing", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyHealth = vi.fn() as unknown as typeof verifyDockerComposeHealth;

    const exitCode = await runEmailEngineDockerHealthVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_TOKEN: "api-token",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "EMAILENGINE_ACCESS_TOKEN=engine-token",
          "EENGINE_SECRET=service-secret",
        ].join("\n"),
      verifyHealth,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(verifyHealth).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(JSON.stringify(parsed)).toContain("EENGINE_PREPARED_TOKEN");
    expect(JSON.stringify(parsed)).not.toContain("api-token");
    expect(JSON.stringify(parsed)).not.toContain("engine-token");
    expect(JSON.stringify(parsed)).not.toContain("service-secret");
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
    composeFileChecks: {},
    hostChecks: {},
    imageChecks: {},
    envChecks: {},
    preparedTokenChecks: {},
    requiredFollowUps: [],
  };
}
