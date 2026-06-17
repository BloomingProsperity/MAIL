import { describe, expect, it } from "vitest";

import {
  safeSmokeBodySummary,
  safeSmokeText,
} from "../src/mail-engine/smoke-error";

describe("smoke error redaction", () => {
  it("redacts sensitive JSON fields", () => {
    const summary = safeSmokeBodySummary({
      ok: false,
      nested: {
        authorization: "Bearer raw-token",
        refreshToken: "refresh-token",
        smtp_secret: "smtp-secret",
      },
    });

    expect(summary).toContain('"authorization":"[redacted]"');
    expect(summary).toContain('"refreshToken":"[redacted]"');
    expect(summary).toContain('"smtp_secret":"[redacted]"');
    expect(summary).not.toContain("raw-token");
    expect(summary).not.toContain("refresh-token");
    expect(summary).not.toContain("smtp-secret");
  });

  it("redacts URLs, tokens, header formats, and delimiter-like text", () => {
    const summary = safeSmokeBodySummary({
      detail:
        'http://user:secret@10.0.0.20/?token=abc github_pat_abc Authorization: Basic raw-basic password: "quoted-secret" token=abc","next":"value password=abc"def',
    });
    const parsed = JSON.parse(summary) as { detail: string };

    expect(parsed.detail).toContain("Authorization: [redacted]");
    expect(summary).not.toContain("raw-basic");
    expect(summary).not.toContain("quoted-secret");
    expect(summary).not.toContain("user:secret");
    expect(summary).not.toContain("10.0.0.20");
    expect(summary).not.toContain("github_pat_abc");
    expect(summary).not.toContain("hunter2");
    expect(summary).not.toContain("token=abc");
    expect(summary).not.toContain('next":"value');
    expect(summary).not.toContain("password=abc");
  });

  it("redacts dynamic worker error text", () => {
    const text = safeSmokeText(
      "worker failed Bearer raw-token Authorization: Basic raw-basic authorization=Basic raw-equals password: hunter2 http://user:secret@10.0.0.20:8080?token=abc",
    );

    expect(text).toBe(
      "worker failed Bearer [redacted] Authorization: [redacted] authorization=[redacted] password: [redacted] [url]",
    );
  });

  it("does not throw when a response body cannot be serialized", () => {
    expect(
      safeSmokeBodySummary({
        count: 1n,
        secret: "smoke-secret",
      }),
    ).toBe("[unserializable response body]");
  });
});
