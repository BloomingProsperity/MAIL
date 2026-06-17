import { describe, expect, it } from "vitest";

import { hashMessageText } from "../src/hermes/message-content";
import {
  createHermesMessageSummaryService,
  InvalidHermesMessageSummaryRequestError,
  type HermesMessageSummaryRecord,
  type HermesMessageSummaryStore,
} from "../src/hermes/message-summary";
import type { MessageDetailDto } from "../src/mail-read/mail-read-store";

describe("Hermes message summary service", () => {
  it("loads selected message text and audits the read message id", async () => {
    const summaryCalls: unknown[] = [];
    const saved: unknown[] = [];
    const store: HermesMessageSummaryStore = {
      async getCachedSummary() {
        return undefined;
      },
      async saveSummary(input) {
        saved.push(input);
        return {
          ...input,
          summaryText: input.summaryText,
          skillRunId: input.skillRunId,
          auditEventId: input.auditEventId,
          createdAt: "2026-06-16T09:00:00.000Z",
          updatedAt: "2026-06-16T09:00:00.000Z",
        };
      },
    };
    const service = createHermesMessageSummaryService({
      createId: () => "summary_cache_1",
      store,
      mailReadStore: {
        async getMessage(input) {
          expect(input).toEqual({
            accountId: "account_1",
            messageId: "message_1",
          });
          return message({
            bodyText: "Please confirm the launch schedule.",
          });
        },
      },
      summaryService: {
        async summarizeThread(input) {
          summaryCalls.push(input);
          return {
            skillRunId: "run_summary_1",
            auditEventId: "audit_summary_1",
            skillId: "thread_summarize",
            mode: "action_points",
            summaryText: "Action: confirm the launch schedule.",
          };
        },
      },
    });

    const result = await service.summarizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      focus: "decisions and reply needs",
      language: "zh-CN",
      memoryScope: "global",
    });

    expect(summaryCalls).toEqual([
      {
        accountId: "account_1",
        subject: "Launch schedule",
        threadText: "Please confirm the launch schedule.",
        mode: "action_points",
        focus: "decisions and reply needs",
        language: "zh-CN",
        readMessageIds: ["message_1"],
        memoryIds: undefined,
        memoryScope: "global",
        memoryLayers: undefined,
      },
    ]);
    expect(saved).toEqual([
      expect.objectContaining({
        id: "summary_cache_1",
        accountId: "account_1",
        messageId: "message_1",
        bodyHash: hashMessageText("Please confirm the launch schedule."),
        mode: "action_points",
        focus: "decisions and reply needs",
        language: "zh-CN",
        summaryText: "Action: confirm the launch schedule.",
        skillRunId: "run_summary_1",
        auditEventId: "audit_summary_1",
      }),
    ]);
    expect(result).toEqual({
      skillRunId: "run_summary_1",
      auditEventId: "audit_summary_1",
      skillId: "thread_summarize",
      accountId: "account_1",
      messageId: "message_1",
      mode: "action_points",
      summaryText: "Action: confirm the launch schedule.",
      cached: false,
    });
  });

  it("uses cached summaries for the same message body and mode tuple", async () => {
    const cached: HermesMessageSummaryRecord = {
      id: "summary_cache_1",
      accountId: "account_1",
      messageId: "message_1",
      bodyHash: hashMessageText("Hello from HTML"),
      mode: "short",
      focus: "decisions",
      language: "English",
      summaryText: "HTML message asks for a decision.",
      skillRunId: "run_cached",
      auditEventId: "audit_cached",
      createdAt: "2026-06-16T09:00:00.000Z",
      updatedAt: "2026-06-16T09:00:00.000Z",
    };
    const lookups: unknown[] = [];
    const service = createHermesMessageSummaryService({
      createId: () => "unused",
      store: {
        async getCachedSummary(input) {
          lookups.push(input);
          return cached;
        },
        async saveSummary() {
          throw new Error("cached summary should not be saved again");
        },
      },
      mailReadStore: {
        async getMessage() {
          return message({
            bodyText: undefined,
            bodyHtml: "<p>Hello&nbsp;from <strong>HTML</strong></p>",
          });
        },
      },
      summaryService: {
        async summarizeThread() {
          throw new Error("cached summary should not call Hermes");
        },
      },
    });

    const result = await service.summarizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      mode: "short",
      focus: "decisions",
      language: "English",
    });

    expect(lookups).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        bodyHash: hashMessageText("Hello from HTML"),
        mode: "short",
        focus: "decisions",
        language: "English",
      },
    ]);
    expect(result).toMatchObject({
      skillRunId: "run_cached",
      summaryText: "HTML message asks for a decision.",
      cached: true,
    });
  });

  it("bypasses the message summary cache when custom instructions are configured", async () => {
    const summaryCalls: unknown[] = [];
    const storeCalls: string[] = [];
    const service = createHermesMessageSummaryService({
      createId: () => "unused",
      store: {
        async getCachedSummary() {
          storeCalls.push("lookup");
          throw new Error("custom instructions should bypass cache lookup");
        },
        async saveSummary() {
          storeCalls.push("save");
          throw new Error("custom instructions should not write legacy cache");
        },
      },
      mailReadStore: {
        async getMessage() {
          return message({ bodyText: "Please confirm today." });
        },
      },
      summaryService: {
        async summarizeThread(input) {
          summaryCalls.push(input);
          return {
            skillRunId: "run_custom",
            skillId: "thread_summarize",
            mode: "short",
            summaryText: "Needs confirmation today.",
          };
        },
      },
    });

    const result = await service.summarizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      mode: "short",
      customInstructions: "Focus only on reply needs.",
    });

    expect(storeCalls).toEqual([]);
    expect(summaryCalls).toEqual([
      expect.objectContaining({
        threadText: "Please confirm today.",
        customInstructions: "Focus only on reply needs.",
      }),
    ]);
    expect(result).toMatchObject({
      skillRunId: "run_custom",
      summaryText: "Needs confirmation today.",
      cached: false,
    });
  });

  it("returns undefined for a message outside the account scope", async () => {
    const service = createHermesMessageSummaryService({
      createId: () => "unused",
      mailReadStore: {
        async getMessage() {
          return undefined;
        },
      },
      summaryService: {
        async summarizeThread() {
          throw new Error("missing message should not call Hermes");
        },
      },
    });

    await expect(
      service.summarizeMessage({
        accountId: "account_1",
        messageId: "message_404",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects messages without readable text", async () => {
    const service = createHermesMessageSummaryService({
      createId: () => "unused",
      mailReadStore: {
        async getMessage() {
          return message({ bodyText: " ", bodyHtml: " ", snippet: " " });
        },
      },
      summaryService: {
        async summarizeThread() {
          throw new Error("empty message should not call Hermes");
        },
      },
    });

    await expect(
      service.summarizeMessage({
        accountId: "account_1",
        messageId: "message_1",
        mode: "detailed",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesMessageSummaryRequestError);
  });
});

function message(overrides: Partial<MessageDetailDto> = {}): MessageDetailDto {
  return {
    id: "message_1",
    accountId: "account_1",
    subject: "Launch schedule",
    from: { email: "client@example.com" },
    receivedAt: "2026-06-16T09:00:00.000Z",
    snippet: "Please confirm.",
    unread: true,
    starred: false,
    mailboxIds: ["inbox_1"],
    attachmentCount: 0,
    classification: {
      bucket: "P2 Important",
      priorityScore: 80,
      reasons: ["direct conversation"],
    },
    to: ["me@example.com"],
    cc: [],
    bodyText: "Please confirm the launch schedule.",
    attachments: [],
    ...overrides,
  };
}
