import { describe, expect, it } from "vitest";

import {
  createInMemoryDiagnosticsLogStore,
  type DiagnosticLogLevel,
} from "../src/logging/diagnostics";
import { createJsonLogger, sanitizeLogFields } from "../src/logging/logger";

describe("backend logger", () => {
  it("writes structured JSON lines and redacts sensitive fields", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      service: "email-hub-api",
      level: "debug",
      sink: (line) => lines.push(line),
      now: () => "2026-06-13T00:00:00.000Z",
    });

    logger.info("oauth_callback_received", {
      requestId: "req_1",
      accessToken: "token-value",
      nested: {
        refreshToken: "refresh-value",
        email: "user@example.com",
      },
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-06-13T00:00:00.000Z",
      level: "info",
      service: "email-hub-api",
      event: "oauth_callback_received",
      requestId: "req_1",
      accessToken: "[redacted]",
      nested: {
        refreshToken: "[redacted]",
        email: "user@example.com",
      },
    });
  });

  it("filters messages below the configured level", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      service: "email-hub-worker",
      level: "warn",
      sink: (line) => lines.push(line),
    });

    logger.info("worker_idle", { lane: "sync_account" });
    logger.warn("worker_retry", { lane: "sync_account" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "warn",
      service: "email-hub-worker",
      event: "worker_retry",
      lane: "sync_account",
    });
  });

  it("captures recent sanitized JSON log entries for diagnostics queries", () => {
    const lines: string[] = [];
    const diagnostics = createInMemoryDiagnosticsLogStore({ capacity: 2 });
    const logger = createJsonLogger({
      service: "email-hub-api",
      level: "debug",
      diagnostics,
      sink: (line) => lines.push(line),
      now: (() => {
        const timestamps = [
          "2026-06-13T00:00:00.000Z",
          "2026-06-13T00:00:01.000Z",
          "2026-06-13T00:00:02.000Z",
        ];
        return () => timestamps.shift() ?? "2026-06-13T00:00:03.000Z";
      })(),
    });

    logger.info("request_completed", {
      requestId: "req_1",
      path: "/oauth/callback?code=raw-code",
    });
    logger.warn("sync_retry", {
      requestId: "req_2",
      refreshToken: "raw-refresh-token",
    });
    logger.error("sync_failed", {
      requestId: "req_2",
      password: "raw-password",
    });

    expect(lines).toHaveLength(3);
    expect(diagnostics.list({ limit: 10 })).toEqual({
      items: [
        expect.objectContaining({
          timestamp: "2026-06-13T00:00:02.000Z",
          level: "error" satisfies DiagnosticLogLevel,
          event: "sync_failed",
          requestId: "req_2",
          password: "[redacted]",
        }),
        expect.objectContaining({
          timestamp: "2026-06-13T00:00:01.000Z",
          level: "warn" satisfies DiagnosticLogLevel,
          event: "sync_retry",
          requestId: "req_2",
          refreshToken: "[redacted]",
        }),
      ],
    });
    expect(diagnostics.list({ requestId: "req_2", level: "error" })).toEqual({
      items: [
        expect.objectContaining({
          event: "sync_failed",
          requestId: "req_2",
        }),
      ],
    });
    expect(JSON.stringify(diagnostics.list({ limit: 10 }))).not.toContain(
      "raw-",
    );
  });

  it("sanitizes request urls and authorization headers", () => {
    expect(
      sanitizeLogFields({
        url: "/oauth/callback?code=abc&state=state_1&access_token=secret",
        headers: {
          authorization: "Bearer secret-token",
          "x-request-id": "req_1",
        },
      }),
    ).toEqual({
      url: "/oauth/callback?code=%5Bredacted%5D&state=state_1&access_token=%5Bredacted%5D",
      headers: {
        authorization: "[redacted]",
        "x-request-id": "req_1",
      },
    });
  });
});
