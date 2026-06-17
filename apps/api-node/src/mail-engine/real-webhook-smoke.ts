import { randomUUID } from "node:crypto";
import { setTimeout as defaultDelay } from "node:timers/promises";

import type { ImapSmtpOnboardingInput } from "../accounts/imap-smtp-onboarding.js";
import {
  runImapSmtpOnboardingSmoke,
  type ImapSmtpOnboardingSmokeResult,
  type RunImapSmtpOnboardingSmokeInput,
} from "../accounts/imap-smtp-onboarding-smoke.js";
import {
  sendSmtpSmokeMessage,
  type SendSmtpSmokeMessageInput,
  type SmtpSmokeDeliveryResult,
} from "./greenmail-smtp-smoke.js";
import { safeSmokeBodySummary } from "./smoke-error.js";

export interface RunEmailEngineRealWebhookSmokeInput {
  apiBaseUrl: string;
  payload: ImapSmtpOnboardingInput;
  deliverySmtp: {
    host: string;
    port: number;
    secure?: boolean;
    from?: string;
  };
  fetchImpl?: typeof fetch;
  runOnboarding?: (
    input: RunImapSmtpOnboardingSmokeInput,
  ) => Promise<ImapSmtpOnboardingSmokeResult>;
  sendMessage?: (
    input: SendSmtpSmokeMessageInput,
  ) => Promise<SmtpSmokeDeliveryResult>;
  createUniqueId?: () => string;
  now?: () => Date;
  delayMs?: (ms: number) => Promise<void>;
  pollAttempts?: number;
  pollMs?: number;
  initialSyncReadyAttempts?: number;
  initialSyncReadyPollMs?: number;
  reuseExistingReadyAccount?: boolean;
}

export interface EmailEngineRealWebhookSmokeResult {
  ok: true;
  smoke: "emailengine_real_webhook";
  apiBaseUrl: string;
  email: string;
  provider: string;
  accountId: string;
  initialSyncJobId: string;
  deliveredMessageId: string;
  deliveryObservation: "message_upserted_webhook" | "read_model_sync";
  diagnosticEventId: string;
  diagnosticEventKind: string;
  readModelMessageId: string;
  readModelSubject: string;
  readModelReceivedAt: string;
  webhookSyncJobId?: string;
}

interface OperationalEventEntry {
  id: string;
  occurredAt?: string;
  service?: string;
  level?: string;
  accountId?: string;
  lane?: string;
  event?: string;
  jobId?: string;
  context: Record<string, unknown>;
}

export async function runEmailEngineRealWebhookSmoke(
  input: RunEmailEngineRealWebhookSmokeInput,
): Promise<EmailEngineRealWebhookSmokeResult> {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const runOnboarding = input.runOnboarding ?? runImapSmtpOnboardingSmoke;
  const sendMessage = input.sendMessage ?? sendSmtpSmokeMessage;
  const uniqueId = (input.createUniqueId ?? randomUUID)();
  const now = input.now ?? (() => new Date());
  const messageId = `emailhub-real-webhook-${uniqueId}@emailhub-smoke.local`;
  const subject = `[EmailHub Real Webhook Smoke] ${uniqueId}`;

  const onboarding =
    (input.reuseExistingReadyAccount
      ? await readReusableExistingAccount({
          apiBaseUrl,
          fetchImpl,
          email: input.payload.email,
          provider: input.payload.provider,
        })
      : undefined) ??
    (await runOnboarding({
      apiBaseUrl,
      payload: input.payload,
      fetchImpl,
    }));
  await waitForInitialSyncReady({
    apiBaseUrl,
    fetchImpl,
    accountId: onboarding.accountId,
    syncJobId: onboarding.syncJobId,
    attempts: input.initialSyncReadyAttempts ?? 0,
    pollMs: input.initialSyncReadyPollMs ?? input.pollMs ?? 2000,
    delayMs: input.delayMs ?? defaultDelay,
  });

  const deliveryStartedAt = now().toISOString();
  const delivery = await sendMessage({
    host: input.deliverySmtp.host,
    port: input.deliverySmtp.port,
    secure: input.deliverySmtp.secure ?? false,
    from: input.deliverySmtp.from ?? "emailhub-smoke@example.com",
    to: onboarding.email,
    messageId,
    subject,
    text: [
      "Email Hub real webhook smoke.",
      `uniqueId=${uniqueId}`,
      `accountId=${onboarding.accountId}`,
    ].join("\n"),
  });

  const observation = await waitForDeliveredMessageObservation({
    apiBaseUrl,
    fetchImpl,
    accountId: onboarding.accountId,
    notBefore: deliveryStartedAt,
    expectedRfcMessageId: delivery.messageId,
    subject,
    uniqueId,
    attempts: input.pollAttempts ?? 30,
    pollMs: input.pollMs ?? 2000,
    delayMs: input.delayMs ?? defaultDelay,
  });
  const diagnosticEventKind =
    readString(observation.diagnostic.context.mailEngineEventKind) ??
    "unknown_notification";
  const webhookSyncJobId =
    observation.diagnostic.jobId ??
    readString(observation.diagnostic.context.syncJobId);

  return {
    ok: true,
    smoke: "emailengine_real_webhook",
    apiBaseUrl,
    email: onboarding.email,
    provider: onboarding.provider,
    accountId: onboarding.accountId,
    initialSyncJobId: onboarding.syncJobId,
    deliveredMessageId: delivery.messageId,
    deliveryObservation: observation.deliveryObservation,
    diagnosticEventId: observation.diagnostic.id,
    diagnosticEventKind,
    readModelMessageId: observation.readModelMessage.id,
    readModelSubject: observation.readModelMessage.subject,
    readModelReceivedAt: observation.readModelMessage.receivedAt,
    ...(webhookSyncJobId ? { webhookSyncJobId } : {}),
  };
}

