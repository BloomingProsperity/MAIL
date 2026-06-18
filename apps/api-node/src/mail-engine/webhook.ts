import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type MailEngineEventSource = "emailengine_webhook";

export type MailEngineEventKind =
  | "sync_requested"
  | "account_deleted"
  | "message_upserted"
  | "message_deleted"
  | "flags_changed"
  | "labels_changed"
  | "mailbox_changed"
  | "auth_failed"
  | "sync_failed"
  | "send_completed"
  | "unknown_notification";

export interface NormalizedMailEngineEvent {
  source: MailEngineEventSource;
  kind: MailEngineEventKind;
  accountId?: string;
  mailboxId?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  providerEmailId?: string;
  rfcMessageId?: string;
  providerUid?: string;
  providerPath?: string;
  resourceKey?: string;
  resourceIdentity?: MailEngineResourceIdentity;
  providerEventName?: string;
  idempotencyKey: string;
}

export interface MailEngineResourceIdentity {
  emailengineMessageId?: string;
  emailengineEmailId?: string;
  internetMessageId?: string;
  imapUid?: string;
  mailboxPath?: string;
  threadId?: string;
  resourceKey?: string;
}

export interface VerifyEmailEngineSignatureInput {
  secret: string;
  body: string | Buffer;
  signature?: string | null;
}

export interface NormalizeEmailEngineWebhookOptions {
  deliveryEventId?: string;
}

export interface VerifyEmailEngineWebhookFreshnessInput {
  payload: unknown;
  now?: Date;
  maxSkewMs?: number;
}

export type EmailEngineWebhookFreshnessResult =
  | {
      ok: true;
      date: string;
    }
  | {
      ok: false;
      reason: "missing_date" | "invalid_date" | "outside_window";
    };

type JsonRecord = Record<string, unknown>;

export const DEFAULT_EMAILENGINE_WEBHOOK_MAX_SKEW_MS = 10 * 60 * 1000;

const eventKindByName: Record<string, MailEngineEventKind> = {
  accountAdded: "sync_requested",
  accountInitialized: "sync_requested",
  accountDeleted: "account_deleted",
  messageNew: "message_upserted",
  messageUpdated: "message_upserted",
  messageDeleted: "message_deleted",
  messageMissing: "message_deleted",
  messageMove: "mailbox_changed",
  messageFlags: "flags_changed",
  messageLabels: "labels_changed",
  mailboxNew: "mailbox_changed",
  mailboxDeleted: "mailbox_changed",
  authenticationError: "auth_failed",
  accountError: "sync_failed",
  messageSent: "send_completed",
};

