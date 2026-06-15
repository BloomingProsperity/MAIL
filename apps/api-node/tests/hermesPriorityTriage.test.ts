import { describe, expect, it } from "vitest";

import { createHermesPriorityTriageService } from "../src/hermes/priority-triage";

describe("Hermes priority triage service", () => {
  it("triages priority with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesPriorityTriageService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return JSON.stringify({
            priority: "high",
            bucket: "P1 Urgent",
            score: 91,
            reasons: [
              "directly addressed to the user",
              "needs reply today",
            ],
            explanation: "Customer launch confirmation is due today.",
          });
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
                content: { summary: "Lina is a VIP customer contact." },
                confidence: 0.93,
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

    const result = await service.triagePriority({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      senderEmail: "lina@example.com",
      currentBucket: "P3 Needs Action",
      currentScore: 82,
      currentReasons: ["directly addressed", "project tag"],
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["contact_memory"],
    });

    expect(memoryQueries).toEqual([
      { layer: "contact_memory", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("triage email priority");
    expect(providerCalls[0].systemPrompt).toContain("JSON object");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[contact_memory/global confidence=0.93] Lina is a VIP customer contact.",
    );
    expect(providerCalls[0].userPrompt).toContain("Current bucket: P3 Needs Action");
    expect(providerCalls[0].userPrompt).toContain(
      "Thread context:\nLina: Can you confirm the launch schedule today?",
    );
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "priority_triage",
      priority: "high",
      bucket: "P1 Urgent",
      score: 91,
      reasons: ["directly addressed to the user", "needs reply today"],
      explanation: "Customer launch confirmation is due today.",
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "priority_triage",
          skillTitle: "Triage priority",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            senderEmail: "lina@example.com",
            currentBucket: "P3 Needs Action",
            currentScore: 82,
            currentReasons: ["directly addressed", "project tag"],
            language: "English",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
          output: {
            priority: "high",
            bucket: "P1 Urgent",
            score: 91,
            reasons: ["directly addressed to the user", "needs reply today"],
            explanation: "Customer launch confirmation is due today.",
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.priority_triage",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "priority_triage",
            senderEmail: "lina@example.com",
            currentBucket: "P3 Needs Action",
            currentScore: 82,
            language: "English",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesPriorityTriageService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.triagePriority({ threadText: " ", subject: "Re: hello" }),
    ).rejects.toThrow("thread text is required");
  });

  it("rejects invalid bucket output", async () => {
    const service = createHermesPriorityTriageService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          return JSON.stringify({
            priority: "high",
            bucket: "P9 Surprise",
            score: 90,
            reasons: ["invalid bucket"],
          });
        },
      },
    });

    await expect(
      service.triagePriority({ threadText: "Please reply today." }),
    ).rejects.toThrow("priority bucket is invalid");
  });
});
