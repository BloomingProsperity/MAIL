import type { MailReadStore } from "../mail-read/mail-read-store.js";
import { hasHermesCustomInstructions } from "./custom-instructions.js";
import { hashMessageText, messageReadableText } from "./message-content.js";
import type {
  HermesRunStore,
  HermesTranslateResult,
  HermesTranslationService,
} from "./translation.js";

export interface HermesMessageTranslationInput {
  accountId: string;
  messageId: string;
  targetLanguage: string;
  sourceLanguage?: string;
  tone?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  forceRefresh?: boolean;
  maxContextChars?: number;
  memoryLimit?: number;
  customInstructions?: string;
}

export interface HermesMessageTranslationResult extends HermesTranslateResult {
  accountId: string;
  messageId: string;
  cached: boolean;
}

export interface HermesMessageTranslationRecord {
  id: string;
  accountId: string;
  messageId: string;
  bodyHash: string;
  targetLanguage: string;
  sourceLanguage: string;
  tone: string;
  translatedText: string;
  skillRunId: string;
  auditEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HermesMessageTranslationLookup {
  accountId: string;
  messageId: string;
  bodyHash: string;
  targetLanguage: string;
  sourceLanguage: string;
  tone: string;
}

export interface HermesMessageTranslationStore {
  getCachedTranslation(
    input: HermesMessageTranslationLookup,
  ): Promise<HermesMessageTranslationRecord | undefined>;
  saveTranslation(
    input: HermesMessageTranslationLookup & {
      id: string;
      translatedText: string;
      skillRunId: string;
      auditEventId?: string;
    },
  ): Promise<HermesMessageTranslationRecord>;
}

export interface HermesMessageTranslationService {
  translateMessage(
    input: HermesMessageTranslationInput,
  ): Promise<HermesMessageTranslationResult | undefined>;
}

export interface HermesMessageTranslationServiceOptions {
  mailReadStore: Pick<MailReadStore, "getMessage">;
  translationService: Pick<HermesTranslationService, "translate">;
  store?: HermesMessageTranslationStore;
  runStore?: HermesRunStore;
  createId: () => string;
}

export class InvalidHermesMessageTranslationRequestError extends Error {
  readonly code = "invalid_hermes_message_translation_request";