interface DeliveredMessageObservation {
  deliveryObservation: "message_upserted_webhook" | "read_model_sync";
  diagnostic: OperationalEventEntry;
  readModelMessage: MessageListEntry;
}

async function waitForInitialSyncReady(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  syncJobId: string;
  attempts: number;
  pollMs: number;
  delayMs: (ms: number) => Promise<void>;
}): Promise<void> {
  const attempts = Math.max(0, input.attempts);
  if (attempts === 0) {
    return;
  }

  let latestStatus = "missing";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = await readInitialSyncJobStatus(input);
    latestStatus = status ?? "missing";
    if (status === "done") {
      return;
    }

    if (attempt < attempts) {
      await input.delayMs(input.pollMs);
    }
  }

  throw new Error(
    `EmailEngine real webhook smoke initial sync job ${input.syncJobId} for ${input.accountId} did not reach done after ${attempts} polls; latest status ${latestStatus}`,
  );
}

async function readReusableExistingAccount(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  email: string;
  provider: string;
}): Promise<ImapSmtpOnboardingSmokeResult | undefined> {
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/sync-center/accounts`,
  );
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `EmailEngine real webhook smoke sync center returned ${response.status}: ${safeSmokeBodySummary(
        body,
      )}`,
    );
  }

  const account = readArray(asRecord(body).items)
    .map(asRecord)
    .find(
      (item) =>
        readString(item.email) === input.email &&
        readString(item.provider) === input.provider &&
        readString(item.engineProvider) === "emailengine" &&
        item.reauthRequired !== true,
    );
  if (!account) {
    return undefined;
  }

  const latestSyncJob = asRecord(account.latestSyncJob);
  const syncJobId = readString(latestSyncJob.id);
  const syncJobStatus = readString(latestSyncJob.status);
  const accountId = readString(account.accountId);
  if (!accountId || !syncJobId || !syncJobStatus) {
    return undefined;
  }

  return {
    email: input.email,
    provider: input.provider,
    accountId,
    syncJobId,
    syncJobStatus,
  };
}

async function readInitialSyncJobStatus(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  syncJobId: string;
}): Promise<string | undefined> {
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/sync-center/accounts`,
  );
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `EmailEngine real webhook smoke sync center returned ${response.status}: ${safeSmokeBodySummary(
        body,
      )}`,
    );
  }

  const account = readArray(asRecord(body).items)
    .map(asRecord)
    .find((item) => readString(item.accountId) === input.accountId);
  const latestSyncJob = asRecord(account?.latestSyncJob);
  if (readString(latestSyncJob.id) !== input.syncJobId) {
    return undefined;
  }

  return readString(latestSyncJob.status);
}

