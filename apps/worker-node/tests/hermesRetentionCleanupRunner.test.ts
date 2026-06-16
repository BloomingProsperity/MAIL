import { describe, expect, it } from "vitest";

import {
  createHermesRetentionCleanupLane,
  createPostgresHermesRetentionCleanupStore,
  runHermesRetentionCleanupOnce,
} from "../src/hermes-retention-cleanup-runner";

describe("Hermes retention cleanup runner", () => {
  it("deletes expired Hermes cache, audit, and run rows in bounded batches", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const rowCounts = [2, 3, 1, 4, 5, 6];
    const store = createPostgresHermesRetentionCleanupStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [], rowCount: rowCounts.shift() ?? 0 };
      },
    });
    const cutoff = new Date("2026-06-01T00:00:00.000Z");

    const result = await store.cleanupExpired({ cutoff, limit: 500 });

    expect(result).toEqual({
      messageTranslations: 2,
      messageSummaries: 3,
      actionPlans: 1,
      feedback: 4,
      auditEvents: 5,
      skillRuns: 6,
    });
    expect(queries.map((query) => query.text)).toEqual([
      expect.stringContaining("FROM hermes_message_translations"),
      expect.stringContaining("FROM hermes_message_summaries"),
      expect.stringContaining("FROM hermes_action_plans"),
      expect.stringContaining("FROM hermes_feedback"),
      expect.stringContaining("FROM hermes_audit_events"),
      expect.stringContaining("FROM hermes_skill_runs"),
    ]);
    expect(queries[2].text).toContain("status = 'completed'");
    expect(queries[0].values).toEqual([cutoff, 500]);
  });

  it("reports processed cleanup totals and cutoff time", async () => {
    const result = await runHermesRetentionCleanupOnce({
      now: new Date("2026-06-16T00:00:00.000Z"),
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      limit: 100,
      store: {
        async cleanupExpired() {
          return {
            messageTranslations: 1,
            messageSummaries: 0,
            actionPlans: 0,
            feedback: 0,
            auditEvents: 2,
            skillRuns: 3,
          };
        },
      },
    });

    expect(result).toEqual({
      status: "processed",
      cutoff: "2026-05-17T00:00:00.000Z",
      deleted: 6,
      messageTranslations: 1,
      messageSummaries: 0,
      actionPlans: 0,
      feedback: 0,
      auditEvents: 2,
      skillRuns: 3,
    });
  });

  it("does not run again before the configured interval", async () => {
    let runs = 0;
    const lane = createHermesRetentionCleanupLane({
      clock: () => new Date("2026-06-16T00:00:00.000Z"),
      intervalMs: 60_000,
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      limit: 100,
      store: {
        async cleanupExpired() {
          runs += 1;
          return {
            messageTranslations: 0,
            messageSummaries: 0,
            actionPlans: 0,
            feedback: 0,
            auditEvents: 0,
            skillRuns: 0,
          };
        },
      },
    });

    expect(await lane()).toEqual([{ status: "idle" }]);
    expect(await lane()).toEqual([{ status: "idle" }]);
    expect(runs).toBe(1);
  });
});
