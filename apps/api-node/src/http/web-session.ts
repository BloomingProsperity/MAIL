import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiConfig } from "./router.js";
import {
  hashWebAuthPassword,
  InvalidWebAuthCredentialsError,
  validateWebAuthEmail,
  validateWebAuthPassword,
  verifyWebAuthPassword,
  WebAuthAdminAlreadyExistsError,
  type WebAuthRole,
  type WebAuthUser,
} from "./web-auth.js";

export const DEFAULT_WEB_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const WEB_SESSION_COOKIE_NAME = "emailhub_session";

export interface WebSession {
  accountIds: string[];
  userId?: string;
  email?: string;
  role?: WebAuthRole;
  createdAtMs: number;
  expiresAtMs: number;
}

export function isWebSessionRoute(requestUrl: string | undefined): boolean {
  const path = getRequestPathname(requestUrl);
  return (
    path === "/api/session" ||
    path === "/api/session/setup" ||
    path === "/api/session/login" ||
    path === "/api/session/logout"
  );
}

export async function handleWebSessionRoute(input: {
  request: IncomingMessage;
  response: ServerResponse;
  config: ApiConfig;
  sessions: Map<string, WebSession>;
  readRequestBody: () => Promise<string>;
  nowMs: () => number;
  maxAgeSeconds: number;
}): Promise<boolean> {
  const path = getRequestPathname(input.request.url);
  if (input.config.webAuthDisabled) {
    if (
      (path === "/api/session" && input.request.method === "GET") ||
      (path === "/api/session/setup" && input.request.method === "POST") ||
      (path === "/api/session/login" && input.request.method === "POST") ||
      (path === "/api/session/logout" && input.request.method === "POST")
    ) {
      writeJson(
        input.response,
        200,
        disabledWebSessionResponse(
          input.config,
          input.nowMs,
          input.maxAgeSeconds,
        ),
      );
      return true;
    }
  }

  if (path === "/api/session" && input.request.method === "GET") {
    const session = readValidWebSession(
      input.request,
      input.sessions,
      input.nowMs,
    );
    writeJson(
      input.response,
      200,
      session
        ? webSessionResponse(session)
        : await anonymousSessionResponse(input.config),
    );
    return true;
  }

  if (path === "/api/session/setup" && input.request.method === "POST") {
    await handleWebSessionSetup(input);
    return true;
  }

  if (path === "/api/session/login" && input.request.method === "POST") {
    await handleWebSessionLogin(input);
    return true;
  }

  if (path === "/api/session/logout" && input.request.method === "POST") {
    const sessionId = readWebSessionId(input.request);
    if (sessionId) {
      input.sessions.delete(sessionId);
    }
    input.response.setHeader(
      "set-cookie",
      buildExpiredWebSessionCookie(input.config),
    );
    writeJson(input.response, 200, { authenticated: false });
    return true;
  }

  writeJson(input.response, 404, { error: "not_found" });
  return true;
}

export function readValidWebSession(
  request: IncomingMessage,
  sessions: Map<string, WebSession>,
  nowMs: () => number,
): WebSession | undefined {
  const sessionId = readWebSessionId(request);
  if (!sessionId) {
    return undefined;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return undefined;
  }

  if (session.expiresAtMs <= nowMs()) {
    sessions.delete(sessionId);
    return undefined;
  }

  return session;
}

