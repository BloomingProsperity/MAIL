import { describe, expect, it } from "vitest";

import { createHermesThreadSummaryService } from "../src/hermes/summaries";

describe("Hermes thread summary service", () => {
  it("summarizes an email thread with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesThreadSummaryService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return [
            "Decision: launch schedule still needs confirmation.",
            "Action: reply to Lina today with any changes.",
          ].join("\n");
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000011",
                layer: "contact_memory",
                scope: "global",
                content: {
                  summary: "Lina is a customer contact on launch projects.",
                },
                confidence: 0.82,
                createdAt: "2026-06-12T09:00:00.000Z",
                updatedAt: "2026-06-12T10:00:00.000Z",
              },
            ],
          };
        },
        async updateMemory() {
          throw new Error("not used");
        },
        async deleteMemory() {
          throw new Error("not used");
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
        },
      },
    });

    const result = await service.summarizeThread({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      mode: "detailed",
      focus: "decisions and next actions",
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["contact_memory"],
    });

    expect(memoryQueries).toEqual([
      { layer: "contact_memory", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("summarize email threads");
    expect(providerCalls[0].userPrompt).toContain("Mode: detailed");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[contact_memory/global confidence=0.82] Lina is a customer contact on launch projects.",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Thread context:\nLina: Can you confirm the launch schedule today?",
    );
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "thread_summarize",
      mode: "detailed",
      summaryText: [
        "Decision: launch schedule still needs confirmation.",
        "Action: reply to Lina today with any changes.",
      ].join("\n"),
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "thread_summarize",
          skillTitle: "Summarize thread",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            mode: "detailed",
            focus: "decisions and next actions",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
          output: {
            mode: "detailed",
            summaryText: [
              "Decision: launch schedule still needs confirmation.",
              "Action: reply to Lina today with any changes.",
            ].join("\n"),
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.thread_summarize",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "thread_summarize",
            mode: "detailed",
            focus: "decisions and next actions",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        },
      },
    ]);
  });

  it("uses the action-points summary mode in prompts, results, and audit output", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const persisted: unknown[] = [];
    const ids = ["run_2", "audit_2"];
    const service = createHermesThreadSummaryService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return "Action: confirm the launch schedule by 17:00.";
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
        },
      },
    });

    const result = await service.summarizeThread({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      mode: "action_points",
      language: "English",
    });

    expect(providerCalls[0].userPrompt).toContain("Mode: action_points");
    expect(providerCalls[0].userPrompt).toContain(
      "Mode instruction: extract only action items, owners, deadlines, and reply needs",
    );
    expect(result).toEqual({
      skillRunId: "run_2",
      auditEventId: "audit_2",
      skillId: "thread_summarize",
      mode: "action_points",
      summaryText: "Action: confirm the launch schedule by 17:00.",
    });
    expect(persisted).toMatchObject([
      {
        run: {
          input: { mode: "action_points" },
          output: {
            mode: "action_points",
            summaryText: "Action: confirm the launch schedule by 17:00.",
          },
        },
        auditEvent: {
          action: {
            skillId: "thread_summarize",
            mode: "action_points",
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesThreadSummaryService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.summarizeThread({ threadText: " ", subject: "Re: hello" }),
    ).rejects.toThrow("thread text is required");
  });
});
