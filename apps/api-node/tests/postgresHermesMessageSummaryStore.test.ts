import { describe, expect, it } from "vitest";

import { createPostgresHermesMessageSummaryStore } from "../src/hermes/postgres-message-summary-store";

describe("postgres Hermes message summary store", () => {
  it("looks up cached message summaries by body hash and summary tuple", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesMessageSummaryStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "summary_1",
              account_id: "account_1",
              message_id: "message_1",
              body_hash: "hash_1",
              mode: "action_points",
              focus: "decisions",
              language: "zh-CN",
              summary_text: "需要确认发布时间。",
              skill_run_id: "run_1",
              audit_event_id: "audit_1",
              created_at: "2026-06-16T09:00:00.000Z",
              updated_at: "2026-06-16T09:00:00.000Z",
            },
          ],
        };
      },
    });

    const result = await store.getCachedSummary({
      accountId: "account_1",
      messageId: "message_1",
      bodyHash: "hash_1",
      mode: "action_points",
      focus: "decisions",
      language: "zh-CN",
    });

    expect(queries[0].text).toMatch(/FROM hermes_message_summaries/i);
    expect(queries[0].text).toMatch(/body_hash = \$3/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "message_1",
      "hash_1",
      "action_points",
      "decisions",
      "zh-CN",
    ]);
    expect(result).toMatchObject({
      id: "summary_1",
      accountId: "account_1",
      messageId: "message_1",
      summaryText: "需要确认发布时间。",
      skillRunId: "run_1",
      auditEventId: "audit_1",
    });
  });

  it("upserts summaries without duplicating concurrent requests", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesMessageSummaryStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "summary_1",
              account_id: "account_1",
              message_id: "message_1",
              body_hash: "hash_1",
              mode: "short",
              focus: "reply needs",
              language: "English",
              summary_text: "Reply today.",
              skill_run_id: "run_1",
              audit_event_id: null,
              created_at: "2026-06-16T09:00:00.000Z",
              updated_at: "2026-06-16T09:00:00.000Z",
            },
          ],
        };
      },
    });

    const result = await store.saveSummary({
      id: "summary_1",
      accountId: "account_1",
      messageId: "message_1",
      bodyHash: "hash_1",
      mode: "short",
      focus: "reply needs",
      language: "English",
      summaryText: "Reply today.",
      skillRunId: "run_1",
    });

    expect(queries[0].text).toMatch(/ON CONFLICT/i);
    expect(queries[0].text).toMatch(
      /account_id,\s*message_id,\s*mode,\s*focus,\s*language,\s*body_hash/i,
    );
    expect(queries[0].values).toEqual([
      "summary_1",
      "account_1",
      "message_1",
      "hash_1",
      "short",
      "reply needs",
      "English",
      "Reply today.",
      "run_1",
      null,
    ]);
    expect(result).toMatchObject({
      id: "summary_1",
      summaryText: "Reply today.",
      skillRunId: "run_1",
    });
    expect(result.auditEventId).toBeUndefined();
  });
});
