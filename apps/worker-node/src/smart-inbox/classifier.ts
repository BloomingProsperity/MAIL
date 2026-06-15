export interface SmartInboxMessageInput {
  subject: string;
  fromEmail: string;
  fromName?: string;
  toEmails: string[];
  ccEmails: string[];
  snippet?: string;
  bodyText?: string;
  unread: boolean;
  starred: boolean;
  attachments: unknown[];
  senderRules?: SmartInboxSenderRule[];
  hermesRules?: SmartInboxHermesRule[];
}

export interface SmartInboxClassification {
  bucket: string;
  priorityScore: number;
  reasons: string[];
  classifiedBy: "rules" | "hermes_rules";
}

export type SmartInboxSenderRule =
  | "always_important"
  | "mute"
  | "personal"
  | "notifications"
  | "newsletters"
  | "feed"
  | "screen_unknown"
  | "blocked_sender"
  | "blocked_domain";

export interface SmartInboxHermesRule {
  bucket: string;
  priorityScore: number;
  reason?: string;
}

export function classifySmartInboxMessage(
  input: SmartInboxMessageInput,
): SmartInboxClassification {
  const reasons: string[] = [];
  const text = searchableText(input);
  let score = 20;

  if (input.senderRules?.includes("blocked_domain")) {
    return {
      bucket: "P7 Screen",
      priorityScore: 0,
      classifiedBy: "rules",
      reasons: ["Domain blocked"],
    };
  }

  if (input.senderRules?.includes("blocked_sender")) {
    return {
      bucket: "P7 Screen",
      priorityScore: 0,
      classifiedBy: "rules",
      reasons: ["Sender blocked"],
    };
  }

  if (input.senderRules?.includes("screen_unknown")) {
    return {
      bucket: "P7 Screen",
      priorityScore: 0,
      classifiedBy: "rules",
      reasons: ["New sender needs approval"],
    };
  }

  if (input.starred) {
    return {
      bucket: "P0 Pinned",
      priorityScore: 100,
      classifiedBy: "rules",
      reasons: ["已星标"],
    };
  }

  if (input.senderRules?.includes("mute")) {
    return {
      bucket: "P7 Screen",
      priorityScore: 0,
      classifiedBy: "rules",
      reasons: ["发件人已静音"],
    };
  }

  const categoryRule = firstCategorySenderRule(input.senderRules);
  if (categoryRule) {
    return categoryRuleClassification(categoryRule);
  }

  const direct = input.toEmails.length > 0;
  if (direct) {
    score += 35;
    reasons.push("直接发给你");
  } else if (input.ccEmails.length > 0) {
    score += 12;
    reasons.push("抄送给你");
  }

  if (looksLikeKnownRelationship(input, text)) {
    score += 18;
    reasons.push("疑似重要联系人");
  }

  const needsReply = looksActionable(text);
  if (needsReply) {
    score += 20;
    reasons.push("识别为需要回复");
  }

  const urgent = looksUrgent(text);
  if (urgent) {
    score += 18;
    reasons.push("包含紧急时间信号");
  }

  if (input.attachments.length > 0) {
    score += 5;
    reasons.push("包含附件");
  }

  const transaction = looksTransactional(text);
  if (transaction) {
    score += 10;
    reasons.push("交易或系统通知");
  }

  const noisy = looksLikeBulkSender(input, text);
  if (noisy) {
    score -= 45;
    reasons.push("newsletter / bulk sender 扣分");
  }

  if (input.senderRules?.includes("always_important")) {
    score = Math.max(score, 90);
    reasons.push("发件人总是重要");
  }

  const priorityScore = clampScore(score);
  const baseClassification: SmartInboxClassification = {
    bucket: chooseBucket({
      priorityScore,
      urgent,
      needsReply,
      noisy,
      transaction,
    }),
    priorityScore,
    reasons,
    classifiedBy: "rules",
  };

  return applyHermesRule(baseClassification, input.hermesRules);
}

function applyHermesRule(
  base: SmartInboxClassification,
  hermesRules: SmartInboxHermesRule[] | undefined,
): SmartInboxClassification {
  const rule = hermesRules?.find((item) => isKnownBucket(item.bucket));
  if (!rule) {
    return base;
  }

  return {
    bucket: rule.bucket,
    priorityScore: clampScore(rule.priorityScore),
    reasons: [
      ...base.reasons,
      ...(rule.reason ? [rule.reason] : []),
      "Hermes approved rule",
    ],
    classifiedBy: "hermes_rules",
  };
}

