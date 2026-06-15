import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export interface HermesReplyDraftInput {
  subject?: string;
  threadText: string;
  instruction?: string;
  tone?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export type HermesQuickReplyScenario =
  | "confirm"
  | "decline"
  | "thanks"
  | "follow_up"
  | "custom";

export type HermesRewritePolishAction =
  | "rewrite"
  | "polish"
  | "shorten"
  | "expand"
  | "tone"
  | "proofread";

export interface HermesQuickReplyInput {
  subject?: string;
  threadText: string;
  scenario: HermesQuickReplyScenario;
  instruction?: string;
  tone?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesRewritePolishInput {
  text: string;
  action: HermesRewritePolishAction;
  instruction?: string;
  tone?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesReplyDraftResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "reply_draft";
  draftText: string;
}

export interface HermesQuickReplyResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "quick_reply";
  scenario: HermesQuickReplyScenario;
  draftText: string;
  editable: true;
  sendsDirectly: false;
}

export interface HermesRewritePolishResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "rewrite_polish";
  action: HermesRewritePolishAction;
  rewrittenText: string;
  editable: true;
  sendsDirectly: false;
}

export interface HermesReplyDraftService {
  draftReply(input: HermesReplyDraftInput): Promise<HermesReplyDraftResult>;
}

export interface HermesQuickReplyService {
  quickReply(input: HermesQuickReplyInput): Promise<HermesQuickReplyResult>;
}

export interface HermesRewritePolishService {
  rewritePolish(
    input: HermesRewritePolishInput,
  ): Promise<HermesRewritePolishResult>;
}

export interface HermesReplyDraftServiceOptions {
  textProvider: HermesTextProvider;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
}

const REPLY_DRAFT_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. Draft a helpful email reply for the user. Do not send the message. Return only the editable reply body with no subject line, no markdown fences, and no commentary.";

const QUICK_REPLY_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. Draft a short quick email reply for the user. Do not send the message. Return only editable reply text, usually one to three sentences, with no subject line, no markdown fences, and no commentary.";

const REWRITE_POLISH_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. Rewrite or polish user-provided email draft text. Do not send the message. Return only editable rewritten text, preserving meaning and important details, with no markdown fences and no commentary.";

const DEFAULT_REPLY_DRAFT_MEMORY_LAYERS = [
  "writing_style_profile",
  "contact_memory",
  "procedural_memory",
  "semantic_profile",
];

