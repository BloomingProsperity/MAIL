import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import { appendHermesCustomInstructionsPromptSection } from "./custom-instructions.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export type HermesNewsletterSenderCategory =
  | "newsletter"
  | "marketing"
  | "transactional"
  | "personal"
  | "unknown";

export type HermesNewsletterCleanupActionType =
  | "move_to_feed"
  | "archive"
  | "unsubscribe_later"
  | "keep_in_inbox"
  | "mark_not_important";

export interface HermesNewsletterCleanupAction {
  type: HermesNewsletterCleanupActionType;
  unsubscribeUrl?: string;
  reason?: string;
}

export interface HermesNewsletterCleanupInput {
  accountId?: string;
  subject?: string;
  threadText: string;
  senderEmail?: string;
  listId?: string;
  currentBucket?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  memoryLimit?: number;
  customInstructions?: string;
}

export interface HermesNewsletterCleanupResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "newsletter_cleanup";
  isNewsletter: boolean;
  confidence: number;
  senderCategory: HermesNewsletterSenderCategory;
  reasons: string[];
  actions: HermesNewsletterCleanupAction[];
}

export interface HermesNewsletterCleanupService {
  cleanupNewsletter(
    input: HermesNewsletterCleanupInput,
  ): Promise<HermesNewsletterCleanupResult>;
}

export interface HermesNewsletterCleanupServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const NEWSLETTER_CLEANUP_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You perform newsletter cleanup for email threads. Return only a JSON object with fields isNewsletter, confidence, senderCategory, reasons, and actions. senderCategory must be newsletter, marketing, transactional, personal, or unknown. actions is an array of preview-only suggestions using type move_to_feed, archive, unsubscribe_later, keep_in_inbox, or mark_not_important, with optional unsubscribeUrl and reason. This is preview-only: do not imply anything was moved, archived, deleted, unsubscribed, or changed. Never suggest delete.";

const DEFAULT_NEWSLETTER_MEMORY_LAYERS = [
  "contact_memory",
  "procedural_memory",
  "semantic_profile",
];

export function createHermesNewsletterCleanupService(
  options: HermesNewsletterCleanupServiceOptions,
): HermesNewsletterCleanupService {
  return {
    async cleanupNewsletter(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_NEWSLETTER_MEMORY_LAYERS,
      });
      const rawText = await options.textProvider.complete({
        systemPrompt: NEWSLETTER_CLEANUP_SYSTEM_PROMPT,
        userPrompt: newsletterCleanupUserPrompt(input, memories),
      });
      const cleanup = parseNewsletterCleanup(rawText);
      const skillRunId = options.createId();
      const result: HermesNewsletterCleanupResult = {
        skillRunId,
        skillId: "newsletter_cleanup",
        ...cleanup,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        ...(input.accountId ? { accountId: input.accountId } : {}),
        run: {
          id: skillRunId,
          skillId: "newsletter_cleanup",
          skillTitle: "Newsletter cleanup",
          input: compactObject({
            subject: input.subject,
            accountId: input.accountId,
            threadText: input.threadText,
            senderEmail: input.senderEmail,
            listId: input.listId,
            currentBucket: input.currentBucket,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: cleanup,
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.newsletter_cleanup",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "newsletter_cleanup",
            accountId: input.accountId,
            senderEmail: input.senderEmail,
            listId: input.listId,
            currentBucket: input.currentBucket,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
            previewOnly: true,
          }),
        },
      });

      return { ...result, auditEventId };
    },
  };
}

function newsletterCleanupUserPrompt(
  input: HermesNewsletterCleanupInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Sender: ${input.senderEmail ?? "(unknown)"}`,
    `List-ID: ${input.listId ?? "(none)"}`,
    `Current bucket: ${input.currentBucket ?? "(none)"}`,
    `Language: ${input.language ?? "match the thread"}`,
  ];

  appendHermesCustomInstructionsPromptSection(lines, input);
  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function parseNewsletterCleanup(rawText: string): Omit<
  HermesNewsletterCleanupResult,
  "skillRunId" | "auditEventId" | "skillId"
> {
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("newsletter cleanup output must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.isNewsletter !== "boolean") {
    throw new Error("newsletter cleanup isNewsletter is required");
  }
  if (!isConfidence(record.confidence)) {
    throw new Error("newsletter cleanup confidence is invalid");
  }

  return {
    isNewsletter: record.isNewsletter,
    confidence: record.confidence,
    senderCategory: isSenderCategory(record.senderCategory)
      ? record.senderCategory
      : "unknown",
    reasons: normalizeReasons(record.reasons),
    actions: Array.isArray(record.actions)
      ? record.actions.map(normalizeCleanupAction)
      : [],
  };
}

function normalizeCleanupAction(value: unknown): HermesNewsletterCleanupAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("newsletter cleanup actions must be objects");
  }

  const record = value as Record<string, unknown>;
  if (!isCleanupActionType(record.type)) {
    throw new Error("newsletter cleanup action type is invalid");
  }

  const action: HermesNewsletterCleanupAction = {
    type: record.type,
  };
  if (isNonEmptyString(record.unsubscribeUrl)) {
    action.unsubscribeUrl = record.unsubscribeUrl.trim();
  }
  if (isNonEmptyString(record.reason)) {
    action.reason = record.reason.trim();
  }

  return action;
}

function normalizeReasons(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => isNonEmptyString(item))
    .map((item) => item.trim());
}

function stripJsonFence(rawText: string): string {
  const trimmed = rawText.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function compactObject(
  value: Record<string, string | string[] | boolean | undefined>,
): Record<string, string | string[] | boolean> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[] | boolean>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isSenderCategory(
  value: unknown,
): value is HermesNewsletterSenderCategory {
  return (
    value === "newsletter" ||
    value === "marketing" ||
    value === "transactional" ||
    value === "personal" ||
    value === "unknown"
  );
}

function isCleanupActionType(
  value: unknown,
): value is HermesNewsletterCleanupActionType {
  return (
    value === "move_to_feed" ||
    value === "archive" ||
    value === "unsubscribe_later" ||
    value === "keep_in_inbox" ||
    value === "mark_not_important"
  );
}
