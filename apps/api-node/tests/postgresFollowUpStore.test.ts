import { describe, expect, it } from "vitest";

import { createPostgresFollowUpStore } from "../src/follow-ups/postgres-follow-up-store";

describe("Postgres follow-up store", () => {
  it("creates durable follow-up reminders without provider payloads", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresFollowUpStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [followUpRow()] };
      },
    });

    const result = await store.createFollowUp({
      id: "fu_1",
      accountId: "acc_1",
      messageId: "msg_1",
      kind: "waiting_on_them",
      dueAt: "2026-06-14T09:00:00.000Z",
      title: "Check whether Lina replied",
      note: "From Hermes follow-up suggestion",
      source: "hermes_followup",
      hermesSkillRunId: "run_1",
      now: "2026-06-13T09:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO follow_up_reminders/i);
    expect(JSON.stringify(queries[0])).not.toMatch(/secret|token|provider_payload/i);
    expect(queries[0].values).toEqual([
      "fu_1",
      "acc_1",
      "msg_1",
      "waiting_on_them",
      "2026-06-14T09:00:00.000Z",
      "Check whether Lina replied",
      "From Hermes follow-up suggestion",
      "hermes_followup",
      "run_1",
      "2026-06-13T09:00:00.000Z",
    ]);
    expect(result).toMatchObject({
      id: "fu_1",
      accountId: "acc_1",
      status: "open",
    });
  });

  it("lists account follow-ups by status and due time", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresFollowUpStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [followUpRow()] };
      },
    });

    const result = await store.listFollowUps({
      accountId: "acc_1",
      status: "open",
      limit: 25,
    });

    expect(queries[0].text).toMatch(/FROM follow_up_reminders/i);
    expect(queries[0].text).toMatch(/account_id = \$1/i);
    expect(queries[0].text).toMatch(/status = \$2/i);
    expect(queries[0].text).toMatch(/ORDER BY due_at ASC, created_at ASC/i);
    expect(queries[0].values).toEqual(["acc_1", "open", 25]);
    expect(result).toHaveLength(1);
  });

  it("marks follow-ups done and records completion time", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresFollowUpStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            followUpRow({
              status: "done",
              completed_at: "2026-06-13T10:00:00.000Z",
            }),
          ],
        };
      },
    });

    const result = await store.updateFollowUp({
      id: "fu_1",
      status: "done",
      now: "2026-06-13T10:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE follow_up_reminders/i);
    expect(queries[0].text).toMatch(/completed_at = CASE/i);
    expect(queries[0].values).toEqual([
      "fu_1",
      null,
      null,
      "done",
      null,
      null,
      "2026-06-13T10:00:00.000Z",
    ]);
    expect(result?.status).toBe("done");
    expect(result?.completedAt).toBe("2026-06-13T10:00:00.000Z");
  });

  it("cancels follow-ups without deleting reminder history", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresFollowUpStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            followUpRow({
              status: "cancelled",
              cancelled_at: "2026-06-13T10:05:00.000Z",
            }),
          ],
        };
      },
    });

    const result = await store.cancelFollowUp({
      id: "fu_1",
      now: "2026-06-13T10:05:00.000Z",
    });

    expect(queries[0].text).toMatch(/UPDATE follow_up_reminders/i);
    expect(queries[0].text).toMatch(/status = 'cancelled'/i);
    expect(queries[0].values).toEqual([
      "fu_1",
      "2026-06-13T10:05:00.000Z",
    ]);
    expect(result?.status).toBe("cancelled");
    expect(result?.cancelledAt).toBe("2026-06-13T10:05:00.000Z");
  });
});

function followUpRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "fu_1",
    account_id: "acc_1",
    message_id: "msg_1",
    kind: "waiting_on_them",
    status: "open",
    due_at: "2026-06-14T09:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
    source: "hermes_followup",
    hermes_skill_run_id: "run_1",
    created_at: "2026-06-13T09:00:00.000Z",
    updated_at: "2026-06-13T09:00:00.000Z",
    completed_at: null,
    cancelled_at: null,
    ...overrides,
  };
}
