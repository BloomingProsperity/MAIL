import { describe, expect, it } from "vitest";

import {
  createHermesMessageFollowupTrackerService,
  InvalidHermesMessageFollowupRequestError,
} from "../src/hermes/message-followups";
import type { MessageDetailDto } from "../src/mail-read/mail-read-store";

describe("Hermes message follow-up tracker service", () => {
  it("loads selected message text and audits the read message id", async () => {
    const calls: unknown[] = [];
    const service = createHermesMessageFollowupTrackerService({
      now: () => "2026-06-16T11:40:00.000Z",
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
      followupTrackerService: {
        async trackFollowup(input) {
          calls.push(input);
          return {
            skillRunId: "run_followup_1",
            auditEventId: "audit_followup_1",
            skillId: "followup_tracker",
            status: "waiting_on_them",
            followupNeeded: true,
            owner: "them",
            confidence: 0.88,
            dueAt: "2026-06-17T09:00:00.000Z",
            nextAction: "Check whether Lina replied",
            reasons: ["we asked for confirmation and no reply yet"],
          };
        },
      },
    });

    const result = await service.trackMessageFollowup({
      accountId: "account_1",
      messageId: "message_1",
      language: "zh-CN",
      memoryLayers: ["contact_memory", "procedural_memory"],
    });

    expect(calls).toEqual([
      {
        accountId: "account_1",
        subject: "Launch schedule",
        threadText: "Please confirm the launch schedule today.",
        participants: [
          "client@example.com",
          "me@example.com",
          "team@example.com",
        ],
        now: "2026-06-16T11:40:00.000Z",
        language: "zh-CN",
        readMessageIds: ["message_1"],
        memoryIds: undefined,
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory", "procedural_memory"],
      },
    ]);
    expect(result).toEqual({
      skillRunId: "run_followup_1",
      auditEventId: "audit_followup_1",
      skillId: "followup_tracker",
      accountId: "account_1",
      messageId: "message_1",
      status: "waiting_on_them",
      followupNeeded: true,
      owner: "them",
      confidence: 0.88,
      dueAt: "2026-06-17T09:00:00.000Z",
      nextAction: "Check whether Lina replied",
      reasons: ["we asked for confirmation and no reply yet"],
    });
  });

  it("uses readable HTML fallback", async () => {
    const calls: unknown[] = [];
    const service = createHermesMessageFollowupTrackerService({
      now: () => "2026-06-16T11:40:00.000Z",
      mailReadStore: {
        async getMessage() {
          return message({
            bodyText: undefined,
            bodyHtml: "<p>Hello&nbsp;<strong>from HTML</strong></p>",
          });
        },
      },
      followupTrackerService: {
        async trackFollowup(input) {
          calls.push(input);
          return followupResult();
        },
      },
    });

    await service.trackMessageFollowup({
      accountId: "account_1",
      messageId: "message_1",
      memoryScope: "global",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        threadText: "Hello from HTML",
        memoryScope: "global",
      }),
    ]);
  });

  it("returns undefined for a message outside the account scope", async () => {
    const service = createHermesMessageFollowupTrackerService({
      now: () => "2026-06-16T11:40:00.000Z",
      mailReadStore: {
        async getMessage() {
          return undefined;
        },
      },
      followupTrackerService: {
        async trackFollowup() {
          throw new Error("missing message should not call Hermes");
        },
      },
    });

    await expect(
      service.trackMessageFollowup({
        accountId: "account_1",
        messageId: "message_404",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects messages without readable text", async () => {
    const service = createHermesMessageFollowupTrackerService({
      now: () => "2026-06-16T11:40:00.000Z",
      mailReadStore: {
        async getMessage() {
          return message({ bodyText: " ", bodyHtml: " ", snippet: " " });
        },
      },
      followupTrackerService: {
        async trackFollowup() {
          throw new Error("empty message should not call Hermes");
        },
      },
    });

    await expect(
      service.trackMessageFollowup({
        accountId: "account_1",
        messageId: "message_1",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesMessageFollowupRequestError);
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
    to: ["me@example.com", "team@example.com"],
    cc: ["client@example.com"],
    bodyText: "Please confirm the launch schedule.",
    attachments: [],
    ...overrides,
  };
}

function followupResult() {
  return {
    skillRunId: "run_followup_1",
    skillId: "followup_tracker" as const,
    status: "waiting_on_them" as const,
    followupNeeded: true,
    owner: "them" as const,
    confidence: 0.88,
    reasons: ["we asked for confirmation and no reply yet"],
  };
}
