import { describe, expect, it, vi } from "vitest";

import {
  runEmailEngineGreenMailVerifyCli,
  type GreenMailVerifyCommandInput,
} from "../src/emailengine-greenmail-verify-runner";

describe("EmailEngine GreenMail verify CLI runner", () => {
  it("loads the selected env file before running the smoke scripts", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const commands: GreenMailVerifyCommandInput[] = [];
    const runCommand = vi.fn((input: GreenMailVerifyCommandInput) => {
      commands.push(input);
      return { status: 0 };
    });

    const exitCode = await runEmailEngineGreenMailVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.inner",
      },
      fileExists: (path) => path === "/repo/.env.inner",
      readEnvFile: () =>
        [
          "EMAILHUB_API_TOKEN=file-api-token",
          "EMAILHUB_SMOKE_MAIL_SECRET=file-smoke-secret",
          "EMAILHUB_SMOKE_MAIL_EMAIL=fixed@example.com",
          "EMAILHUB_SMOKE_RECIPIENT_EMAIL=fixed-recipient@example.com",
        ].join("\n"),
      runCommand,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(runCommand).toHaveBeenCalledTimes(6);
    expect(commands.map((command) => command.args[1])).toEqual([
      "smoke:imap-smtp-onboarding",
      "smoke:imap-smtp-onboarding:auth",
      "smoke:emailengine-real-webhook",
      "smoke:emailengine-send",
      "smoke:emailengine-attachment-download",
      "smoke:emailengine-mail-action",
    ]);
    expect(commands[0]).toMatchObject({
      command: "npm",
      args: ["run", "smoke:imap-smtp-onboarding", "-w", "apps/api-node"],
      cwd: "/repo",
    });
    expect(commands[0]?.env.EMAILHUB_API_TOKEN).toBe("file-api-token");
    expect(commands[0]?.env.EMAILHUB_SMOKE_MAIL_SECRET).toBe(
      "file-smoke-secret",
    );
    expect(commands[0]?.env.EMAILHUB_SMOKE_MAIL_EMAIL).toBe(
      "fixed@example.com",
    );
    expect(commands[2]?.env.EMAILHUB_SMOKE_MAIL_EMAIL).toBeUndefined();
    expect(commands[3]?.env.EMAILHUB_SMOKE_MAIL_EMAIL).toBeUndefined();
    expect(commands[3]?.env.EMAILHUB_SMOKE_RECIPIENT_EMAIL).toBeUndefined();
    expect(commands[4]?.env.EMAILHUB_SMOKE_MAIL_EMAIL).toBeUndefined();
    expect(commands[5]?.env.EMAILHUB_SMOKE_MAIL_EMAIL).toBeUndefined();
    expect(commands[0]?.env.EMAILHUB_ENV_FILE).toBe(".env.inner");
    const parsed = JSON.parse(stdout.at(-1) ?? "{}");
    expect(parsed).toMatchObject({
      ok: true,
      gate: "emailengine_greenmail",
      envFile: ".env.inner",
    });
    expect(JSON.stringify(parsed)).not.toContain("file-api-token");
    expect(JSON.stringify(parsed)).not.toContain("file-smoke-secret");
  });

  it("stops at the first failed smoke and redacts secrets", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runCommand = vi.fn((input: GreenMailVerifyCommandInput) => ({
      status: input.args[1] === "smoke:emailengine-real-webhook" ? 1 : 0,
    }));

    const exitCode = await runEmailEngineGreenMailVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_API_TOKEN: "process-api-token",
      },
      fileExists: () => false,
      readEnvFile: () =>
        [
          "EMAILHUB_SMOKE_MAIL_SECRET=file-smoke-secret",
          "EMAILHUB_AUTH_SMOKE_MAIL_SECRET=file-auth-secret",
        ].join("\n"),
      runCommand,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(runCommand).toHaveBeenCalledTimes(3);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      gate: "emailengine_greenmail",
      failedScript: "smoke:emailengine-real-webhook",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("process-api-token");
    expect(serialized).not.toContain("file-smoke-secret");
    expect(serialized).not.toContain("file-auth-secret");
  });

  it("redacts command runner errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runEmailEngineGreenMailVerifyCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_API_TOKEN: "process-api-token",
      },
      fileExists: () => false,
      readEnvFile: () => "",
      runCommand: () => ({
        status: null,
        error: new Error(
          "failed Bearer process-api-token github_pat_secret password=hunter2",
        ),
      }),
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    const serialized = JSON.stringify(JSON.parse(stderr[0] ?? "{}"));
    expect(serialized).not.toContain("process-api-token");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("hunter2");
  });
});
