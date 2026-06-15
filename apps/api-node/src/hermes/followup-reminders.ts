import type {
  FollowUpKind,
  FollowUpReminder,
  FollowUpService,
} from "../follow-ups/follow-ups.js";

export class InvalidHermesFollowUpReminderRequestError extends Error {
  readonly code = "invalid_hermes_follow_up_request";

  constructor(message = "invalid Hermes follow-up request") {
    super(message);
  }
}

export type HermesFollowUpReminderStatus =
  | "needs_reply"
  | "waiting_on_them"
  | "no_followup"
  | "done";

export interface HermesFollowUpReminderConfirmationInput {
  accountId: string;
  messageId: string;
  skillRunId: string;
  status: HermesFollowUpReminderStatus;
  dueAt: string;
  title?: string;
  nextAction?: string;
  reasons?: string[];
  sourceQuote?: string;
}

export interface HermesFollowUpReminderService {
  confirmFollowUpSuggestion(
    input: HermesFollowUpReminderConfirmationInput,
  ): Promise<FollowUpReminder>;
}

export function createHermesFollowUpReminderService(options: {
  followUpService: FollowUpService;
}): HermesFollowUpReminderService {
  return {
    async confirmFollowUpSuggestion(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.messageId);
      assertNonEmpty(input.skillRunId);
      assertNonEmpty(input.dueAt);

      const kind = actionableKind(input.status);
      const title =
        optionalTrimmed(input.title) ??
        optionalTrimmed(input.nextAction) ??
        defaultTitle(kind);

      return options.followUpService.createFollowUp({
        accountId: input.accountId,
        messageId: input.messageId,
        dueAt: input.dueAt,
        kind,
        title,
        note: buildNote(input),
        source: "hermes_followup",
        hermesSkillRunId: input.skillRunId,
      });
    },
  };
}

function actionableKind(status: HermesFollowUpReminderStatus): FollowUpKind {
  if (status === "needs_reply" || status === "waiting_on_them") {
    return status;
  }

  throw new InvalidHermesFollowUpReminderRequestError(
    "follow-up suggestion is not actionable",
  );
}

function buildNote(input: HermesFollowUpReminderConfirmationInput): string {
  const lines = ["Hermes suggested this follow-up."];
  const reasons = normalizeReasons(input.reasons);
  if (reasons.length > 0) {
    lines.push(`Reasons: ${reasons.join("; ")}`);
  }
  const sourceQuote = optionalTrimmed(input.sourceQuote);
  if (sourceQuote) {
    lines.push(`Source: ${sourceQuote}`);
  }

  return lines.join("\n");
}

function normalizeReasons(value: string[] | undefined): string[] {
  return (value ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function defaultTitle(kind: FollowUpKind): string {
  return kind === "needs_reply"
    ? "Reply to this email"
    : "Follow up on this email";
}

function assertNonEmpty(value: string): void {
  if (!value.trim()) {
    throw new InvalidHermesFollowUpReminderRequestError();
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
