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

export interface HermesDraftFeedbackStore {
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
    async recordDraftFeedback(input) {
      return withTransaction(client, async (tx) => {
        const skillRun = await loadReplyDraftRun(tx, input.skillRunId);
        if (!skillRun) {
          return undefined;
        }

        const normalizedInput = normalizeFeedbackInput(input);
        const analysis = analyzeDraftRevision(input.draftText, input.finalText);
        const feedbackId = options.createId();
        await insertDraftFeedback(tx, {
          id: feedbackId,
          input: normalizedInput,
          analysis,
        });

        if (textsEqual(input.draftText, input.finalText)) {
          return {
            feedbackId,
            skillRunId: input.skillRunId,
            learned: false,
          };
        }

        const memoryId = options.createId();
        await insertWritingStyleMemory(tx, {
          id: memoryId,
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

async function loadReplyDraftRun(
  client: Queryable,
  skillRunId: string,
): Promise<HermesSkillRunRow | undefined> {
  const result = await client.query<HermesSkillRunRow>(
    `
      SELECT id, skill_id
      FROM hermes_skill_runs
      WHERE id = $1
      LIMIT 1
    `,
    [skillRunId],
  );
  const row = result.rows[0];
  return row?.skill_id === "reply_draft" ? row : undefined;
}

async function insertDraftFeedback(
  client: Queryable,
  input: {
    id: string;
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
      "reply_draft.final_edit",
      compactObject({
        source: "reply_draft_feedback",
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
        source: "reply_draft_feedback",
        feedbackId: input.feedbackId,
        skillRunId: input.input.skillRunId,
        scope: memoryScopeForFeedback(input.input),
        subject: input.input.subject,
        recipientEmail: input.input.recipientEmail,
        preference: input.analysis.preference,
        changes: input.analysis.changes,
        example: {
          before: input.input.draftText,
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

function normalizeRecipientEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
