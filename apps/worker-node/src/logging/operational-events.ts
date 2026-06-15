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
          input.message ?? null,
          sanitizeContext(input.context),
        ],
      );
    },
  };
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
