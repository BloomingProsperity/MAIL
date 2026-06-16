import { describe, expect, it } from "vitest";

import {
  createHermesMessageReplyService,
  InvalidHermesMessageReplyRequestError,
} from "../src/hermes/message-replies";
import type { MessageDetailDto } from "../src/mail-read/mail-read-store";

describe("Hermes message reply service", () => {
  it("loads the selected message body before drafting a reply", async () => {
    const calls: unknown[] = [];
    const service = createHermesMessageReplyService({
      mailReadStore: {
        async getMessage(input) {
          expect(input).toEqual({
            accountId: "account_1",
            messageId: "message_1",
          });
          return message({
            bodyText: "Please confirm the launch schedule today.",
          });
        },
      },
      replyDraftService: {
        async draftReply(input) {
          calls.push(input);
          return {
            skillRunId: "run_reply_1",
            auditEventId: "audit_reply_1",
            skillId: "reply_draft",
            draftText: "Hi,\n\nI can confirm the schedule today.",
          };
        },
      },
      quickReplyService: {
        async quickReply() {
          throw new Error("quick reply should not be used");
        },
      },
    });

    const result = await service.draftMessageReply({
      accountId: "account_1",
      messageId: "message_1",
      instruction: "Confirm politely.",
      tone: "warm professional",
      language: "English",
      memoryIds: ["memory_1"],
      memoryLayers: ["writing_style_profile"],
    });

    expect(calls).toEqual([
      {
        subject: "Launch schedule",
        threadText: "Please confirm the launch schedule today.",
        instruction: "Confirm politely.",
        tone: "warm professional",
        language: "English",
        readMessageIds: ["message_1"],
        memoryIds: ["memory_1"],
        memoryScope: "sender:client@example.com",
        memoryLayers: ["writing_style_profile"],
      },
    ]);
    expect(result).toEqual({
      skillRunId: "run_reply_1",
      auditEventId: "audit_reply_1",
      skillId: "reply_draft",
      accountId: "account_1",
      messageId: "message_1",
      draftText: "Hi,\n\nI can confirm the schedule today.",
    });
  });

  it("uses readable HTML fallback for quick replies", async () => {
    const calls: unknown[] = [];
    const service = createHermesMessageReplyService({
      mailReadStore: {
        async getMessage() {
          return message({
            bodyText: undefined,
            bodyHtml: "<p>Hello&nbsp;<strong>from HTML</strong></p>",
          });
        },
      },
      replyDraftService: {
        async draftReply() {
          throw new Error("reply draft should not be used");
        },
      },
      quickReplyService: {
        async quickReply(input) {
          calls.push(input);
          return {
            skillRunId: "run_quick_1",
            skillId: "quick_reply",
            scenario: "thanks",
            draftText: "Thanks, I will take a look.",
            editable: true,
            sendsDirectly: false,
          };
        },
      },
    });

    const result = await service.quickMessageReply({
      accountId: "account_1",
      messageId: "message_1",
      scenario: "thanks",
      instruction: "Keep it short.",
      memoryScope: "global",
    });

    expect(calls).toEqual([
      {
        subject: "Launch schedule",
        threadText: "Hello from HTML",
        scenario: "thanks",
        instruction: "Keep it short.",
        readMessageIds: ["message_1"],
        memoryScope: "global",
      },
    ]);
    expect(result).toMatchObject({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      accountId: "account_1",
      messageId: "message_1",
      draftText: "Thanks, I will take a look.",
    });
  });

  it("returns undefined for a message outside the account scope", async () => {
    const service = createHermesMessageReplyService({
      mailReadStore: {
        async getMessage() {
          return undefined;
        },
      },
      replyDraftService: {
        async draftReply() {
          throw new Error("missing message should not call Hermes");
        },
      },
      quickReplyService: {
        async quickReply() {
          throw new Error("missing message should not call Hermes");
        },
      },
    });

    await expect(
      service.draftMessageReply({
        accountId: "account_1",
        messageId: "message_404",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects messages without readable reply text", async () => {
    const service = createHermesMessageReplyService({
      mailReadStore: {
        async getMessage() {
          return message({ bodyText: " ", bodyHtml: " ", snippet: " " });
        },
      },
      replyDraftService: {
        async draftReply() {
          throw new Error("empty message should not call Hermes");
        },
      },
      quickReplyService: {
        async quickReply() {
          throw new Error("empty message should not call Hermes");
        },
      },
    });

    await expect(
      service.draftMessageReply({
        accountId: "account_1",
        messageId: "message_1",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesMessageReplyRequestError);
  });

  it("rejects invalid quick reply scenarios before reading mail", async () => {
    const service = createHermesMessageReplyService({
      mailReadStore: {
        async getMessage() {
          throw new Error("invalid scenario should not read mail");
        },
      },
      replyDraftService: {
        async draftReply() {
          throw new Error("reply draft should not be used");
        },
      },
      quickReplyService: {
        async quickReply() {
          throw new Error("invalid scenario should not call Hermes");
        },
      },
    });

    await expect(
      service.quickMessageReply({
        accountId: "account_1",
        messageId: "message_1",
        scenario: "send_now",
      } as any),
    ).rejects.toBeInstanceOf(InvalidHermesMessageReplyRequestError);
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
