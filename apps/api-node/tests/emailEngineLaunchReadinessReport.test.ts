import { describe, expect, it, vi } from "vitest";

import {
  launchReadinessSecretValues,
  runEmailEngineLaunchReadinessReportCli,
} from "../src/emailengine-launch-readiness-report-runner";
import { createEmailEngineLaunchReadinessReport } from "../src/mail-engine/launch-readiness-report";

describe("EmailEngine launch readiness report", () => {
  it("separates internal test readiness from production launch readiness", () => {
    const env = internalEnv({
      EMAILENGINE_AUTH_SERVER_SECRET: "",
      HERMES_CHAT_COMPLETIONS_URL: "",
      GOOGLE_OAUTH_CLIENT_ID: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "",
      MICROSOFT_OAUTH_CLIENT_ID: "",
      MICROSOFT_OAUTH_CLIENT_SECRET: "",
      TEST_DATABASE_URL: "",
    });

    const result = createEmailEngineLaunchReadinessReport({
      env,
      envFile: ".env",
      now: () => new Date("2026-06-18T03:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      internalTestReady: true,
      productionReady: false,
      gate: "emailengine_launch_readiness",
      envFile: ".env",
      checkedAt: "2026-06-18T03:00:00.000Z",
      checks: {
        internalSecrets: { ok: true, issues: [] },
        nativeEngine: { ok: true, issues: [] },
        smokeConfig: { ok: true },
        optionalIntegrations: { ok: true },
        productionDelta: { ok: false },
      },
      requiredFollowUps: [],
    });
    expect(result.productionFollowUps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("EMAILENGINE_AUTH_SERVER_SECRET must be set"),
      ]),
    );
    expect(result.runnableSuites).toContainEqual(
      expect.objectContaining({
        name: "docker_internal_stack",
        status: "ready",
      }),
    );
    expect(result.runnableSuites).toContainEqual(
      expect.objectContaining({
        name: "docker_greenmail_stack",
        command: "npm run compose:up:test:detached",
        status: "ready",
      }),
    );
    expect(result.runnableSuites).toContainEqual(
      expect.objectContaining({
        name: "production_launch_gate",
        status: "blocked",
      }),
    );

    const serialized = JSON.stringify(result);
    for (const secret of launchReadinessSecretValues(env)) {
      if (secret) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it("blocks internal testing when EmailEngine secrets are missing", () => {
    const result = createEmailEngineLaunchReadinessReport({
      env: internalEnv({
        EMAILENGINE_ACCESS_TOKEN: "",
      }),
      now: () => new Date("2026-06-18T03:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.internalTestReady).toBe(false);
    expect(result.checks.internalSecrets).toEqual({
      ok: false,
      issues: [
        {
          code: "emailengine_access_token_missing",
          severity: "error",
          env: ["EMAILENGINE_ACCESS_TOKEN"],
          detail:
            "EMAILENGINE_ACCESS_TOKEN must be set before the EmailEngine internal test gate. Lets the API and worker call EmailEngine during internal testing.",
        },
      ],
    });
    expect(result.runnableSuites).toContainEqual(
      expect.objectContaining({
        name: "docker_internal_stack",
        status: "blocked",
      }),
    );
  });

  it("blocks diagnostics-backed smokes when the API token is missing", () => {
    const result = createEmailEngineLaunchReadinessReport({
      env: internalEnv({
        EMAILHUB_API_TOKEN: "",
      }),
      now: () => new Date("2026-06-18T03:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.internalSecrets.issues).toContainEqual({
      code: "emailhub_api_token_missing",
      severity: "error",
      env: ["EMAILHUB_API_TOKEN"],
      detail:
        "EMAILHUB_API_TOKEN must be set before the EmailEngine internal test gate. Lets diagnostics-backed smoke checks read protected launch evidence.",
    });
    expect(result.runnableSuites).toContainEqual(
      expect.objectContaining({
        name: "greenmail_smokes",
        status: "blocked",
      }),
    );
    expect(result.runnableSuites).toContainEqual(
      expect.objectContaining({
        name: "docker_greenmail_stack",
        status: "blocked",
      }),
    );
  });

  it("blocks invalid GreenMail smoke port settings", () => {
    const result = createEmailEngineLaunchReadinessReport({
      env: internalEnv({
        EMAILHUB_SMOKE_IMAP_PORT: "not-a-port",
      }),
      now: () => new Date("2026-06-18T03:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.smokeConfig.issues).toContainEqual({
      code: "emailhub_smoke_imap_port_invalid",
      severity: "error",
      env: ["EMAILHUB_SMOKE_IMAP_PORT"],
      detail:
        "EMAILHUB_SMOKE_IMAP_PORT must be a positive integer for GreenMail smoke checks.",
    });
  });

  it("loads the selected env file and writes a redacted report", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const readEnvFile = vi.fn(() =>
      [
        `EMAILENGINE_ACCESS_TOKEN=${EMAILENGINE_ACCESS_TOKEN}`,
        `EENGINE_PREPARED_TOKEN=${EENGINE_PREPARED_TOKEN}`,
        "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
        "EENGINE_SECRET=file-service-secret",
        "EMAILENGINE_AUTH_SERVER_SECRET=file-auth-secret",
      ].join("\n"),
    );

    const exitCode = await runEmailEngineLaunchReadinessReportCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.inner",
        EMAILHUB_API_TOKEN: "process-api-token",
      },
      fileExists: (path) => path === "/repo/.env.inner",
      readEnvFile,
      now: () => new Date("2026-06-18T03:00:00.000Z"),
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(readEnvFile).toHaveBeenCalledWith("/repo/.env.inner");
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed.envFile).toBe(".env.inner");
    expect(parsed.internalTestReady).toBe(true);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain(EMAILENGINE_ACCESS_TOKEN);
    expect(serialized).not.toContain(EENGINE_PREPARED_TOKEN);
    expect(serialized).not.toContain("process-api-token");
    expect(serialized).not.toContain("file-webhook-secret");
  });

  it("redacts top-level readiness errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const createReport = vi.fn(() => {
      throw new Error(
        "readiness failed process-api-token Bearer launch-token http://user:secret@10.0.0.20:8080?token=abc github_pat_abc password=hunter2",
      );
    }) as unknown as typeof createEmailEngineLaunchReadinessReport;

    const exitCode = await runEmailEngineLaunchReadinessReportCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        ...internalEnv({
          EMAILHUB_API_TOKEN: "process-api-token",
        }),
      },
      fileExists: () => false,
      readEnvFile: () => "",
      createReport,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "emailengine_launch_readiness",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("process-api-token");
    expect(serialized).not.toContain("launch-token");
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("10.0.0.20");
    expect(serialized).not.toContain("github_pat_abc");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("token=abc");
  });
});

function internalEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    EMAILENGINE_ACCESS_TOKEN,
    EENGINE_PREPARED_TOKEN,
    EMAILENGINE_WEBHOOK_SECRET: "internal-webhook-secret",
    EMAILENGINE_AUTH_SERVER_SECRET: "internal-auth-secret",
    EENGINE_SECRET: "internal-service-secret",
    EMAILHUB_API_TOKEN: "internal-api-token",
    VITE_EMAILHUB_API_TOKEN: "internal-api-token",
    POSTGRES_PASSWORD: "internal-postgres-password",
    HERMES_CHAT_COMPLETIONS_URL: "http://hermes:4000/v1/chat/completions",
    GOOGLE_OAUTH_CLIENT_ID: "google-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    EMAILENGINE_GMAIL_OAUTH2_PROVIDER_ID: "ee-gmail-app",
    MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
    MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
    EMAILENGINE_OUTLOOK_OAUTH2_PROVIDER_ID: "ee-outlook-app",
    TEST_DATABASE_URL: "postgres://test/emailhub",
    ...overrides,
  };
}

const EMAILENGINE_ACCESS_TOKEN =
  "f05d76644ea39c4a2ee33e7bffe55808b716a34b51d67b388c7d60498b0f89bc";
const EENGINE_PREPARED_TOKEN =
  "hKJpZNlAMzAxZThjNTFhZjgxM2Q3MzUxNTYzYTFlM2I1NjVkYmEzZWJjMzk4";
