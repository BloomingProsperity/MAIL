import { describe, expect, it } from "vitest";

import { createPostgresHermesAuditLogStore } from "../src/hermes/postgres-audit-log-store";

describe("postgres Hermes audit log store", () => {
  it("lists audit events with account, skill, message, and memory filters", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesAuditLogStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "audit_1",
              account_id: "account_1",
              event_type: "hermes.skill.email_search_qa",
              skill_run_id: "run_1",
              skill_id: "email_search_qa",
              skill_title: "自然语言查邮件",
              read_message_ids: ["message_1"],
              memory_ids: ["memory_1"],
              action: { skillId: "email_search_qa" },
              input: { accountId: "account_1", question: "合同" },
              output: { answerText: "找到 1 封" },
              created_at: "2026-06-14T08:00:00.000Z",
            },
          ],
        };
      },
    });

    await expect(
      store.listAuditEvents({
        accountId: "account_1",
        skillId: "email_search_qa",
        messageId: "message_1",
        memoryId: "memory_1",
        limit: 25,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "audit_1",
          accountId: "account_1",
          eventType: "hermes.skill.email_search_qa",
          skillRunId: "run_1",
          skillId: "email_search_qa",
          skillTitle: "自然语言查邮件",
          readMessageIds: ["message_1"],
          memoryIds: ["memory_1"],
          action: { skillId: "email_search_qa" },
          input: { accountId: "account_1", question: "合同" },
          output: { answerText: "找到 1 封" },
          createdAt: "2026-06-14T08:00:00.000Z",
        },
      ],
    });

    expect(queries[0].text).toMatch(/FROM hermes_audit_events/i);
    expect(queries[0].text).toMatch(/LEFT JOIN hermes_skill_runs/i);
    expect(queries[0].text).toMatch(/LEFT JOIN hermes_skills/i);
    expect(queries[0].text).toMatch(/audit\.account_id::text = \$1/i);
    expect(queries[0].text).not.toMatch(/run\.input->>'accountId' = \$1/i);
    expect(queries[0].text).not.toMatch(/FROM messages/i);
    expect(queries[0].text).toMatch(/\$3 = ANY\(audit\.read_message_ids::text\[\]\)/i);
    expect(queries[0].text).toMatch(/\$4 = ANY\(audit\.memory_ids::text\[\]\)/i);
    expect(queries[0].text).toMatch(/ORDER BY audit\.created_at DESC, audit\.id DESC/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "email_search_qa",
      "message_1",
      "memory_1",
      25,
    ]);
  });
});
