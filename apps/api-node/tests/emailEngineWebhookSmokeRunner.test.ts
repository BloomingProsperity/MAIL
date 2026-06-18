import { describe, expect, it, vi } from "vitest";

import {
  runEmailEngineWebhookSmokeCli,
  type EmailEngineWebhookSmokeRunner,
} from "../src/emailengine-webhook-smoke-runner";

describe("EmailEngine webhook smoke CLI runner", () => {
  it("loads the selected env file before signing the webhook smoke", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runWebhookSmoke = vi.fn(async (input) => {
      expect(input).toMatchObject({
        apiBaseUrl: "http://api-from-file:8080",
        secret: "file-webhook-secret",
        accountId: "acc_file",
        eventName: "fileEvent",
      });
      return {
        accountId: input.accountId ?? "missing-account",
        eventId: "evt_file",
        first: {},
        duplicate: {},
      };
    }) as EmailEngineWebhookSmokeRunner;

    const exitCode = await runEmailEngineWebhookSmokeCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "EMAILHUB_API_BASE_URL=http://api-from-file:8080",
          "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
          "EMAILHUB_SMOKE_ACCOUNT_ID=acc_file",
          "EMAILHUB_SMOKE_WEBHOOK_EVENT=fileEvent",
        ].join("\n"),
      runWebhookSmoke,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(runWebhookSmoke).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: true,
      smoke: "emailengine_webhook",
      apiBaseUrl: "http://api-from-file:8080",
      accountId: "acc_file",
      eventId: "evt_file",
    });
    expect(JSON.stringify(parsed)).not.toContain("file-webhook-secret");
  });

  it("lets process env override selected env file values", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runWebhookSmoke = vi.fn(async (input) => {
      expect(input).toMatchObject({
        apiBaseUrl: "http://process-api:8080",
        secret: "process-webhook-secret",
        accountId: "acc_process",
        eventName: "processEvent",
      });
      return {
        accountId: input.accountId ?? "missing-account",
        eventId: "evt_process",
        first: {},
        duplicate: {},
      };
    }) as EmailEngineWebhookSmokeRunner;

    const exitCode = await runEmailEngineWebhookSmokeCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
        EMAILHUB_API_BASE_URL: "http://process-api:8080",
        EMAILENGINE_WEBHOOK_SECRET: "process-webhook-secret",
        EMAILHUB_SMOKE_ACCOUNT_ID: "acc_process",
        EMAILHUB_SMOKE_WEBHOOK_EVENT: "processEvent",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "EMAILHUB_API_BASE_URL=http://api-from-file:8080",
          "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
          "EMAILHUB_SMOKE_ACCOUNT_ID=acc_file",
          "EMAILHUB_SMOKE_WEBHOOK_EVENT=fileEvent",
        ].join("\n"),
      runWebhookSmoke,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(runWebhookSmoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stdout)).not.toContain("process-webhook-secret");
    expect(JSON.stringify(stdout)).not.toContain("file-webhook-secret");
  });

  it("redacts env-file secrets from webhook smoke failures", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runWebhookSmoke = vi.fn(async () => {
      throw new Error(
        "failed file-webhook-secret file-api-token github_pat_secret password=hunter2",
      );
    }) as EmailEngineWebhookSmokeRunner;

    const exitCode = await runEmailEngineWebhookSmokeCli({
      env: {
        EMAILHUB_REPO_ROOT: "/repo",
        EMAILHUB_ENV_FILE: ".env.prod",
      },
      fileExists: (path) => path === "/repo/.env.prod",
      readEnvFile: () =>
        [
          "EMAILHUB_API_BASE_URL=http://api-from-file:8080",
          "EMAILHUB_API_TOKEN=file-api-token",
          "EMAILENGINE_WEBHOOK_SECRET=file-webhook-secret",
        ].join("\n"),
      runWebhookSmoke,
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const parsed = JSON.parse(stderr[0] ?? "{}");
    expect(parsed).toMatchObject({
      ok: false,
      smoke: "emailengine_webhook",
      apiBaseUrl: "[url]",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("file-webhook-secret");
    expect(serialized).not.toContain("file-api-token");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("hunter2");
  });
});
