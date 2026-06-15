import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import type { HermesMemoryStore } from "./memory-store.js";

export interface HermesTextProvider {
  complete(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string>;
}

export interface HermesTranslateInput {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
  tone?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesTranslateResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "translate_text";
  sourceLanguage: string;
  targetLanguage: string;
  translatedText: string;
}

export interface HermesTranslationService {
  translate(input: HermesTranslateInput): Promise<HermesTranslateResult>;
}

export interface HermesRunStoreInput {
  run: {
    id: string;
    skillId: string;
    skillTitle: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  };
  auditEvent: {
    id: string;
    eventType: string;
    skillRunId: string;
    readMessageIds: string[];
    memoryIds: string[];
    action: Record<string, unknown>;
  };
}

export interface HermesRunStore {
  recordCompletedSkillRun(input: HermesRunStoreInput): Promise<void>;
}

export interface HermesTranslationServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const TRANSLATION_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. Translate email text faithfully. Preserve paragraph breaks, lists, names, dates, numbers, signatures, and intent. Return only the translation.";
const DEFAULT_TRANSLATION_MEMORY_LAYERS = [
  "semantic_profile",
  "writing_style_profile",
  "contact_memory",
  "procedural_memory",
];

export function createHermesTranslationService(
  options: HermesTranslationServiceOptions,
): HermesTranslationService {
  return {
    async translate(input) {
      if (!input.text || input.text.trim().length === 0) {
        throw new Error("translation text is required");
      }

      if (!input.targetLanguage || input.targetLanguage.trim().length === 0) {
        throw new Error("target language is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_TRANSLATION_MEMORY_LAYERS,
      });
      const translatedText = await options.textProvider.complete({
        systemPrompt: TRANSLATION_SYSTEM_PROMPT,
        userPrompt: translationUserPrompt(input, memories),
      });
      const skillRunId = options.createId();
      const sourceLanguage = input.sourceLanguage ?? "auto";
      const usedMemoryIds = usedHermesMemoryIds(input.memoryIds, memories);
      const result: HermesTranslateResult = {
        skillRunId,
        skillId: "translate_text",
        sourceLanguage,
        targetLanguage: input.targetLanguage,
        translatedText,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "translate_text",
          skillTitle: "翻译邮件",
          input: compactObject({
            text: input.text,
            sourceLanguage,
            targetLanguage: input.targetLanguage,
            tone: input.tone,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            translatedText,
            sourceLanguage,
            targetLanguage: input.targetLanguage,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.translate_text",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedMemoryIds,
          action: compactObject({
            skillId: "translate_text",
            targetLanguage: input.targetLanguage,
            sourceLanguage,
            tone: input.tone,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
        },
      });

      return { ...result, auditEventId };
    },
  };
}

function translationUserPrompt(
  input: HermesTranslateInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Source language: ${input.sourceLanguage ?? "auto"}`,
    `Target language: ${input.targetLanguage}`,
    `Tone: ${input.tone ?? "preserve original"}`,
  ];

  appendHermesMemoryPromptSection(lines, memories);

  lines.push("", "Text:", input.text);
  return lines.join("\n");
}

function compactObject(
  value: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[]>;
}