  constructor(message = "invalid_hermes_message_translation_request") {
    super(message);
  }
}

const DEFAULT_TRANSLATION_TONE = "preserve original meaning and formatting";
const DEFAULT_SOURCE_LANGUAGE = "auto";
const MAX_SHORT_FIELD_LENGTH = 80;

export function createHermesMessageTranslationService(
  options: HermesMessageTranslationServiceOptions,
): HermesMessageTranslationService {
  return {
    async translateMessage(input) {
      const normalized = normalizeInput(input);
      const message = await options.mailReadStore.getMessage({
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      });
      if (!message) {
        return undefined;
      }

      const text = messageTranslationText(message, {
        maxChars: normalized.maxContextChars,
      });
      if (!text) {
        throw new InvalidHermesMessageTranslationRequestError(
          "message has no translatable text",
        );
      }

      const bodyHash = hashTranslationSource(text);
      const lookup = {
        accountId: normalized.accountId,
        messageId: normalized.messageId,
        bodyHash,
        targetLanguage: normalized.targetLanguage,
        sourceLanguage: normalized.sourceLanguage,
        tone: normalized.tone,
      };

      if (!normalized.forceRefresh && !hasHermesCustomInstructions(normalized) && options.store) {
        const cached = await options.store.getCachedTranslation(lookup);
        if (cached) {
          const audit = await recordCachedTranslationRun(
            options,
            cached,
            normalized,
          );
          return {
            ...recordToResult(cached, true),
            ...(audit
              ? {
                  skillRunId: audit.skillRunId,
                  auditEventId: audit.auditEventId,
                }
              : {}),
          };
        }
      }

      const result = await options.translationService.translate({
        text,
        targetLanguage: normalized.targetLanguage,
        sourceLanguage: normalized.sourceLanguage,
        tone: normalized.tone,
        readMessageIds: [normalized.messageId],
        memoryIds: normalized.memoryIds,
        memoryScope:
          normalized.memoryScope ??
          (message.from.email ? `sender:${message.from.email}` : "global"),
        memoryLayers: normalized.memoryLayers,
        memoryLimit: normalized.memoryLimit,
        customInstructions: normalized.customInstructions,
      });

      if (!options.store || hasHermesCustomInstructions(normalized)) {
        return {
          ...result,
          accountId: normalized.accountId,
          messageId: normalized.messageId,
          cached: false,
        };
      }

      const saved = await options.store.saveTranslation({
        ...lookup,
        id: options.createId(),
        translatedText: result.translatedText,
        skillRunId: result.skillRunId,
        auditEventId: result.auditEventId,
      });

      return recordToResult(saved, false);
    },
  };
}

export const messageTranslationText = messageReadableText;

export const hashTranslationSource = hashMessageText;

type NormalizedHermesMessageTranslationInput = Required<
  Pick<
    HermesMessageTranslationInput,
    "accountId" | "messageId" | "targetLanguage" | "sourceLanguage" | "tone"
  >
> &
  Pick<
    HermesMessageTranslationInput,
    | "memoryIds"
    | "memoryScope"
    | "memoryLayers"
    | "forceRefresh"
    | "maxContextChars"
    | "memoryLimit"
    | "customInstructions"
  >;

function normalizeInput(
  input: HermesMessageTranslationInput,
): NormalizedHermesMessageTranslationInput {
  return {
    accountId: normalizeRequiredText(input.accountId),
    messageId: normalizeRequiredText(input.messageId),
    targetLanguage: normalizeRequiredText(input.targetLanguage),
    sourceLanguage: input.sourceLanguage
      ? normalizeRequiredText(input.sourceLanguage)
      : DEFAULT_SOURCE_LANGUAGE,
    tone: input.tone ? normalizeRequiredText(input.tone) : DEFAULT_TRANSLATION_TONE,
    ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
    ...(input.memoryScope ? { memoryScope: normalizeRequiredText(input.memoryScope) } : {}),
    ...(input.memoryLayers ? { memoryLayers: input.memoryLayers } : {}),
    ...(input.forceRefresh ? { forceRefresh: true } : {}),
    ...(input.maxContextChars !== undefined
      ? { maxContextChars: input.maxContextChars }
      : {}),
    ...(input.memoryLimit !== undefined ? { memoryLimit: input.memoryLimit } : {}),
    ...(input.customInstructions !== undefined
      ? { customInstructions: input.customInstructions }
      : {}),
  };
}

async function recordCachedTranslationRun(
  options: HermesMessageTranslationServiceOptions,
  record: HermesMessageTranslationRecord,
  input: NormalizedHermesMessageTranslationInput,
): Promise<{ skillRunId: string; auditEventId: string } | undefined> {
  if (!options.runStore) {
    return undefined;
  }

  const skillRunId = options.createId();
  const auditEventId = options.createId();
  await options.runStore.recordCompletedSkillRun({
    run: {
      id: skillRunId,
      skillId: "translate_text",
      skillTitle: "翻译邮件",
      input: compactObject({
        accountId: record.accountId,
        messageId: record.messageId,
        bodyHash: record.bodyHash,
        sourceLanguage: record.sourceLanguage,
        targetLanguage: record.targetLanguage,
        tone: record.tone,
        memoryIds: input.memoryIds,
        memoryScope: input.memoryScope,
        memoryLayers: input.memoryLayers,
      }),
      output: {
        cached: true,
        translatedTextHash: hashTranslationSource(record.translatedText),
        translatedTextLength: record.translatedText.length,
        sourceLanguage: record.sourceLanguage,
        targetLanguage: record.targetLanguage,
      },
    },
    auditEvent: {
      id: auditEventId,
      eventType: "hermes.skill.translate_text",
      skillRunId,
      readMessageIds: [record.messageId],
      memoryIds: input.memoryIds ?? [],
      action: compactObject({
        skillId: "translate_text",
        cached: true,
        targetLanguage: record.targetLanguage,
        sourceLanguage: record.sourceLanguage,
        tone: record.tone,
        memoryScope: input.memoryScope,
        memoryLayers: input.memoryLayers,
      }),
    },
  });

  return { skillRunId, auditEventId };
}

function normalizeRequiredText(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SHORT_FIELD_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new InvalidHermesMessageTranslationRequestError();
  }

  return trimmed;
}

function recordToResult(
  record: HermesMessageTranslationRecord,
  cached: boolean,
): HermesMessageTranslationResult {
  return {
    skillRunId: record.skillRunId,
    ...(record.auditEventId ? { auditEventId: record.auditEventId } : {}),
    skillId: "translate_text",
    accountId: record.accountId,
    messageId: record.messageId,
    sourceLanguage: record.sourceLanguage,
    targetLanguage: record.targetLanguage,
    translatedText: record.translatedText,
    cached,
  };
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}