export function verifyEmailEngineSignature(
  input: VerifyEmailEngineSignatureInput,
): boolean {
  if (!input.secret || !input.signature) {
    return false;
  }

  const provided = input.signature.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", input.secret)
    .update(input.body)
    .digest("base64url");

  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function normalizeEmailEngineWebhook(
  payload: unknown,
  options: NormalizeEmailEngineWebhookOptions = {},
): NormalizedMailEngineEvent[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const eventName = readString(root.event) ?? "unknown";
  const deliveryEventId =
    readString(root.eventId) ??
    readString(data.eventId);
  const knownKind = eventKindByName[eventName];
  const kind = knownKind ?? "unknown_notification";
  const accountId = readString(root.account) ?? readString(data.account);
  const mailboxId =
    readString(root.path) ??
    readString(root.mailbox) ??
    readString(data.path) ??
    readString(data.mailbox);
  const providerMessageId =
    readString(root.message) ??
    readString(data.id) ??
    readString(data.message) ??
    readString(root.id);
  const providerThreadId =
    readString(root.threadId) ??
    readString(root.thread) ??
    readString(data.threadId) ??
    readString(data.thread);
  const providerEmailId = readString(root.emailId) ?? readString(data.emailId);
  const rfcMessageId =
    readString(root.messageId) ?? readString(data.messageId);
  const providerUid = readStringOrNumber(root.uid) ?? readStringOrNumber(data.uid);
  const providerPath = mailboxId;
  const resourceKey = buildResourceKey({
    accountId,
    providerEmailId,
    rfcMessageId,
    providerMessageId,
    providerUid,
    providerPath,
  });
  const resourceIdentity = buildResourceIdentity({
    providerMessageId,
    providerEmailId,
    rfcMessageId,
    providerUid,
    providerPath,
    providerThreadId,
    resourceKey,
  });

  return [
    compactEvent({
      source: "emailengine_webhook",
      kind,
      accountId,
      mailboxId,
      providerMessageId,
      providerThreadId,
      providerEmailId,
      rfcMessageId,
      providerUid,
      providerPath,
      resourceKey,
      resourceIdentity,
      providerEventName: knownKind ? undefined : eventName,
      idempotencyKey: buildIdempotencyKey(
        accountId,
        eventName,
        providerMessageId ?? rfcMessageId ?? eventName,
        payload,
        deliveryEventId,
      ),
    }),
  ];
}

export function verifyEmailEngineWebhookFreshness(
  input: VerifyEmailEngineWebhookFreshnessInput,
): EmailEngineWebhookFreshnessResult {
  const root = asRecord(input.payload);
  const eventDate = readString(root.date);
  if (!eventDate) {
    return { ok: false, reason: "missing_date" };
  }

  const eventTimestamp = Date.parse(eventDate);
  if (!Number.isFinite(eventTimestamp)) {
    return { ok: false, reason: "invalid_date" };
  }

  const now = input.now ?? new Date();
  const maxSkewMs = input.maxSkewMs ?? DEFAULT_EMAILENGINE_WEBHOOK_MAX_SKEW_MS;
  if (Math.abs(now.getTime() - eventTimestamp) > maxSkewMs) {
    return { ok: false, reason: "outside_window" };
  }

  return { ok: true, date: eventDate };
}

function buildIdempotencyKey(
  accountId: string | undefined,
  eventName: string,
  uniqueEventPart: string | undefined,
  payload: unknown,
  deliveryEventId?: string,
): string {
  const safeAccount = accountId ?? "no-account";
  if (deliveryEventId) {
    return `emailengine:${safeAccount}:event-id:${deliveryEventId}`;
  }

  return `emailengine:${safeAccount}:${eventName}:${
    uniqueEventPart ?? "no-message"
  }:${stablePayloadHash(payload)}`;
}

interface BuildResourceKeyInput {
  accountId?: string;
  providerEmailId?: string;
  rfcMessageId?: string;
  providerMessageId?: string;
  providerUid?: string;
  providerPath?: string;
}

function buildResourceKey(input: BuildResourceKeyInput): string | undefined {
  const safeAccount = input.accountId ?? "no-account";

  if (input.providerEmailId) {
    return `emailengine:${safeAccount}:emailId:${input.providerEmailId}`;
  }

  if (input.rfcMessageId) {
    return `emailengine:${safeAccount}:messageId:${input.rfcMessageId}`;
  }

  if (input.providerMessageId) {
    return `emailengine:${safeAccount}:id:${input.providerMessageId}`;
  }

  if (input.providerPath && input.providerUid) {
    return `emailengine:${safeAccount}:uid:${input.providerPath}:${input.providerUid}`;
  }

  return undefined;
}

interface BuildResourceIdentityInput {
  providerMessageId?: string;
  providerEmailId?: string;
  rfcMessageId?: string;
  providerUid?: string;
  providerPath?: string;
  providerThreadId?: string;
  resourceKey?: string;
}

function buildResourceIdentity(
  input: BuildResourceIdentityInput,
): MailEngineResourceIdentity | undefined {
  const identity = {
    ...(input.providerMessageId
      ? { emailengineMessageId: input.providerMessageId }
      : {}),
    ...(input.providerEmailId
      ? { emailengineEmailId: input.providerEmailId }
      : {}),
    ...(input.rfcMessageId ? { internetMessageId: input.rfcMessageId } : {}),
    ...(input.providerUid ? { imapUid: input.providerUid } : {}),
    ...(input.providerPath ? { mailboxPath: input.providerPath } : {}),
    ...(input.providerThreadId ? { threadId: input.providerThreadId } : {}),
    ...(input.resourceKey ? { resourceKey: input.resourceKey } : {}),
  };

  return Object.keys(identity).length > 0 ? identity : undefined;
}

function compactEvent(
  event: NormalizedMailEngineEvent,
): NormalizedMailEngineEvent {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  ) as NormalizedMailEngineEvent;
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringOrNumber(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return readString(value);
}

function stablePayloadHash(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
