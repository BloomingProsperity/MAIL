import { describe, expect, it, vi } from "vitest";

import {
  productionEnvSecretValues,
  runEmailEngineProdEnvVerifyCli,
} from "../src/emailengine-prod-env-verify-runner";
import { verifyEmailEngineProductionEnv } from "../src/mail-engine/production-env-preflight";

describe("EmailEngine production env verify CLI runner", () => {
  it("returns zero for a production-ready env without printing secret values", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const env = productionEnv({
      HERMES_CHAT_COMPLETIONS_URL: "",
      GOOGLE_OAUTH_CLIENT_ID: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "",
      MICROSOFT_OAUTH_CLIENT_ID: "",
      MICROSOFT_OAUTH_CLIENT_SECRET: "",
    });

    const exitCode = await runEmailEngineProdEnvVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        ...env,
      },
      fileExists: () => false,
      readEnvFile: () => "",
      now: () => new Date("2026-06-17T12:00:00.000Z"),
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: true,
      gate: "emailengine_prod_env",
      checkedAt: "2026-06-17T12:00:00.000Z",
      checks: {
        requiredSecrets: { ok: true, issues: [] },
        webApiToken: { ok: true, issues: [] },
        optionalIntegrations: { ok: true },
      },
    });
    expect(parsed.checks.optionalIntegrations.issues).toHaveLength(3);
    const serialized = JSON.stringify(parsed);
    for (const secret of productionEnvSecretValues(env)) {
      if (secret) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it("returns one for missing or default production secrets", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runEmailEngineProdEnvVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        ...productionEnv({
          EMAILHUB_API_TOKEN: "",
          EMAILENGINE_WEBHOOK_SECRET: "dev-emailhub-secret",
          POSTGRES_PASSWORD: "emailhub_dev",
        }),
      },
      fileExists: () => false,
      readEnvFile: () => "",
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "emailengine_prod_env",
      checks: {
        requiredSecrets: { ok: false },
        webApiToken: { ok: true, issues: [] },
      },
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).toContain("EMAILHUB_API_TOKEN");
    expect(serialized).toContain("EMAILENGINE_WEBHOOK_SECRET");
    expect(serialized).toContain("POSTGRES_PASSWORD");
    expect(serialized).not.toContain("dev-emailhub-secret");
    expect(serialized).not.toContain("emailhub_dev");
  });

  it("fails when the bundled web API token would not match the API token", () => {
    const result = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILHUB_API_TOKEN: "api-token",
        VITE_EMAILHUB_API_TOKEN: "wrong-web-token",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.webApiToken).toEqual({
      ok: false,
      issues: [
        {
          code: "vite_emailhub_api_token_mismatch",
          severity: "error",
          env: ["EMAILHUB_API_TOKEN", "VITE_EMAILHUB_API_TOKEN"],
          detail:
            "VITE_EMAILHUB_API_TOKEN must match EMAILHUB_API_TOKEN for the bundled protected web app.",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("api-token");
    expect(JSON.stringify(result)).not.toContain("wrong-web-token");
  });

  it("does not require the bundled Postgres password when DATABASE_URL is explicit", () => {
    const result = verifyEmailEngineProductionEnv({
      env: productionEnv({
        DATABASE_URL: "postgres://external-db/emailhub",
        POSTGRES_PASSWORD: "emailhub_dev",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("POSTGRES_PASSWORD");
    expect(JSON.stringify(result)).not.toContain("emailhub_dev");
  });

  it("uses the selected env file and lets process env override it", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const readEnvFile = vi.fn(() =>
      [
        "EMAILHUB_API_TOKEN=file-token",
        "VITE_EMAILHUB_API_TOKEN=file-token",
        "EMAILENGINE_ACCESS_TOKEN=file-emailengine-token",
        "EENGINE_PREPARED_TOKEN=file-prepared-token",
        "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
        "EMAILENGINE_AUTH_SERVER_SECRET=file-auth-secret",
        "EENGINE_SECRET=file-service-secret",
        "POSTGRES_PASSWORD=file-postgres-password",
      ].join("\n"),
    );

    const exitCode = await runEmailEngineProdEnvVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_TOKEN: "process-token",
        VITE_EMAILHUB_API_TOKEN: "process-token",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(readEnvFile).toHaveBeenCalledWith("/repo/.env.prod");
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed.envFile).toBe(".env.prod");
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("process-token");
    expect(serialized).not.toContain("file-token");
    expect(serialized).not.toContain("file-emailengine-token");
  });

  it("redacts top-level preflight errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyPreflight = vi.fn(() => {
      throw new Error(
        "preflight failed api-token Bearer launch-token http://user:secret@10.0.0.20:8080?token=abc github_pat_abc password=hunter2",
      );
    }) as unknown as typeof verifyEmailEngineProductionEnv;

    const exitCode = await runEmailEngineProdEnvVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        ...productionEnv({
          EMAILHUB_API_TOKEN: "api-token",
          EMAILHUB_API_BASE_URL: "http://user:secret@10.0.0.20:8080?token=abc",
        }),
      },
      fileExists: () => false,
      readEnvFile: () => "",
      verifyPreflight,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "emailengine_prod_env",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("api-token");
    expect(serialized).not.toContain("launch-token");
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("10.0.0.20");
    expect(serialized).not.toContain("github_pat_abc");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("token=abc");
  });
});

function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    EMAILHUB_API_TOKEN: "prod-api-token",
    VITE_EMAILHUB_API_TOKEN: "prod-api-token",
    EMAILENGINE_ACCESS_TOKEN: "prod-emailengine-token",
    EENGINE_PREPARED_TOKEN: "prod-prepared-token",
    EMAILENGINE_WEBHOOK_SECRET: "prod-webhook-secret",
    EMAILENGINE_AUTH_SERVER_SECRET: "prod-auth-secret",
    EENGINE_SECRET: "prod-service-secret",
    POSTGRES_PASSWORD: "prod-postgres-password",
    HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
    GOOGLE_OAUTH_CLIENT_ID: "google-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
    MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
    ...overrides,
  };
}
