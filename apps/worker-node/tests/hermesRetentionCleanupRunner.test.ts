import { describe, expect, it } from "vitest";

import {
  createHermesRetentionCleanupLane,
  createPostgresHermesRetentionCleanupStore,
  runHermesRetentionCleanupOnce,
} from "../src/hermes-retention-cleanup-runner";

describe("Hermes retention cleanup runner", () => {
  it("fails stale confirmations and deletes expired Hermes rows in bounded batches", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const rowCounts = [1, 2, 3, 4, 5, 6, 7];
    const store = createPostgresHermesRetentionCleanupStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [], rowCount: rowCounts.shift() ?? 0 };
      },
    });
    const cutoff = new Date("2026-06-01T00:00:00.000Z");

    const result = await store.cleanupExpired({ cutoff, limit: 500 });

    expect(result).toEqual({
      staleActionPlanConfirmations: 1,
      messageTranslations: 2,
      messageSummaries: 3,
      actionPlans: 4,
      feedback: 5,
      auditEvents: 6,
      skillRuns: 7,
    });
    expect(queries.map((query) => query.text)).toEqual([
      expect.stringContaining("WITH stale_plans AS"),
      expect.stringContaining("FROM hermes_message_translations"),
      expect.stringContaining("FROM hermes_message_summaries"),
      expect.stringContaining("FROM hermes_action_plans"),
      expect.stringContaining("FROM hermes_feedback"),
      expect.stringContaining("FROM hermes_audit_events"),
      expect.stringContaining("FROM hermes_skill_runs"),
    ]);
    expect(queries[0].text).toContain("status = 'confirming'");
    expect(queries[0].text).toContain("FOR UPDATE SKIP LOCKED");
    expect(queries[0].values).toEqual([
      cutoff,
      500,
      "confirmation_timed_out",
    ]);
    expect(queries[3].text).toContain("status = 'completed'");
    expect(queries[1].values).toEqual([cutoff, 500]);
  });

  it("reports processed cleanup totals and cutoff time", async () => {
    const result = await runHermesRetentionCleanupOnce({
      now: new Date("2026-06-16T00:00:00.000Z"),
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      limit: 100,
      store: {
        async cleanupExpired() {
          return {
            staleActionPlanConfirmations: 1,
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
      deleted: 7,
      staleActionPlanConfirmations: 1,
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
            staleActionPlanConfirmations: 0,
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
