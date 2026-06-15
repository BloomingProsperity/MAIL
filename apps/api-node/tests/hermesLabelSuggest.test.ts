import { describe, expect, it } from "vitest";

import { createHermesLabelSuggestService } from "../src/hermes/label-suggest";

describe("Hermes label suggest service", () => {
  it("suggests labels and organization actions with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesLabelSuggestService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return JSON.stringify({
            labels: [
              {
                name: "客户",
                confidence: 0.86,
                reason: "Customer is asking for launch confirmation.",
              },
            ],
            actions: [
              {
                type: "keep_in_inbox",
                reason: "Needs a direct reply today.",
              },
              {
                type: "apply_label",
                label: "客户",
                reason: "Customer project thread.",
              },
            ],
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
                layer: "procedural_memory",
                scope: "global",
                content: { rule: "Customer requests should stay in inbox." },
                confidence: 0.91,
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

    const result = await service.suggestLabels({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      senderEmail: "lina@example.com",
      currentLabels: ["工作"],
      availableLabels: ["工作", "客户", "产品"],
      language: "Chinese",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["procedural_memory"],
    });

    expect(memoryQueries).toEqual([
      { layer: "procedural_memory", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("suggest labels");
    expect(providerCalls[0].systemPrompt).toContain("JSON object");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[procedural_memory/global confidence=0.91] Customer requests should stay in inbox.",
    );
    expect(providerCalls[0].userPrompt).toContain("Available labels: 工作, 客户, 产品");
    expect(providerCalls[0].userPrompt).toContain(
      "Thread context:\nLina: Can you confirm the launch schedule today?",
    );
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "label_suggest",
      labels: [
        {
          name: "客户",
          confidence: 0.86,
          reason: "Customer is asking for launch confirmation.",
        },
      ],
      actions: [
        {
          type: "keep_in_inbox",
          reason: "Needs a direct reply today.",
        },
        {
          type: "apply_label",
          label: "客户",
          reason: "Customer project thread.",
        },
      ],
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "label_suggest",
          skillTitle: "Suggest labels",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            senderEmail: "lina@example.com",
            currentLabels: ["工作"],
            availableLabels: ["工作", "客户", "产品"],
            language: "Chinese",
            memoryScope: "global",
            memoryLayers: ["procedural_memory"],
          },
          output: {
            labels: [
              {
                name: "客户",
                confidence: 0.86,
                reason: "Customer is asking for launch confirmation.",
              },
            ],
            actions: [
              {
                type: "keep_in_inbox",
                reason: "Needs a direct reply today.",
              },
              {
                type: "apply_label",
                label: "客户",
                reason: "Customer project thread.",
              },
            ],
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.label_suggest",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "label_suggest",
            senderEmail: "lina@example.com",
            language: "Chinese",
            memoryScope: "global",
            memoryLayers: ["procedural_memory"],
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesLabelSuggestService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.suggestLabels({ threadText: " ", subject: "Re: hello" }),
    ).rejects.toThrow("thread text is required");
  });

  it("rejects non-object Hermes output", async () => {
    const service = createHermesLabelSuggestService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          return JSON.stringify([]);
        },
      },
    });

    await expect(
      service.suggestLabels({
        threadText: "Please archive this newsletter.",
      }),
    ).rejects.toThrow("label suggestion output must be a JSON object");
  });
});
