import type { MailReadStore } from "../mail-read/mail-read-store.js";
import { messageReadableText } from "./message-content.js";
import type {
  HermesQuickReplyResult,
  HermesQuickReplyScenario,
  HermesQuickReplyService,
  HermesReplyDraftInput,
  HermesReplyDraftResult,
  HermesReplyDraftService,
} from "./drafts.js";

export interface HermesMessageReplyDraftInput {
  accountId: string;
  messageId: string;
  instruction?: string;
  tone?: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  maxContextChars?: number;
}

export interface HermesMessageQuickReplyInput
  extends HermesMessageReplyDraftInput {
  scenario: HermesQuickReplyScenario;
}

export interface HermesMessageReplyDraftResult
  extends HermesReplyDraftResult {
  accountId: string;
  messageId: string;
}

export interface HermesMessageQuickReplyResult
  extends HermesQuickReplyResult {
  accountId: string;
  messageId: string;
}

export interface HermesMessageReplyService {
  draftMessageReply(
    input: HermesMessageReplyDraftInput,
  ): Promise<HermesMessageReplyDraftResult | undefined>;
  quickMessageReply(
    input: HermesMessageQuickReplyInput,
  ): Promise<HermesMessageQuickReplyResult | undefined>;
}

export interface HermesMessageReplyServiceOptions {
  mailReadStore: Pick<MailReadStore, "getMessage">;
  replyDraftService: Pick<HermesReplyDraftService, "draftReply">;
  quickReplyService: Pick<HermesQuickReplyService, "quickReply">;
}

export class InvalidHermesMessageReplyRequestError extends Error {
  readonly code = "invalid_hermes_message_reply_request";

  constructor(message = "invalid_hermes_message_reply_request") {
    super(message);
  }
}

const MAX_SHORT_FIELD_LENGTH = 120;

export function createHermesMessageReplyService(
  options: HermesMessageReplyServiceOptions,
): HermesMessageReplyService {
  return {
    async draftMessageReply(input) {
      const normalized = normalizeReplyDraftInput(input);
      const message = await options.mailReadStore.getMessage({
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      });
      if (!message) {
        return undefined;
      }

      const threadText = messageReadableText(message, {
        maxChars: normalized.maxContextChars,
      });
      if (!threadText) {
        throw new InvalidHermesMessageReplyRequestError(
          "message has no replyable text",
        );
      }

      const result = await options.replyDraftService.draftReply({
        ...draftInputFromMessage(
          normalized,
          message.subject,
          threadText,
          message.from.email,
        ),
      });

      return {
        ...result,
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      };
    },

    async quickMessageReply(input) {
      const normalized = normalizeQuickReplyInput(input);
      const message = await options.mailReadStore.getMessage({
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      });
      if (!message) {
        return undefined;
      }

      const threadText = messageReadableText(message, {
        maxChars: normalized.maxContextChars,
      });
      if (!threadText) {
        throw new InvalidHermesMessageReplyRequestError(
          "message has no replyable text",
        );
      }

      const result = await options.quickReplyService.quickReply({
        ...draftInputFromMessage(
          normalized,
          message.subject,
          threadText,
          message.from.email,
        ),
        scenario: normalized.scenario,
      });

      return {
        ...result,
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      };
    },
  };
}

function draftInputFromMessage(
  input: HermesMessageReplyDraftInput,
  subject: string | undefined,
  threadText: string,
  senderEmail: string | undefined,
): HermesReplyDraftInput {
  return {
    ...(subject ? { subject } : {}),
    threadText,
    ...(input.instruction ? { instruction: input.instruction } : {}),
    ...(input.tone ? { tone: input.tone } : {}),
    ...(input.language ? { language: input.language } : {}),
    readMessageIds: [input.messageId],
    ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
    memoryScope: input.memoryScope ?? (senderEmail ? `sender:${senderEmail}` : "global"),
    ...(input.memoryLayers ? { memoryLayers: input.memoryLayers } : {}),
  };
}

function normalizeReplyDraftInput(
  input: HermesMessageReplyDraftInput,
): HermesMessageReplyDraftInput {
  return {
    accountId: normalizeRequiredText(input.accountId),
    messageId: normalizeRequiredText(input.messageId),
    ...(input.instruction
      ? { instruction: normalizeRequiredText(input.instruction) }
      : {}),
    ...(input.tone ? { tone: normalizeRequiredText(input.tone) } : {}),
    ...(input.language ? { language: normalizeRequiredText(input.language) } : {}),
    ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
    ...(input.memoryScope
      ? { memoryScope: normalizeRequiredText(input.memoryScope) }
      : {}),
    ...(input.memoryLayers ? { memoryLayers: input.memoryLayers } : {}),
    ...(input.maxContextChars !== undefined
      ? { maxContextChars: input.maxContextChars }
      : {}),
  };
}

function normalizeQuickReplyInput(
  input: HermesMessageQuickReplyInput,
): HermesMessageQuickReplyInput {
  return {
    ...normalizeReplyDraftInput(input),
    scenario: normalizeScenario(input.scenario),
  };
}

function normalizeScenario(
  scenario: HermesMessageQuickReplyInput["scenario"],
): HermesQuickReplyScenario {
  if (
    scenario === "confirm" ||
    scenario === "decline" ||
    scenario === "thanks" ||
    scenario === "follow_up" ||
    scenario === "custom"
  ) {
    return scenario;
  }

  throw new InvalidHermesMessageReplyRequestError();
}

function normalizeRequiredText(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SHORT_FIELD_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new InvalidHermesMessageReplyRequestError();
  }

  return trimmed;
}
