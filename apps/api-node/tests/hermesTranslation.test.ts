import { describe, expect, it } from "vitest";

import { createHermesTranslationService } from "../src/hermes/translation";

describe("Hermes translation service", () => {
  it("runs translation through the Hermes text provider with formatting constraints", async () => {
    const calls: unknown[] = [];
    const service = createHermesTranslationService({
      createId: () => "run_1",
      textProvider: {
        async complete(input) {
          calls.push(input);
          return "你好，张三：\n请确认会议时间。";
        },
      },
    });

    const result = await service.translate({
      text: "Hello Zhang,\nPlease confirm the meeting time.",
      sourceLanguage: "English",
      targetLanguage: "Chinese",
      tone: "business",
    });

    expect(calls).toEqual([
      {
        systemPrompt:
          "You are Hermes inside Email Hub. Translate email text faithfully. Preserve paragraph breaks, lists, names, dates, numbers, signatures, and intent. Return only the translation.",
        userPrompt:
          "Source language: English\nTarget language: Chinese\nTone: business\n\nText:\nHello Zhang,\nPlease confirm the meeting time.",
      },
    ]);
    expect(result).toEqual({
      skillRunId: "run_1",
      skillId: "translate_text",
      sourceLanguage: "English",
      targetLanguage: "Chinese",
      translatedText: "你好，张三：\n请确认会议时间。",
    });
  });

  it("rejects empty translation text before calling Hermes", async () => {
    const service = createHermesTranslationService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes for empty text");
        },
      },
    });

    await expect(
      service.translate({ text: " ", targetLanguage: "Chinese" }),
    ).rejects.toThrow("translation text is required");
  });

  it("rejects a missing target language before calling Hermes", async () => {
    const service = createHermesTranslationService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without a target language");
        },
      },
    });

    await expect(
      service.translate({ text: "Hello", targetLanguage: " " }),
    ).rejects.toThrow("target language is required");
  });

  it("persists the translation run and audit event when a run store is configured", async () => {
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesTranslationService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete() {
          return "你好";
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
        },
      },
    });

    const result = await service.translate({
      text: "Hello",
      targetLanguage: "Chinese",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000002"],
    });

    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "translate_text",
      sourceLanguage: "auto",
      targetLanguage: "Chinese",
      translatedText: "你好",
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "translate_text",
          skillTitle: "翻译邮件",
          input: {
            text: "Hello",
            sourceLanguage: "auto",
            targetLanguage: "Chinese",
          },
          output: {
            translatedText: "你好",
            sourceLanguage: "auto",
            targetLanguage: "Chinese",
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.translate_text",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: ["00000000-0000-0000-0000-000000000002"],
          action: {
            skillId: "translate_text",
            targetLanguage: "Chinese",
            sourceLanguage: "auto",
          },
        },
      },
    ]);
  });

  it("loads scoped memories into the prompt and audits the used memory ids", async () => {
    const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesTranslationService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          calls.push(input);
          return "Bonjour";
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          if (input.layer === "writing_style_profile") {
            return {
              items: [
                {
                  id: "00000000-0000-0000-0000-000000000011",
                  layer: "writing_style_profile",
                  scope: "global",
                  content: { preference: "Prefer concise replies." },
                  confidence: 0.92,
                  createdAt: "2026-06-12T09:00:00.000Z",
                  updatedAt: "2026-06-12T10:00:00.000Z",
                },
              ],
            };
          }

          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000012",
                layer: "contact_memory",
                scope: "global",
                content: { summary: "Customer prefers French." },
                confidence: 0.81,
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

    await service.translate({
      text: "Hello",
      targetLanguage: "French",
      memoryScope: "global",
      memoryLayers: ["writing_style_profile", "contact_memory"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
    });

    expect(memoryQueries).toEqual([
      { layer: "writing_style_profile", scope: "global", limit: 3 },
      { layer: "contact_memory", scope: "global", limit: 3 },
    ]);
    expect(calls[0].userPrompt).toContain("Relevant user memory:");
    expect(calls[0].userPrompt).toContain(
      "[writing_style_profile/global confidence=0.92] Prefer concise replies.",
    );
    expect(calls[0].userPrompt).toContain(
      "[contact_memory/global confidence=0.81] Customer prefers French.",
    );
    expect(persisted).toHaveLength(1);
    expect((persisted[0] as any).auditEvent.memoryIds).toEqual([
      "00000000-0000-0000-0000-000000000099",
      "00000000-0000-0000-0000-000000000011",
      "00000000-0000-0000-0000-000000000012",
    ]);
  });
});
