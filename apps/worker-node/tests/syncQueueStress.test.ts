import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSyncQueueStressCheck } from "../src/sync-queue-stress";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

async function readProjectFile(...parts: string[]): Promise<string> {
  return readFile(join(repoRoot, ...parts), "utf8");
}

describe("sync queue stress diagnostics", () => {
  it("drains a large multi-account backlog without duplicate claims or same-account overlap", async () => {
    const result = await runSyncQueueStressCheck({
      accountCount: 8,
      jobsPerAccount: 25,
      workerCount: 32,
      leaseSeconds: 30,
      workDelayMs: 1,
      startedAt: new Date("2026-06-14T04:00:00.000Z"),
    });

    expect(result).toMatchObject({
      ok: true,
      accountCount: 8,
      jobsPerAccount: 25,
      workerCount: 32,
      totalJobs: 200,
      completedJobs: 200,
      duplicateClaims: [],
      maxConcurrentPerAccount: 1,
      maxAttempts: 1,
    });
    expect(result.perAccountCompleted).toEqual({
      acc_001: 25,
      acc_002: 25,
      acc_003: 25,
      acc_004: 25,
      acc_005: 25,
      acc_006: 25,
      acc_007: 25,
      acc_008: 25,
    });
    expect(result.idleWorkers).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks the stress check unhealthy when a queue duplicate-claims the same job", async () => {
    const result = await runSyncQueueStressCheck({
      accountCount: 2,
      jobsPerAccount: 2,
      workerCount: 4,
      leaseSeconds: 30,
      workDelayMs: 1,
      startedAt: new Date("2026-06-14T04:00:00.000Z"),
      injectDuplicateClaimForTest: true,
    });

    expect(result.ok).toBe(false);
    expect(result.duplicateClaims).toEqual(["job_acc_001_001"]);
  });

  it("exposes documented self-hosted stress gates from the root workspace", async () => {
    const rootPackage = JSON.parse(await readProjectFile("package.json"));
    const workerPackage = JSON.parse(
      await readProjectFile("apps", "worker-node", "package.json"),
    );
    const readme = await readProjectFile("README.md");

    expect(workerPackage.scripts["stress:sync-queue"]).toBe(
      "node dist/sync-queue-stress.js",
    );
    expect(rootPackage.scripts["stress:sync-queue"]).toBe(
      "npm run build:worker && npm run stress:sync-queue -w apps/worker-node --",
    );
    expect(rootPackage.scripts["stress:sync-queue:heavy"]).toContain(
      "--accounts=64 --jobs-per-account=200 --workers=128 --work-delay-ms=1",
    );
    expect(rootPackage.scripts["stress:sync-queue:postgres"]).toBe(
      "npm run test:worker:postgres",
    );
    expect(workerPackage.scripts["test:postgres:strict"]).toBe(
      "tsx src/postgres-strict-gate.ts && vitest run tests/postgresSyncQueueStress.integration.test.ts",
    );
    expect(rootPackage.scripts["stress:sync-queue:postgres:strict"]).toBe(
      "npm run test:postgres:strict -w apps/worker-node",
    );
    expect(rootPackage.scripts["verify:emailengine-launch:strict-db"]).toBe(
      "npm run stress:sync-queue:postgres:strict",
    );
    expect(rootPackage.scripts["verify:emailengine-launch"]).toContain(
      "npm run verify:emailengine-launch:strict-db",
    );
    expect(readme).toContain("npm run stress:sync-queue");
    expect(readme).toContain("npm run stress:sync-queue:heavy");
    expect(readme).toContain("npm run stress:sync-queue:postgres");
    expect(readme).toContain("npm run verify:emailengine-launch:strict-db");
    expect(readme).toContain("TEST_DATABASE_URL");
  });
});
