import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("operational event migration", () => {
  it("adds durable diagnostic events for API and worker troubleshooting", async () => {
    const sql = await readFile(
      new URL("../../../infra/migrations/0029_operational_events.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS operational_events/i);
    expect(sql).toMatch(/service TEXT NOT NULL/i);
    expect(sql).toMatch(/level TEXT NOT NULL/i);
    expect(sql).toMatch(/event TEXT NOT NULL/i);
    expect(sql).toMatch(/request_id TEXT/i);
    expect(sql).toMatch(/account_id TEXT/i);
    expect(sql).toMatch(/lane TEXT/i);
    expect(sql).toMatch(/job_id TEXT/i);
    expect(sql).toMatch(/context JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(sql).toMatch(/operational_events_occurred_idx/i);
    expect(sql).toMatch(/operational_events_service_level_idx/i);
    expect(sql).toMatch(/operational_events_account_idx/i);
    expect(sql).toMatch(/operational_events_lane_idx/i);
    expect(sql).toMatch(/operational_events_job_idx/i);
  });
});
