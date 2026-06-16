import { describe, expect, it } from "vitest";

import {
  checkWorkerHealth,
  formatWorkerHealthForLog,
  type WorkerHealthPool,
} from "../src/healthcheck";

describe("worker healthcheck", () => {
  it("reports worker lanes, runtime config, database readiness, and token warning", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
        WORKER_LEASE_SECONDS: "30",
        WORKER_CONCURRENCY: "8",
        WORKER_POLL_MS: "1000",
      },
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      service: "email-hub-worker",
      ok: true,
      checks: {
        database: "ok",
        emailEngineAccessToken: "missing",
        emailEnginePreparedToken: "missing",
      },
      runtime: {
        leaseSeconds: 30,
        concurrency: 8,
        pollMs: 1000,
        composeAttachmentCleanupIntervalMs: 3600000,
        composeAttachmentRetentionMs: 604800000,
        composeAttachmentCleanupLimit: 100,
      },
      warnings: ["EMAILENGINE_ACCESS_TOKEN"],
    });
    expect(health.lanes).toEqual(
      expect.arrayContaining([
        "sync",
        "scheduled_send",
        "alias_delivery",
        "compose_attachment_cleanup",
      ]),
    );
    expect(JSON.stringify(health)).not.toContain("secret");
  });

  it("fails when DATABASE_URL is missing", async () => {
    const health = await checkWorkerHealth({
      env: {},
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      ok: false,
      checks: {
        database: "missing",
        emailEngineAccessToken: "missing",
        emailEnginePreparedToken: "missing",
      },
      missing: ["DATABASE_URL"],
    });
  });

  it("redacts database connection failures", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
      },
      createPool: () =>
        pool({
          query: async () => {
            throw new Error("password secret rejected by postgres");
          },
        }),
    });

    expect(health).toMatchObject({
      ok: false,
      checks: {
        database: "unavailable",
      },
      missing: [],
    });
    expect(JSON.stringify(health)).not.toContain("secret");
    expect(formatWorkerHealthForLog(health)).toContain("database=unavailable");
  });

  it("can require EmailEngine token in strict self-hosted mode", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
        WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN: "true",
      },
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      ok: false,
      checks: {
        database: "ok",
        emailEngineAccessToken: "missing",
        emailEnginePreparedToken: "missing",
      },
      missing: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
    });
  });

  it("warns when the worker has a raw EmailEngine token without a prepared Docker token", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
        EMAILENGINE_ACCESS_TOKEN: "raw-secret-token",
      },
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      ok: true,
      checks: {
        database: "ok",
        emailEngineAccessToken: "configured",
        emailEnginePreparedToken: "missing",
      },
      missing: [],
      warnings: ["EENGINE_PREPARED_TOKEN"],
    });
    expect(JSON.stringify(health)).not.toContain("raw-secret-token");
  });

  it("fails strict EmailEngine health when the prepared Docker token is missing", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
        EMAILENGINE_ACCESS_TOKEN: "raw-secret-token",
        WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN: "true",
      },
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      ok: false,
      checks: {
        database: "ok",
        emailEngineAccessToken: "configured",
        emailEnginePreparedToken: "missing",
      },
      missing: ["EENGINE_PREPARED_TOKEN"],
      warnings: ["EENGINE_PREPARED_TOKEN"],
    });
    expect(JSON.stringify(health)).not.toContain("raw-secret-token");
  });

  it("fails strict EmailEngine health when the raw API token is missing", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
        EENGINE_PREPARED_TOKEN: "prepared-secret-token",
        WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN: "true",
      },
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      ok: false,
      checks: {
        database: "ok",
        emailEngineAccessToken: "missing",
        emailEnginePreparedToken: "configured",
      },
      missing: ["EMAILENGINE_ACCESS_TOKEN"],
      warnings: ["EMAILENGINE_ACCESS_TOKEN"],
    });
    expect(JSON.stringify(health)).not.toContain("prepared-secret-token");
  });

  it("passes strict EmailEngine health when raw and prepared tokens are configured", async () => {
    const health = await checkWorkerHealth({
      env: {
        DATABASE_URL: "postgres://emailhub:secret@postgres:5432/emailhub",
        EMAILENGINE_ACCESS_TOKEN: "raw-secret-token",
        EENGINE_PREPARED_TOKEN: "prepared-secret-token",
        WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN: "true",
      },
      createPool: () => pool(),
    });

    expect(health).toMatchObject({
      ok: true,
      checks: {
        database: "ok",
        emailEngineAccessToken: "configured",
        emailEnginePreparedToken: "configured",
      },
      missing: [],
      warnings: [],
    });
    expect(JSON.stringify(health)).not.toContain("raw-secret-token");
    expect(JSON.stringify(health)).not.toContain("prepared-secret-token");
  });
});

function pool(overrides: Partial<WorkerHealthPool> = {}): WorkerHealthPool {
  return {
    async query() {
      return undefined;
    },
    async end() {
      return undefined;
    },
    ...overrides,
  };
}
