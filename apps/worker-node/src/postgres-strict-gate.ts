import { pathToFileURL } from "node:url";

export const STRICT_POSTGRES_GATE_MESSAGE =
  "TEST_DATABASE_URL is required for strict Postgres sync queue stress. Start infra/docker-compose.test.yml and do not point this at production.";

export function requireStrictPostgresTestDatabaseUrl(
  env: { TEST_DATABASE_URL?: string } = process.env,
): string {
  const databaseUrl = env.TEST_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(STRICT_POSTGRES_GATE_MESSAGE);
  }

  return databaseUrl;
}

function main(): void {
  try {
    requireStrictPostgresTestDatabaseUrl();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
