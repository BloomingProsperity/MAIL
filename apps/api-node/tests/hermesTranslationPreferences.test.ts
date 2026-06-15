import { describe, expect, it } from "vitest";

import { createHermesTranslationPreferenceService } from "../src/hermes/translation-preferences";

describe("Hermes translation preference service", () => {
  it("stores an explicit always-translate preference as procedural memory", async () => {
    const created: unknown[] = [];
    const service = createHermesTranslationPreferenceService({
      createId: () => "00000000-0000-0000-0000-000000000010",
      memoryStore: {
        async createMemory(input) {
          created.push(input);
          return {
            ...input,
            createdAt: "2026-06-13T09:00:00.000Z",
            updatedAt: "2026-06-13T09:00:00.000Z",
          };
        },
      },
    });

    const result = await service.confirmTranslationPreference({
      mode: "always",
      sourceLanguage: "English",
      targetLanguage: "Chinese",
      reason: "User clicked always translate.",
    });

    expect(created).toEqual([
      {
        id: "00000000-0000-0000-0000-000000000010",
        layer: "procedural_memory",
        scope: "global",
        confidence: 0.92,
        content: {
          source: "translation_preference",
          mode: "always",
          sourceLanguage: "English",
          targetLanguage: "Chinese",
          reason: "User clicked always translate.",
          preference:
            "When translating English emails, prefer Chinese as the target language.",
        },
      },
    ]);
    expect(result.memory.content.preference).toBe(
      "When translating English emails, prefer Chinese as the target language.",
    );
  });

  it("stores a never-translate preference without requiring a target language", async () => {
    const created: unknown[] = [];
    const service = createHermesTranslationPreferenceService({
      createId: () => "00000000-0000-0000-0000-000000000011",
      memoryStore: {
        async createMemory(input) {
          created.push(input);
          return {
            ...input,
            createdAt: "2026-06-13T09:00:00.000Z",
            updatedAt: "2026-06-13T09:00:00.000Z",
          };
        },
      },
    });

    const result = await service.confirmTranslationPreference({
      mode: "never",
      sourceLanguage: "Japanese",
    });

    expect(created).toEqual([
      {
        id: "00000000-0000-0000-0000-000000000011",
        layer: "procedural_memory",
        scope: "global",
        confidence: 0.92,
        content: {
          source: "translation_preference",
          mode: "never",
          sourceLanguage: "Japanese",
          preference:
            "Do not auto-translate Japanese emails unless the user asks.",
        },
      },
    ]);
    expect(result.memory.content.mode).toBe("never");
  });

  it("rejects always-translate preferences without a target language", async () => {
    const service = createHermesTranslationPreferenceService({
      createId: () => "unused",
      memoryStore: {
        async createMemory() {
          throw new Error("should not create invalid preferences");
        },
      },
    });

    await expect(
      service.confirmTranslationPreference({
        mode: "always",
        sourceLanguage: "English",
      }),
    ).rejects.toThrow("target language is required");
  });
});
