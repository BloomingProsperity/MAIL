import type {
  MailQuickFilter,
  MailSearchScope,
  ListMessagesInput,
} from "../mail-read/mail-read-store.js";

export interface HermesEmailSearchPlanFilter {
  field: string;
  operator: "contains" | "gte" | "lt" | "eq";
  value: string | boolean;
  label: string;
}

export interface HermesEmailSearchPlan {
  searchQuery: string;
  quickFilters: MailQuickFilter[];
  qScopes: MailSearchScope[];
  filters: HermesEmailSearchPlanFilter[];
  listMessagesInput: Pick<
    ListMessagesInput,
    | "q"
    | "quickFilters"
    | "qScopes"
    | "senderQuery"
    | "recipientQuery"
    | "receivedAfter"
    | "receivedBefore"
    | "hasAttachment"
  >;
  explanation: string[];
}

export interface PlanHermesEmailSearchInput {
  question: string;
  searchQuery?: string;
  now: string;
}

const DEFAULT_SCOPES: MailSearchScope[] = [
  "sender",
  "recipients",
  "subject",
  "body",
];

const SEARCH_STOP_WORDS = [
  "帮我",
  "查找",
  "搜索",
  "找到",
  "邮件",
  "封邮件",
  "带附件",
  "有附件",
  "包含附件",
  "未读",
  "星标",
  "今天",
  "昨天",
  "本周",
  "上周",
  "最近",
  "from",
  "to",
  "with attachment",
  "with attachments",
  "has attachment",
  "unread",
  "starred",
  "today",
  "yesterday",
  "this week",
  "last week",
  "last",
  "past",
  "days",
  "day",
  "emails",
  "email",
  "mail",
  "find",
  "search",
  "show",
  "me",
  "the",
  "a",
  "an",
];

export function planHermesEmailSearch(
  input: PlanHermesEmailSearchInput,
): HermesEmailSearchPlan {
  const question = normalizeWhitespace(input.question);
  const quickFilters = new Set<MailQuickFilter>();
  const filters: HermesEmailSearchPlanFilter[] = [];
  const explanations: string[] = [];
  let qScopes = [...DEFAULT_SCOPES];
  let senderQuery: string | undefined;
  let recipientQuery: string | undefined;
  let receivedAfter: string | undefined;
  let receivedBefore: string | undefined;
  let hasAttachment: boolean | undefined;

  if (/(带附件|有附件|包含附件|附件|with attachments?|has attachments?)/i.test(question)) {
    quickFilters.add("attachments");
    hasAttachment = true;
    filters.push({
      field: "hasAttachment",
      operator: "eq",
      value: true,
      label: "有附件",
    });
    explanations.push("限制为带附件的邮件。");
  }

  if (/(未读|unread)/i.test(question)) {
    quickFilters.add("unread");
    filters.push({
      field: "unread",
      operator: "eq",
      value: true,
      label: "未读",
    });
    explanations.push("限制为未读邮件。");
  }

  if (/(星标|starred|flagged)/i.test(question)) {
    quickFilters.add("starred");
    filters.push({
      field: "starred",
      operator: "eq",
      value: true,
      label: "星标",
    });
    explanations.push("限制为星标邮件。");
  }

  const dateRange = detectDateRange(question, input.now);
  if (dateRange) {
    receivedAfter = dateRange.after;
    receivedBefore = dateRange.before;
    filters.push({
      field: "receivedAt",
      operator: "gte",
      value: receivedAfter,
      label: `${dateRange.label} 起`,
    });
    filters.push({
      field: "receivedAt",
      operator: "lt",
      value: receivedBefore,
      label: `${dateRange.label} 止`,
    });
    explanations.push(`限制为${dateRange.label}收到的邮件。`);
  }

  senderQuery = detectSenderQuery(question);
  if (senderQuery) {
    filters.push({
      field: "sender",
      operator: "contains",
      value: senderQuery,
      label: `发件人包含 ${senderQuery}`,
    });
    explanations.push(`限制发件人包含 ${senderQuery}。`);
  }

  recipientQuery = detectRecipientQuery(question);
  if (recipientQuery) {
    filters.push({
      field: "recipient",
      operator: "contains",
      value: recipientQuery,
      label: `收件人包含 ${recipientQuery}`,
    });
    explanations.push(`限制收件人包含 ${recipientQuery}。`);
  }

  if (/(主题|subject)/i.test(question)) {
    qScopes = ["subject"];
    explanations.push("只搜索主题。");
  } else if (/(正文|内容|body|text)/i.test(question)) {
    qScopes = ["body"];
    explanations.push("只搜索正文和索引文本。");
  }

  const explicitSearchQuery = input.searchQuery?.trim();
  const searchQuery =
    explicitSearchQuery && explicitSearchQuery.length > 0
      ? explicitSearchQuery
      : deriveSearchQuery(question, {
          senderQuery,
          recipientQuery,
          dateLabel: dateRange?.label,
        });

  return {
    searchQuery,
    quickFilters: [...quickFilters],
    qScopes,
    filters,
    listMessagesInput: compactPlanInput({
      q: searchQuery,
      quickFilters: [...quickFilters],
      qScopes,
      senderQuery,
      recipientQuery,
      receivedAfter,
      receivedBefore,
      hasAttachment,
    }),
    explanation:
      explanations.length > 0
        ? explanations
        : ["使用问题中的关键词搜索发件人、收件人、主题和正文。"],
  };
}

