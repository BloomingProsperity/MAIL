import { describe, expect, it } from "vitest";

import { createPostgresHermesRunStore } from "../src/hermes/postgres-run-store";

describe("postgres Hermes run store", () => {
  it("records a completed skill run and audit event in one transaction", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (/COUNT\(DISTINCT id\)::int AS count/i.test(text)) {
          return { rows: [{ count: 1 }] };
        }
        return { rows: [] };
      },
    };

    const store = createPostgresHermesRunStore(client);
    await store.recordCompletedSkillRun({
      accountId: "00000000-0000-0000-0000-000000000099",
      run: {
        id: "run_1",
        skillId: "translate_text",
        skillTitle: "翻译邮件",
        input: { text: "Hello", targetLanguage: "Chinese" },
        output: { translatedText: "你好" },
      },
      auditEvent: {
        id: "audit_1",
        eventType: "hermes.skill.translate_text",
        skillRunId: "run_1",
        readMessageIds: ["00000000-0000-0000-0000-000000000001"],
        memoryIds: ["00000000-0000-0000-0000-000000000002"],
        action: { skillId: "translate_text", targetLanguage: "Chinese" },
      },
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "SELECT",
      "INSERT",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
    expect(queries[1].text).toMatch(/FROM messages/i);
    expect(queries[1].values).toEqual([
      "00000000-0000-0000-0000-000000000099",
      ["00000000-0000-0000-0000-000000000001"],
    ]);
    expect(queries[2].text).toMatch(/FROM hermes_memories/i);
    expect(queries[2].values).toEqual([
      "00000000-0000-0000-0000-000000000099",
      ["00000000-0000-0000-0000-000000000002"],
    ]);
    expect(queries[3].text).toMatch(/INSERT INTO hermes_skills/i);
    expect(queries[4].text).toMatch(/INSERT INTO hermes_skill_runs/i);
    expect(queries[4].values).toEqual([
      "run_1",
      "00000000-0000-0000-0000-000000000099",
      "translate_text",
      { text: "Hello", targetLanguage: "Chinese" },
      { translatedText: "你好" },
    ]);
    expect(queries[5].text).toMatch(/INSERT INTO hermes_audit_events/i);
    expect(queries[5].values).toEqual([
      "audit_1",
      "00000000-0000-0000-0000-000000000099",
      "hermes.skill.translate_text",
      "run_1",
      ["00000000-0000-0000-0000-000000000001"],
      ["00000000-0000-0000-0000-000000000002"],
      { skillId: "translate_text", targetLanguage: "Chinese" },
    ]);
  });

  it("rolls back when audit read messages are outside the run account", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (/COUNT\(DISTINCT id\)::int AS count/i.test(text)) {
          return { rows: [{ count: 0 }] };
        }
        return { rows: [] };
      },
    };

    const store = createPostgresHermesRunStore(client);
    await expect(
      store.recordCompletedSkillRun({
        accountId: "00000000-0000-0000-0000-000000000099",
        run: {
          id: "run_1",
          skillId: "translate_text",
          skillTitle: "翻译邮件",
          input: {},
          output: {},
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.translate_text",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [],
          action: {},
        },
      }),
    ).rejects.toThrow("Hermes run read message scope mismatch");

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "ROLLBACK",
    ]);
    expect(queries.some((query) => /INSERT INTO hermes_skill_runs/i.test(query.text))).toBe(
      false,
    );
  });
});
