export interface HermesAuditLogEntry {
  id: string;
  accountId?: string;
  eventType: string;
  skillRunId?: string;
  skillId?: string;
  skillTitle?: string;
  readMessageIds: string[];
  memoryIds: string[];
  action: Record<string, unknown>;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  createdAt: string;
}

export interface HermesAuditLogPage {
  items: HermesAuditLogEntry[];
}

export interface HermesAuditLogListInput {
  accountId?: string;
  skillId?: string;
  messageId?: string;
  memoryId?: string;
  limit?: number;
}

export interface HermesAuditLogStoreListInput {
  accountId: string | undefined;
  skillId: string | undefined;
  messageId: string | undefined;
  memoryId: string | undefined;
  limit: number;
}

export interface HermesAuditLogStore {
  listAuditEvents(input: HermesAuditLogStoreListInput): Promise<HermesAuditLogPage>;
}

export interface HermesAuditLogService {
  listAuditEvents(input: HermesAuditLogListInput): Promise<HermesAuditLogPage>;
}

export class InvalidHermesAuditLogRequestError extends Error {
  readonly code = "invalid_hermes_audit_log_request";
}

export function createHermesAuditLogService(input: {
  store: HermesAuditLogStore;
}): HermesAuditLogService {
  return {
    async listAuditEvents(rawInput) {
      return input.store.listAuditEvents(normalizeListInput(rawInput));
    },
  };
}

function normalizeListInput(
  input: HermesAuditLogListInput,
): HermesAuditLogStoreListInput {
  return {
    accountId: normalizeOptionalText(input.accountId),
    skillId: normalizeOptionalText(input.skillId),
    messageId: normalizeOptionalText(input.messageId),
    memoryId: normalizeOptionalText(input.memoryId),
    limit: normalizeLimit(input.limit),
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed) || trimmed.length > 256) {
    throw new InvalidHermesAuditLogRequestError();
  }

  return trimmed;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidHermesAuditLogRequestError();
  }

  return Math.min(value, 100);
}
