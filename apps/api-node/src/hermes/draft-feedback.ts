import { type PoolLike, withTransaction, type Queryable } from "../db/transaction.js";

export interface HermesDraftFeedbackInput {
  skillRunId: string;
  draftText: string;
  finalText: string;
  subject?: string;
  recipientEmail?: string;
}

export interface HermesDraftFeedbackResult {
  feedbackId: string;
  skillRunId: string;
  learned: boolean;
  memoryId?: string;
}

export type HermesDraftFeedbackSkillId =
  | "reply_draft"
  | "quick_reply"
  | "rewrite_polish";

export interface HermesDraftFeedbackStore {
  getDraftFeedbackSkillRun(input: {
    skillRunId: string;
  }): Promise<
    | {
        skillRunId: string;
        skillId: HermesDraftFeedbackSkillId;
      }
    | undefined
  >;
  recordDraftFeedback(
    input: HermesDraftFeedbackInput,
  ): Promise<HermesDraftFeedbackResult | undefined>;
}

interface CreatePostgresHermesDraftFeedbackStoreOptions {
  createId: () => string;
}

interface HermesSkillRunRow extends Record<string, unknown> {
  id: string;
  skill_id: string;
  input?: unknown;
  output?: unknown;
}

interface DraftRevisionAnalysis {
  draftWordCount: number;
  finalWordCount: number;
  changes: string[];
  preference: string;
}

export function createPostgresHermesDraftFeedbackStore(
  client: PoolLike,
  options: CreatePostgresHermesDraftFeedbackStoreOptions,
): HermesDraftFeedbackStore {
  return {
    async getDraftFeedbackSkillRun(input) {
      const skillRun = await loadEditableFeedbackRun(client, input.skillRunId);
      return skillRun
        ? {
            skillRunId: skillRun.id,
            skillId: skillRun.skill_id,
          }
        : undefined;
    },

    async recordDraftFeedback(input) {
      return withTransaction(client, async (tx) => {
        const skillRun = await loadEditableFeedbackRun(tx, input.skillRunId);
        if (!skillRun) {
          return undefined;
        }

        const normalizedInput = normalizeFeedbackInput(input);
        const acceptedRewritePolish =
          skillRun.skill_id === "rewrite_polish" &&
          textsEqual(normalizedInput.draftText, normalizedInput.finalText);
        const analysis = acceptedRewritePolish
          ? analyzeAcceptedRewritePolish(skillRun, normalizedInput)
          : analyzeDraftRevision(input.draftText, input.finalText);
        const feedbackId = options.createId();
        await insertDraftFeedback(tx, {
          id: feedbackId,
          skillId: skillRun.skill_id,
          input: normalizedInput,
          analysis,
        });

        if (textsEqual(input.draftText, input.finalText) && !acceptedRewritePolish) {
          return {
            feedbackId,
            skillRunId: input.skillRunId,
            learned: false,
          };
        }

        const memoryId = options.createId();
        await insertWritingStyleMemory(tx, {
          id: memoryId,
          skillId: skillRun.skill_id,
          skillRun,
          feedbackId,
          input: normalizedInput,
          analysis,
        });

        return {
          feedbackId,
          skillRunId: input.skillRunId,
          learned: true,
          memoryId,
        };
      });
    },
  };
}

async function loadEditableFeedbackRun(
  client: Queryable,
  skillRunId: string,
): Promise<(HermesSkillRunRow & { skill_id: HermesDraftFeedbackSkillId }) | undefined> {
  const result = await client.query<HermesSkillRunRow>(
    `
      SELECT id, skill_id
           , input
           , output
      FROM hermes_skill_runs
      WHERE id = $1
      LIMIT 1
    `,
    [skillRunId],
  );
  const row = result.rows[0];
  return row?.skill_id === "reply_draft" ||
    row?.skill_id === "quick_reply" ||
    row?.skill_id === "rewrite_polish"
    ? (row as HermesSkillRunRow & { skill_id: HermesDraftFeedbackSkillId })
    : undefined;
}

async function insertDraftFeedback(
  client: Queryable,
  input: {
    id: string;
    skillId: HermesDraftFeedbackSkillId;
    input: HermesDraftFeedbackInput;
    analysis: DraftRevisionAnalysis;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO hermes_feedback (
        id,
        skill_run_id,
        feedback_type,
        payload
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      input.id,
      input.input.skillRunId,
      `${input.skillId}.final_edit`,
      compactObject({
        source: `${input.skillId}_feedback`,
        draftText: input.input.draftText,
        finalText: input.input.finalText,
        subject: input.input.subject,
        recipientEmail: input.input.recipientEmail,
        analysis: input.analysis,
      }),
    ],
  );
}

