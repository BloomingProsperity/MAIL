import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { ApiConfig } from "./router.js";
import { readValidWebSession, type WebSession } from "./web-session.js";

export interface ApiAccessContext {
  accountIds?: Set<string>;
}

export interface ApiAccessResult {
  authorized: boolean;
  context: ApiAccessContext;
}

export function resolveApiRequestAccess(
  request: IncomingMessage,
  config: ApiConfig,
  sessions: Map<string, WebSession>,
  nowMs: () => number,
): ApiAccessResult {
  const path = getRequestPathname(request.url);
  const defaultContext = createApiAccessContext(config.apiAccessAccountIds);
  if (!path.startsWith("/api/") || isApiAuthExemptPath(path)) {
    return { authorized: true, context: defaultContext };
  }

  if (config.webAuthDisabled) {
    return { authorized: true, context: defaultContext };
  }

  const expectedToken = config.apiAccessToken?.trim();
  const suppliedToken = readApiAccessToken(request);
  if (suppliedToken) {
    return {
      authorized: expectedToken
        ? safeEqual(suppliedToken, expectedToken)
        : false,
      context: defaultContext,
    };
  }

  const session = readValidWebSession(request, sessions, nowMs);
  if (session) {
    return {
      authorized: true,
      context: createApiAccessContext(session.accountIds),
    };
  }

  if (!expectedToken) {
    return {
      authorized: !config.apiAccessTokenRequired,
      context: defaultContext,
    };
  }

  return { authorized: false, context: defaultContext };
}

export function isApiAccessAccountScoped(context: ApiAccessContext): boolean {
  return Boolean(context.accountIds && context.accountIds.size > 0);
}

export function isAccountAccessAllowed(
  context: ApiAccessContext,
  accountId: string,
): boolean {
  return !context.accountIds || context.accountIds.has(accountId);
}

export function readApiAccessToken(
  request: IncomingMessage,
): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const bearerToken = authorization.slice("Bearer ".length).trim();
    return bearerToken || undefined;
  }

  const header = request.headers["x-emailhub-api-token"];
  const rawToken = Array.isArray(header) ? header[0] : header;
  const token = rawToken?.trim();
  return token || undefined;
}

function createApiAccessContext(
  accountIdsInput: string[] | undefined,
): ApiAccessContext {
  const accountIds = normalizeApiAccessAccountIds(accountIdsInput);
  return accountIds.length > 0 ? { accountIds: new Set(accountIds) } : {};
}

function normalizeApiAccessAccountIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((accountId) => accountId.trim())
        .filter((accountId) => accountId.length > 0),
    ),
  );
}

function isApiAuthExemptPath(path: string): boolean {
  return (
    path === "/api/webhooks/emailengine" ||
    path === "/api/mail-engine/auth-server"
  );
}

function getRequestPathname(requestUrl: string | undefined): string {
  if (!requestUrl) {
    return "/";
  }

  return new URL(requestUrl, "http://localhost").pathname;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
