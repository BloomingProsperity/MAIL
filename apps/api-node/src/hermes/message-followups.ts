import type { MailReadStore, MessageDetailDto } from "../mail-read/mail-read-store.js";
import type {
  HermesFollowupTrackerResult,
  HermesFollowupTrackerService,
} from "./followup-tracker.js";
import { messageReadableText } from "./message-content.js";

export interface HermesMessageFollowupTrackerInput {
  accountId: string;
  messageId: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  maxContextChars?: number;
  memoryLimit?: number;
  customInstructions?: string;
}

export interface HermesMessageFollowupTrackerResult
  extends HermesFollowupTrackerResult {
  accountId: string;
  messageId: string;
}

export interface HermesMessageFollowupTrackerService {
  trackMessageFollowup(
    input: HermesMessageFollowupTrackerInput,
  ): Promise<HermesMessageFollowupTrackerResult | undefined>;
}

export interface HermesMessageFollowupTrackerServiceOptions {
  mailReadStore: Pick<MailReadStore, "getMessage">;
  followupTrackerService: Pick<HermesFollowupTrackerService, "trackFollowup">;
  now: () => string;
}

export class InvalidHermesMessageFollowupRequestError extends Error {
  readonly code = "invalid_hermes_message_followup_request";

  constructor(message = "invalid_hermes_message_followup_request") {
    super(message);
  }
}

const DEFAULT_FOLLOWUP_LANGUAGE = "match the thread";
const MAX_SHORT_FIELD_LENGTH = 120;

export function createHermesMessageFollowupTrackerService(
  options: HermesMessageFollowupTrackerServiceOptions,
): HermesMessageFollowupTrackerService {
  return {
    async trackMessageFollowup(input) {
      const normalized = normalizeInput(input);
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
        throw new InvalidHermesMessageFollowupRequestError(
          "message has no follow-up trackable text",
        );
      }

      const result = await options.followupTrackerService.trackFollowup({
        accountId: normalized.accountId,
        subject: message.subject,
        threadText,
        participants: messageParticipants(message),
        now: options.now(),
        language: normalized.language,
        readMessageIds: [normalized.messageId],
        memoryIds: normalized.memoryIds,
        memoryScope:
          normalized.memoryScope ??
          (message.from.email ? `sender:${message.from.email}` : "global"),
        memoryLayers: normalized.memoryLayers,
        ...(normalized.memoryLimit !== undefined
          ? { memoryLimit: normalized.memoryLimit }
          : {}),
        ...(normalized.customInstructions !== undefined
          ? { customInstructions: normalized.customInstructions }
          : {}),
      });

      return {
        ...result,
        accountId: normalized.accountId,
        messageId: normalized.messageId,
      };
    },
  };
}

function messageParticipants(message: MessageDetailDto): string[] {
  return Array.from(
    new Set(
      [message.from.email, ...message.to, ...message.cc]
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeInput(
  input: HermesMessageFollowupTrackerInput,
): Required<Pick<HermesMessageFollowupTrackerInput, "accountId" | "messageId" | "language">> &
  Pick<
    HermesMessageFollowupTrackerInput,
    | "memoryIds"
    | "memoryScope"
    | "memoryLayers"
    | "maxContextChars"
    | "memoryLimit"
    | "customInstructions"
  > {
  return {
    accountId: normalizeRequiredText(input.accountId),
    messageId: normalizeRequiredText(input.messageId),
    language: input.language
      ? normalizeRequiredText(input.language)
      : DEFAULT_FOLLOWUP_LANGUAGE,
    ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
    ...(input.memoryScope
      ? { memoryScope: normalizeRequiredText(input.memoryScope) }
      : {}),
    ...(input.memoryLayers ? { memoryLayers: input.memoryLayers } : {}),
    ...(input.maxContextChars !== undefined
      ? { maxContextChars: input.maxContextChars }
      : {}),
    ...(input.memoryLimit !== undefined ? { memoryLimit: input.memoryLimit } : {}),
    ...(input.customInstructions !== undefined
      ? { customInstructions: input.customInstructions }
      : {}),
  };
}

function normalizeRequiredText(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_SHORT_FIELD_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    throw new InvalidHermesMessageFollowupRequestError();
  }

  return trimmed;
}
