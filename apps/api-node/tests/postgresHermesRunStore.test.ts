import { describe, expect, it } from "vitest";

import { createPostgresHermesRunStore } from "../src/hermes/postgres-run-store";

describe("postgres Hermes run store", () => {
  it("records a completed skill run and audit event in one transaction", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresHermesRunStore(client);
    await store.recordCompletedSkillRun({
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
      "INSERT",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
    expect(queries[1].text).toMatch(/INSERT INTO hermes_skills/i);
    expect(queries[2].text).toMatch(/INSERT INTO hermes_skill_runs/i);
    expect(queries[2].values).toEqual([
      "run_1",
      "translate_text",
      { text: "Hello", targetLanguage: "Chinese" },
      { translatedText: "你好" },
    ]);
    expect(queries[3].text).toMatch(/INSERT INTO hermes_audit_events/i);
    expect(queries[3].values).toEqual([
      "audit_1",
      "hermes.skill.translate_text",
      "run_1",
      ["00000000-0000-0000-0000-000000000001"],
      ["00000000-0000-0000-0000-000000000002"],
      { skillId: "translate_text", targetLanguage: "Chinese" },
    ]);
  });
});
