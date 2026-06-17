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

  it("targets the selected Docker compose project for all compose commands", async () => {
    const calls: Array<{ args: string[] }> = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeProjectName: "emailhub-current-test",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      requiredComposeFiles: [
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ],
      preparedTokenPairs: [
        {
          service: "emailengine",
          name: "accessTokenPreparedToken",
          rawToken: "raw-token",
          expectedPreparedToken: "prepared-token",
        },
      ],
      runCommand: async (input) => {
        calls.push({ args: input.args });
        if (input.args.includes("inspect")) {
          return {
            exitCode: 0,
            stdout:
              "/repo/infra/docker-compose.yml,/repo/infra/docker-compose.prod.yml\n",
            stderr: "",
          };
        }
        if (input.args.includes("tokens")) {
          return {
            exitCode: 0,
            stdout: "prepared-token\n",
            stderr: "",
          };
        }
        if (input.args.includes("--format")) {
          return healthyComposeCommand();
        }
        if (input.args.includes("-q")) {
          const serviceName = input.args.at(-1);
          return {
            exitCode: 0,
            stdout: `${serviceName}_container\n`,
            stderr: "",
          };
        }
        throw new Error(`unexpected docker command: ${input.args.join(" ")}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.composeProjectName).toBe("emailhub-current-test");
    const composeCalls = calls.filter((call) => call.args[0] === "compose");
    expect(composeCalls.length).toBeGreaterThan(1);
    expect(
      composeCalls.every(
        (call) =>
          call.args[1] === "--project-name" &&
          call.args[2] === "emailhub-current-test",
      ),
    ).toBe(true);
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
            ? JSON.stringify({
                ok: true,
                provider: "emailengine",
                readiness: { status: "ready" },
                capabilities: {
                  imapSmtpOnboarding: true,
                  attachmentDownload: true,
                  send: true,
                },
              })
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

  it("verifies running containers include required compose config files", async () => {
    const calls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      requiredComposeFiles: [
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ],
      runCommand: async (input) => {
        calls.push(input);
        if (input.args.includes("inspect")) {
          return {
            exitCode: 0,
            stdout:
              "/repo/infra/docker-compose.yml,/repo/infra/docker-compose.prod.yml\n",
            stderr: "",
          };
        }
        if (input.args.includes("--format")) {
          return healthyComposeCommand();
        }
        if (input.args.includes("-q")) {
          const serviceName = input.args.at(-1);
          return {
            exitCode: 0,
            stdout: `${serviceName}_container\n`,
            stderr: "",
          };
        }
        throw new Error(`unexpected docker command: ${input.args.join(" ")}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.composeFileChecks).toEqual(
      composeFileChecksForServices({
        postgres: { ok: true },
        "redis-engine": { ok: true },
        emailengine: { ok: true },
        api: { ok: true },
        worker: { ok: true },
        web: { ok: true },
      }),
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.arrayContaining(["ps", "-q", "api"]),
        }),
        expect.objectContaining({
          args: expect.arrayContaining(["ps", "-q", "worker"]),
        }),
        expect.objectContaining({
          args: expect.arrayContaining([
            "inspect",
            "--format",
            '{{ index .Config.Labels "com.docker.compose.project.config_files" }}',
            "api_container",
          ]),
        }),
      ]),
    );
  });

  it("fails when any required container was not started with the required prod compose overlay", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      requiredComposeFiles: [
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ],
      runCommand: async (input) => {
        if (input.args.includes("inspect")) {
          const containerId = String(input.args.at(-1));
          return {
            exitCode: 0,
            stdout: containerId.startsWith("worker_")
              ? "/repo/infra/docker-compose.yml\n"
              : "/repo/infra/docker-compose.yml,/repo/infra/docker-compose.prod.yml\n",
            stderr: "",
          };
        }
        if (input.args.includes("--format")) {
          return healthyComposeCommand();
        }
        if (input.args.includes("-q")) {
          const serviceName = input.args.at(-1);
          return {
            exitCode: 0,
            stdout: `${serviceName}_container\n`,
            stderr: "",
          };
        }
        throw new Error(`unexpected docker command: ${input.args.join(" ")}`);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.composeFileChecks).toEqual(
      composeFileChecksForServices({
        postgres: { ok: true },
        "redis-engine": { ok: true },
        emailengine: { ok: true },
        api: { ok: true },
        worker: {
          ok: false,
          missingFiles: ["infra/docker-compose.prod.yml"],
          detail: "config_file_missing",
        },
        web: { ok: true },
      }),
    );
    expect(result.requiredFollowUps).toEqual([
      "Restart Docker compose service worker with required compose files: infra/docker-compose.prod.yml.",
    ]);
  });

  it("fails when a running container includes an unexpected compose overlay", async () => {
    const unexpectedOverlay = "/repo/infra/docker-compose.old.yml";
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      requiredComposeFiles: [
        "infra/docker-compose.yml",
        "infra/docker-compose.prod.yml",
      ],
      runCommand: async (input) => {
        if (input.args.includes("inspect")) {
          const containerId = String(input.args.at(-1));
          return {
            exitCode: 0,
            stdout: containerId.startsWith("worker_")
              ? `/repo/infra/docker-compose.yml,/repo/infra/docker-compose.prod.yml,${unexpectedOverlay}\n`
              : "/repo/infra/docker-compose.yml,/repo/infra/docker-compose.prod.yml\n",
            stderr: "",
          };
        }
        if (input.args.includes("--format")) {
          return healthyComposeCommand();
        }
        if (input.args.includes("-q")) {
          const serviceName = input.args.at(-1);
          return {
            exitCode: 0,
            stdout: `${serviceName}_container\n`,
            stderr: "",
          };
        }
        throw new Error(`unexpected docker command: ${input.args.join(" ")}`);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.composeFileChecks.worker).toEqual({
      ok: false,
      service: "worker",
      unexpectedFiles: [unexpectedOverlay],
      detail: "config_file_unexpected",
    });
    expect(result.requiredFollowUps).toEqual([
      `Restart Docker compose service worker without unexpected compose files: ${unexpectedOverlay}.`,
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

  it("waits for transient Docker health states before passing", async () => {
    const sleeps: number[] = [];
    const commandResults = [
      {
        exitCode: 0,
        stdout: JSON.stringify([
          service("postgres"),
          service("redis-engine"),
          service("emailengine", { Health: "starting" }),
          service("api"),
          service("worker"),
          service("web"),
        ]),
        stderr: "",
      },
      await healthyComposeCommand(),
    ];

    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      runCommand: async () => commandResults.shift() ?? healthyComposeCommand(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.maxAttempts).toBe(3);
    expect(sleeps).toEqual([25]);
  });

  it("does not wait when EmailEngine readiness proves a configuration gap", async () => {
    const sleeps: number[] = [];
    let httpCalls = 0;
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      runCommand: healthyComposeCommand,
      hostChecks: [
        {
          name: "mail_engine_readiness",
          url: "http://127.0.0.1:8080/api/mail-engine/health",
          expect: "mail_engine_ready",
        },
      ],
      httpGet: async () => {
        httpCalls += 1;
        return {
          status: 200,
          body: JSON.stringify({
            ok: false,
            readiness: { status: "degraded" },
          }),
        };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.maxAttempts).toBe(3);
    expect(httpCalls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("passes host HTTP probe headers without leaking them in results", async () => {
    const httpCalls: unknown[] = [];
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
          headers: {
            authorization: "Bearer secret-token",
          },
        },
      ],
      httpGet: async (input) => {
        httpCalls.push(input);
        return {
          status: 401,
          body: JSON.stringify({ error: "unauthorized" }),
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(httpCalls).toEqual([
      {
        url: "http://127.0.0.1:8080/api/mail-engine/health",
        timeoutMs: 5_000,
        headers: {
          authorization: "Bearer secret-token",
        },
      },
    ]);
    expect(result.hostChecks.mail_engine_readiness).toEqual({
      ok: false,
      name: "mail_engine_readiness",
      url: "http://127.0.0.1:8080/api/mail-engine/health",
      status: 401,
      detail: "mail_engine_not_ready",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(result.requiredFollowUps).toEqual([
      "Fix host HTTP check: mail_engine_readiness url=http://127.0.0.1:8080/api/mail-engine/health detail=mail_engine_not_ready.",
    ]);
  });

  it("redacts sensitive host HTTP probe URL parts from results", async () => {
    const requestedUrls: string[] = [];
    const sensitiveUrl =
      "http://user:secret@127.0.0.1:8080/api/mail-engine/health?access_token=abc#frag";
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: healthyComposeCommand,
      hostChecks: [
        {
          name: "mail_engine_readiness",
          url: sensitiveUrl,
          expect: "mail_engine_ready",
        },
      ],
      httpGet: async (input) => {
        requestedUrls.push(input.url);
        return {
          status: 401,
          body: JSON.stringify({ error: "unauthorized" }),
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(requestedUrls).toEqual([sensitiveUrl]);
    expect(result.hostChecks.mail_engine_readiness).toEqual({
      ok: false,
      name: "mail_engine_readiness",
      url: "http://127.0.0.1:8080/api/mail-engine/health",
      status: 401,
      detail: "mail_engine_not_ready",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix host HTTP check: mail_engine_readiness url=http://127.0.0.1:8080/api/mail-engine/health detail=mail_engine_not_ready.",
    ]);
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain("user:secret");
    expect(serializedResult).not.toContain("access_token=abc");
    expect(serializedResult).not.toContain("#frag");
  });

  it("passes runtime env invariants for production Docker services", async () => {
    const calls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: [
        {
          service: "api",
          name: "NODE_ENV",
          expected: "production",
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
      ],
      runCommand: async (input) => {
        calls.push(input);
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        const name = input.args[input.args.length - 1];
        return {
          exitCode: 0,
          stdout: `${name === "NODE_ENV" ? "production" : "true"}\n`,
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.envChecks).toEqual({
      "api.NODE_ENV": {
        ok: true,
        service: "api",
        name: "NODE_ENV",
      },
      "api.EMAILHUB_REQUIRE_API_TOKEN": {
        ok: true,
        service: "api",
        name: "EMAILHUB_REQUIRE_API_TOKEN",
      },
      "worker.WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN": {
        ok: true,
        service: "worker",
        name: "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN",
      },
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.arrayContaining([
            "exec",
            "-T",
            "api",
            "printenv",
            "NODE_ENV",
          ]),
        }),
        expect.objectContaining({
          args: expect.arrayContaining([
            "exec",
            "-T",
            "worker",
            "printenv",
            "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN",
          ]),
        }),
      ]),
    );
  });

  it("fails runtime env invariants without leaking actual values", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: [
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
      ],
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        if (input.args.includes("EMAILHUB_REQUIRE_API_TOKEN")) {
          return {
            exitCode: 0,
            stdout: "secret-token\n",
            stderr: "",
          };
        }
        return {
          exitCode: 1,
          stdout: "",
          stderr: "permission denied secret-token",
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.envChecks).toEqual({
      "api.EMAILHUB_REQUIRE_API_TOKEN": {
        ok: false,
        service: "api",
        name: "EMAILHUB_REQUIRE_API_TOKEN",
        detail: "env_value_mismatch",
      },
      "worker.WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN": {
        ok: false,
        service: "worker",
        name: "WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN",
        detail: "env_read_failed",
      },
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix Docker env invariant: api.EMAILHUB_REQUIRE_API_TOKEN.",
      "Fix Docker env invariant: worker.WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN.",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("checks JSON env invariant paths without leaking actual or expected values", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      envInvariants: [
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["serviceSecret"],
          expected: "expected-webhook-secret",
        },
        {
          service: "emailengine",
          name: "EENGINE_SETTINGS",
          valuePath: ["authServer"],
          expected:
            "http://emailengine:expected-auth-secret@api:8080/api/mail-engine/auth-server",
        },
      ],
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            serviceSecret: "actual-webhook-secret",
            authServer:
              "http://emailengine:expected-auth-secret@api:8080/api/mail-engine/auth-server",
          }),
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.envChecks).toEqual({
      "emailengine.EENGINE_SETTINGS.serviceSecret": {
        ok: false,
        service: "emailengine",
        name: "EENGINE_SETTINGS.serviceSecret",
        detail: "env_value_mismatch",
      },
      "emailengine.EENGINE_SETTINGS.authServer": {
        ok: true,
        service: "emailengine",
        name: "EENGINE_SETTINGS.authServer",
      },
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix Docker env invariant: emailengine.EENGINE_SETTINGS.serviceSecret.",
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("actual-webhook-secret");
    expect(serialized).not.toContain("expected-webhook-secret");
    expect(serialized).not.toContain("expected-auth-secret");
  });

  it("checks prepared token pairs without leaking raw or exported tokens", async () => {
    const calls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      preparedTokenPairs: [
        {
          service: "emailengine",
          name: "accessTokenPreparedToken",
          rawToken: "raw-engine-token",
          expectedPreparedToken: "expected-prepared-token",
          redisUrl: "redis://redis-engine:6379/0",
        },
      ],
      runCommand: async (input) => {
        calls.push(input);
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        return {
          exitCode: 0,
          stdout: "actual-prepared-token\n",
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(false);
    expect(result.preparedTokenChecks).toEqual({
      "emailengine.accessTokenPreparedToken": {
        ok: false,
        service: "emailengine",
        name: "accessTokenPreparedToken",
        detail: "prepared_token_mismatch",
      },
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix Docker prepared token pair: emailengine.accessTokenPreparedToken.",
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.arrayContaining([
            "exec",
            "-T",
            "emailengine",
            "emailengine",
            "tokens",
            "export",
            "-t",
            "raw-engine-token",
            "--dbs.redis=redis://redis-engine:6379/0",
          ]),
        }),
      ]),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("raw-engine-token");
    expect(serialized).not.toContain("expected-prepared-token");
    expect(serialized).not.toContain("actual-prepared-token");
  });

  it("does not wait when prepared token pairs prove a configuration gap", async () => {
    const sleeps: number[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      preparedTokenPairs: [
        {
          service: "emailengine",
          name: "accessTokenPreparedToken",
          rawToken: "raw-engine-token",
          expectedPreparedToken: "expected-prepared-token",
        },
      ],
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        return {
          exitCode: 0,
          stdout: "actual-prepared-token\n",
          stderr: "",
        };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(
      result.preparedTokenChecks["emailengine.accessTokenPreparedToken"],
    ).toEqual({
      ok: false,
      service: "emailengine",
      name: "accessTokenPreparedToken",
      detail: "prepared_token_mismatch",
    });
    expect(sleeps).toEqual([]);
  });

  it("does not wait when runtime env invariants prove a configuration gap", async () => {
    const sleeps: number[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      waitAttempts: 3,
      waitIntervalMs: 25,
      hostChecks: [
        {
          name: "api_health",
          url: "http://127.0.0.1:8080/health",
          expect: "http_ok",
        },
      ],
      envInvariants: [
        {
          service: "api",
          name: "NODE_ENV",
          expected: "production",
        },
      ],
      runCommand: async (input) => {
        if (input.args.includes("ps")) {
          return healthyComposeCommand();
        }
        return {
          exitCode: 0,
          stdout: "development\n",
          stderr: "",
        };
      },
      httpGet: async () => ({
        status: 503,
        body: "starting",
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.envChecks["api.NODE_ENV"]).toEqual({
      ok: false,
      service: "api",
      name: "NODE_ENV",
      detail: "env_value_mismatch",
    });
    expect(sleeps).toEqual([]);
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

function composeFileChecksForServices(
  checks: Record<
    string,
    {
      ok: boolean;
      detail?:
        | "config_file_missing"
        | "config_file_unexpected"
        | "config_file_mismatch";
      missingFiles?: string[];
      unexpectedFiles?: string[];
    }
  >,
) {
  return Object.fromEntries(
    Object.entries(checks).map(([serviceName, check]) => [
      serviceName,
      {
        ok: check.ok,
        service: serviceName,
        ...(check.missingFiles ? { missingFiles: check.missingFiles } : {}),
        ...(check.unexpectedFiles
          ? { unexpectedFiles: check.unexpectedFiles }
          : {}),
        ...(check.detail ? { detail: check.detail } : {}),
      },
    ]),
  );
}
