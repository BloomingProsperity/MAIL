import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readMigration(): Promise<string> {
  const migrationUrl = new URL(
    "../../../infra/migrations/0005_hermes_runtime.sql",
    import.meta.url,
  );

  return readFile(migrationUrl, "utf8");
}

describe("Hermes runtime migration", () => {
  it("seeds built-in skills and links audit events to skill runs", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/INSERT INTO hermes_skills/i);
    expect(sql).toMatch(/translate_text/i);
    expect(sql).toMatch(/action_plan/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS skill_run_id UUID/i);
    expect(sql).toMatch(/REFERENCES hermes_skill_runs\(id\)/i);
    expect(sql).toMatch(/hermes_audit_events_skill_run_idx/i);
  });
});
