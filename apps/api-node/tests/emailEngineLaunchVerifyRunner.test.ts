import { describe, expect, it, vi } from "vitest";

import type { EmailEngineLaunchVerificationResult } from "../src/mail-engine/launch-verifier";
import { verifyEmailEngineLaunch } from "../src/mail-engine/launch-verifier";
import {
  readPositiveInteger,
  runEmailEngineLaunchVerifyCli,
  sanitizeLaunchVerifyError,
} from "../src/emailengine-launch-verify-runner";

describe("EmailEngine launch verify CLI runner", () => {
  it("returns zero and writes the launch result when the gate passes", async () => {
    const result = launchResult({ ok: true });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyLaunch = vi.fn(async (input) => {
      expect(input.apiBaseUrl).toBe("http://api:8080");
      expect(input.timeoutMs).toBe(2500);
      return result;
    }) as unknown as typeof verifyEmailEngineLaunch;

    const exitCode = await runEmailEngineLaunchVerifyCli({
      env: {
        EMAILHUB_API_BASE_URL: "http://api:8080",
        EMAILHUB_LAUNCH_VERIFY_TIMEOUT_MS: "2500",
        EMAILHUB_API_TOKEN: "api-token",
      },
      verifyLaunch,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      ok: true,
      gate: "emailengine_launch",
    });
  });

  it("uses the selected env file for launch verification when process env does not override it", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const readEnvFile = vi.fn(() =>
      [
        "EMAILHUB_API_BASE_URL=http://api-from-file:8080",
        "EMAILHUB_LAUNCH_VERIFY_TIMEOUT_MS=3500",
        "EMAILHUB_API_TOKEN=file-token",
      ].join("\n"),
    );
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = launchResult({ ok: true });
    const verifyLaunch = vi.fn(async (input) => {
      expect(input.apiBaseUrl).toBe("http://api-from-file:8080");
      expect(input.timeoutMs).toBe(3500);
      await input.fetchImpl?.("http://api-from-file:8080/health");
      return result;
    }) as unknown as typeof verifyEmailEngineLaunch;

    const exitCode = await runEmailEngineLaunchVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyLaunch,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(readEnvFile).toHaveBeenCalledWith("/repo/.env.prod");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api-from-file:8080/health",
      expect.objectContaining({
        headers: { authorization: "Bearer file-token" },
      }),
    );
    expect(JSON.stringify(stdout)).not.toContain("file-token");
  });

  it("lets process env override selected env file launch settings", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = launchResult({ ok: true });
    const verifyLaunch = vi.fn(async (input) => {
      expect(input.apiBaseUrl).toBe("http://process-api:8080");
      expect(input.timeoutMs).toBe(900);
      await input.fetchImpl?.("http://process-api:8080/health");
      return result;
    }) as unknown as typeof verifyEmailEngineLaunch;

    const exitCode = await runEmailEngineLaunchVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_BASE_URL: "http://process-api:8080",
        EMAILHUB_LAUNCH_VERIFY_TIMEOUT_MS: "900",
        EMAILHUB_API_TOKEN: "process-token",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "EMAILHUB_API_BASE_URL=http://api-from-file:8080",
          "EMAILHUB_LAUNCH_VERIFY_TIMEOUT_MS=3500",
          "EMAILHUB_API_TOKEN=file-token",
        ].join("\n"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyLaunch,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://process-api:8080/health",
      expect.objectContaining({
        headers: { authorization: "Bearer process-token" },
      }),
    );
    expect(JSON.stringify(stdout)).not.toContain("process-token");
    expect(JSON.stringify(stdout)).not.toContain("file-token");
  });

  it("returns one and redacts top-level verifier errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const verifyLaunch = vi.fn(async () => {
      throw new Error(
        "failed super-secret-token Bearer launch-token http://user:secret@10.0.0.20:8080/path?token=abc github_pat_abc password=hunter2 10.0.0.20",
      );
    }) as unknown as typeof verifyEmailEngineLaunch;

    const exitCode = await runEmailEngineLaunchVerifyCli({
      env: {
        EMAILHUB_API_BASE_URL:
          "http://user:secret@127.0.0.1:8080/?token=abc#frag",
        EMAILHUB_API_TOKEN: "super-secret-token",
      },
      verifyLaunch,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "emailengine_launch",
      apiBaseUrl: "http://127.0.0.1:8080",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("launch-token");
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("10.0.0.20");
    expect(serialized).not.toContain("github_pat_abc");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("token=abc");
  });

  it("sanitizes unknown and long launch verifier errors", () => {
    expect(sanitizeLaunchVerifyError(undefined)).toBe("unknown_error");
    expect(
      sanitizeLaunchVerifyError(`prefix ${"x".repeat(400)} suffix`),
    ).toHaveLength(240);
  });

  it("parses positive integer environment values with a fallback", () => {
    expect(readPositiveInteger("1500", 100)).toBe(1500);
    expect(readPositiveInteger("0", 100)).toBe(100);
    expect(readPositiveInteger("bad", 100)).toBe(100);
  });
});

function launchResult(input: {
  ok: boolean;
}): EmailEngineLaunchVerificationResult {
  return {
    ok: input.ok,
    gate: "emailengine_launch",
    apiBaseUrl: "http://api:8080",
    checkedAt: "2026-06-17T12:00:00.000Z",
    checks: {
      apiHealth: { ok: input.ok, statusCode: 200 },
      emailEngineReadiness: {
        ok: input.ok,
        statusCode: 200,
        status: "ready",
      },
      tokenBackedCapabilities: {
        ok: input.ok,
        detail:
          "imap_smtp_onboarding, attachment_download, and send are available",
      },
      launchReadinessClean: {
        ok: input.ok,
        detail: "no missing env, warnings, or setup actions",
      },
    },
    readiness: {
      status: "ready",
      missing: [],
      warnings: [],
      setupActions: [],
    },
    requiredFollowUps: input.ok ? [] : ["fix launch gate"],
  };
}
