import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const migrationsDir = path.join(repoRoot, "infra", "migrations");

export function readTestDatabaseUrl(): string | undefined {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    return undefined;
  }

  assertSafeTestDatabaseUrl(databaseUrl);
  return databaseUrl;
}

export async function createPostgresTestPool(): Promise<Pool> {
  const databaseUrl = readTestDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for Postgres integration tests");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 80,
  });
  await waitForPostgres(pool);
  await applyMigrations(pool);
  return pool;
}

export async function resetPostgresTestDatabase(pool: Pool): Promise<void> {
  await pool.query(
    "TRUNCATE sync_runs, sync_jobs, mail_engine_events RESTART IDENTITY CASCADE",
  );
}

async function applyMigrations(pool: Pool): Promise<void> {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
  }
}

async function waitForPostgres(pool: Pool): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(500);
    }
  }
}

function assertSafeTestDatabaseUrl(raw: string): void {
  const parsed = new URL(raw);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run destructive integration tests against non-test database "${databaseName}"`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
