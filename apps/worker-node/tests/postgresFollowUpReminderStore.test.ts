import { describe, expect, it } from "vitest";

import { createPostgresFollowUpReminderStore } from "../src/postgres-follow-up-reminder-store";

describe("Postgres follow-up reminder store", () => {
  it("claims one due open reminder with a lease", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresFollowUpReminderStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [followUpRow()] };
      },
    });

    const job = await store.claimNextDueFollowUp({
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
    });

    expect(queries[0].text).toMatch(/WITH candidate AS/i);
    expect(queries[0].text).toMatch(/FROM follow_up_reminders/i);
    expect(queries[0].text).toMatch(/status = 'open'/i);
    expect(queries[0].text).toMatch(/due_at <= \$1::timestamptz/i);
    expect(queries[0].text).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(queries[0].text).toMatch(/lease_owner = \$2/i);
    expect(queries[0].values).toEqual([
      "2026-06-13T12:30:00.000Z",
      "worker-a",
      "2026-06-13T12:30:30.000Z",
    ]);
    expect(job).toMatchObject({
      id: "fu_1",
      accountId: "acc_1",
      messageId: "msg_1",
      kind: "waiting_on_them",
    });
  });

  it("marks the reminder due and upserts an explainable Needs Action classification", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresFollowUpReminderStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    await store.promoteDueFollowUp({
      followUpId: "fu_1",
      messageId: "msg_1",
      now: new Date("2026-06-13T12:30:00.000Z"),
    });

    expect(queries[0].text).toMatch(/UPDATE follow_up_reminders/i);
    expect(queries[0].text).toMatch(/status = 'due'/i);
    expect(queries[0].text).toMatch(/INSERT INTO message_classification/i);
    expect(queries[0].text).toMatch(/P3 Needs Action/i);
    expect(queries[0].text).toMatch(/priority_score/i);
    expect(queries[0].text).toMatch(/Follow-up reminder is due/i);
    expect(queries[0].text).toMatch(/classified_by/i);
    expect(queries[0].text).toMatch(/follow_up_reminder/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(message_id\) DO UPDATE/i);
    expect(queries[0].values).toEqual([
      "fu_1",
      "msg_1",
      "2026-06-13T12:30:00.000Z",
    ]);
  });
});

function followUpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "fu_1",
    account_id: "acc_1",
    message_id: "msg_1",
    kind: "waiting_on_them",
    due_at: "2026-06-13T12:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
    ...overrides,
  };
}
