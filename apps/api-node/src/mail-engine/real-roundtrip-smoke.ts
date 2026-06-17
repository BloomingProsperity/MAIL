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

export interface RunEmailEngineSendSmokeInput {
  apiBaseUrl: string;
  payload: ImapSmtpOnboardingInput;
  recipientPayload?: ImapSmtpOnboardingInput;
  fetchImpl?: typeof fetch;
  runOnboarding?: (
    input: RunImapSmtpOnboardingSmokeInput,
  ) => Promise<ImapSmtpOnboardingSmokeResult>;
  createUniqueId?: () => string;
  now?: () => Date;
  delayMs?: (ms: number) => Promise<void>;
  pollAttempts?: number;
  pollMs?: number;
  initialSyncReadyAttempts?: number;
  initialSyncReadyPollMs?: number;
  reuseExistingReadyAccount?: boolean;
}

export interface EmailEngineSendSmokeResult {
  ok: true;
  smoke: "emailengine_send";
  apiBaseUrl: string;
  email: string;
  provider: string;
  accountId: string;
  senderEmail: string;
  senderAccountId: string;
  recipientEmail: string;
  recipientAccountId: string;
  draftId: string;
  sendAction: string;
  readModelMessageId: string;
  readModelSubject: string;
  readModelReceivedAt: string;
}

