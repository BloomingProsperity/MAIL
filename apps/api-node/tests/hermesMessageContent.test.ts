import { describe, expect, it } from "vitest";

import {
  DEFAULT_HERMES_MAX_CONTEXT_CHARS,
  limitHermesContextText,
  messageReadableText,
} from "../src/hermes/message-content";
import type { MessageDetailDto } from "../src/mail-read/mail-read-store";

describe("Hermes message content budget", () => {
  it("limits readable message text to the default Hermes context budget", () => {
    const text = messageReadableText(message({ bodyText: "x".repeat(30_000) }));

    expect(text.length).toBeLessThanOrEqual(DEFAULT_HERMES_MAX_CONTEXT_CHARS);
    expect(text).toContain("Hermes context truncated");
  });

  it("uses skill-specific context budgets when provided", () => {
    const text = messageReadableText(message({ bodyText: "x".repeat(5_000) }), {
      maxChars: 1_200,
    });

    expect(text.length).toBeLessThanOrEqual(1_200);
    expect(text).toContain("truncated to 1200");
  });

  it("strips HTML before applying the context budget", () => {
    const text = messageReadableText(
      message({
        bodyText: undefined,
        bodyHtml: `<p>${"hello ".repeat(600)}</p>`,
      }),
      { maxChars: 1_000 },
    );

    expect(text.length).toBeLessThanOrEqual(1_000);
    expect(text).not.toContain("<p>");
    expect(text).toContain("Hermes context truncated");
  });

  it("keeps already small direct text unchanged", () => {
    expect(limitHermesContextText("short body", { maxChars: 1_000 })).toBe(
      "short body",
    );
  });
});

function message(overrides: Partial<MessageDetailDto>): MessageDetailDto {
  return {
    id: "message_1",
    accountId: "account_1",
    subject: "Launch",
    from: { email: "client@example.com" },
    receivedAt: "2026-06-16T09:00:00.000Z",
    snippet: "fallback snippet",
    unread: false,
    starred: false,
    mailboxIds: ["inbox"],
    labelIds: [],
    attachmentCount: 0,
    classification: {
      bucket: "P2 Important",
      priorityScore: 70,
      reasons: [],
    },
    to: [],
    cc: [],
    bodyText: "body",
    attachments: [],
    ...overrides,
  };
}
