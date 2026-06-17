import type { MailReadStore } from "../mail-read/mail-read-store.js";
import { hashMessageText, messageReadableText } from "./message-content.js";
import type {
  HermesThreadSummaryMode,
  HermesThreadSummaryResult,
  HermesThreadSummaryService,
} from "./summaries.js";

export interface HermesMessageSummaryInput {
  accountId: string;
  messageId: string;
  mode?: HermesThreadSummaryMode;
  focus?: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  forceRefresh?: boolean;
  maxContextChars?: number;
  memoryLimit?: number;
}

export interface HermesMessageSummaryResult extends HermesThreadSummaryResult {
  accountId: string;
  messageId: string;
  cached: boolean;
}

export interface HermesMessageSummaryRecord {
  id: string;
  accountId: string;
  messageId: string;
  bodyHash: string;
  mode: HermesThreadSummaryMode;
  focus: string;
  language: string;
  summaryText: string;
  skillRunId: string;
  auditEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HermesMessageSummaryLookup {
  accountId: string;
  messageId: string;
  bodyHash: string;
  mode: HermesThreadSummaryMode;
  focus: string;
  language: string;
}

export interface HermesMessageSummaryStore {
  getCachedSummary(
    input: HermesMessageSummaryLookup,
  ): Promise<HermesMessageSummaryRecord | undefined>;
  saveSummary(
    input: HermesMessageSummaryLookup & {
      id: string;
      summaryText: string;
      skillRunId: string;
      auditEventId?: string;
    },
  ): Promise<HermesMessageSummaryRecord>;
}

export interface HermesMessageSummaryService {
  summarizeMessage(
    input: HermesMessageSummaryInput,
  ): Promise<HermesMessageSummaryResult | undefined>;
}

export interface HermesMessageSummaryServiceOptions {
  mailReadStore: Pick<MailReadStore, "getMessage">;
  summaryService: Pick<HermesThreadSummaryService, "summarizeThread">;
  store?: HermesMessageSummaryStore;
  createId: () => string;
}

export class InvalidHermesMessageSummaryRequestError extends Error {
  readonly code = "invalid_hermes_message_summary_request";

  constructor(message = "invalid_hermes_message_summary_request") {
    super(message);
  }
}

const DEFAULT_SUMMARY_MODE: HermesThreadSummaryMode = "detailed";
const DEFAULT_SUMMARY_FOCUS =
  "decisions, action items, deadlines, and reply needs";
const DEFAULT_SUMMARY_LANGUAGE = "match the thread";
const MAX_SHORT_FIELD_LENGTH = 120;

export function createHermesMessageSummaryService(
  options: HermesMessageSummaryServiceOptions,
): HermesMessageSummaryService {
  return {
    async summarizeMessage(input) {
      const normalized = normalizeInput(input);
      const message = await options.mailReadStore.getMessage({
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      });
      if (!message) {
        return undefined;
      }

      const text = messageReadableText(message, {
        maxChars: normalized.maxContextChars,
      });
      if (!text) {
        throw new InvalidHermesMessageSummaryRequestError(
          "message has no summarizable text",
        );
      }

      const bodyHash = hashMessageText(text);
      const lookup = {
        accountId: normalized.accountId,
        messageId: normalized.messageId,
        bodyHash,
        mode: normalized.mode,
        focus: normalized.focus,
        language: normalized.language,
      };

      if (!normalized.forceRefresh && options.store) {
        const cached = await options.store.getCachedSummary(lookup);
        if (cached) {
          return recordToResult(cached, true);
        }
      }

      const result = await options.summaryService.summarizeThread({
        subject: message.subject,
        threadText: text,
        mode: normalized.mode,
        focus: normalized.focus,
        language: normalized.language,
        readMessageIds: [normalized.messageId],
        memoryIds: normalized.memoryIds,
        memoryScope: normalized.memoryScope ?? "global",
        memoryLayers: normalized.memoryLayers,
        memoryLimit: normalized.memoryLimit,
      });

      if (!options.store) {
        return {
          ...result,
          accountId: normalized.accountId,
          messageId: normalized.messageId,
          cached: false,
        };
      }

      const saved = await options.store.saveSummary({
        ...lookup,
        id: options.createId(),
        summaryText: result.summaryText,
        skillRunId: result.skillRunId,
        auditEventId: result.auditEventId,
      });

      return recordToResult(saved, false);
    },
  };
}

function normalizeInput(
  input: HermesMessageSummaryInput,
): Required<
  Pick<
    HermesMessageSummaryInput,
    "accountId" | "messageId" | "mode" | "focus" | "language"
  >
> &
  Pick<
    HermesMessageSummaryInput,
    | "memoryIds"
    | "memoryScope"
    | "memoryLayers"
    | "forceRefresh"
    | "maxContextChars"
    | "memoryLimit"
  > {
  return {
    accountId: normalizeRequiredText(input.accountId),
    messageId: normalizeRequiredText(input.messageId),
    mode: normalizeMode(input.mode),
    focus: input.focus
      ? normalizeRequiredText(input.focus)
      : DEFAULT_SUMMARY_FOCUS,
    language: input.language
      ? normalizeRequiredText(input.language)
      : DEFAULT_SUMMARY_LANGUAGE,
    ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
    ...(input.memoryScope ? { memoryScope: normalizeRequiredText(input.memoryScope) } : {}),
    ...(input.memoryLayers ? { memoryLayers: input.memoryLayers } : {}),
    ...(input.forceRefresh ? { forceRefresh: true } : {}),
    ...(input.maxContextChars !== undefined
      ? { maxContextChars: input.maxContextChars }
      : {}),
    ...(input.memoryLimit !== undefined ? { memoryLimit: input.memoryLimit } : {}),
  };
}

function normalizeMode(
  mode: HermesMessageSummaryInput["mode"],
): HermesThreadSummaryMode {
  if (!mode) {
    return DEFAULT_SUMMARY_MODE;
  }
  if (mode === "short" || mode === "detailed" || mode === "action_points") {
    return mode;
  }

  throw new InvalidHermesMessageSummaryRequestError();
}

function normalizeRequiredText(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SHORT_FIELD_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new InvalidHermesMessageSummaryRequestError();
  }

  return trimmed;
}

function recordToResult(
  record: HermesMessageSummaryRecord,
  cached: boolean,
): HermesMessageSummaryResult {
  return {
    skillRunId: record.skillRunId,
    ...(record.auditEventId ? { auditEventId: record.auditEventId } : {}),
    skillId: "thread_summarize",
    accountId: record.accountId,
    messageId: record.messageId,
    mode: record.mode,
    summaryText: record.summaryText,
    cached,
  };
}
