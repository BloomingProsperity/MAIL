import { describe, expect, it } from "vitest";

import {
  buildSmokeFailureReport,
  writeSmokeFailureReport,
} from "../src/cli/smoke-report";

describe("smoke failure reports", () => {
  it("redacts report fields and error messages", () => {
    const report = buildSmokeFailureReport({
      smoke: "emailengine_send",
      fields: {
        apiBaseUrl: "http://user:secret@10.0.0.20:8080/path?token=abc",
        email: "support@example.com",
        provider: "custom_domain",
      },
      secrets: ["smoke-secret"],
      error: new Error(
        "failed smoke-secret Bearer raw-token http://user:secret@10.0.0.20:8080?token=abc github_pat_abc password=hunter2",
      ),
    });

    expect(report).toMatchObject({
      ok: false,
      smoke: "emailengine_send",
      apiBaseUrl: "[url]",
      email: "support@example.com",
      provider: "custom_domain",
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("smoke-secret");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("10.0.0.20");
    expect(serialized).not.toContain("github_pat_abc");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("token=abc");
  });

  it("writes a JSON failure report to stderr", () => {
    const lines: string[] = [];

    writeSmokeFailureReport({
      smoke: "emailengine_webhook",
      fields: { apiBaseUrl: "http://127.0.0.1:8080" },
      error: "boom token=abc",
      writeStderr: (message) => lines.push(message),
    });

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      ok: false,
      smoke: "emailengine_webhook",
      apiBaseUrl: "[url]",
      error: "boom [redacted]",
    });
  });
});
