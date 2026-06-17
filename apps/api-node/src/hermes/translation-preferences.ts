import type { HermesMemoryDto, HermesMemoryStore } from "./memory-store.js";

export type HermesTranslationPreferenceMode = "always" | "never";

export interface HermesTranslationPreferenceInput {
  accountId: string;
  mode: HermesTranslationPreferenceMode;
  sourceLanguage: string;
  targetLanguage?: string;
  memoryScope?: string;
  reason?: string;
}

export interface HermesTranslationPreferenceResult {
  memory: HermesMemoryDto;
}

export interface HermesTranslationPreferenceService {
  confirmTranslationPreference(
    input: HermesTranslationPreferenceInput,
  ): Promise<HermesTranslationPreferenceResult>;
}

export class InvalidTranslationPreferenceRequestError extends Error {
  readonly code = "invalid_translation_preference_request";

  constructor(message = "invalid_translation_preference_request") {
    super(message);
  }
}

export interface HermesTranslationPreferenceServiceOptions {
  memoryStore: Pick<HermesMemoryStore, "createMemory">;
  createId: () => string;
}

const TRANSLATION_PREFERENCE_CONFIDENCE = 0.92;

export function createHermesTranslationPreferenceService(
  options: HermesTranslationPreferenceServiceOptions,
): HermesTranslationPreferenceService {
  return {
    async confirmTranslationPreference(input) {
      const normalized = normalizeTranslationPreference(input);
      const memory = await options.memoryStore.createMemory({
        id: options.createId(),
        accountId: normalized.accountId,
        layer: "procedural_memory",
        scope: normalized.memoryScope,
        confidence: TRANSLATION_PREFERENCE_CONFIDENCE,
        content: compactObject({
          source: "translation_preference",
          mode: normalized.mode,
          sourceLanguage: normalized.sourceLanguage,
          targetLanguage: normalized.targetLanguage,
          reason: normalized.reason,
          preference: preferenceText(normalized),
        }),
      });

      return { memory };
    },
  };
}

function normalizeTranslationPreference(
  input: HermesTranslationPreferenceInput,
): Required<Pick<HermesTranslationPreferenceInput, "mode" | "sourceLanguage">> &
  Pick<HermesTranslationPreferenceInput, "accountId" | "targetLanguage" | "reason"> & {
    memoryScope: string;
  } {
  const mode = input.mode;
  if (mode !== "always" && mode !== "never") {
    throw new InvalidTranslationPreferenceRequestError();
  }

  const sourceLanguage = normalizeShortText(
    input.sourceLanguage,
    "source language is required",
  );
  const targetLanguage =
    input.targetLanguage === undefined
      ? undefined
      : normalizeShortText(input.targetLanguage, "target language is invalid");

  if (mode === "always" && !targetLanguage) {
    throw new InvalidTranslationPreferenceRequestError(
      "target language is required",
    );
  }

  return {
    accountId: normalizeShortText(input.accountId, "account id is required", 128),
    mode,
    sourceLanguage,
    ...(targetLanguage ? { targetLanguage } : {}),
    memoryScope: input.memoryScope
      ? normalizeShortText(input.memoryScope, "memory scope is invalid")
      : "global",
    ...(input.reason
      ? { reason: normalizeShortText(input.reason, "reason is invalid", 240) }
      : {}),
  };
}

function preferenceText(
  input: ReturnType<typeof normalizeTranslationPreference>,
): string {
  if (input.mode === "never") {
    return `Do not auto-translate ${input.sourceLanguage} emails unless the user asks.`;
  }

  return `When translating ${input.sourceLanguage} emails, prefer ${input.targetLanguage} as the target language.`;
}

function normalizeShortText(
  value: string,
  message: string,
  maxLength = 64,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new InvalidTranslationPreferenceRequestError(message);
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidTranslationPreferenceRequestError(message);
  }

  return trimmed;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