function detectDateRange(
  question: string,
  now: string,
): { label: string; after: string; before: string } | undefined {
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) {
    return undefined;
  }

  if (/(今天|today)/i.test(question)) {
    const start = startOfUtcDay(current);
    return {
      label: "今天",
      after: start.toISOString(),
      before: addDays(start, 1).toISOString(),
    };
  }

  if (/(昨天|yesterday)/i.test(question)) {
    const start = addDays(startOfUtcDay(current), -1);
    return {
      label: "昨天",
      after: start.toISOString(),
      before: addDays(start, 1).toISOString(),
    };
  }

  if (/(本周|this week)/i.test(question)) {
    const start = startOfUtcWeek(current);
    return {
      label: "本周",
      after: start.toISOString(),
      before: addDays(start, 7).toISOString(),
    };
  }

  if (/(上周|last week)/i.test(question)) {
    const start = addDays(startOfUtcWeek(current), -7);
    return {
      label: "上周",
      after: start.toISOString(),
      before: addDays(start, 7).toISOString(),
    };
  }

  const recentDays = /(?:最近|近|last|past)\s*(\d{1,2})\s*(?:天|days?)/i.exec(
    question,
  );
  if (recentDays) {
    const days = Number.parseInt(recentDays[1], 10);
    if (Number.isInteger(days) && days > 0 && days <= 90) {
      return {
        label: `最近 ${days} 天`,
        after: addDays(current, -days).toISOString(),
        before: current.toISOString(),
      };
    }
  }

  const isoDate = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(question);
  if (isoDate) {
    const start = startOfUtcDay(new Date(`${isoDate[1]}T00:00:00.000Z`));
    if (!Number.isNaN(start.getTime())) {
      return {
        label: isoDate[1],
        after: start.toISOString(),
        before: addDays(start, 1).toISOString(),
      };
    }
  }

  return undefined;
}

function detectSenderQuery(question: string): string | undefined {
  const explicit =
    /(?:from|sender|发件人|来自|由)\s*[:：]?\s*([^\s,，。；;]+)/i.exec(
      question,
    )?.[1] ?? /([A-Z][a-zA-Z0-9._%+-]{1,63})\s*(?:发来|发的|sent)/.exec(question)?.[1];
  if (explicit) {
    return sanitizeParticipant(explicit);
  }

  const capitalized = /\b([A-Z][a-zA-Z0-9._%+-]{2,63})\b/.exec(question)?.[1];
  return capitalized && !isLikelySearchKeyword(capitalized)
    ? sanitizeParticipant(capitalized)
    : undefined;
}

function detectRecipientQuery(question: string): string | undefined {
  const explicit =
    /(?:to|recipient|收件人|发给|给)\s*[:：]?\s*([^\s,，。；;]+)/i.exec(
      question,
    )?.[1];
  return explicit ? sanitizeParticipant(explicit) : undefined;
}

function deriveSearchQuery(
  question: string,
  context: {
    senderQuery?: string;
    recipientQuery?: string;
    dateLabel?: string;
  },
): string {
  let query = question;
  for (const value of [
    context.senderQuery,
    context.recipientQuery,
    context.dateLabel,
  ]) {
    if (value) {
      query = query.replace(new RegExp(escapeRegExp(value), "gi"), " ");
    }
  }
  for (const word of SEARCH_STOP_WORDS) {
    query = query.replace(stopWordPattern(word), " ");
  }

  query = query
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\b/g, " ")
    .replace(/[?？,，。；;:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return query.length > 0 ? query.slice(0, 128) : question.slice(0, 128);
}

function compactPlanInput(
  input: HermesEmailSearchPlan["listMessagesInput"],
): HermesEmailSearchPlan["listMessagesInput"] {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    }),
  ) as HermesEmailSearchPlan["listMessagesInput"];
}

function sanitizeParticipant(value: string): string | undefined {
  const cleaned = value.replace(/[<>()"'“”‘’]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 128) : undefined;
}

function isLikelySearchKeyword(value: string): boolean {
  return /^(OTP|Q[1-4]|FYI|PDF|HTML|API|RE|FWD|Which|Where|What|When|Who|Please|Find|Search|Show)$/i.test(
    value,
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function startOfUtcWeek(value: Date): Date {
  const day = value.getUTCDay() || 7;
  return addDays(startOfUtcDay(value), 1 - day);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stopWordPattern(value: string): RegExp {
  const escaped = escapeRegExp(value);
  return /^[a-z0-9 ]+$/i.test(value)
    ? new RegExp(`\\b${escaped}\\b`, "gi")
    : new RegExp(escaped, "gi");
}
