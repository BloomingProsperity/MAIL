import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Hermes audit log migration", () => {
  it("adds indexes for high-volume AI trace queries", async () => {
    const sql = await readFile(
      new URL("../../../infra/migrations/0028_hermes_audit_log_indexes.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toMatch(/hermes_audit_events_created_idx/i);
    expect(sql).toMatch(/ON hermes_audit_events \(created_at DESC, id DESC\)/i);
    expect(sql).toMatch(/hermes_audit_events_read_message_ids_gin_idx/i);
    expect(sql).toMatch(/USING GIN \(read_message_ids\)/i);
    expect(sql).toMatch(/hermes_audit_events_memory_ids_gin_idx/i);
    expect(sql).toMatch(/USING GIN \(memory_ids\)/i);
  });
});
