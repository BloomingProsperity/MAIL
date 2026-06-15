import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export type HermesLabelActionType =
  | "apply_label"
  | "archive"
  | "snooze"
  | "keep_in_inbox"
  | "move_to_feed"
  | "mark_important";

export interface HermesLabelSuggestion {
  name: string;
  confidence?: number;
  reason?: string;
}

export interface HermesLabelActionSuggestion {
  type: HermesLabelActionType;
  label?: string;
  snoozeUntil?: string;
  reason?: string;
}

export interface HermesLabelSuggestInput {
  subject?: string;
  threadText: string;
  senderEmail?: string;
  currentLabels?: string[];
  availableLabels?: string[];
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesLabelSuggestResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "label_suggest";
  labels: HermesLabelSuggestion[];
  actions: HermesLabelActionSuggestion[];
}

export interface HermesLabelSuggestService {
  suggestLabels(input: HermesLabelSuggestInput): Promise<HermesLabelSuggestResult>;
}

export interface HermesLabelSuggestServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const LABEL_SUGGEST_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You suggest labels and organization actions for email threads. Return only a JSON object with fields labels and actions. labels is an array of {name, confidence, reason}. actions is an array of {type, label, snoozeUntil, reason}. action type must be one of apply_label, archive, snooze, keep_in_inbox, move_to_feed, mark_important. These are preview suggestions only; do not imply anything was applied. Do not invent facts.";

const DEFAULT_LABEL_SUGGEST_MEMORY_LAYERS = [
  "procedural_memory",
  "contact_memory",
  "semantic_profile",
  "writing_style_profile",
];

export function createHermesLabelSuggestService(
  options: HermesLabelSuggestServiceOptions,
): HermesLabelSuggestService {
  return {
    async suggestLabels(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_LABEL_SUGGEST_MEMORY_LAYERS,
      });
      const rawText = await options.textProvider.complete({
        systemPrompt: LABEL_SUGGEST_SYSTEM_PROMPT,
        userPrompt: labelSuggestUserPrompt(input, memories),
      });
      const suggestion = parseLabelSuggestion(rawText);
      const skillRunId = options.createId();
      const result: HermesLabelSuggestResult = {
        skillRunId,
        skillId: "label_suggest",
        labels: suggestion.labels,
        actions: suggestion.actions,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "label_suggest",
          skillTitle: "Suggest labels",
          input: compactObject({
            subject: input.subject,
            threadText: input.threadText,
            senderEmail: input.senderEmail,
            currentLabels: input.currentLabels,
            availableLabels: input.availableLabels,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            labels: suggestion.labels,
            actions: suggestion.actions,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.label_suggest",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "label_suggest",
            senderEmail: input.senderEmail,
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

function labelSuggestUserPrompt(
  input: HermesLabelSuggestInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Sender: ${input.senderEmail ?? "(unknown)"}`,
    `Current labels: ${formatList(input.currentLabels)}`,
    `Available labels: ${formatList(input.availableLabels)}`,
    `Language: ${input.language ?? "match the thread"}`,
  ];

  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function parseLabelSuggestion(rawText: string): {
  labels: HermesLabelSuggestion[];
  actions: HermesLabelActionSuggestion[];
} {
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("label suggestion output must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  return {
    labels: Array.isArray(record.labels)
      ? record.labels.map(normalizeLabelSuggestion)
      : [],
    actions: Array.isArray(record.actions)
      ? record.actions.map(normalizeActionSuggestion)
      : [],
  };
}

function normalizeLabelSuggestion(value: unknown): HermesLabelSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("label suggestions must be objects");
  }

  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.name)) {
    throw new Error("label suggestion name is required");
  }

  const label: HermesLabelSuggestion = {
    name: record.name.trim(),
  };
  if (isConfidence(record.confidence)) {
    label.confidence = record.confidence;
  }
  if (isNonEmptyString(record.reason)) {
    label.reason = record.reason.trim();
  }

  return label;
}

function normalizeActionSuggestion(value: unknown): HermesLabelActionSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("label actions must be objects");
  }

  const record = value as Record<string, unknown>;
  if (!isActionType(record.type)) {
    throw new Error("label action type is invalid");
  }

  const action: HermesLabelActionSuggestion = {
    type: record.type,
  };
  if (isNonEmptyString(record.label)) {
    action.label = record.label.trim();
  }
  if (isNonEmptyString(record.snoozeUntil)) {
    action.snoozeUntil = record.snoozeUntil.trim();
  }
  if (isNonEmptyString(record.reason)) {
    action.reason = record.reason.trim();
  }

  return action;
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

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "(none)";
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

function isActionType(value: unknown): value is HermesLabelActionType {
  return (
    value === "apply_label" ||
    value === "archive" ||
    value === "snooze" ||
    value === "keep_in_inbox" ||
    value === "move_to_feed" ||
    value === "mark_important"
  );
}