export function createHermesReplyDraftService(
  options: HermesReplyDraftServiceOptions,
): HermesReplyDraftService {
  return {
    async draftReply(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_REPLY_DRAFT_MEMORY_LAYERS,
      });
      const draftText = await options.textProvider.complete({
        systemPrompt: REPLY_DRAFT_SYSTEM_PROMPT,
        userPrompt: replyDraftUserPrompt(input, memories),
      });
      const skillRunId = options.createId();
      const result: HermesReplyDraftResult = {
        skillRunId,
        skillId: "reply_draft",
        draftText,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "reply_draft",
          skillTitle: "Draft reply",
          input: compactObject({
            subject: input.subject,
            threadText: input.threadText,
            instruction: input.instruction,
            tone: input.tone,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            draftText,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.reply_draft",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "reply_draft",
            tone: input.tone,
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

export function createHermesQuickReplyService(
  options: HermesReplyDraftServiceOptions,
): HermesQuickReplyService {
  return {
    async quickReply(input) {
      if (!input.threadText || input.threadText.trim().length === 0) {
        throw new Error("thread text is required");
      }
      if (!isQuickReplyScenario(input.scenario)) {
        throw new Error("invalid quick reply scenario");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_REPLY_DRAFT_MEMORY_LAYERS,
      });
      const draftText = await options.textProvider.complete({
        systemPrompt: QUICK_REPLY_SYSTEM_PROMPT,
        userPrompt: quickReplyUserPrompt(input, memories),
      });
      const skillRunId = options.createId();
      const result: HermesQuickReplyResult = {
        skillRunId,
        skillId: "quick_reply",
        scenario: input.scenario,
        draftText,
        editable: true,
        sendsDirectly: false,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "quick_reply",
          skillTitle: "Quick reply",
          input: compactObject({
            subject: input.subject,
            threadText: input.threadText,
            scenario: input.scenario,
            instruction: input.instruction,
            tone: input.tone,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            scenario: input.scenario,
            draftText,
            editable: true,
            sendsDirectly: false,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.quick_reply",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "quick_reply",
            scenario: input.scenario,
            tone: input.tone,
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

export function createHermesRewritePolishService(
  options: HermesReplyDraftServiceOptions,
): HermesRewritePolishService {
  return {
    async rewritePolish(input) {
      if (!input.text || input.text.trim().length === 0) {
        throw new Error("text is required");
      }
      if (!isRewritePolishAction(input.action)) {
        throw new Error("invalid rewrite polish action");
      }

      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_REPLY_DRAFT_MEMORY_LAYERS,
      });
      const rewrittenText = await options.textProvider.complete({
        systemPrompt: REWRITE_POLISH_SYSTEM_PROMPT,
        userPrompt: rewritePolishUserPrompt(input, memories),
      });
      const skillRunId = options.createId();
      const result: HermesRewritePolishResult = {
        skillRunId,
        skillId: "rewrite_polish",
        action: input.action,
        rewrittenText,
        editable: true,
        sendsDirectly: false,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        run: {
          id: skillRunId,
          skillId: "rewrite_polish",
          skillTitle: "Rewrite and polish",
          input: compactObject({
            text: input.text,
            action: input.action,
            instruction: input.instruction,
            tone: input.tone,
            language: input.language,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
          }),
          output: {
            action: input.action,
            rewrittenText,
            editable: true,
            sendsDirectly: false,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.rewrite_polish",
          skillRunId,
          readMessageIds: input.readMessageIds ?? [],
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "rewrite_polish",
            action: input.action,
            tone: input.tone,
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

function replyDraftUserPrompt(
  input: HermesReplyDraftInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Tone: ${input.tone ?? "use the user's normal style"}`,
    `Language: ${input.language ?? "match the thread"}`,
    `User instruction: ${input.instruction ?? "draft a suitable reply"}`,
  ];

  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function quickReplyUserPrompt(
  input: HermesQuickReplyInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Subject: ${input.subject ?? "(none)"}`,
    `Scenario: ${input.scenario}`,
    `Scenario instruction: ${quickReplyScenarioInstruction(input.scenario)}`,
    `Tone: ${input.tone ?? "use the user's normal style"}`,
    `Language: ${input.language ?? "match the thread"}`,
    `User instruction: ${input.instruction ?? "draft a suitable quick reply"}`,
  ];

  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Thread context:", input.threadText);
  return lines.join("\n");
}

function rewritePolishUserPrompt(
  input: HermesRewritePolishInput,
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Action: ${input.action}`,
    `Action instruction: ${rewritePolishActionInstruction(input.action)}`,
    `Tone: ${input.tone ?? "preserve the user's normal style"}`,
    `Language: ${input.language ?? "match the original draft"}`,
    `User instruction: ${input.instruction ?? "improve the draft"}`,
  ];

  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Original draft:", input.text);
  return lines.join("\n");
}

function quickReplyScenarioInstruction(
  scenario: HermesQuickReplyScenario,
): string {
  switch (scenario) {
    case "confirm":
      return "confirm or acknowledge the request clearly";
    case "decline":
      return "politely decline without over-explaining";
    case "thanks":
      return "thank the sender and acknowledge receipt";
    case "follow_up":
      return "ask for the next step, status, or missing information";
    case "custom":
      return "follow the user's instruction closely";
  }
}

function isQuickReplyScenario(
  value: unknown,
): value is HermesQuickReplyScenario {
  return (
    value === "confirm" ||
    value === "decline" ||
    value === "thanks" ||
    value === "follow_up" ||
    value === "custom"
  );
}

function rewritePolishActionInstruction(
  action: HermesRewritePolishAction,
): string {
  switch (action) {
    case "rewrite":
      return "rewrite the draft for clarity while preserving meaning";
    case "polish":
      return "polish grammar, flow, and professionalism";
    case "shorten":
      return "make the draft shorter without losing key details";
    case "expand":
      return "expand the draft with useful detail while staying concise";
    case "tone":
      return "adjust tone according to the requested tone";
    case "proofread":
      return "fix spelling, grammar, and punctuation only";
  }
}

function isRewritePolishAction(
  value: unknown,
): value is HermesRewritePolishAction {
  return (
    value === "rewrite" ||
    value === "polish" ||
    value === "shorten" ||
    value === "expand" ||
    value === "tone" ||
    value === "proofread"
  );
}

function compactObject(
  value: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Record<string, string | string[]>;
}
