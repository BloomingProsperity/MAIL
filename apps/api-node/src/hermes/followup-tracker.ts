import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import { appendHermesCustomInstructionsPromptSection } from "./custom-instructions.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export type HermesFollowupStatus =
  | "needs_reply"
  | "waiting_on_them"
  | "no_followup"
  | "done";

export type HermesFollowupOwner = "me" | "them" | "unknown";

export interface HermesFollowupTrackerInput {
  subject?: string;
  threadText: string;
  userEmail?: string;
  participants?: string[];
  now?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  memoryLimit?: number;
  customInstructions?: string;
}

export interface HermesFollowupTrackerResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "followup_tracker";
  status: HermesFollowupStatus;
  followupNeeded: boolean;
  owner: HermesFollowupOwner;
  confidence: number;
  reasons: string[];
  dueAt?: string;
  dueText?: string;
  nextAction?: string;
  sourceQuote?: string;
}

export interface HermesFollowupTrackerService {
  trackFollowup(
    input: HermesFollowupTrackerInput,
  ): Promise<HermesFollowupTrackerResult>;
}

export interface HermesFollowupTrackerServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const FOLLOWUP_TRACKER_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You track follow-up state for email threads. Return only a JSON object with fields status, followupNeeded, owner, confidence, reasons, and optional dueAt, dueText, nextAction, sourceQuote. status must be needs_reply, waiting_on_them, no_followup, or done. owner must be me, them, or unknown. confidence must be a number from 0 to 1. Use ISO 8601 for dueAt when a deadline is clear. This is a preview suggestion only; do not create tasks, send mail, or mutate mail state.";

const DEFAULT_FOLLOWUP_MEMORY_LAYERS = [
  "contact_memory",
  "procedural_memory",
  "semantic_profile",
  "writing_style_profile",
];

export function createHermesFollowupTrackerService(
  options: HermesFollowupTrackerServiceOptions,
): HermesFollowupTrackerService {
  return {
    async trackFollowup(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_FOLLOWUP_MEMORY_LAYERS,
      });
      const rawText = await options.textProvider.complete({
        systemPrompt: FOLLOWUP_TRACKER_SYSTEM_PROMPT,
        userPrompt: followupTrackerUserPrompt(input, memories),
      });
      const followup = parseFollowupTracker(rawText);
      const skillRunId = options.createId();
      const result: HermesFollowupTrackerResult = {
        skillRunId,
        skillId: "followup_tracker",
        ...followup,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "followup_tracker",
          skillTitle: "Track follow-up",
          input: compactObject({
            subject: input.subject,
            threadText: input.threadText,
            userEmail: input.userEmail,
            participants: input.participants,
            now: input.now,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: followupOutput(followup),
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.followup_tracker",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "followup_tracker",
            userEmail: input.userEmail,
            now: input.now,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
        },
      });

      return { ...result, auditEventId };
    },
  };
}

function followupTrackerUserPrompt(
  input: HermesFollowupTrackerInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `User email: ${input.userEmail ?? "(unknown)"}`,
    `Participants: ${formatList(input.participants)}`,
    `Current time: ${input.now ?? "unknown"}`,
    `Language: ${input.language ?? "match the thread"}`,
  ];

  appendHermesCustomInstructionsPromptSection(lines, input);
  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function parseFollowupTracker(rawText: string): Omit<
  HermesFollowupTrackerResult,
  "skillRunId" | "auditEventId" | "skillId"
> {
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("follow-up tracker output must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  if (!isFollowupStatus(record.status)) {
    throw new Error("follow-up status is invalid");
  }
  if (typeof record.followupNeeded !== "boolean") {
    throw new Error("follow-up needed flag is invalid");
  }
  if (!isFollowupOwner(record.owner)) {
    throw new Error("follow-up owner is invalid");
  }
  if (!isConfidence(record.confidence)) {
    throw new Error("follow-up confidence is invalid");
  }

  return {
    status: record.status,
    followupNeeded: record.followupNeeded,
    owner: record.owner,
    confidence: record.confidence,
    reasons: normalizeReasons(record.reasons),
    ...(isNonEmptyString(record.dueAt) ? { dueAt: record.dueAt.trim() } : {}),
    ...(isNonEmptyString(record.dueText)
      ? { dueText: record.dueText.trim() }
      : {}),
    ...(isNonEmptyString(record.nextAction)
      ? { nextAction: record.nextAction.trim() }
      : {}),
    ...(isNonEmptyString(record.sourceQuote)
      ? { sourceQuote: record.sourceQuote.trim() }
      : {}),
  };
}

function followupOutput(
  followup: Omit<
    HermesFollowupTrackerResult,
    "skillRunId" | "auditEventId" | "skillId"
  >,
): Record<string, string | string[] | number | boolean> {
  return compactObject({
    status: followup.status,
    followupNeeded: followup.followupNeeded,
    owner: followup.owner,
    dueAt: followup.dueAt,
    dueText: followup.dueText,
    confidence: followup.confidence,
    reasons: followup.reasons,
    nextAction: followup.nextAction,
    sourceQuote: followup.sourceQuote,
  });
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
  value: Record<
    string,
    string | string[] | number | boolean | undefined
  >,
): Record<string, string | string[] | number | boolean> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[] | number | boolean>;
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "(none)";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFollowupStatus(value: unknown): value is HermesFollowupStatus {
  return (
    value === "needs_reply" ||
    value === "waiting_on_them" ||
    value === "no_followup" ||
    value === "done"
  );
}

function isFollowupOwner(value: unknown): value is HermesFollowupOwner {
  return value === "me" || value === "them" || value === "unknown";
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}
