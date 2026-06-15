import { describe, expect, it } from "vitest";

import {
  collectSyncJobDiagnostics,
  formatSyncJobDiagnosticsForLog,
} from "../src/sync-job-diagnostics";

describe("sync job diagnostics", () => {
  it("summarizes sync_jobs backlog health with lease and dead-letter context", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (queries.length === 1) {
          return {
            rows: [
              {
                total_jobs: "28",
                queued_jobs: "12",
                due_queued_jobs: "9",
                scheduled_queued_jobs: "3",
                running_jobs: "4",
                active_running_jobs: "2",
                expired_running_jobs: "2",
                done_jobs: "10",
                failed_jobs: "0",
                dead_letter_jobs: "2",
                oldest_queued_at: "2026-06-14T03:40:00.000Z",
                oldest_due_at: "2026-06-14T03:40:00.000Z",
                next_scheduled_at: "2026-06-14T04:10:00.000Z",
              },
            ],
          };
        }

        return {
          rows: [
            {
              account_id: "acc_customer",
              queued_jobs: "7",
              due_queued_jobs: "6",
              running_jobs: "1",
              expired_running_jobs: "1",
              dead_letter_jobs: "0",
              oldest_queued_at: "2026-06-14T03:40:00.000Z",
            },
            {
              account_id: "acc_news",
              queued_jobs: "5",
              due_queued_jobs: "3",
              running_jobs: "3",
              expired_running_jobs: "1",
              dead_letter_jobs: "2",
              oldest_queued_at: "2026-06-14T03:45:00.000Z",
            },
          ],
        };
      },
    };

    const result = await collectSyncJobDiagnostics({
      client,
      now: new Date("2026-06-14T04:00:00.000Z"),
      topAccountLimit: 5,
    });

    expect(queries).toHaveLength(2);
    expect(queries[0].text).toMatch(/COUNT\(\*\) FILTER/i);
    expect(queries[0].text).toMatch(/lease_expires_at <= \$1::timestamptz/i);
    expect(queries[0].values).toEqual(["2026-06-14T04:00:00.000Z"]);
    expect(queries[1].text).toMatch(/GROUP BY COALESCE\(account_id/i);
    expect(queries[1].text).toMatch(/LIMIT \$2/i);
    expect(queries[1].values).toEqual(["2026-06-14T04:00:00.000Z", 5]);
    expect(result).toEqual({
      service: "email-hub-worker",
      ok: false,
      checkedAt: "2026-06-14T04:00:00.000Z",
      totals: {
        totalJobs: 28,
        queuedJobs: 12,
        dueQueuedJobs: 9,
        scheduledQueuedJobs: 3,
        runningJobs: 4,
        activeRunningJobs: 2,
        expiredRunningJobs: 2,
        doneJobs: 10,
        failedJobs: 0,
        deadLetterJobs: 2,
      },
      timestamps: {
        oldestQueuedAt: "2026-06-14T03:40:00.000Z",
        oldestDueAt: "2026-06-14T03:40:00.000Z",
        nextScheduledAt: "2026-06-14T04:10:00.000Z",
      },
      warnings: ["expired_running_jobs", "dead_letter_jobs"],
      topAccounts: [
        {
          accountId: "acc_customer",
          queuedJobs: 7,
          dueQueuedJobs: 6,
          runningJobs: 1,
          expiredRunningJobs: 1,
          deadLetterJobs: 0,
          oldestQueuedAt: "2026-06-14T03:40:00.000Z",
        },
        {
          accountId: "acc_news",
          queuedJobs: 5,
          dueQueuedJobs: 3,
          runningJobs: 3,
          expiredRunningJobs: 1,
          deadLetterJobs: 2,
          oldestQueuedAt: "2026-06-14T03:45:00.000Z",
        },
      ],
    });
  });

  it("formats a compact log line for quick SSH troubleshooting", async () => {
    const line = formatSyncJobDiagnosticsForLog({
      service: "email-hub-worker",
      ok: false,
      checkedAt: "2026-06-14T04:00:00.000Z",
      totals: {
        totalJobs: 5,
        queuedJobs: 3,
        dueQueuedJobs: 2,
        scheduledQueuedJobs: 1,
        runningJobs: 1,
        activeRunningJobs: 0,
        expiredRunningJobs: 1,
        doneJobs: 0,
        failedJobs: 0,
        deadLetterJobs: 1,
      },
      timestamps: {},
      warnings: ["expired_running_jobs", "dead_letter_jobs"],
      topAccounts: [],
    });

    expect(line).toBe(
      "service=email-hub-worker ok=false queued=3 due=2 running=1 expired=1 deadLetter=1 warnings=expired_running_jobs,dead_letter_jobs",
    );
  });
});
