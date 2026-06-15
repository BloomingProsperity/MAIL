import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export type HermesActionItemPriority = "low" | "medium" | "high";
export type HermesActionItemStatus = "open" | "waiting" | "blocked" | "done";

export interface HermesActionItem {
  title: string;
  owner?: string;
  dueAt?: string;
  dueText?: string;
  priority?: HermesActionItemPriority;
  status?: HermesActionItemStatus;
  sourceQuote?: string;
}

export interface HermesActionItemExtractInput {
  subject?: string;
  threadText: string;
  language?: string;
  now?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesActionItemExtractResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "action_item_extract";
  items: HermesActionItem[];
}

export interface HermesActionItemExtractService {
  extractActionItems(
    input: HermesActionItemExtractInput,
  ): Promise<HermesActionItemExtractResult>;
}

export interface HermesActionItemExtractServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const ACTION_ITEM_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You extract action items from email threads. Return only a JSON array with objects using these fields: title, owner, dueAt, dueText, priority, status, sourceQuote. priority must be low, medium, or high. status must be open, waiting, blocked, or done. Use ISO 8601 for dueAt when a deadline is clear. Use [] when there are no action items. Do not invent facts.";

const DEFAULT_ACTION_ITEM_MEMORY_LAYERS = [
  "contact_memory",
  "procedural_memory",
  "semantic_profile",
  "writing_style_profile",
];

export function createHermesActionItemExtractService(
  options: HermesActionItemExtractServiceOptions,
): HermesActionItemExtractService {
  return {
    async extractActionItems(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_ACTION_ITEM_MEMORY_LAYERS,
      });
      const rawText = await options.textProvider.complete({
        systemPrompt: ACTION_ITEM_SYSTEM_PROMPT,
        userPrompt: actionItemUserPrompt(input, memories),
      });
      const items = parseActionItems(rawText);
      const skillRunId = options.createId();
      const result: HermesActionItemExtractResult = {
        skillRunId,
        skillId: "action_item_extract",
        items,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "action_item_extract",
          skillTitle: "Extract action items",
          input: compactObject({
            subject: input.subject,
            threadText: input.threadText,
            language: input.language,
            now: input.now,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            items,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.action_item_extract",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "action_item_extract",
            language: input.language,
            now: input.now,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
        },
      });

      return { ...result, auditEventId };
    },
  };
}

function actionItemUserPrompt(
  input: HermesActionItemExtractInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Language: ${input.language ?? "match the thread"}`,
    `Current time: ${input.now ?? "unknown"}`,
  ];

  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function parseActionItems(rawText: string): HermesActionItem[] {
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!Array.isArray(parsed)) {
    throw new Error("action item output must be a JSON array");
  }

  return parsed.map(normalizeActionItem);
}

function normalizeActionItem(value: unknown): HermesActionItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("action item output must contain objects");
  }

  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.title)) {
    throw new Error("action item title is required");
  }

  const item: HermesActionItem = {
    title: record.title.trim(),
  };
  if (isNonEmptyString(record.owner)) {
    item.owner = record.owner.trim();
  }
  if (isNonEmptyString(record.dueAt)) {
    item.dueAt = record.dueAt.trim();
  }
  if (isNonEmptyString(record.dueText)) {
    item.dueText = record.dueText.trim();
  }
  if (isPriority(record.priority)) {
    item.priority = record.priority;
  }
  if (isStatus(record.status)) {
    item.status = record.status;
  }
  if (isNonEmptyString(record.sourceQuote)) {
    item.sourceQuote = record.sourceQuote.trim();
  }

  return item;
}

function stripJsonFence(rawText: string): string {
  const trimmed = rawText.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function compactObject(
  value: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[]>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPriority(value: unknown): value is HermesActionItemPriority {
  return value === "low" || value === "medium" || value === "high";
}

function isStatus(value: unknown): value is HermesActionItemStatus {
  return (
    value === "open" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "done"
  );
}