async function handleWebSessionSetup(input: {
  request: IncomingMessage;
  response: ServerResponse;
  config: ApiConfig;
  sessions: Map<string, WebSession>;
  readRequestBody: () => Promise<string>;
  nowMs: () => number;
  maxAgeSeconds: number;
}): Promise<void> {
  if (!input.config.webAuthStore) {
    writeJson(input.response, 503, { error: "setup_unavailable" });
    return;
  }

  let credentials: WebAuthCredentials;
  try {
    credentials = readWebAuthCredentials(await input.readRequestBody());
    credentials.email = validateWebAuthEmail(credentials.email);
    credentials.password = validateWebAuthPassword(credentials.password);
  } catch {
    writeJson(input.response, 400, { error: "invalid_setup_request" });
    return;
  }

  try {
    const user = await input.config.webAuthStore.createFirstAdmin({
      id: input.config.createWebAuthUserId?.() ?? randomUUID(),
      email: credentials.email,
      passwordHash: await hashWebAuthPassword(credentials.password),
      createdAt: new Date(input.nowMs()).toISOString(),
    });
    createWebUserSession(input, user);
  } catch (error) {
    if (error instanceof WebAuthAdminAlreadyExistsError) {
      writeJson(input.response, 409, { error: "setup_closed" });
      return;
    }

    throw error;
  }
}

async function handleWebSessionLogin(input: {
  request: IncomingMessage;
  response: ServerResponse;
  config: ApiConfig;
  sessions: Map<string, WebSession>;
  readRequestBody: () => Promise<string>;
  nowMs: () => number;
  maxAgeSeconds: number;
}): Promise<void> {
  if (input.config.webAuthStore) {
    await handleWebUserLogin(input);
    return;
  }

  const expectedToken = input.config.apiAccessToken?.trim();
  if (!expectedToken) {
    writeJson(input.response, 503, { error: "login_unavailable" });
    return;
  }

  let password = "";
  try {
    password = readWebSessionLoginPassword(await input.readRequestBody());
  } catch {
    writeJson(input.response, 400, { error: "invalid_login_request" });
    return;
  }

  if (!password || !safeEqual(password, expectedToken)) {
    writeJson(input.response, 401, { error: "login_failed" });
    return;
  }

  const now = input.nowMs();
  const session: WebSession = {
    accountIds: normalizeApiAccessAccountIds(input.config.apiAccessAccountIds),
    createdAtMs: now,
    expiresAtMs: now + input.maxAgeSeconds * 1000,
  };
  const sessionId = randomUUID();
  input.sessions.set(sessionId, session);
  input.response.setHeader(
    "set-cookie",
    buildWebSessionCookie(sessionId, input.config, input.maxAgeSeconds),
  );
  writeJson(input.response, 200, webSessionResponse(session));
}

async function handleWebUserLogin(input: {
  request: IncomingMessage;
  response: ServerResponse;
  config: ApiConfig;
  sessions: Map<string, WebSession>;
  readRequestBody: () => Promise<string>;
  nowMs: () => number;
  maxAgeSeconds: number;
}): Promise<void> {
  let credentials: WebAuthCredentials;
  try {
    credentials = readWebAuthCredentials(await input.readRequestBody());
  } catch {
    writeJson(input.response, 400, { error: "invalid_login_request" });
    return;
  }

  const user = await input.config.webAuthStore?.findUserByEmail(
    credentials.email,
  );
  const passwordMatches = user
    ? await verifyWebAuthPassword({
        password: credentials.password,
        passwordHash: user.passwordHash,
      })
    : false;

  if (!user || !passwordMatches) {
    writeJson(input.response, 401, { error: "login_failed" });
    return;
  }

  createWebUserSession(input, user);
}

interface WebAuthCredentials {
  email: string;
  password: string;
}

function readWebAuthCredentials(body: string): WebAuthCredentials {
  const payload = JSON.parse(body || "{}");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidWebAuthCredentialsError();
  }

  const email = (payload as { email?: unknown }).email;
  const password = (payload as { password?: unknown }).password;
  if (typeof email !== "string" || typeof password !== "string") {
    throw new InvalidWebAuthCredentialsError();
  }

  return { email, password };
}

function readWebSessionLoginPassword(body: string): string {
  const payload = JSON.parse(body || "{}");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_login_request");
  }

  const password = (payload as { password?: unknown }).password;
  return typeof password === "string" ? password : "";
}