async function waitForDeliveredMessageObservation(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  notBefore: string;
  expectedRfcMessageId: string;
  subject: string;
  uniqueId: string;
  attempts: number;
  pollMs: number;
  delayMs: (ms: number) => Promise<void>;
}): Promise<DeliveredMessageObservation> {
  const attempts = Math.max(1, input.attempts);
  let sawCurrentWebhookDiagnostic = false;
  let sawExpectedReadModelMessage = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const page = await readDiagnostics(input);
    const messageDiagnostic = page.find((entry) =>
      isMessageUpsertedDiagnostic(
        entry,
        input.accountId,
        input.notBefore,
        input.expectedRfcMessageId,
      ),
    );
    const accountDiagnostic = page.find((entry) =>
      isCurrentAccountWebhookDiagnostic(
        entry,
        input.accountId,
        input.notBefore,
      ),
    );
    const readModelMessage = await findExpectedMessageInReadModel(input);

    sawCurrentWebhookDiagnostic =
      sawCurrentWebhookDiagnostic ||
      Boolean(messageDiagnostic ?? accountDiagnostic);
    sawExpectedReadModelMessage =
      sawExpectedReadModelMessage || Boolean(readModelMessage);

    if (readModelMessage && messageDiagnostic) {
      return {
        deliveryObservation: "message_upserted_webhook",
        diagnostic: messageDiagnostic,
        readModelMessage,
      };
    }

    if (readModelMessage && accountDiagnostic) {
      return {
        deliveryObservation: "read_model_sync",
        diagnostic: accountDiagnostic,
        readModelMessage,
      };
    }

    if (attempt < attempts) {
      await input.delayMs(input.pollMs);
    }
  }

  if (!sawExpectedReadModelMessage) {
    throw new Error(
      `EmailEngine real webhook smoke did not observe ${input.subject} in the mail read model for ${input.accountId} after ${attempts} polls`,
    );
  }

  if (!sawCurrentWebhookDiagnostic) {
    throw new Error(
      `EmailEngine real webhook smoke did not observe a current EmailEngine webhook diagnostic for ${input.accountId} after ${attempts} diagnostics polls`,
    );
  }

  throw new Error(
    `EmailEngine real webhook smoke did not observe ${input.subject} with a current EmailEngine webhook diagnostic for ${input.accountId} after ${attempts} polls`,
  );
}

async function readDiagnostics(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
}): Promise<OperationalEventEntry[]> {
  const url = `${input.apiBaseUrl}/api/diagnostics/events?service=email-hub-api&event=emailengine_webhook_ingested&accountId=${encodeURIComponent(
    input.accountId,
  )}&lane=sync&limit=50`;
  const response = await input.fetchImpl(url);
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `EmailEngine real webhook smoke diagnostics returned ${response.status}: ${safeSmokeBodySummary(
        body,
      )}`,
    );
  }

  return readArray(asRecord(body).items).map((item) => {
    const record = asRecord(item);
    return {
      id: readString(record.id) ?? "",
      ...optionalString("occurredAt", record.occurredAt),
      ...optionalString("service", record.service),
      ...optionalString("level", record.level),
      ...optionalString("accountId", record.accountId),
      ...optionalString("lane", record.lane),
      ...optionalString("event", record.event),
      ...optionalString("jobId", record.jobId),
      context: asRecord(record.context),
    };
  });
}

interface MessageListEntry {
  id: string;
  accountId: string;
  subject: string;
  receivedAt: string;
}

async function findExpectedMessageInReadModel(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  subject: string;
  uniqueId: string;
}): Promise<MessageListEntry | undefined> {
  const message = await findMessageInReadModel(input);
  if (!message) {
    return undefined;
  }

  const detail = await readMessageDetail({
    ...input,
    messageId: message.id,
  });

  return isExpectedMessageDetail(detail, input) ? message : undefined;
}

