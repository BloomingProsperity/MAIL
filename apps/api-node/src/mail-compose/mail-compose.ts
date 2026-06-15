export class InvalidMailComposeRequestError extends Error {
  readonly code = "invalid_mail_compose_request";

  constructor(message = "invalid mail compose request") {
    super(message);
  }
}

export interface HermesDraftFeedbackStore {
  recordDraftFeedback(input: {
    skillRunId: string;
    draftText: string;
    finalText: string;
    subject?: string;
    recipientEmail?: string;
  }): Promise<unknown>;
}

export interface MailAddress {
  address: string;
  name?: string;
}

export type MailDraftStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed";
export type MailDraftSource = "manual" | "hermes_reply";
export type MailEngineProvider = "emailengine" | "native";
export type MailAccountSyncState = "syncing" | "reauth_required" | "paused";
export type ScheduledSendStatus =
  | "scheduled"
  | "queued"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed"
  | "dead_letter";

export interface MailDraft {
  id: string;
  accountId: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  status: MailDraftStatus;
  source: MailDraftSource;
  replyToMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
  providerQueueId?: string;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export interface MailComposeAccount {
  accountId: string;
  email: string;
  syncState: MailAccountSyncState;
  engineProvider: MailEngineProvider;
}

export interface DraftWithAccount {
  draft: MailDraft;
  account: MailComposeAccount;
}

export interface ScheduledSend {
  id: string;
  accountId: string;
  draftId: string;
  scheduledAt: string;
  status: ScheduledSendStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  canEdit: boolean;
  canSendNow: boolean;
  canDelete: boolean;
  providerQueueId?: string;
  providerMessageId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface ScheduledSendWithDraft {
  scheduledSend: ScheduledSend;
  draft: MailDraft;
  account: MailComposeAccount;
}

export interface CreateMailDraftInput {
  accountId: string;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  source?: MailDraftSource;
  replyToMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
}

export interface MailComposeStore {
  createDraft(
    input: Required<Pick<CreateMailDraftInput, "accountId" | "to">> & {
      id: string;
      cc: MailAddress[];
      bcc: MailAddress[];
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      source: MailDraftSource;
      replyToMessageId?: string;
      hermesSkillRunId?: string;
      hermesDraftText?: string;
      now: string;
    },
  ): Promise<MailDraft>;
  getDraftWithAccount(input: {
    accountId: string;
    draftId: string;
  }): Promise<DraftWithAccount | undefined>;
  claimDraftForSend(input: {
    accountId: string;
    draftId: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<DraftWithAccount | undefined>;
  markDraftSent(input: {
    accountId: string;
    draftId: string;
    providerQueueId?: string;
    providerMessageId?: string;
    sentAt: string;
  }): Promise<MailDraft>;
  markDraftFailed(input: {
    accountId: string;
    draftId: string;
    errorMessage: string;
  }): Promise<MailDraft | undefined>;
  createScheduledSend(input: {
    id: string;
    accountId: string;
    draftId: string;
    scheduledAt: string;
    notBefore: string;
    idempotencyKey: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  listScheduledSends(input: {
    accountId: string;
    limit: number;
  }): Promise<ScheduledSend[]>;
  rescheduleScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    scheduledAt: string;
    notBefore: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  cancelScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
  claimScheduledSendForSubmit(input: {
    accountId: string;
    scheduledId: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<ScheduledSendWithDraft | undefined>;
  markScheduledSendSent(input: {
    accountId: string;
    scheduledId: string;
    draftId: string;
    providerQueueId?: string;
    providerMessageId?: string;
    sentAt: string;
  }): Promise<ScheduledSend>;
  markScheduledSendFailed(input: {
    accountId: string;
    scheduledId: string;
    draftId: string;
    errorMessage: string;
    now: string;
  }): Promise<ScheduledSend | undefined>;
}

export interface MailSendTransport {
  submitMessage(input: {
    accountId: string;
    draftId: string;
    idempotencyKey: string;
    to: MailAddress[];
    cc: MailAddress[];
    bcc: MailAddress[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
  }): Promise<{
    queueId?: string;
    messageId?: string;
    sendAt?: string;
  }>;
}

export interface MailComposeService {
  createDraft(input: CreateMailDraftInput): Promise<MailDraft>;
  sendDraft(input: { accountId: string; draftId: string }): Promise<{
    accountId: string;
    draftId: string;
    action: "draft_send_queued";
    draft: MailDraft;
  }>;
  scheduleDraft(input: {
    accountId: string;
    draftId: string;
    scheduledAt: string;
  }): Promise<ScheduledSend>;
  listOutbox(input: {
    accountId: string;
    limit?: number;
  }): Promise<{ accountId: string; items: ScheduledSend[] }>;
  rescheduleScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    scheduledAt: string;
  }): Promise<ScheduledSend>;
  cancelScheduledSend(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSend>;
  sendScheduledNow(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSend>;
}

export function createMailComposeService(options: {
  store: MailComposeStore;
  transports: Partial<Record<MailEngineProvider, MailSendTransport>>;
  createId: () => string;
  hermesDraftFeedbackStore?: HermesDraftFeedbackStore;
  now?: () => Date;
}): MailComposeService {
  return {
    async createDraft(input) {
      const normalized = normalizeDraftInput(input);
      const draft = await options.store.createDraft({
        ...normalized,
        id: options.createId(),
        now: currentIso(options.now),
      });

      await recordHermesDraftFeedback(options.hermesDraftFeedbackStore, draft);

      return draft;
    },

    async sendDraft(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.draftId);

      const loaded = await options.store.getDraftWithAccount({
        accountId: input.accountId,
        draftId: input.draftId,
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("draft was not found");
      }
      ensureDraftCanSend(loaded);

      const now = currentIso(options.now);
      const claimed = await options.store.claimDraftForSend({
        ...input,
        leaseOwner: "api-send-draft",
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
        now,
      });
      if (!claimed) {
        throw new InvalidMailComposeRequestError("draft is not sendable");
      }

      const transport = options.transports[claimed.account.engineProvider];
      if (!transport) {
        await options.store.markDraftFailed({
          ...input,
          errorMessage: "send transport is unavailable",
        });
        throw new InvalidMailComposeRequestError("send transport is unavailable");
      }

      try {
        const result = await transport.submitMessage({
          accountId: claimed.account.accountId,
          draftId: claimed.draft.id,
          idempotencyKey: `compose:${claimed.draft.id}:send`,
          to: claimed.draft.to,
          cc: claimed.draft.cc,
          bcc: claimed.draft.bcc,
          subject: claimed.draft.subject,
          ...(claimed.draft.bodyText ? { bodyText: claimed.draft.bodyText } : {}),
          ...(claimed.draft.bodyHtml ? { bodyHtml: claimed.draft.bodyHtml } : {}),
        });

        const sentAt = result.sendAt ?? currentIso(options.now);
        const draft = await options.store.markDraftSent({
          ...input,
          ...(result.queueId ? { providerQueueId: result.queueId } : {}),
          ...(result.messageId ? { providerMessageId: result.messageId } : {}),
          sentAt,
        });

        return {
          accountId: input.accountId,
          draftId: input.draftId,
          action: "draft_send_queued",
          draft,
        };
      } catch (error) {
        await options.store.markDraftFailed({
          ...input,
          errorMessage: error instanceof Error ? error.message : "send failed",
        });
        throw error;
      }
    },

    async scheduleDraft(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.draftId);
      const scheduledAt = normalizeScheduledAt(input.scheduledAt, options.now);

      const loaded = await options.store.getDraftWithAccount({
        accountId: input.accountId,
        draftId: input.draftId,
      });
      if (!loaded) {
        throw new InvalidMailComposeRequestError("draft was not found");
      }
      ensureDraftCanSchedule(loaded);

      const now = currentIso(options.now);
      const scheduledSend = await options.store.createScheduledSend({
        id: options.createId(),
        accountId: input.accountId,
        draftId: input.draftId,
        scheduledAt,
        notBefore: scheduledAt,
        idempotencyKey: `compose:${input.draftId}:schedule:${scheduledAt}`,
        now,
      });
      if (!scheduledSend) {
        throw new InvalidMailComposeRequestError("draft is not schedulable");
      }

      return scheduledSend;
    },

    async listOutbox(input) {
      assertNonEmpty(input.accountId);
      return {
        accountId: input.accountId,
        items: await options.store.listScheduledSends({
          accountId: input.accountId,
          limit: normalizeOutboxLimit(input.limit),
        }),
      };
    },

    async rescheduleScheduledSend(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const scheduledAt = normalizeScheduledAt(input.scheduledAt, options.now);
      const result = await options.store.rescheduleScheduledSend({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
        scheduledAt,
        notBefore: scheduledAt,
        now: currentIso(options.now),
      });
      if (!result) {
        throw new InvalidMailComposeRequestError("scheduled send was not found");
      }

      return result;
    },

    async cancelScheduledSend(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const result = await options.store.cancelScheduledSend({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
        now: currentIso(options.now),
      });
      if (!result) {
        throw new InvalidMailComposeRequestError("scheduled send was not found");
      }

      return result;
    },

    async sendScheduledNow(input) {
      assertNonEmpty(input.accountId);
      assertNonEmpty(input.scheduledId);
      const now = currentIso(options.now);
      const claimed = await options.store.claimScheduledSendForSubmit({
        accountId: input.accountId,
        scheduledId: input.scheduledId,
        leaseOwner: "api-send-now",
        leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
        now,
      });
      if (!claimed) {
        throw new InvalidMailComposeRequestError("scheduled send is not sendable");
      }
      ensureAccountCanSend(claimed.account);

      const transport = options.transports[claimed.account.engineProvider];
      if (!transport) {
        const failed = await options.store.markScheduledSendFailed({
          accountId: input.accountId,
          scheduledId: input.scheduledId,
          draftId: claimed.draft.id,
          errorMessage: "send transport is unavailable",
          now,
        });
        if (failed) {
          return failed;
        }
        throw new InvalidMailComposeRequestError("send transport is unavailable");
      }

      try {
        const result = await transport.submitMessage({
          accountId: claimed.account.accountId,
          draftId: claimed.draft.id,
          idempotencyKey: `compose:${claimed.draft.id}:schedule:${claimed.scheduledSend.id}:send`,
          to: claimed.draft.to,
          cc: claimed.draft.cc,
          bcc: claimed.draft.bcc,
          subject: claimed.draft.subject,
          ...(claimed.draft.bodyText ? { bodyText: claimed.draft.bodyText } : {}),
          ...(claimed.draft.bodyHtml ? { bodyHtml: claimed.draft.bodyHtml } : {}),
        });

        return options.store.markScheduledSendSent({
          accountId: input.accountId,
          scheduledId: input.scheduledId,
          draftId: claimed.draft.id,
          ...(result.queueId ? { providerQueueId: result.queueId } : {}),
          ...(result.messageId ? { providerMessageId: result.messageId } : {}),
          sentAt: result.sendAt ?? currentIso(options.now),
        });
      } catch (error) {
        await options.store.markScheduledSendFailed({
          accountId: input.accountId,
          scheduledId: input.scheduledId,
          draftId: claimed.draft.id,
          errorMessage: error instanceof Error ? error.message : "send failed",
          now: currentIso(options.now),
        });
        throw error;
      }
    },
  };
}

function normalizeDraftInput(input: CreateMailDraftInput): {
  accountId: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
} {
  assertNonEmpty(input.accountId);
  const to = normalizeAddresses(input.to);
  const cc = normalizeAddresses(input.cc ?? []);
  const bcc = normalizeAddresses(input.bcc ?? []);
  const bodyText = optionalTrimmed(input.bodyText);
  const bodyHtml = optionalTrimmed(input.bodyHtml);

  if (to.length === 0) {
    throw new InvalidMailComposeRequestError("recipient is required");
  }
  if (!bodyText && !bodyHtml) {
    throw new InvalidMailComposeRequestError("message body is required");
  }

  return {
    accountId: input.accountId.trim(),
    to,
    cc,
    bcc,
    subject: input.subject?.trim() ?? "",
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    source: input.source === "hermes_reply" ? "hermes_reply" : "manual",
    ...(optionalTrimmed(input.replyToMessageId)
      ? { replyToMessageId: optionalTrimmed(input.replyToMessageId) }
      : {}),
    ...(optionalTrimmed(input.hermesSkillRunId)
      ? { hermesSkillRunId: optionalTrimmed(input.hermesSkillRunId) }
      : {}),
    ...(optionalTrimmed(input.hermesDraftText)
      ? { hermesDraftText: optionalTrimmed(input.hermesDraftText) }
      : {}),
  };
}

async function recordHermesDraftFeedback(
  store: HermesDraftFeedbackStore | undefined,
  draft: MailDraft,
): Promise<void> {
  if (
    !store ||
    draft.source !== "hermes_reply" ||
    !draft.hermesSkillRunId ||
    !draft.hermesDraftText ||
    !draft.bodyText
  ) {
    return;
  }

  await store.recordDraftFeedback({
    skillRunId: draft.hermesSkillRunId,
    draftText: draft.hermesDraftText,
    finalText: draft.bodyText,
    ...(draft.subject ? { subject: draft.subject } : {}),
    ...(draft.to[0]?.address ? { recipientEmail: draft.to[0].address } : {}),
  });
}

function ensureDraftCanSend(input: DraftWithAccount): void {
  if (input.draft.status !== "draft" && input.draft.status !== "sending") {
    throw new InvalidMailComposeRequestError("draft is not sendable");
  }
  ensureAccountCanSend(input.account);
}

function ensureDraftCanSchedule(input: DraftWithAccount): void {
  if (input.draft.status !== "draft") {
    throw new InvalidMailComposeRequestError("draft is not schedulable");
  }
  ensureAccountCanSend(input.account);
}

function ensureAccountCanSend(input: MailComposeAccount): void {
  if (input.syncState === "paused") {
    throw new InvalidMailComposeRequestError("account sync is paused");
  }
  if (input.syncState === "reauth_required") {
    throw new InvalidMailComposeRequestError("account requires reauthorization");
  }
}

function normalizeAddresses(addresses: MailAddress[]): MailAddress[] {
  return addresses.map(normalizeAddress).filter((address) => address.address);
}

function normalizeAddress(address: MailAddress): MailAddress {
  const normalized = address.address.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new InvalidMailComposeRequestError("recipient email is invalid");
  }
  return {
    address: normalized,
    ...(optionalTrimmed(address.name) ? { name: optionalTrimmed(address.name) } : {}),
  };
}

function assertNonEmpty(value: string): void {
  if (!value.trim()) {
    throw new InvalidMailComposeRequestError();
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function currentIso(now: (() => Date) | undefined): string {
  return (now?.() ?? new Date()).toISOString();
}

function normalizeScheduledAt(value: string, now: (() => Date) | undefined): string {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new InvalidMailComposeRequestError("scheduled time is invalid");
  }

  const current = now?.() ?? new Date();
  if (scheduledAt.getTime() <= current.getTime()) {
    throw new InvalidMailComposeRequestError("scheduled time must be future");
  }

  const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() > current.getTime() + maxFutureMs) {
    throw new InvalidMailComposeRequestError("scheduled time is too far");
  }

  return scheduledAt.toISOString();
}

function normalizeOutboxLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidMailComposeRequestError("outbox limit is invalid");
  }

  return limit;
}
