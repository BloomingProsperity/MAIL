import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readMigration(): Promise<string> {
  const migrationUrl = new URL(
    "../../../infra/migrations/0004_stored_secrets.sql",
    import.meta.url,
  );

  return readFile(migrationUrl, "utf8");
}

describe("stored secrets migration", () => {
  it("creates an opaque secret table for OAuth refresh token refs", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS stored_secrets/i);
    expect(sql).toMatch(/secret_ref TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/secret_value TEXT NOT NULL/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS stored_secrets_ref_idx/i);
  });
});
