import { randomUUID } from "node:crypto";

import { sanitizeLogFields } from "./logger.js";

export type OperationalEventLevel = "debug" | "info" | "warn" | "error";

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

export interface OperationalEventRecorder {
  record(input: OperationalEventRecordInput): Promise<void>;
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export function createPostgresOperationalEventRecorder(
  client: Queryable,
  options: {
    createId?: () => string;
    now?: () => string;
  } = {},
): OperationalEventRecorder {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async record(input) {
      await client.query(
        `
          INSERT INTO operational_events (
            id,
            occurred_at,
            service,
            level,
            event,
            request_id,
            account_id,
            lane,
            job_id,
            message,
            context
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          createId(),
          now(),
          input.service,
          input.level,
          input.event,
          input.requestId ?? null,
          input.accountId ?? null,
          input.lane ?? null,
          input.jobId ?? null,
          input.message ? sanitizeOperationalMessage(input.message) : null,
          sanitizeContext(input.context),
        ],
      );
    },
  };
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
