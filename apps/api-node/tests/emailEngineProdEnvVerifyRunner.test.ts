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
        containerImage: { ok: true, issues: [] },
        webApiToken: { ok: true, issues: [] },
        nativeEngine: { ok: true, issues: [] },
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
        containerImage: { ok: true, issues: [] },
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

  it("rejects malformed EmailEngine raw tokens and raw-token prepared values", () => {
    const rawToken = "a".repeat(64);
    const malformed = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILENGINE_ACCESS_TOKEN: "not-a-64-hex-token",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(malformed.ok).toBe(false);
    expect(malformed.checks.requiredSecrets.issues).toContainEqual({
      code: "emailengine_access_token_format_invalid",
      severity: "error",
      env: ["EMAILENGINE_ACCESS_TOKEN"],
      detail:
        "EMAILENGINE_ACCESS_TOKEN must be the original 64-character EmailEngine API token. Generate it with `emailengine tokens issue` before the production launch gate.",
    });
    expect(JSON.stringify(malformed)).not.toContain("not-a-64-hex-token");

    const rawPrepared = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILENGINE_ACCESS_TOKEN: rawToken,
        EENGINE_PREPARED_TOKEN: rawToken,
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(rawPrepared.ok).toBe(false);
    expect(rawPrepared.checks.requiredSecrets.issues).toContainEqual({
      code: "eengine_prepared_token_equals_raw_token",
      severity: "error",
      env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
      detail:
        "EENGINE_PREPARED_TOKEN must be the exported prepared token string for EMAILENGINE_ACCESS_TOKEN, not the raw API token itself. Generate it with `emailengine tokens export -t EMAILENGINE_ACCESS_TOKEN`.",
    });
    expect(JSON.stringify(rawPrepared)).not.toContain(rawToken);
  });

  it("rejects mutable or unpinned EmailEngine image overrides", () => {
    const latest = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILENGINE_IMAGE: "postalsys/emailengine:latest",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(latest.ok).toBe(false);
    expect(latest.checks.containerImage).toEqual({
      ok: false,
      issues: [
        {
          code: "emailengine_image_uses_latest",
          severity: "error",
          env: ["EMAILENGINE_IMAGE"],
          detail:
            "EMAILENGINE_IMAGE must not use the mutable latest tag before the EmailEngine production launch gate. Use the default pinned image, a v2.x.x image tag, or an immutable sha256 digest.",
        },
      ],
    });
    expect(latest.requiredFollowUps).toContain(
      "EMAILENGINE_IMAGE must not use the mutable latest tag before the EmailEngine production launch gate. Use the default pinned image, a v2.x.x image tag, or an immutable sha256 digest.",
    );

    const unversioned = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILENGINE_IMAGE: "postalsys/emailengine",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(unversioned.ok).toBe(false);
    expect(unversioned.checks.containerImage.issues).toContainEqual({
      code: "emailengine_image_not_pinned",
      severity: "error",
      env: ["EMAILENGINE_IMAGE"],
      detail:
        "EMAILENGINE_IMAGE must be omitted for the default pinned image, set to a v2.x.x image tag, or set to an immutable sha256 digest before the EmailEngine production launch gate.",
    });

    const versioned = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILENGINE_IMAGE: "postalsys/emailengine:v2.72.0",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });
    const digested = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILENGINE_IMAGE:
          "registry.example.com/emailengine/custom@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(versioned.ok).toBe(true);
    expect(versioned.checks.containerImage).toEqual({ ok: true, issues: [] });
    expect(digested.ok).toBe(true);
    expect(digested.checks.containerImage).toEqual({ ok: true, issues: [] });
  });

  it("fails the production launch gate when the paused native engine is enabled", () => {
    const result = verifyEmailEngineProductionEnv({
      env: productionEnv({
        EMAILHUB_NATIVE_ENGINE_ENABLED: "true",
      }),
      now: () => new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.nativeEngine).toEqual({
      ok: false,
      issues: [
        {
          code: "native_engine_enabled",
          severity: "error",
          env: ["EMAILHUB_NATIVE_ENGINE_ENABLED"],
          detail:
            "EMAILHUB_NATIVE_ENGINE_ENABLED must stay false for the EmailEngine-first production launch; the self-built Native Engine is paused.",
        },
      ],
    });
    expect(result.requiredFollowUps).toContain(
      "EMAILHUB_NATIVE_ENGINE_ENABLED must stay false for the EmailEngine-first production launch; the self-built Native Engine is paused.",
    );
  });

  it("uses the selected env file and lets process env override it", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const readEnvFile = vi.fn(() =>
      [
        "EMAILHUB_API_TOKEN=file-token",
        "VITE_EMAILHUB_API_TOKEN=file-token",
        `EMAILENGINE_ACCESS_TOKEN=${EMAILENGINE_ACCESS_TOKEN}`,
        `EENGINE_PREPARED_TOKEN=${EENGINE_PREPARED_TOKEN}`,
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
    expect(serialized).not.toContain(EMAILENGINE_ACCESS_TOKEN);
    expect(serialized).not.toContain(EENGINE_PREPARED_TOKEN);
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
    EMAILENGINE_ACCESS_TOKEN,
    EENGINE_PREPARED_TOKEN,
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

const EMAILENGINE_ACCESS_TOKEN =
  "f05d76644ea39c4a2ee33e7bffe55808b716a34b51d67b388c7d60498b0f89bc";
const EENGINE_PREPARED_TOKEN =
  "hKJpZNlAMzAxZThjNTFhZjgxM2Q3MzUxNTYzYTFlM2I1NjVkYmEzZWJjMzk4";
