import { describe, expect, it } from "vitest";

import { classifySmartInboxMessage } from "../src/smart-inbox/classifier";

describe("Smart Inbox classifier", () => {
  it("puts urgent direct customer requests ahead with explainable reasons", () => {
    const classification = classifySmartInboxMessage({
      subject: "请今天 17:00 前确认 Q2 合作方案",
      fromEmail: "client@example.com",
      fromName: "张伟 客户成功",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "请确认是否可以继续推进，如果有问题请回复。",
      bodyText: "麻烦今天 17:00 前回复确认。",
      unread: true,
      starred: false,
      attachments: [],
    });

    expect(classification.bucket).toBe("P1 Urgent");
    expect(classification.priorityScore).toBeGreaterThanOrEqual(90);
    expect(classification.reasons).toEqual(
      expect.arrayContaining([
        "直接发给你",
        "识别为需要回复",
        "包含紧急时间信号",
      ]),
    );
  });

  it("keeps newsletters and promotional senders below customer requests", () => {
    const customerRequest = classifySmartInboxMessage({
      subject: "需求文档 V2.1 请确认",
      fromEmail: "customer@example.com",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "更新后的需求文档已经上传，请查看并回复。",
      bodyText: "请回复是否需要调整。",
      unread: true,
      starred: false,
      attachments: [],
    });
    const newsletter = classifySmartInboxMessage({
      subject: "Weekly product newsletter and promo",
      fromEmail: "news@marketing.example.com",
      fromName: "Marketing Updates",
      toEmails: [],
      ccEmails: [],
      snippet: "Unsubscribe from this newsletter or view all promotions.",
      bodyText: "Sale, discount, unsubscribe, newsletter.",
      unread: true,
      starred: false,
      attachments: [],
    });

    expect(customerRequest.bucket).toBe("P3 Needs Action");
    expect(newsletter.bucket).toBe("P6 Feed");
    expect(newsletter.priorityScore).toBeLessThan(customerRequest.priorityScore);
    expect(newsletter.reasons).toContain("newsletter / bulk sender 扣分");
  });

  it("treats starred messages as pinned regardless of sender noise", () => {
    const classification = classifySmartInboxMessage({
      subject: "Newsletter but starred",
      fromEmail: "news@example.com",
      toEmails: [],
      ccEmails: [],
      snippet: "unsubscribe newsletter",
      unread: false,
      starred: true,
      attachments: [],
    });

    expect(classification.bucket).toBe("P0 Pinned");
    expect(classification.priorityScore).toBeGreaterThanOrEqual(95);
    expect(classification.reasons).toContain("已星标");
  });
  it("promotes future mail from an always-important sender rule", () => {
    const classification = classifySmartInboxMessage({
      subject: "Weekly product newsletter and promo",
      fromEmail: "news@marketing.example.com",
      toEmails: [],
      ccEmails: [],
      snippet: "Unsubscribe from this newsletter or view all promotions.",
      unread: true,
      starred: false,
      attachments: [],
      senderRules: ["always_important"],
    });

    expect(classification.bucket).toBe("P2 Important");
    expect(classification.priorityScore).toBeGreaterThanOrEqual(90);
    expect(classification.reasons).toContain("发件人总是重要");
  });

  it("screens future mail from a muted sender rule even when it looks urgent", () => {
    const classification = classifySmartInboxMessage({
      subject: "URGENT: please reply today",
      fromEmail: "client@example.com",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "Please reply today before 17:00.",
      unread: true,
      starred: false,
      attachments: [],
      senderRules: ["mute"],
    });

    expect(classification.bucket).toBe("P7 Screen");
    expect(classification.priorityScore).toBe(0);
    expect(classification.reasons).toContain("发件人已静音");
  });

  it("routes future mail from a feed sender rule to Feed", () => {
    const classification = classifySmartInboxMessage({
      subject: "Product update",
      fromEmail: "updates@example.com",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "Here is this week's product context.",
      unread: true,
      starred: false,
      attachments: [],
      senderRules: ["feed"],
    });

    expect(classification.bucket).toBe("P6 Feed");
    expect(classification.priorityScore).toBe(15);
    expect(classification.reasons).toContain("Sender rule: Feed");
    expect(classification.classifiedBy).toBe("rules");
  });

  it("screens first-time senders until Gatekeeper accepts them", () => {
    const classification = classifySmartInboxMessage({
      subject: "Intro from a new vendor",
      fromEmail: "new.vendor@example.com",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "Could we discuss a partnership?",
      unread: true,
      starred: false,
      attachments: [],
      senderRules: ["screen_unknown"],
    });

    expect(classification.bucket).toBe("P7 Screen");
    expect(classification.priorityScore).toBe(0);
    expect(classification.reasons).toContain("New sender needs approval");
  });

  it("keeps blocked senders in Screen regardless of message content", () => {
    const classification = classifySmartInboxMessage({
      subject: "URGENT: please reply today",
      fromEmail: "blocked@example.com",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "Please reply today before 17:00.",
      unread: true,
      starred: false,
      attachments: [],
      senderRules: ["blocked_sender"],
    });

    expect(classification.bucket).toBe("P7 Screen");
    expect(classification.priorityScore).toBe(0);
    expect(classification.reasons).toContain("Sender blocked");
  });

  it("applies approved Hermes sender classification rules with a visible reason", () => {
    const classification = classifySmartInboxMessage({
      subject: "Weekly product newsletter and promo",
      fromEmail: "news@example.com",
      toEmails: ["me@example.com"],
      ccEmails: [],
      snippet: "Unsubscribe newsletter.",
      unread: true,
      starred: false,
      attachments: [],
      hermesRules: [
        {
          bucket: "P6 Feed",
          priorityScore: 15,
          reason: "Hermes learned you move this sender to Feed.",
        },
      ],
    });

    expect(classification.bucket).toBe("P6 Feed");
    expect(classification.priorityScore).toBe(15);
    expect(classification.reasons).toEqual(
      expect.arrayContaining([
        "Hermes learned you move this sender to Feed.",
        "Hermes approved rule",
      ]),
    );
    expect(classification.classifiedBy).toBe("hermes_rules");
  });

  it("keeps starred messages pinned above approved Hermes rules", () => {
    const classification = classifySmartInboxMessage({
      subject: "Pinned but Hermes would route to feed",
      fromEmail: "news@example.com",
      toEmails: [],
      ccEmails: [],
      unread: false,
      starred: true,
      attachments: [],
      hermesRules: [
        {
          bucket: "P6 Feed",
          priorityScore: 15,
          reason: "Hermes learned you move this sender to Feed.",
        },
      ],
    });

    expect(classification.bucket).toBe("P0 Pinned");
    expect(classification.priorityScore).toBe(100);
    expect(classification.classifiedBy).toBe("rules");
  });
});
