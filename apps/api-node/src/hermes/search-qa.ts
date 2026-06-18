import type {
  MailReadStore,
  MessageClassificationDto,
  MessageListItemDto,
  MessageSearchPreviewDto,
} from "../mail-read/mail-read-store.js";
import {
  appendHermesMemoryPromptSection,
  loadHermesMemoryContext,
  usedHermesMemoryIds,
} from "./memory-context.js";
import { appendHermesCustomInstructionsPromptSection } from "./custom-instructions.js";
import type { HermesMemoryStore } from "./memory-store.js";
import {
  planHermesEmailSearch,
  type HermesEmailSearchPlan,
} from "./search-planner.js";
import { limitHermesContextText } from "./message-content.js";
import type { HermesRunStore, HermesTextProvider } from "./translation.js";

export interface HermesEmailSearchQaInput {
  accountId?: string;
  mailboxId?: string;
  question: string;
  searchQuery?: string;
  language?: string;
  limit?: number;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  memoryLimit?: number;
  maxContextChars?: number;
  customInstructions?: string;
}

export interface HermesEmailSearchQaMatch {
  id: string;
  accountId: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  receivedAt: string;
  snippet?: string;
  searchPreview?: MessageSearchPreviewDto;
  classification: MessageClassificationDto;
}

export interface HermesEmailSearchQaCitation {
  resultIndex: number;
  messageId: string;
  accountId: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  receivedAt: string;
  snippet?: string;
  searchPreview?: MessageSearchPreviewDto;
  bucket: string;
  reasons: string[];
}

export interface HermesEmailSearchQaResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "email_search_qa";
  answerText: string;
  searchQuery: string;
  searchPlan: HermesEmailSearchPlan;
  citations: HermesEmailSearchQaCitation[];
  matches: HermesEmailSearchQaMatch[];
}

export interface HermesEmailSearchQaService {
  searchMail(input: HermesEmailSearchQaInput): Promise<HermesEmailSearchQaResult>;
}

export interface HermesEmailSearchQaServiceOptions {
  textProvider: HermesTextProvider;
  mailReadStore: Pick<MailReadStore, "listMessages">;
  createId: () => string;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
  now?: () => string;
}

const EMAIL_SEARCH_QA_SYSTEM_PROMPT =
  "You are Hermes inside Email Hub. You answer questions about email search results. Use only the provided search results and memory context. If the answer is not in the results, say so. Mention the relevant sender, subject, date, priority bucket, and why the user may care. Return only the answer.";

const DEFAULT_EMAIL_SEARCH_QA_MEMORY_LAYERS = [
  "contact_memory",
  "semantic_profile",
  "procedural_memory",
  "writing_style_profile",
];

const DEFAULT_SEARCH_LIMIT = 5;

export function createHermesEmailSearchQaService(
  options: HermesEmailSearchQaServiceOptions,
): HermesEmailSearchQaService {
  return {
    async searchMail(input) {
      if (!input.question || input.question.trim().length === 0) {
        throw new Error("question is required");
      }

      const searchPlan = planHermesEmailSearch({
        question: input.question,
        searchQuery: input.searchQuery,
        now: options.now?.() ?? new Date().toISOString(),
      });
      const searchQuery = searchPlan.searchQuery;
      const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
      const memories = await loadHermesMemoryContext(input, {
        memoryStore: options.memoryStore,
        memoryLimit: options.memoryLimit,
        defaultLayers: DEFAULT_EMAIL_SEARCH_QA_MEMORY_LAYERS,
      });
      const page = await options.mailReadStore.listMessages({
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...searchPlan.listMessagesInput,
        limit,
        sort: "smart",
      });
      const matches = page.items.map(toSearchMatch);
      const citations = matches.map(toSearchCitation);
      const answerText =
        matches.length === 0
          ? "No matching emails found."
          : await options.textProvider.complete({
              systemPrompt: EMAIL_SEARCH_QA_SYSTEM_PROMPT,
              userPrompt: limitHermesContextText(
                emailSearchQaUserPrompt(input, searchPlan, matches, memories),
                { maxChars: input.maxContextChars },
              ),
            });
      const skillRunId = options.createId();
      const result: HermesEmailSearchQaResult = {
        skillRunId,
        skillId: "email_search_qa",
        answerText,
        searchQuery,
        searchPlan,
        citations,
        matches,
      };

      if (!options.runStore) {
        return result;
      }

      const auditEventId = options.createId();
      await options.runStore.recordCompletedSkillRun({
        ...(input.accountId ? { accountId: input.accountId } : {}),
        run: {
          id: skillRunId,
          skillId: "email_search_qa",
          skillTitle: "Search mail with Hermes",
          input: compactObject({
            accountId: input.accountId,
            mailboxId: input.mailboxId,
            question: input.question,
            searchQuery,
            searchPlan,
            language: input.language,
            limit,
            memoryScope: input.memoryScope,
            memoryLayers: input.memoryLayers,
            maxContextChars: input.maxContextChars,
          }),
          output: {
            answerText,
            searchQuery,
            searchPlan,
            matchIds: matches.map((match) => match.id),
            citations,
          },
        },
        auditEvent: {
          id: auditEventId,
          eventType: "hermes.skill.email_search_qa",
          skillRunId,
          readMessageIds: uniqueStrings([
            ...(input.readMessageIds ?? []),
            ...matches.map((match) => match.id),
          ]),
          memoryIds: usedHermesMemoryIds(input.memoryIds, memories),
          action: compactObject({
            skillId: "email_search_qa",
            accountId: input.accountId,
            mailboxId: input.mailboxId,
            searchQuery,
            searchPlan,
            language: input.language,
            limit,
          }),
        },
      });

      return { ...result, auditEventId };
    },
  };
}

