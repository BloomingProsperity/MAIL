import { describe, expect, it } from "vitest";

import {
  createHermesMessageOrganizationService,
  InvalidHermesMessageOrganizationRequestError,
} from "../src/hermes/message-organization";
import type { MessageDetailDto } from "../src/mail-read/mail-read-store";

describe("Hermes message organization service", () => {
  it("loads selected message context and organizes it through Hermes skills", async () => {
    const calls: Record<string, unknown[]> = {
      priority: [],
      labels: [],
      newsletter: [],
      actionItems: [],
      labelLists: [],
    };
    const service = createHermesMessageOrganizationService({
      now: () => "2026-06-16T11:30:00.000Z",
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
      labelService: {
        async listLabels(input) {
          calls.labelLists.push(input);
          return {
            items: [
              label("客户"),
              label("验证码"),
            ],
          };
        },
      },
      priorityService: {
        async triagePriority(input) {
          calls.priority.push(input);
          return {
            skillRunId: "run_priority_1",
            skillId: "priority_triage",
            priority: "high",
            bucket: "P1 Urgent",
            score: 94,
            reasons: ["deadline today"],
          };
        },
      },
      labelSuggestService: {
        async suggestLabels(input) {
          calls.labels.push(input);
          return {
            skillRunId: "run_labels_1",
            skillId: "label_suggest",
            labels: [{ name: "客户", confidence: 0.91 }],
            actions: [{ type: "apply_label", label: "客户" }],
          };
        },
      },
      newsletterCleanupService: {
        async cleanupNewsletter(input) {
          calls.newsletter.push(input);
          return {
            skillRunId: "run_newsletter_1",
            skillId: "newsletter_cleanup",
            isNewsletter: false,
            confidence: 0.88,
            senderCategory: "personal",
            reasons: ["direct conversation"],
            actions: [{ type: "keep_in_inbox" }],
          };
        },
      },
      actionItemExtractService: {
        async extractActionItems(input) {
          calls.actionItems.push(input);
          return {
            skillRunId: "run_actions_1",
            skillId: "action_item_extract",
            items: [{ title: "Confirm launch schedule", owner: "me" }],
          };
        },
      },
    });

    const result = await service.organizeMessage({
      accountId: "account_1",
      messageId: "message_1",
      language: "zh-CN",
      memoryLayers: ["contact_memory", "semantic_profile"],
    });

    const shared = {
      subject: "Launch schedule",
      threadText: "Please confirm the launch schedule today.",
      language: "zh-CN",
      readMessageIds: ["message_1"],
      memoryIds: undefined,
      memoryScope: "sender:client@example.com",
      memoryLayers: ["contact_memory", "semantic_profile"],
    };
    expect(calls.labelLists).toEqual([{ accountId: "account_1" }]);
    expect(calls.priority).toEqual([
      {
        ...shared,
        senderEmail: "client@example.com",
        currentBucket: "P1 Urgent",
        currentScore: 96,
        currentReasons: ["Direct to you"],
      },
    ]);
    expect(calls.labels).toEqual([
      {
        ...shared,
        senderEmail: "client@example.com",
        currentLabels: [],
        availableLabels: ["客户", "验证码"],
      },
    ]);
    expect(calls.newsletter).toEqual([
      {
        ...shared,
        senderEmail: "client@example.com",
        currentBucket: "P1 Urgent",
      },
    ]);
    expect(calls.actionItems).toEqual([
      {
        ...shared,
        now: "2026-06-16T11:30:00.000Z",
      },
    ]);
    expect(result).toMatchObject({
      accountId: "account_1",
      messageId: "message_1",
      priority: { skillRunId: "run_priority_1" },
      labels: { skillRunId: "run_labels_1" },
      newsletter: { skillRunId: "run_newsletter_1" },
      actionItems: { skillRunId: "run_actions_1" },
    });
  });

  it("uses readable HTML fallback", async () => {
    const calls: unknown[] = [];
    const service = createHermesMessageOrganizationService({
      now: () => "2026-06-16T11:30:00.000Z",
      mailReadStore: {
        async getMessage() {
          return message({
            bodyText: undefined,
            bodyHtml: "<p>Hello&nbsp;<strong>from HTML</strong></p>",
          });
        },
      },
      priorityService: {
        async triagePriority(input) {
          calls.push(input);
          return priorityResult();
        },
      },
      labelSuggestService: {
        async suggestLabels() {
          return labelResult();
        },
      },
      newsletterCleanupService: {
        async cleanupNewsletter() {
          return newsletterResult();
        },
      },
      actionItemExtractService: {
        async extractActionItems() {
          return actionItemResult();
        },
      },
    });

    await service.organizeMessage({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        threadText: "Hello from HTML",
      }),
    ]);
  });

  it("returns undefined for a message outside the account scope", async () => {
    const service = createHermesMessageOrganizationService({
      now: () => "2026-06-16T11:30:00.000Z",
      mailReadStore: {
        async getMessage() {
          return undefined;
        },
      },
      priorityService: {
        async triagePriority() {
          throw new Error("missing message should not call Hermes");
        },
      },
      labelSuggestService: {
        async suggestLabels() {
          throw new Error("missing message should not call Hermes");
        },
      },
      newsletterCleanupService: {
        async cleanupNewsletter() {
          throw new Error("missing message should not call Hermes");
        },
      },
      actionItemExtractService: {
        async extractActionItems() {
          throw new Error("missing message should not call Hermes");
        },
      },
    });

    await expect(
      service.organizeMessage({
        accountId: "account_1",
        messageId: "message_404",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects messages without readable text", async () => {
    const service = createHermesMessageOrganizationService({
      now: () => "2026-06-16T11:30:00.000Z",
      mailReadStore: {
        async getMessage() {
          return message({ bodyText: " ", bodyHtml: " ", snippet: " " });
        },
      },
      priorityService: {
        async triagePriority() {
          throw new Error("empty message should not call Hermes");
        },
      },
      labelSuggestService: {
        async suggestLabels() {
          throw new Error("empty message should not call Hermes");
        },
      },
      newsletterCleanupService: {
        async cleanupNewsletter() {
          throw new Error("empty message should not call Hermes");
        },
      },
      actionItemExtractService: {
        async extractActionItems() {
          throw new Error("empty message should not call Hermes");
        },
      },
    });

    await expect(
      service.organizeMessage({
        accountId: "account_1",
        messageId: "message_1",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesMessageOrganizationRequestError);
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
      bucket: "P1 Urgent",
      priorityScore: 96,
      reasons: ["Direct to you"],
    },
    to: ["me@example.com"],
    cc: [],
    bodyText: "Please confirm the launch schedule.",
    attachments: [],
    ...overrides,
  };
}

function label(name: string) {
  return {
    id: `label_${name}`,
    accountId: "account_1",
    name,
    color: "blue" as const,
    messageCount: 1,
    createdAt: "2026-06-16T09:00:00.000Z",
  };
}

function priorityResult() {
  return {
    skillRunId: "run_priority_1",
    skillId: "priority_triage" as const,
    priority: "high" as const,
    bucket: "P1 Urgent" as const,
    score: 94,
    reasons: ["deadline today"],
  };
}

function labelResult() {
  return {
    skillRunId: "run_labels_1",
    skillId: "label_suggest" as const,
    labels: [],
    actions: [],
  };
}

function newsletterResult() {
  return {
    skillRunId: "run_newsletter_1",
    skillId: "newsletter_cleanup" as const,
    isNewsletter: false,
    confidence: 0.88,
    senderCategory: "personal" as const,
    reasons: [],
    actions: [],
  };
}

function actionItemResult() {
  return {
    skillRunId: "run_actions_1",
    skillId: "action_item_extract" as const,
    items: [],
  };
}
