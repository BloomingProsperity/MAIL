import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import { appendHermesCustomInstructionsPromptSection } from "./custom-instructions.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export interface HermesThreadSummaryInput {
  accountId?: string;
  subject?: string;
  threadText: string;
  mode?: HermesThreadSummaryMode;
  focus?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  memoryLimit?: number;
  customInstructions?: string;
}

export type HermesThreadSummaryMode = "short" | "detailed" | "action_points";

export interface HermesThreadSummaryResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "thread_summarize";
  mode: HermesThreadSummaryMode;
  summaryText: string;
}

export interface HermesThreadSummaryService {
  summarizeThread(
    input: HermesThreadSummaryInput,
  ): Promise<HermesThreadSummaryResult>;
}

export interface HermesThreadSummaryServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const THREAD_SUMMARY_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You summarize email threads for the user. Focus on decisions, open questions, action items, owners, deadlines, blockers, and anything the user must reply to. Return only the summary text; do not invent facts.";

const DEFAULT_THREAD_SUMMARY_MEMORY_LAYERS = [
  "contact_memory",
  "procedural_memory",
  "semantic_profile",
  "writing_style_profile",
];

export function createHermesThreadSummaryService(
  options: HermesThreadSummaryServiceOptions,
): HermesThreadSummaryService {
  return {
    async summarizeThread(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }
      const mode = normalizeThreadSummaryMode(input.mode);

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_THREAD_SUMMARY_MEMORY_LAYERS,
      });
      const summaryText = await options.textProvider.complete({
        systemPrompt: THREAD_SUMMARY_SYSTEM_PROMPT,
        userPrompt: threadSummaryUserPrompt(input, memories),
      });
      const skillRunId = options.createId();
      const result: HermesThreadSummaryResult = {
        skillRunId,
        skillId: "thread_summarize",
        mode,
        summaryText,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        ...(input.accountId ? { accountId: input.accountId } : {}),
        run: {
          id: skillRunId,
          skillId: "thread_summarize",
          skillTitle: "Summarize thread",
          input: compactObject({
            subject: input.subject,
            accountId: input.accountId,
            threadText: input.threadText,
            mode,
            focus: input.focus,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            mode,
            summaryText,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.thread_summarize",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "thread_summarize",
            accountId: input.accountId,
            mode,
            focus: input.focus,
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

function threadSummaryUserPrompt(
  input: HermesThreadSummaryInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const mode = normalizeThreadSummaryMode(input.mode);
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Mode: ${mode}`,
    `Mode instruction: ${threadSummaryModeInstruction(mode)}`,
    `Focus: ${input.focus ?? "decisions, action items, deadlines, and reply needs"}`,
    `Language: ${input.language ?? "match the thread"}`,
  ];

  appendHermesCustomInstructionsPromptSection(lines, input);
  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function normalizeThreadSummaryMode(
  mode: HermesThreadSummaryInput["mode"],
): HermesThreadSummaryMode {
  if (mode === undefined) {
    return "detailed";
  }
  if (mode === "short" || mode === "detailed" || mode === "action_points") {
    return mode;
  }

  throw new Error("invalid thread summary mode");
}

function threadSummaryModeInstruction(mode: HermesThreadSummaryMode): string {
  switch (mode) {
    case "short":
      return "summarize in two or three concise bullets";
    case "detailed":
      return "summarize decisions, context, blockers, and next steps";
    case "action_points":
      return "extract only action items, owners, deadlines, and reply needs";
  }
}

function compactObject(
  value: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[]>;
}