async function insertWritingStyleMemory(
  client: Queryable,
  input: {
    id: string;
    skillId: HermesDraftFeedbackSkillId;
    skillRun: HermesSkillRunRow & { skill_id: HermesDraftFeedbackSkillId };
    feedbackId: string;
    input: HermesDraftFeedbackInput;
    analysis: DraftRevisionAnalysis;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO hermes_memories (
        id,
        layer,
        scope,
        content,
        confidence
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      input.id,
      "writing_style_profile",
      memoryScopeForFeedback(input.input),
      compactObject({
        source: `${input.skillId}_feedback`,
        feedbackId: input.feedbackId,
        skillRunId: input.input.skillRunId,
        scope: memoryScopeForFeedback(input.input),
        subject: input.input.subject,
        recipientEmail: input.input.recipientEmail,
        ...(input.skillId === "rewrite_polish"
          ? {
              action: rewritePolishAction(input.skillRun),
              originalText: rewritePolishOriginalText(input.skillRun),
            }
          : {}),
        preference: input.analysis.preference,
        changes: input.analysis.changes,
        example: {
          before: memoryExampleBefore(input.input, input.skillRun),
          after: input.input.finalText,
        },
      }),
      memoryConfidence(input.analysis),
    ],
  );
}

export function analyzeDraftRevision(
  draftText: string,
  finalText: string,
): DraftRevisionAnalysis {
  const draftWordCount = countWords(draftText);
  const finalWordCount = countWords(finalText);
  const changes: string[] = [];

  if (finalWordCount <= Math.max(1, Math.floor(draftWordCount * 0.65))) {
    changes.push("shortened_reply");
  } else if (finalWordCount >= Math.ceil(draftWordCount * 1.35)) {
    changes.push("expanded_reply");
  }

  if (removedFormalSignoff(draftText, finalText)) {
    changes.push("removed_formal_signoff");
  }

  if (changes.length === 0 && !textsEqual(draftText, finalText)) {
    changes.push("edited_wording");
  }

  return {
    draftWordCount,
    finalWordCount,
    changes,
    preference: preferenceFromChanges(changes),
  };
}

function analyzeAcceptedRewritePolish(
  skillRun: HermesSkillRunRow,
  input: HermesDraftFeedbackInput,
): DraftRevisionAnalysis {
  const before = rewritePolishOriginalText(skillRun) ?? input.draftText;
  const action = rewritePolishAction(skillRun);
  return {
    draftWordCount: countWords(before),
    finalWordCount: countWords(input.finalText),
    changes: ["accepted_rewrite_polish"],
    preference:
      action === "polish"
        ? "The user accepted Hermes polished wording; prefer similarly clear, polished phrasing for future drafts."
        : "The user accepted Hermes rewritten wording; prefer similar wording for future drafts.",
  };
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function textsEqual(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function removedFormalSignoff(draftText: string, finalText: string): boolean {
  return /(^|\n)\s*(best|regards|sincerely),?\s*(\n|$)/i.test(draftText) &&
    !/(^|\n)\s*(best|regards|sincerely),?\s*(\n|$)/i.test(finalText);
}

function preferenceFromChanges(changes: string[]): string {
  const preferences: string[] = [];
  if (changes.includes("shortened_reply")) {
    preferences.push("Prefer shorter reply drafts with less extra phrasing.");
  }
  if (changes.includes("expanded_reply")) {
    preferences.push("Prefer more detailed reply drafts when context is thin.");
  }
  if (changes.includes("removed_formal_signoff")) {
    preferences.push("Avoid adding a formal sign-off unless the user wrote one.");
  }
  if (preferences.length === 0) {
    preferences.push("Preserve the user's edited wording for similar replies.");
  }

  return preferences.join(" ");
}

function memoryConfidence(analysis: DraftRevisionAnalysis): number {
  if (analysis.changes.includes("accepted_rewrite_polish")) {
    return 0.7;
  }
  return analysis.changes.includes("shortened_reply") ||
    analysis.changes.includes("expanded_reply")
    ? 0.8
    : 0.65;
}

function normalizeFeedbackInput(
  input: HermesDraftFeedbackInput,
): HermesDraftFeedbackInput {
  const recipientEmail = normalizeRecipientEmail(input.recipientEmail);
  return {
    ...input,
    ...(recipientEmail ? { recipientEmail } : {}),
  };
}

function memoryScopeForFeedback(input: HermesDraftFeedbackInput): string {
  return input.recipientEmail ? `recipient:${input.recipientEmail}` : "global";
}

function memoryExampleBefore(
  input: HermesDraftFeedbackInput,
  skillRun: HermesSkillRunRow,
): string {
  return skillRun.skill_id === "rewrite_polish"
    ? rewritePolishOriginalText(skillRun) ?? input.draftText
    : input.draftText;
}

function rewritePolishOriginalText(
  skillRun: HermesSkillRunRow,
): string | undefined {
  const input = recordFromUnknown(skillRun.input);
  const text = input?.text;
  return typeof text === "string" && text.trim() ? text : undefined;
}

function rewritePolishAction(skillRun: HermesSkillRunRow): string | undefined {
  const input = recordFromUnknown(skillRun.input);
  const action = input?.action;
  return typeof action === "string" && action.trim() ? action : undefined;
}

function normalizeRecipientEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
