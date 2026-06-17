import { createHmac, randomUUID } from "node:crypto";

export interface BuildSmokeWebhookRequestInput {
  apiBaseUrl: string;
  secret: string;
  accountId?: string;
  eventName?: string;
  messageId?: string;
  eventId?: string;
  date?: string;
}

export interface SmokeWebhookRequest {
  url: string;
  init: RequestInit;
  body: string;
  eventId: string;
  accountId: string;
}

export interface AssertSmokeResponseInput {
  phase: "first" | "duplicate";
  status: number;
  body: unknown;
  accountId: string;
  eventId: string;
}

export interface RunEmailEngineWebhookSmokeInput {
  apiBaseUrl: string;
  secret: string;
  accountId?: string;
  eventName?: string;
  messageId?: string;
  eventId?: string;
  fetchImpl?: typeof fetch;
}

export interface EmailEngineWebhookSmokeResult {
  accountId: string;
  eventId: string;
  first: unknown;
  duplicate: unknown;
}

export const DEFAULT_EMAILENGINE_WEBHOOK_SMOKE_ACCOUNT_ID =
  "11111111-1111-4111-8111-111111111111";

export function buildSmokeWebhookRequest(
  input: BuildSmokeWebhookRequestInput,
): SmokeWebhookRequest {
  const accountId =
    input.accountId ?? DEFAULT_EMAILENGINE_WEBHOOK_SMOKE_ACCOUNT_ID;
  const eventName = input.eventName ?? "emailhubSmokeProbe";
  const messageId = input.messageId ?? `smoke_${randomUUID()}`;
  const eventId = input.eventId ?? `smoke_${randomUUID()}`;
  const date = input.date ?? new Date().toISOString();
  const body = JSON.stringify({
    date,
    event: eventName,
    account: accountId,
    path: "INBOX",
    data: {
      id: messageId,
      threadId: `thread_${messageId}`,
      messageId: `<${messageId}@emailhub-smoke.local>`,
    },
  });

  return {
    url: `${normalizeApiBaseUrl(input.apiBaseUrl)}/api/webhooks/emailengine`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ee-wh-event-id": eventId,
        "x-ee-wh-signature": sign(input.secret, body),
      },
      body,
    },
    body,
    eventId,
    accountId,
  };
}

export async function runEmailEngineWebhookSmoke(
  input: RunEmailEngineWebhookSmokeInput,
): Promise<EmailEngineWebhookSmokeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = buildSmokeWebhookRequest(input);
  const first = await postAndReadJson(fetchImpl, request);

  assertSmokeResponse({
    phase: "first",
    status: first.status,
    body: first.body,
    accountId: request.accountId,
    eventId: request.eventId,
  });

  const duplicate = await postAndReadJson(fetchImpl, request);

  assertSmokeResponse({
    phase: "duplicate",
    status: duplicate.status,
    body: duplicate.body,
    accountId: request.accountId,
    eventId: request.eventId,
  });

  return {
    accountId: request.accountId,
    eventId: request.eventId,
    first: first.body,
    duplicate: duplicate.body,
  };
}

export function assertSmokeResponse(input: AssertSmokeResponseInput): void {
  if (input.status !== 202) {
    throw new Error(`EmailEngine webhook smoke ${input.phase} returned ${input.status}`);
  }

  const body = asRecord(input.body);
  const events = readArray(body.events);
  const syncJobs = readArray(body.syncJobs);
  const event = events.find((item) => {
    const eventRecord = asRecord(item);
    const idempotencyKey = eventRecord.idempotencyKey;
    return (
      typeof idempotencyKey === "string" &&
      idempotencyKey.startsWith(`emailengine:${input.accountId}:`) &&
      eventRecord.accountId === input.accountId
    );
  });

  if (!event) {
    throw new Error(
      `EmailEngine webhook smoke ${input.phase} did not return the expected event`,
    );
  }

  if (input.phase === "first") {
    const expectedJobKey = `job:${asRecord(event).idempotencyKey}`;
    const job = syncJobs.find(
      (item) =>
        asRecord(item).idempotencyKey === expectedJobKey &&
        asRecord(item).accountId === input.accountId &&
        asRecord(item).status === "queued",
    );

    if (!job) {
      throw new Error("EmailEngine webhook smoke did not enqueue a sync job");
    }

    return;
  }

  if (Number(body.duplicateCount) < 1 || syncJobs.length !== 0) {
    throw new Error("EmailEngine webhook smoke duplicate delivery was not idempotent");
  }
}

async function postAndReadJson(
  fetchImpl: typeof fetch,
  request: SmokeWebhookRequest,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(request.url, request.init);

  return {
    status: response.status,
    body: await response.json(),
  };
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