function toSearchMatch(message: MessageListItemDto): HermesEmailSearchQaMatch {
  return {
    id: message.id,
    accountId: message.accountId,
    subject: message.subject,
    from: message.from,
    receivedAt: message.receivedAt,
    ...(message.snippet ? { snippet: message.snippet } : {}),
    ...(message.searchPreview ? { searchPreview: message.searchPreview } : {}),
    classification: message.classification,
  };
}

function toSearchCitation(
  match: HermesEmailSearchQaMatch,
  index: number,
): HermesEmailSearchQaCitation {
  return {
    resultIndex: index + 1,
    messageId: match.id,
    accountId: match.accountId,
    subject: match.subject,
    from: match.from,
    receivedAt: match.receivedAt,
    ...(match.snippet ? { snippet: match.snippet } : {}),
    ...(match.searchPreview ? { searchPreview: match.searchPreview } : {}),
    bucket: match.classification.bucket,
    reasons: [...match.classification.reasons],
  };
}

function emailSearchQaUserPrompt(
  input: HermesEmailSearchQaInput,
  searchPlan: HermesEmailSearchPlan,
  matches: HermesEmailSearchQaMatch[],
  memories: Awaited<ReturnType<typeof loadHermesMemoryContext>>,
): string {
  const lines = [
    `Search question: ${input.question}`,
    `Search query: ${searchPlan.searchQuery}`,
    `Language: ${input.language ?? "match the user question"}`,
  ];
  lines.push("Interpreted search plan:");
  lines.push(...formatSearchPlan(searchPlan));

  appendHermesCustomInstructionsPromptSection(lines, input);
  appendHermesMemoryPromptSection(lines, memories);
  lines.push("", "Search results:");
  lines.push(...matches.map(formatSearchResult));
  return lines.join("\n");
}

function formatSearchPlan(plan: HermesEmailSearchPlan): string[] {
  return [
    `- query=${plan.searchQuery}`,
    `- scopes=${plan.qScopes.join(", ")}`,
    `- filters=${plan.filters.map((filter) => filter.label).join("; ") || "(none)"}`,
  ];
}

function formatSearchResult(match: HermesEmailSearchQaMatch, index: number): string {
  const fromName = match.from.name ? `${match.from.name} ` : "";
  const reasons =
    match.classification.reasons.length > 0
      ? ` reasons=${match.classification.reasons.join(", ")}`
      : "";
  return [
    `${index + 1}. id=${match.id}`,
    `subject=${match.subject}`,
    `from=${fromName}<${match.from.email}>`,
    `receivedAt=${match.receivedAt}`,
    `classification=${match.classification.bucket} score=${match.classification.priorityScore}${reasons}`,
    `snippet=${match.snippet ?? "(none)"}`,
    `searchPreview=${match.searchPreview?.text ?? "(none)"}`,
  ].join(" | ");
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
