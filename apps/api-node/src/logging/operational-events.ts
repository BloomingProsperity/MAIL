import { randomUUID } from "node:crypto";

import { sanitizeLogFields } from "./logger.js";

export type OperationalEventLevel = "debug" | "info" | "warn" | "error";

export interface OperationalEventEntry {
  id: string;
  occurredAt: string;
  service: string;
  level: OperationalEventLevel;
  event: string;
  requestId?: string;
  accountId?: string;
  lane?: string;
  jobId?: string;
  message?: string;
  context: Record<string, unknown>;
}

export interface OperationalEventLogPage {
  items: OperationalEventEntry[];
}

export interface OperationalEventLogListInput {
  service?: string;
  level?: OperationalEventLevel;
  event?: string;
  requestId?: string;
  accountId?: string;
  lane?: string;
  jobId?: string;
  limit?: number;
}

export interface OperationalEventRecordInput {
  service: string;
  level: OperationalEventLevel;
  event: string;
  requestId?: string;
  accountId?: string;
  lane?: string;
  jobId?: string;
  message?: string;
  context?: Record<string, unknown>;
}

export interface OperationalEventStoreRecordInput
  extends OperationalEventRecordInput {
  id: string;
  occurredAt: string;
  context: Record<string, unknown>;
}

export interface OperationalEventLogStore {
  list(input: OperationalEventLogListInput): Promise<OperationalEventLogPage>;
  record(input: OperationalEventStoreRecordInput): Promise<OperationalEventEntry>;
}

export interface OperationalEventLogService {
  listEvents(input?: OperationalEventLogListInput): Promise<OperationalEventLogPage>;
  recordEvent(input: OperationalEventRecordInput): Promise<OperationalEventEntry>;
}

export class InvalidOperationalEventQueryError extends Error {
  readonly code = "invalid_operational_event_query";

  constructor() {
    super("Invalid operational event query");
  }
}

export function createOperationalEventLogService(input: {
  store: OperationalEventLogStore;
  createId?: () => string;
  now?: () => string;
}): OperationalEventLogService {
  const createId = input.createId ?? randomUUID;
  const now = input.now ?? (() => new Date().toISOString());

  return {
    async listEvents(rawInput = {}) {
      const page = await input.store.list(normalizeListInput(rawInput));
      return {
        items: page.items.map(sanitizeOperationalEventEntry),
      };
    },
    async recordEvent(rawInput) {
      return sanitizeOperationalEventEntry(
        await input.store.record(normalizeRecordInput(rawInput, createId(), now())),
      );
    },
  };
}

export function isOperationalEventLevel(
  value: string | undefined,
): value is OperationalEventLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function normalizeListInput(
  input: OperationalEventLogListInput,
): OperationalEventLogListInput {
  return {
    ...normalizeTextFilter("service", input.service),
    ...(input.level ? { level: input.level } : {}),
    ...normalizeTextFilter("event", input.event),
    ...normalizeTextFilter("requestId", input.requestId),
    ...normalizeTextFilter("accountId", input.accountId),
    ...normalizeTextFilter("lane", input.lane),
    ...normalizeTextFilter("jobId", input.jobId),
    limit: normalizeLimit(input.limit),
  };
}

function normalizeRecordInput(
  input: OperationalEventRecordInput,
  id: string,
  occurredAt: string,
): OperationalEventStoreRecordInput {
  return {
    id,
    occurredAt,
    ...requiredText("service", input.service),
    level: input.level,
    ...requiredText("event", input.event),
    ...normalizeTextFilter("requestId", input.requestId),
    ...normalizeTextFilter("accountId", input.accountId),
    ...normalizeTextFilter("lane", input.lane),
    ...normalizeTextFilter("jobId", input.jobId),
    ...normalizeTextFilter(
      "message",
      input.message ? sanitizeOperationalMessage(input.message) : undefined,
    ),
    context: sanitizeContext(input.context),
  };
}

function sanitizeOperationalEventEntry(
  item: OperationalEventEntry,
): OperationalEventEntry {
  return {
    ...item,
    ...(item.message
      ? { message: sanitizeOperationalMessage(item.message) }
      : {}),
    context: sanitizeContext(item.context),
  };
}

function requiredText<K extends string>(
  key: K,
  value: string,
): Record<K, string> {
  const normalized = normalizeTextFilter(key, value);
  if (!normalized[key]) {
    throw new InvalidOperationalEventQueryError();
  }

  return normalized as Record<K, string>;
}

function normalizeTextFilter<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  if (value === undefined) {
    return {};
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new InvalidOperationalEventQueryError();
  }

  return { [key]: trimmed } as Partial<Record<K, string>>;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidOperationalEventQueryError();
  }

  return Math.min(value, 200);
}

function sanitizeContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeOperationalContextValue(context ?? {}, undefined);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }

  return {};
}

const OPERATIONAL_CONTEXT_KEYS = new Set([
  "action",
  "accountId",
  "affected",
  "attempts",
  "authMethod",
  "authType",
  "category",
  "checks",
  "code",
  "commandId",
  "commandType",
  "diagnostics",
  "duplicate",
  "email",
  "endpointUrl",
  "error",
  "errorMessage",
  "finalCommandStatus",
  "finalJobStatus",
  "imap",
  "inputMode",
  "jobId",
  "laneName",
  "loginHint",
  "mailEngineEventId",
  "mailEngineEventKind",
  "mailEngineIdempotencyKey",
  "maxAttempts",
  "message",
  "missing",
  "model",
  "name",
  "nextRunAt",
  "ok",
  "provider",
  "providerEmailId",
  "providerEventName",
  "providerKey",
  "providerMessageId",
  "reason",
  "recoveryAction",
  "redirectPath",
  "result",
  "resourceIdentity",
  "resourceKey",
  "retriedJobCount",
  "retriedJobIds",
  "retryable",
  "rfcMessageId",
  "severity",
  "smtp",
  "status",
  "syncJobId",
  "syncJobType",
  "triggerEventId",
  "workerId",
]);

const SENSITIVE_CONTEXT_KEY =
  /authorization|cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pass$|subject$|body(?:text|html)?$|snippet$|sender(?:name)?$|threadtext$|prompt$|systemprompt$|userprompt$|providerpayload$|payload$|raw(?:body|html|text)?$|response$|input$|output$/i;
const SENSITIVE_MESSAGE_PATTERN =
  /authorization|cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|subject|body|snippet|sender|thread text|prompt|provider payload|payload|raw html|raw body|response|input|output/i;

function sanitizeOperationalMessage(value: string): string {
  return SENSITIVE_MESSAGE_PATTERN.test(value) ? "[redacted]" : value.slice(0, 512);
}

function sanitizeOperationalContextValue(
  value: unknown,
  key: string | undefined,
): unknown {
  if (key && SENSITIVE_CONTEXT_KEY.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    if (key === "message" || key === "errorMessage") {
      return sanitizeOperationalMessage(value);
    }

    const fieldKey = key ?? "value";
    const sanitized = sanitizeLogFields({ [fieldKey]: value });
    if (
      sanitized &&
      typeof sanitized === "object" &&
      !Array.isArray(sanitized) &&
      fieldKey in sanitized
    ) {
      return (sanitized as Record<string, unknown>)[fieldKey];
    }
    return value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeOperationalMessage(value.message),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOperationalContextValue(item, undefined));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!OPERATIONAL_CONTEXT_KEYS.has(entryKey)) {
        continue;
      }
      output[entryKey] = sanitizeOperationalContextValue(entryValue, entryKey);
    }
    return output;
  }

  return String(value);
}
