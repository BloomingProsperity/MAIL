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
      return input.store.list(normalizeListInput(rawInput));
    },
    async recordEvent(rawInput) {
      return input.store.record(normalizeRecordInput(rawInput, createId(), now()));
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
    ...normalizeTextFilter("message", input.message),
    context: sanitizeContext(input.context),
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
  const sanitized = sanitizeLogFields(context ?? {});
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }

  return {};
}
