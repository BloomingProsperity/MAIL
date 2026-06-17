import { describe, expect, it } from "vitest";

import {
  createHermesRetentionMaintenanceService,
  createPostgresHermesRetentionMaintenanceStore,
} from "../src/maintenance/hermes-retention-maintenance";

describe("Hermes retention maintenance", () => {
  it("reports bounded expired-row estimates for managed Hermes tables", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const counts = ["1", "501", "0", "2", "3", "4"];
    const store = createPostgresHermesRetentionMaintenanceStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [{ count: counts.shift() ?? "0" }] };
      },
    });
    const service = createHermesRetentionMaintenanceService({
      store,
      now: () => new Date("2026-06-17T12:00:00.000Z"),
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      cleanupLimit: 500,
    });

    const status = await service.getStatus();

    expect(status).toMatchObject({
      generatedAt: "2026-06-17T12:00:00.000Z",
      retentionDays: 30,
      cleanupLimit: 500,
      cutoff: "2026-05-18T12:00:00.000Z",
      expiredRows: 510,
      scanLimited: true,
    });
    expect(status.tables).toHaveLength(6);
    expect(status.tables[1]).toMatchObject({
      table: "hermes_message_summaries",
      expiredRows: 500,
      scanLimit: 500,
      scanLimited: true,
    });
    expect(queries).toHaveLength(6);
    expect(queries[0].values).toEqual([
      new Date("2026-05-18T12:00:00.000Z"),
      501,
    ]);
    expect(queries[0].text).toContain("LIMIT $2");
  });

  it("runs bounded cleanup and returns per-table deletion counts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const cleanupRows = [1, 2, 3, 4, 5, 6];
    const store = createPostgresHermesRetentionMaintenanceStore({
      async query(text, values) {
        queries.push({ text, values });
        if (text.includes("DELETE FROM")) {
          return { rows: [], rowCount: cleanupRows.shift() ?? 0 };
        }

        return { rows: [{ count: "0" }] };
      },
    });
    const service = createHermesRetentionMaintenanceService({
      store,
      now: () => new Date("2026-06-17T12:00:00.000Z"),
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      cleanupLimit: 500,
    });

    const result = await service.cleanup({ retentionDays: 14, limit: 25 });

    expect(result).toMatchObject({
      retentionDays: 14,
      cleanupLimit: 25,
      cutoff: "2026-06-03T12:00:00.000Z",
      cleanup: {
        messageTranslations: 1,
        messageSummaries: 2,
        actionPlans: 3,
        feedback: 4,
        auditEvents: 5,
        skillRuns: 6,
        deleted: 21,
      },
    });
    expect(
      queries.filter((query) => query.text.includes("DELETE FROM")),
    ).toHaveLength(6);
    expect(queries[0].values).toEqual([
      new Date("2026-06-03T12:00:00.000Z"),
      25,
    ]);
    expect(result.after.cleanupLimit).toBe(25);
  });
});
