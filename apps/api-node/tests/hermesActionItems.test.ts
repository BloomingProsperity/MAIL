import { describe, expect, it } from "vitest";

import { createHermesActionItemExtractService } from "../src/hermes/action-items";

describe("Hermes action item extract service", () => {
  it("extracts structured action items with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesActionItemExtractService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return JSON.stringify([
            {
              title: "Confirm launch schedule",
              owner: "me",
              dueAt: "2026-06-12T17:00:00.000Z",
              dueText: "today 17:00",
              priority: "high",
              status: "open",
              sourceQuote: "Can you confirm the launch schedule today?",
            },
          ]);
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
                content: { summary: "Lina is a customer contact." },
                confidence: 0.88,
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

    const result = await service.extractActionItems({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      language: "English",
      now: "2026-06-12T10:00:00.000Z",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["contact_memory"],
    });

    expect(memoryQueries).toEqual([
      { layer: "contact_memory", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("extract action items");
    expect(providerCalls[0].systemPrompt).toContain("JSON array");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[contact_memory/global confidence=0.88] Lina is a customer contact.",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Thread context:\nLina: Can you confirm the launch schedule today?",
    );
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "action_item_extract",
      items: [
        {
          title: "Confirm launch schedule",
          owner: "me",
          dueAt: "2026-06-12T17:00:00.000Z",
          dueText: "today 17:00",
          priority: "high",
          status: "open",
          sourceQuote: "Can you confirm the launch schedule today?",
        },
      ],
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "action_item_extract",
          skillTitle: "Extract action items",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            language: "English",
            now: "2026-06-12T10:00:00.000Z",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
          output: {
            items: [
              {
                title: "Confirm launch schedule",
                owner: "me",
                dueAt: "2026-06-12T17:00:00.000Z",
                dueText: "today 17:00",
                priority: "high",
                status: "open",
                sourceQuote: "Can you confirm the launch schedule today?",
              },
            ],
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.action_item_extract",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "action_item_extract",
            language: "English",
            now: "2026-06-12T10:00:00.000Z",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesActionItemExtractService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.extractActionItems({ threadText: " ", subject: "Re: hello" }),
    ).rejects.toThrow("thread text is required");
  });

  it("rejects non-array Hermes output", async () => {
    const service = createHermesActionItemExtractService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          return JSON.stringify({ title: "not an array" });
        },
      },
    });

    await expect(
      service.extractActionItems({
        threadText: "Please review the launch schedule.",
      }),
    ).rejects.toThrow("action item output must be a JSON array");
  });
});
