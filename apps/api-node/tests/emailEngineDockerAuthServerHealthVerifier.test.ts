import { describe, expect, it } from "vitest";

import { verifyDockerComposeHealth } from "../src/mail-engine/docker-compose-health-verifier";

describe("EmailEngine auth-server Docker health verification", () => {
  it("passes Basic probes without leaking headers", async () => {
    const httpCalls: unknown[] = [];
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: healthyComposeCommand,
      hostChecks: [
        {
          name: "mail_engine_auth_server",
          url: "http://127.0.0.1:8080/api/mail-engine/auth-server?account=__emailhub_launch_probe__&proto=health_probe",
          expect: "emailengine_auth_server_basic",
          headers: {
            authorization: "Basic secret-auth-header",
          },
        },
      ],
      httpGet: async (input) => {
        httpCalls.push(input);
        return {
          status: 400,
          body: JSON.stringify({
            error: "invalid_emailengine_auth_server_request",
          }),
        };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.hostChecks.mail_engine_auth_server).toEqual({
      ok: true,
      name: "mail_engine_auth_server",
      url: "http://127.0.0.1:8080/api/mail-engine/auth-server",
      status: 400,
    });
    expect(httpCalls).toEqual([
      {
        url: "http://127.0.0.1:8080/api/mail-engine/auth-server?account=__emailhub_launch_probe__&proto=health_probe",
        timeoutMs: 5_000,
        headers: {
          authorization: "Basic secret-auth-header",
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-auth-header");
    expect(JSON.stringify(result)).not.toContain("__emailhub_launch_probe__");
  });

  it("fails Basic probes on unexpected status or body", async () => {
    const result = await verifyDockerComposeHealth({
      projectRoot: "/repo",
      envFile: ".env",
      composeFiles: ["infra/docker-compose.yml", "infra/docker-compose.prod.yml"],
      runCommand: healthyComposeCommand,
      hostChecks: [
        {
          name: "mail_engine_auth_server",
          url: "http://127.0.0.1:8080/api/mail-engine/auth-server?account=__emailhub_launch_probe__&proto=health_probe",
          expect: "emailengine_auth_server_basic",
        },
      ],
      httpGet: async () => ({
        status: 404,
        body: JSON.stringify({
          error: "not_found",
        }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.hostChecks.mail_engine_auth_server).toEqual({
      ok: false,
      name: "mail_engine_auth_server",
      url: "http://127.0.0.1:8080/api/mail-engine/auth-server",
      status: 404,
      detail: "emailengine_auth_server_unexpected",
    });
    expect(result.requiredFollowUps).toEqual([
      "Fix host HTTP check: mail_engine_auth_server url=http://127.0.0.1:8080/api/mail-engine/auth-server detail=emailengine_auth_server_unexpected.",
    ]);
  });
});

function service(name: string): Record<string, unknown> {
  return {
    State: "running",
    Health: "healthy",
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
