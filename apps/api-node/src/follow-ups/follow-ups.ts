export class InvalidFollowUpRequestError extends Error {
  readonly code = "invalid_follow_up_request";

  constructor(message = "invalid follow-up request") {
    super(message);
  }
}

export type FollowUpKind = "manual" | "needs_reply" | "waiting_on_them";
export type FollowUpSource = "manual" | "hermes_followup";
export type FollowUpStatus = "open" | "due" | "done" | "cancelled";
export type FollowUpListStatus = "open" | "due" | "done" | "cancelled" | "all";

export interface FollowUpReminder {
  id: string;
  accountId: string;
  messageId: string;
  kind: FollowUpKind;
  status: FollowUpStatus;
  dueAt: string;
  title?: string;
  note?: string;
  source: FollowUpSource;
  hermesSkillRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface CreateFollowUpInput {
  accountId: string;
  messageId: string;
  dueAt: string;
  kind?: FollowUpKind;
  title?: string;
  note?: string;
  source?: FollowUpSource;
  hermesSkillRunId?: string;
}

export interface UpdateFollowUpInput {
  id: string;
  dueAt?: string;
  kind?: FollowUpKind;
  status?: Exclude<FollowUpStatus, "cancelled">;
  title?: string;
  note?: string;
}

export interface FollowUpStore {
  createFollowUp(input: {
    id: string;
    accountId: string;
    messageId: string;
    dueAt: string;
    kind: FollowUpKind;
    title?: string;
    note?: string;
    source: FollowUpSource;
    hermesSkillRunId?: string;
    now: string;
  }): Promise<FollowUpReminder>;
  listFollowUps(input: {
    accountId: string;
    status: FollowUpListStatus;
    limit: number;
  }): Promise<FollowUpReminder[]>;
  updateFollowUp(
    input: UpdateFollowUpInput & { now: string },
  ): Promise<FollowUpReminder | undefined>;
  cancelFollowUp(input: {
    id: string;
    now: string;
  }): Promise<FollowUpReminder | undefined>;
}

export interface FollowUpService {
  createFollowUp(input: CreateFollowUpInput): Promise<FollowUpReminder>;
  listFollowUps(input: {
    accountId: string;
    status?: FollowUpListStatus;
    limit?: number;
  }): Promise<{
    accountId: string;
    status: FollowUpListStatus;
    items: FollowUpReminder[];
  }>;
  updateFollowUp(input: UpdateFollowUpInput): Promise<FollowUpReminder>;
  cancelFollowUp(input: { id: string }): Promise<FollowUpReminder>;
}

export function createFollowUpService(options: {
  store: FollowUpStore;
  createId: () => string;
  now?: () => Date;
}): FollowUpService {
  return {
    async createFollowUp(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.messageId);
      const dueAt = normalizeDueAt(input.dueAt, options.now);
      const now = currentIso(options.now);

      return options.store.createFollowUp({
        id: options.createId(),
        accountId: input.accountId,
        messageId: input.messageId,
        dueAt,
        kind: normalizeKind(input.kind),
        ...(optionalTrimmed(input.title) ? { title: optionalTrimmed(input.title) } : {}),
        ...(optionalTrimmed(input.note) ? { note: optionalTrimmed(input.note) } : {}),
        source: input.source === "hermes_followup" ? "hermes_followup" : "manual",
        ...(optionalTrimmed(input.hermesSkillRunId)
          ? { hermesSkillRunId: optionalTrimmed(input.hermesSkillRunId) }
          : {}),
        now,
      });
    },

    async listFollowUps(input) {
      assertNonEmpty(input.accountId);
      const status = normalizeListStatus(input.status);
      const limit = normalizeLimit(input.limit);

      return {
        accountId: input.accountId,
        status,
        items: await options.store.listFollowUps({
          accountId: input.accountId,
          status,
          limit,
        }),
      };
    },

    async updateFollowUp(input) {
      assertNonEmpty(input.id);
      const dueAt = input.dueAt
        ? normalizeDueAt(input.dueAt, options.now)
        : undefined;
      const result = await options.store.updateFollowUp({
        id: input.id,
        ...(dueAt ? { dueAt } : {}),
        ...(input.kind ? { kind: normalizeKind(input.kind) } : {}),
        ...(input.status ? { status: normalizeMutableStatus(input.status) } : {}),
        ...(optionalTrimmed(input.title) ? { title: optionalTrimmed(input.title) } : {}),
        ...(optionalTrimmed(input.note) ? { note: optionalTrimmed(input.note) } : {}),
        now: currentIso(options.now),
      });
      if (!result) {
        throw new InvalidFollowUpRequestError("follow-up was not found");
      }

      return result;
    },

    async cancelFollowUp(input) {
      assertNonEmpty(input.id);
      const result = await options.store.cancelFollowUp({
        id: input.id,
        now: currentIso(options.now),
      });
      if (!result) {
        throw new InvalidFollowUpRequestError("follow-up was not found");
      }

      return result;
    },
  };
}

function normalizeDueAt(value: string, now: (() => Date) | undefined): string {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) {
    throw new InvalidFollowUpRequestError("due time is invalid");
  }

  const current = now?.() ?? new Date();
  if (dueAt.getTime() <= current.getTime()) {
    throw new InvalidFollowUpRequestError("due time must be future");
  }

  const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
  if (dueAt.getTime() > current.getTime() + maxFutureMs) {
    throw new InvalidFollowUpRequestError("due time is too far");
  }

  return dueAt.toISOString();
}

function normalizeKind(value: FollowUpKind | undefined): FollowUpKind {
  if (value === "needs_reply" || value === "waiting_on_them") {
    return value;
  }

  return "manual";
}

function normalizeListStatus(
  value: FollowUpListStatus | undefined,
): FollowUpListStatus {
  if (
    value === "due" ||
    value === "done" ||
    value === "cancelled" ||
    value === "all"
  ) {
    return value;
  }

  return "open";
}

function normalizeMutableStatus(
  value: Exclude<FollowUpStatus, "cancelled">,
): Exclude<FollowUpStatus, "cancelled"> {
  if (value === "due" || value === "done") {
    return value;
  }

  return "open";
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new InvalidFollowUpRequestError("limit is invalid");
  }

  return value;
}

function assertNonEmpty(value: string): void {
  if (!value.trim()) {
    throw new InvalidFollowUpRequestError();
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function currentIso(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString();
}
