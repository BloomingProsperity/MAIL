import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import { appendHermesCustomInstructionsPromptSection } from "./custom-instructions.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export type HermesPriorityLevel = "low" | "medium" | "high";

export type HermesPriorityBucket =
  | "P0 Pinned"
  | "P1 Urgent"
  | "P2 Important"
  | "P3 Needs Action"
  | "P4 FYI / Updates"
  | "P5 Transactions"
  | "P6 Feed"
  | "P7 Screen";

export interface HermesPriorityTriageInput {
  subject?: string;
  threadText: string;
  senderEmail?: string;
  currentBucket?: string;
  currentScore?: number;
  currentReasons?: string[];
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  memoryLimit?: number;
  customInstructions?: string;
}

export interface HermesPriorityTriageResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "priority_triage";
  priority: HermesPriorityLevel;
  bucket: HermesPriorityBucket;
  score: number;
  reasons: string[];
  explanation?: string;
}

export interface HermesPriorityTriageService {
  triagePriority(
    input: HermesPriorityTriageInput,
  ): Promise<HermesPriorityTriageResult>;
}

export interface HermesPriorityTriageServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const PRIORITY_TRIAGE_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You triage email priority for Smart Inbox. Return only a JSON object with fields priority, bucket, score, reasons, and optional explanation. priority must be low, medium, or high. bucket must be one of P0 Pinned, P1 Urgent, P2 Important, P3 Needs Action, P4 FYI / Updates, P5 Transactions, P6 Feed, P7 Screen. score must be an integer from 0 to 100. reasons must be a concise string array. This is a preview suggestion only; do not imply the stored Smart Inbox state was changed.";

const DEFAULT_PRIORITY_TRIAGE_MEMORY_LAYERS = [
  "contact_memory",
  "procedural_memory",
  "semantic_profile",
  "writing_style_profile",
];

export function createHermesPriorityTriageService(
  options: HermesPriorityTriageServiceOptions,
): HermesPriorityTriageService {
  return {
    async triagePriority(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_PRIORITY_TRIAGE_MEMORY_LAYERS,
      });
      const rawText = await options.textProvider.complete({
        systemPrompt: PRIORITY_TRIAGE_SYSTEM_PROMPT,
        userPrompt: priorityTriageUserPrompt(input, memories),
      });
      const triage = parsePriorityTriage(rawText);
      const skillRunId = options.createId();
      const result: HermesPriorityTriageResult = {
        skillRunId,
        skillId: "priority_triage",
        ...triage,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "priority_triage",
          skillTitle: "Triage priority",
          input: compactObject({
            subject: input.subject,
            threadText: input.threadText,
            senderEmail: input.senderEmail,
            currentBucket: input.currentBucket,
            currentScore: input.currentScore,
            currentReasons: input.currentReasons,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            priority: triage.priority,
            bucket: triage.bucket,
            score: triage.score,
            reasons: triage.reasons,
            ...(triage.explanation ? { explanation: triage.explanation } : {}),
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.priority_triage",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "priority_triage",
            senderEmail: input.senderEmail,
            currentBucket: input.currentBucket,
            currentScore: input.currentScore,
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

function priorityTriageUserPrompt(
  input: HermesPriorityTriageInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Sender: ${input.senderEmail ?? "(unknown)"}`,
    `Current bucket: ${input.currentBucket ?? "(none)"}`,
    `Current score: ${input.currentScore ?? "(none)"}`,
    `Current reasons: ${formatList(input.currentReasons)}`,
    `Language: ${input.language ?? "match the thread"}`,
  ];

  appendHermesCustomInstructionsPromptSection(lines, input);
  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function parsePriorityTriage(rawText: string): Omit<
  HermesPriorityTriageResult,
  "skillRunId" | "auditEventId" | "skillId"
> {
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("priority triage output must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  if (!isPriorityLevel(record.priority)) {
    throw new Error("priority level is invalid");
  }
  if (!isPriorityBucket(record.bucket)) {
    throw new Error("priority bucket is invalid");
  }
  if (!isPriorityScore(record.score)) {
    throw new Error("priority score is invalid");
  }

  return {
    priority: record.priority,
    bucket: record.bucket,
    score: record.score,
    reasons: normalizeReasons(record.reasons),
    ...(isNonEmptyString(record.explanation)
      ? { explanation: record.explanation.trim() }
      : {}),
  };
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
  value: Record<string, string | string[] | number | undefined>,
): Record<string, string | string[] | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[] | number>;
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "(none)";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPriorityLevel(value: unknown): value is HermesPriorityLevel {
  return value === "low" || value === "medium" || value === "high";
}

function isPriorityBucket(value: unknown): value is HermesPriorityBucket {
  return (
    value === "P0 Pinned" ||
    value === "P1 Urgent" ||
    value === "P2 Important" ||
    value === "P3 Needs Action" ||
    value === "P4 FYI / Updates" ||
    value === "P5 Transactions" ||
    value === "P6 Feed" ||
    value === "P7 Screen"
  );
}

function isPriorityScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}