export interface RunEmailEngineAttachmentDownloadSmokeInput {
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

export interface EmailEngineAttachmentDownloadSmokeResult {
  ok: true;
  smoke: "emailengine_attachment_download";
  apiBaseUrl: string;
  email: string;
  provider: string;
  accountId: string;
  deliveredMessageId: string;
  readModelMessageId: string;
  readModelSubject: string;
  attachmentId: string;
  attachmentFilename: string;
  attachmentContentType: string;
  downloadedBytes: number;
}

interface SmokeAccountInput {
  apiBaseUrl: string;
  payload: ImapSmtpOnboardingInput;
  fetchImpl: typeof fetch;
  runOnboarding: (
    input: RunImapSmtpOnboardingSmokeInput,
  ) => Promise<ImapSmtpOnboardingSmokeResult>;
  reuseExistingReadyAccount: boolean;
  initialSyncReadyAttempts: number;
  initialSyncReadyPollMs: number;
  pollMs: number;
  delayMs: (ms: number) => Promise<void>;
}

interface MessageListEntry {
  id: string;
  accountId: string;
  subject: string;
  receivedAt: string;
}

interface ExpectedMessage {
  message: MessageListEntry;
  detail: Record<string, unknown>;
}

export async function runEmailEngineSendSmoke(
  input: RunEmailEngineSendSmokeInput,
): Promise<EmailEngineSendSmokeResult> {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const uniqueId = (input.createUniqueId ?? randomUUID)();
  const subject = `[EmailHub Send Smoke] ${uniqueId}`;
  const runOnboarding = input.runOnboarding ?? runImapSmtpOnboardingSmoke;
  const sender = await prepareSmokeAccount({
    apiBaseUrl,
    payload: input.payload,
    fetchImpl,
    runOnboarding,
    reuseExistingReadyAccount: input.reuseExistingReadyAccount ?? true,
    initialSyncReadyAttempts: input.initialSyncReadyAttempts ?? 0,
    initialSyncReadyPollMs:
      input.initialSyncReadyPollMs ?? input.pollMs ?? 2000,
    pollMs: input.pollMs ?? 2000,
    delayMs: input.delayMs ?? defaultDelay,
  });
  const recipient = sameMailbox(input.payload, input.recipientPayload)
    ? sender
    : await prepareSmokeAccount({
        apiBaseUrl,
        payload: input.recipientPayload ?? input.payload,
        fetchImpl,
        runOnboarding,
        reuseExistingReadyAccount: input.reuseExistingReadyAccount ?? true,
        initialSyncReadyAttempts: input.initialSyncReadyAttempts ?? 0,
        initialSyncReadyPollMs:
          input.initialSyncReadyPollMs ?? input.pollMs ?? 2000,
        pollMs: input.pollMs ?? 2000,
        delayMs: input.delayMs ?? defaultDelay,
      });
  const draft = await createDraft({
    apiBaseUrl,
    fetchImpl,
    accountId: sender.accountId,
    to: recipient.email,
    subject,
    bodyText: [
      "Email Hub EmailEngine send smoke.",
      `uniqueId=${uniqueId}`,
      `senderAccountId=${sender.accountId}`,
      `recipientAccountId=${recipient.accountId}`,
    ].join("\n"),
  });
  const send = await sendDraft({
    apiBaseUrl,
    fetchImpl,
    accountId: sender.accountId,
    draftId: draft.id,
  });
  const observed = await waitForExpectedMessage({
    apiBaseUrl,
    fetchImpl,
    accountId: recipient.accountId,
    subject,
    uniqueId,
    attempts: input.pollAttempts ?? 60,
    pollMs: input.pollMs ?? 2000,
    delayMs: input.delayMs ?? defaultDelay,
    errorPrefix: "EmailEngine send smoke",
  });

  return {
    ok: true,
    smoke: "emailengine_send",
    apiBaseUrl,
    email: sender.email,
    provider: sender.provider,
    accountId: sender.accountId,
    senderEmail: sender.email,
    senderAccountId: sender.accountId,
    recipientEmail: recipient.email,
    recipientAccountId: recipient.accountId,
    draftId: draft.id,
    sendAction: send.action,
    readModelMessageId: observed.message.id,
    readModelSubject: observed.message.subject,
    readModelReceivedAt: observed.message.receivedAt,
  };
}

function sameMailbox(
  left: ImapSmtpOnboardingInput,
  right: ImapSmtpOnboardingInput | undefined,
): boolean {
  return !right || (
    left.email.trim().toLowerCase() === right.email.trim().toLowerCase() &&
    left.provider.trim().toLowerCase() === right.provider.trim().toLowerCase()
  );
}

export async function runEmailEngineAttachmentDownloadSmoke(
  input: RunEmailEngineAttachmentDownloadSmokeInput,
): Promise<EmailEngineAttachmentDownloadSmokeResult> {
  const apiBaseUrl = normalizeApiBaseUrl(input.apiBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const runOnboarding = input.runOnboarding ?? runImapSmtpOnboardingSmoke;
  const sendMessage = input.sendMessage ?? sendSmtpSmokeMessage;
  const uniqueId = (input.createUniqueId ?? randomUUID)();
  const subject = `[EmailHub Attachment Smoke] ${uniqueId}`;
  const attachmentFilename = `emailhub-smoke-${uniqueId}.txt`;
  const attachmentContent = `Email Hub attachment smoke uniqueId=${uniqueId}\n`;
  const account = await prepareSmokeAccount({
    apiBaseUrl,
    payload: input.payload,
    fetchImpl,
    runOnboarding,
    reuseExistingReadyAccount: input.reuseExistingReadyAccount ?? true,
    initialSyncReadyAttempts: input.initialSyncReadyAttempts ?? 0,
    initialSyncReadyPollMs:
      input.initialSyncReadyPollMs ?? input.pollMs ?? 2000,
    pollMs: input.pollMs ?? 2000,
    delayMs: input.delayMs ?? defaultDelay,
  });
  const delivery = await sendMessage({
    host: input.deliverySmtp.host,
    port: input.deliverySmtp.port,
    secure: input.deliverySmtp.secure ?? false,
    from: input.deliverySmtp.from ?? "emailhub-smoke@example.com",
    to: account.email,
    messageId: `emailhub-attachment-${uniqueId}@emailhub-smoke.local`,
    subject,
    text: [
      "Email Hub EmailEngine attachment smoke.",
      `uniqueId=${uniqueId}`,
      `accountId=${account.accountId}`,
    ].join("\n"),
    attachments: [
      {
        filename: attachmentFilename,
        contentType: "text/plain",
        content: attachmentContent,
      },
    ],
  });
  const observed = await waitForExpectedMessage({
    apiBaseUrl,
    fetchImpl,
    accountId: account.accountId,
    subject,
    uniqueId,
    attempts: input.pollAttempts ?? 60,
    pollMs: input.pollMs ?? 2000,
    delayMs: input.delayMs ?? defaultDelay,
    errorPrefix: "EmailEngine attachment download smoke",
  });
  const attachment = findAttachment(observed.detail, attachmentFilename);
  const download = await downloadAttachment({
    apiBaseUrl,
    fetchImpl,
    accountId: account.accountId,
    attachmentId: attachment.id,
  });
  if (download.text !== attachmentContent) {
    throw new Error(
      "EmailEngine attachment download smoke downloaded different attachment bytes",
    );
  }

  return {
    ok: true,
    smoke: "emailengine_attachment_download",
    apiBaseUrl,
    email: account.email,
    provider: account.provider,
    accountId: account.accountId,
    deliveredMessageId: delivery.messageId,
    readModelMessageId: observed.message.id,
    readModelSubject: observed.message.subject,
    attachmentId: attachment.id,
    attachmentFilename: attachment.filename,
    attachmentContentType: download.contentType ?? attachment.contentType,
    downloadedBytes: Buffer.byteLength(download.text),
  };
}

async function prepareSmokeAccount(
  input: SmokeAccountInput,
): Promise<ImapSmtpOnboardingSmokeResult> {
  const account =
    (input.reuseExistingReadyAccount
      ? await readReusableExistingAccount({
          apiBaseUrl: input.apiBaseUrl,
          fetchImpl: input.fetchImpl,
          email: input.payload.email,
          provider: input.payload.provider,
        })
      : undefined) ??
    (await input.runOnboarding({
      apiBaseUrl: input.apiBaseUrl,
      payload: input.payload,
      fetchImpl: input.fetchImpl,
    }));

  await waitForInitialSyncReady({
    apiBaseUrl: input.apiBaseUrl,
    fetchImpl: input.fetchImpl,
    accountId: account.accountId,
    syncJobId: account.syncJobId,
    attempts: input.initialSyncReadyAttempts,
    pollMs: input.initialSyncReadyPollMs,
    delayMs: input.delayMs,
  });

  return account;
}

async function createDraft(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  to: string;
  subject: string;
  bodyText: string;
}): Promise<{ id: string }> {
  const response = await postJson(
    input.fetchImpl,
    `${input.apiBaseUrl}/api/accounts/${encodeURIComponent(
      input.accountId,
    )}/compose/drafts`,
    {
      to: [{ address: input.to }],
      cc: [],
      bcc: [],
      subject: input.subject,
      bodyText: input.bodyText,
      source: "manual",
    },
  );
  if (response.status !== 201) {
    throw new Error(
      `EmailEngine send smoke draft creation returned ${response.status}: ${JSON.stringify(
        response.body,
      )}`,
    );
  }

  return { id: readRequiredString(asRecord(response.body), "id") };
}

async function sendDraft(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  draftId: string;
}): Promise<{ action: string }> {
  const response = await postJson(
    input.fetchImpl,
    `${input.apiBaseUrl}/api/accounts/${encodeURIComponent(
      input.accountId,
    )}/compose/drafts/${encodeURIComponent(input.draftId)}/send`,
    undefined,
  );
  const body = asRecord(response.body);
  if (
    response.status !== 202 ||
    readRequiredString(body, "action") !== "draft_send_queued"
  ) {
    throw new Error(
      `EmailEngine send smoke draft send returned ${response.status}: ${JSON.stringify(
        response.body,
      )}`,
    );
  }

  return { action: "draft_send_queued" };
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
    `EmailEngine smoke initial sync job ${input.syncJobId} for ${input.accountId} did not reach done after ${attempts} polls; latest status ${latestStatus}`,
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
      `EmailEngine smoke sync center returned ${response.status}: ${JSON.stringify(
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
      `EmailEngine smoke sync center returned ${response.status}: ${JSON.stringify(
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

async function waitForExpectedMessage(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  subject: string;
  uniqueId: string;
  attempts: number;
  pollMs: number;
  delayMs: (ms: number) => Promise<void>;
  errorPrefix: string;
}): Promise<ExpectedMessage> {
  const attempts = Math.max(1, input.attempts);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const message = await findMessageInReadModel(input);
    if (message) {
      const detail = await readMessageDetail({
        ...input,
        messageId: message.id,
      });
      if (isExpectedMessageDetail(detail, input)) {
        return { message, detail: detail! };
      }
    }
    if (attempt < attempts) {
      await input.delayMs(input.pollMs);
    }
  }

  throw new Error(
    `${input.errorPrefix} did not observe ${input.subject} in the mail read model for ${input.accountId} after ${attempts} polls`,
  );
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
      `EmailEngine smoke mail read list returned ${response.status}: ${JSON.stringify(
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
      `EmailEngine smoke mail read detail returned ${response.status}: ${JSON.stringify(
        body,
      )}`,
    );
  }

  return asRecord(body);
}

function findAttachment(
  detail: Record<string, unknown>,
  filename: string,
): { id: string; filename: string; contentType: string } {
  const attachment = readArray(detail.attachments)
    .map(asRecord)
    .find((item) => readString(item.filename) === filename);
  if (!attachment) {
    throw new Error(
      `EmailEngine attachment download smoke did not observe attachment ${filename}`,
    );
  }

  return {
    id: readRequiredString(attachment, "id"),
    filename: readRequiredString(attachment, "filename"),
    contentType: readRequiredString(attachment, "contentType"),
  };
}

async function downloadAttachment(input: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  accountId: string;
  attachmentId: string;
}): Promise<{ text: string; contentType?: string }> {
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/accounts/${encodeURIComponent(
      input.accountId,
    )}/attachments/${encodeURIComponent(input.attachmentId)}/download`,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `EmailEngine attachment download smoke returned ${response.status}: ${text}`,
    );
  }

  return {
    text,
    ...(response.headers.get("content-type")
      ? { contentType: response.headers.get("content-type")! }
      : {}),
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return { status: response.status, body: await response.json() };
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

function readRequiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`EmailEngine smoke response is missing ${key}`);
  }

  return value;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