async function findMessageInReadModel(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  subject: string;
  uniqueId: string;
}): Promise<MessageListEntry | undefined> {
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/accounts/${encodeURIComponent(
      input.accountId,
    )}/messages?limit=10&q=${encodeURIComponent(
      input.uniqueId,
    )}&qScope=subject`,
  );
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `EmailEngine real webhook smoke mail read list returned ${response.status}: ${safeSmokeBodySummary(
        body,
      )}`,
    );
  }

  return readArray(asRecord(body).items)
    .map(readMessageListEntry)
    .find(
      (message): message is MessageListEntry =>
        message !== undefined &&
        message.accountId === input.accountId &&
        message.subject === input.subject,
    );
}

async function readMessageDetail(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  messageId: string;
}): Promise<Record<string, unknown> | undefined> {
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/accounts/${encodeURIComponent(
      input.accountId,
    )}/messages/${encodeURIComponent(input.messageId)}`,
  );
  const body = (await response.json()) as unknown;
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(
      `EmailEngine real webhook smoke mail read detail returned ${response.status}: ${safeSmokeBodySummary(
        body,
      )}`,
    );
  }

  return asRecord(body);
}

function readMessageListEntry(value: unknown): MessageListEntry | undefined {
  const record = asRecord(value);
  const id = readString(record.id);
  const accountId = readString(record.accountId);
  const subject = readString(record.subject);
  const receivedAt = readString(record.receivedAt);

  return id && accountId && subject && receivedAt
    ? { id, accountId, subject, receivedAt }
    : undefined;
}

function isExpectedMessageDetail(
  detail: Record<string, unknown> | undefined,
  expected: {
    accountId: string;
    subject: string;
    uniqueId: string;
  },
): boolean {
  if (!detail) {
    return false;
  }

  const bodyText = readString(detail.bodyText);
  const bodyHtml = readString(detail.bodyHtml);
  const snippet = readString(detail.snippet);
  const searchableText = [bodyText, bodyHtml, snippet].filter(Boolean).join("\n");

  return (
    readString(detail.accountId) === expected.accountId &&
    readString(detail.subject) === expected.subject &&
    (searchableText.length === 0 || searchableText.includes(expected.uniqueId))
  );
}

function isMessageUpsertedDiagnostic(
  event: OperationalEventEntry,
  accountId: string,
  notBefore: string,
  expectedRfcMessageId: string,
): boolean {
  const syncJobId = readString(event.context.syncJobId);
  const idempotencyKey = readString(event.context.mailEngineIdempotencyKey);
  const resourceIdentity = asRecord(event.context.resourceIdentity);
  const rfcMessageId =
    readString(event.context.rfcMessageId) ??
    readString(resourceIdentity.internetMessageId);

  return (
    event.service === "email-hub-api" &&
    event.level === "info" &&
    event.event === "emailengine_webhook_ingested" &&
    event.accountId === accountId &&
    event.lane === "sync" &&
    isAtOrAfter(event.occurredAt, notBefore) &&
    readString(event.jobId) !== undefined &&
    event.context.duplicate === false &&
    readString(event.context.mailEngineEventId) !== undefined &&
    readString(event.context.mailEngineEventKind) === "message_upserted" &&
    rfcMessageId === expectedRfcMessageId &&
    readString(event.context.syncJobType) === "sync_account" &&
    syncJobId === event.jobId &&
    Boolean(idempotencyKey?.startsWith(`emailengine:${accountId}:`))
  );
}

function isCurrentAccountWebhookDiagnostic(
  event: OperationalEventEntry,
  accountId: string,
  notBefore: string,
): boolean {
  const syncJobId = readString(event.context.syncJobId);
  const idempotencyKey = readString(event.context.mailEngineIdempotencyKey);

  return (
    event.service === "email-hub-api" &&
    event.level === "info" &&
    event.event === "emailengine_webhook_ingested" &&
    event.accountId === accountId &&
    event.lane === "sync" &&
    isAtOrAfter(event.occurredAt, notBefore) &&
    readString(event.jobId) !== undefined &&
    event.context.duplicate === false &&
    readString(event.context.mailEngineEventId) !== undefined &&
    readString(event.context.mailEngineEventKind) !== undefined &&
    readString(event.context.syncJobType) === "sync_account" &&
    syncJobId === event.jobId &&
    Boolean(idempotencyKey?.startsWith(`emailengine:${accountId}:`))
  );
}

function isAtOrAfter(value: string | undefined, floor: string): boolean {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  const floorTimestamp = Date.parse(floor);
  return Number.isFinite(timestamp) && Number.isFinite(floorTimestamp)
    ? timestamp >= floorTimestamp
    : false;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalString<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const stringValue = readString(value);
  return stringValue ? ({ [key]: stringValue } as Partial<Record<K, string>>) : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
