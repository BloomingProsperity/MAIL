import { createHash } from "node:crypto";

import type { MailReadStore, MessageDetailDto } from "../mail-read/mail-read-store.js";
import type {
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

      const text = messageTranslationText(message);
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

      if (!normalized.forceRefresh && options.store) {
        const cached = await options.store.getCachedTranslation(lookup);
        if (cached) {
          return recordToResult(cached, true);
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
      });

      if (!options.store) {
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

export function messageTranslationText(message: MessageDetailDto): string {
  const bodyText = normalizeWhitespace(message.bodyText ?? "");
  if (bodyText) {
    return bodyText;
  }

  const bodyHtml = normalizeWhitespace(stripHtml(message.bodyHtml ?? ""));
  if (bodyHtml) {
    return bodyHtml;
  }

  return normalizeWhitespace(message.snippet ?? "");
}

export function hashTranslationSource(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeInput(
  input: HermesMessageTranslationInput,
): Required<
  Pick<
    HermesMessageTranslationInput,
    "accountId" | "messageId" | "targetLanguage" | "sourceLanguage" | "tone"
  >
> &
  Pick<
    HermesMessageTranslationInput,
    "memoryIds" | "memoryScope" | "memoryLayers" | "forceRefresh"
  > {
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
  };
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

function stripHtml(value: string): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