function webSessionResponse(session: WebSession | undefined): {
  authenticated: boolean;
  accountIds?: string[];
  expiresAt?: string;
  user?: {
    email: string;
    role: WebAuthRole;
  };
} {
  if (!session) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    ...(session.accountIds.length > 0 ? { accountIds: session.accountIds } : {}),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    ...(session.email && session.role
      ? { user: { email: session.email, role: session.role } }
      : {}),
  };
}

function disabledWebSessionResponse(
  config: ApiConfig,
  nowMs: () => number,
  maxAgeSeconds: number,
): {
  authenticated: true;
  authDisabled: true;
  accountIds?: string[];
  expiresAt: string;
  user: {
    email: string;
    role: WebAuthRole;
  };
} {
  const accountIds = normalizeApiAccessAccountIds(config.apiAccessAccountIds);
  return {
    authenticated: true,
    authDisabled: true,
    ...(accountIds.length > 0 ? { accountIds } : {}),
    expiresAt: new Date(nowMs() + maxAgeSeconds * 1000).toISOString(),
    user: { email: "admin", role: "owner" },
  };
}

async function anonymousSessionResponse(config: ApiConfig): Promise<{
  authenticated: boolean;
  authDisabled?: boolean;
  accountIds?: string[];
  setupRequired?: boolean;
  user?: {
    email: string;
    role: WebAuthRole;
  };
}> {
  if (config.webAuthDisabled) {
    return {
      authenticated: true,
      authDisabled: true,
      user: { email: "admin", role: "owner" },
    };
  }

  if (config.webAuthStore) {
    return {
      authenticated: false,
      setupRequired: (await config.webAuthStore.countAdmins()) === 0,
    };
  }

  const expectedToken = config.apiAccessToken?.trim();
  if (expectedToken || config.apiAccessTokenRequired) {
    return { authenticated: false };
  }

  const accountIds = normalizeApiAccessAccountIds(config.apiAccessAccountIds);
  return {
    authenticated: true,
    ...(accountIds.length > 0 ? { accountIds } : {}),
  };
}

function createWebUserSession(
  input: {
    response: ServerResponse;
    config: ApiConfig;
    sessions: Map<string, WebSession>;
    nowMs: () => number;
    maxAgeSeconds: number;
  },
  user: WebAuthUser,
): void {
  const now = input.nowMs();
  const session: WebSession = {
    accountIds: normalizeApiAccessAccountIds(input.config.apiAccessAccountIds),
    userId: user.id,
    email: user.email,
    role: user.role,
    createdAtMs: now,
    expiresAtMs: now + input.maxAgeSeconds * 1000,
  };
  const sessionId = randomUUID();
  input.sessions.set(sessionId, session);
  input.response.setHeader(
    "set-cookie",
    buildWebSessionCookie(sessionId, input.config, input.maxAgeSeconds),
  );
  writeJson(input.response, 200, webSessionResponse(session));
}

function buildWebSessionCookie(
  sessionId: string,
  config: ApiConfig,
  maxAgeSeconds: number,
): string {
  return [
    `${WEB_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(config.webSessionCookieSecure ? ["Secure"] : []),
  ].join("; ");
}

function buildExpiredWebSessionCookie(config: ApiConfig): string {
  return [
    `${WEB_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(config.webSessionCookieSecure ? ["Secure"] : []),
  ].join("; ");
}

function readWebSessionId(request: IncomingMessage): string | undefined {
  return readCookieValue(request, WEB_SESSION_COOKIE_NAME);
}

function readCookieValue(
  request: IncomingMessage,
  cookieName: string,
): string | undefined {
  const rawCookie = request.headers.cookie;
  if (!rawCookie) {
    return undefined;
  }

  for (const item of rawCookie.split(";")) {
    const [name, ...valueParts] = item.trim().split("=");
    if (name !== cookieName) {
      continue;
    }

    const value = valueParts.join("=");
    if (!value) {
      return undefined;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
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

function getRequestPathname(requestUrl: string | undefined): string {
  if (!requestUrl) {
    return "/";
  }

  return new URL(requestUrl, "http://localhost").pathname;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