function firstCategorySenderRule(
  rules: SmartInboxSenderRule[] | undefined,
):
  | "personal"
  | "notifications"
  | "newsletters"
  | "feed"
  | undefined {
  return rules?.find(
    (rule): rule is "personal" | "notifications" | "newsletters" | "feed" =>
      rule === "personal" ||
      rule === "notifications" ||
      rule === "newsletters" ||
      rule === "feed",
  );
}

function categoryRuleClassification(
  rule: "personal" | "notifications" | "newsletters" | "feed",
): SmartInboxClassification {
  if (rule === "personal") {
    return {
      bucket: "P2 Important",
      priorityScore: 80,
      reasons: ["Sender rule: Personal"],
      classifiedBy: "rules",
    };
  }

  if (rule === "notifications") {
    return {
      bucket: "P4 FYI / Updates",
      priorityScore: 35,
      reasons: ["Sender rule: Notifications"],
      classifiedBy: "rules",
    };
  }

  if (rule === "newsletters") {
    return {
      bucket: "P6 Feed",
      priorityScore: 15,
      reasons: ["Sender rule: Newsletters"],
      classifiedBy: "rules",
    };
  }

  return {
    bucket: "P6 Feed",
    priorityScore: 15,
    reasons: ["Sender rule: Feed"],
    classifiedBy: "rules",
  };
}

function isKnownBucket(value: string): boolean {
  return (
    value === "P0 Pinned" ||
    value === "P1 Urgent" ||
    value === "P2 Important" ||
    value === "P3 Needs Action" ||
    value === "P4 FYI / Updates" ||
    value === "P5 Transactions" ||
    value === "P6 Feed" ||
    value === "P7 Screen"
  );
}

function chooseBucket(input: {
  priorityScore: number;
  urgent: boolean;
  needsReply: boolean;
  noisy: boolean;
  transaction: boolean;
}): string {
  if (input.urgent && input.needsReply) {
    return "P1 Urgent";
  }
  if (input.needsReply) {
    return "P3 Needs Action";
  }
  if (input.priorityScore >= 65) {
    return "P2 Important";
  }
  if (input.transaction) {
    return "P5 Transactions";
  }
  if (input.noisy) {
    return "P6 Feed";
  }
  return "P4 FYI / Updates";
}

function searchableText(input: SmartInboxMessageInput): string {
  return [
    input.subject,
    input.fromEmail,
    input.fromName,
    input.snippet,
    input.bodyText,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

function looksLikeKnownRelationship(
  input: SmartInboxMessageInput,
  text: string,
): boolean {
  const sender = input.fromEmail.toLowerCase();
  return (
    /client|customer|partner|vendor|support|sales|success/.test(sender) ||
    /客户|合作|供应商|技术支持|市场部|财务部|产品团队/.test(text)
  );
}

function looksActionable(text: string): boolean {
  return /请|确认|回复|review|approve|approval|action required|follow up|need|needs|todo|deadline|asap|麻烦|需要|待办|处理|查看/.test(
    text,
  );
}

function looksUrgent(text: string): boolean {
  return /urgent|asap|today|tonight|tomorrow|deadline|overdue|今天|明天|截止|到期|紧急|尽快|\b\d{1,2}:\d{2}\b|\b[ap]m\b/.test(
    text,
  );
}

function looksTransactional(text: string): boolean {
  return /invoice|receipt|payment|order|billing|statement|login|security|验证码|发票|收据|付款|订单|账单|登录|安全/.test(
    text,
  );
}

function looksLikeBulkSender(
  input: SmartInboxMessageInput,
  text: string,
): boolean {
  const sender = input.fromEmail.toLowerCase();
  return (
    /^no-?reply@/.test(sender) ||
    /^noreply@/.test(sender) ||
    /newsletter|marketing|promo|promotion|updates|digest|unsubscribe|sale|discount|campaign|邮件订阅|订阅|营销|促销|退订/.test(
      text,
    )
  );
}

function clampScore(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}
