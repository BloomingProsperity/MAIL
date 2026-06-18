export interface HermesEmailSearchQaRouteInput {
  accountId?: string;
  mailboxId?: string;
  question: string;
  searchQuery?: string;
  language?: string;
  limit?: number;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export function parseHermesEmailSearchQaInput(
  body: string,
  routeAccountId: string | undefined,
  invalidRequest: () => Error,
): HermesEmailSearchQaRouteInput {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    mailboxId?: unknown;
    question?: unknown;
    searchQuery?: unknown;
    language?: unknown;
    limit?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.question)) {
    throw invalidRequest();
  }

  const accountId = parseAccountId(
    payload.accountId,
    routeAccountId,
    invalidRequest,
  );
  const readMessageIds = parseOptionalStringArray(
    payload.readMessageIds,
    invalidRequest,
  );
  const memoryIds = parseOptionalStringArray(payload.memoryIds, invalidRequest);
  const memoryLayers = parseOptionalStringArray(
    payload.memoryLayers,
    invalidRequest,
  );

  return {
    ...(accountId ? { accountId } : {}),
    ...(isNonEmptyString(payload.mailboxId) ? { mailboxId: payload.mailboxId } : {}),
    question: payload.question,
    ...(isNonEmptyString(payload.searchQuery)
      ? { searchQuery: payload.searchQuery }
      : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...(payload.limit !== undefined
      ? { limit: parseSearchLimit(payload.limit, invalidRequest) }
      : {}),
    ...(readMessageIds !== undefined ? { readMessageIds } : {}),
    ...(memoryIds !== undefined ? { memoryIds } : {}),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...(memoryLayers !== undefined ? { memoryLayers } : {}),
  };
}

function parseAccountId(
  payloadAccountId: unknown,
  routeAccountId: string | undefined,
  invalidRequest: () => Error,
): string | undefined {
  if (payloadAccountId === undefined) {
    return routeAccountId;
  }
  if (!isNonEmptyString(payloadAccountId)) {
    throw invalidRequest();
  }

  const accountId = payloadAccountId.trim();
  if (routeAccountId && accountId !== routeAccountId) {
    throw invalidRequest();
  }

  return accountId;
}

function parseSearchLimit(value: unknown, invalidRequest: () => Error): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 20
  ) {
    throw invalidRequest();
  }

  return value;
}

function parseOptionalStringArray(
  value: unknown,
  invalidRequest: () => Error,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw invalidRequest();
  }

  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
