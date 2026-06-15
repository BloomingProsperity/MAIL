import { pathToFileURL } from "node:url";
import { Pool } from "pg";

import { readWorkerRuntimeConfig, type WorkerRuntimeConfig } from "./runtime-config.js";
import { describeWorker } from "./worker.js";

export type WorkerHealthDatabaseStatus = "ok" | "missing" | "unavailable";
export type WorkerHealthTokenStatus = "configured" | "missing";

export interface WorkerHealthPool {
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
}

export interface WorkerHealthResult {
  service: "email-hub-worker";
  ok: boolean;
  ready: boolean;
  checkedAt: string;
  lanes: string[];
  runtime: WorkerRuntimeConfig;
  checks: {
    database: WorkerHealthDatabaseStatus;
    emailEngineAccessToken: WorkerHealthTokenStatus;
  };
  missing: string[];
  warnings: string[];
}

export interface WorkerHealthcheckOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  createPool?: (databaseUrl: string) => WorkerHealthPool;
}

export async function checkWorkerHealth(
  options: WorkerHealthcheckOptions = {},
): Promise<WorkerHealthResult> {
  const env = options.env ?? process.env;
  const runtime = readWorkerRuntimeConfig(env);
  const worker = describeWorker();
  const missing: string[] = [];
  const warnings: string[] = [];
  const requireEmailEngineToken =
    env.WORKER_HEALTH_REQUIRE_EMAILENGINE_TOKEN === "true";

  const database = await checkDatabase({
    databaseUrl: env.DATABASE_URL,
    createPool: options.createPool ?? createPostgresPool,
  });
  if (database === "missing") {
    missing.push("DATABASE_URL");
  }

  const emailEngineAccessToken =
    typeof env.EMAILENGINE_ACCESS_TOKEN === "string" &&
    env.EMAILENGINE_ACCESS_TOKEN.trim().length > 0
      ? "configured"
      : "missing";
  if (emailEngineAccessToken === "missing") {
    warnings.push("EMAILENGINE_ACCESS_TOKEN");
    if (requireEmailEngineToken) {
      missing.push("EMAILENGINE_ACCESS_TOKEN");
    }
  }

  const ok =
    database === "ok" &&
    (!requireEmailEngineToken || emailEngineAccessToken === "configured");

  return {
    service: "email-hub-worker",
    ok,
    ready: ok,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    lanes: worker.lanes,
    runtime,
    checks: {
      database,
      emailEngineAccessToken,
    },
    missing,
    warnings,
  };
}

export function formatWorkerHealthForLog(result: WorkerHealthResult): string {
  return [
    `service=${result.service}`,
    `ok=${String(result.ok)}`,
    `database=${result.checks.database}`,
    `emailEngineAccessToken=${result.checks.emailEngineAccessToken}`,
    `lanes=${result.lanes.length}`,
  ].join(" ");
}

export async function runWorkerHealthcheck(
  options: WorkerHealthcheckOptions = {},
): Promise<WorkerHealthResult> {
  const result = await checkWorkerHealth(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }

  return result;
}

async function checkDatabase(input: {
  databaseUrl?: string;
  createPool: (databaseUrl: string) => WorkerHealthPool;
}): Promise<WorkerHealthDatabaseStatus> {
  const databaseUrl = input.databaseUrl?.trim();
  if (!databaseUrl) {
    return "missing";
  }

  const pool = input.createPool(databaseUrl);
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function createPostgresPool(databaseUrl: string): WorkerHealthPool {
  return new Pool({ connectionString: databaseUrl });
}

function isMainModule(): boolean {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
}

if (isMainModule()) {
  void runWorkerHealthcheck().catch(() => {
    process.stdout.write(
      `${JSON.stringify({
        service: "email-hub-worker",
        ok: false,
        ready: false,
        checks: { database: "unavailable" },
        missing: [],
        warnings: [],
      })}\n`,
    );
    process.exitCode = 1;
  });
}
