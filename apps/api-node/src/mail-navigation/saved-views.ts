import type { MailNavigationTone } from "./navigation-summary.js";

export type SavedViewKind = "keyword" | "message_fact";

export interface SavedViewDefinition {
  id: string;
  label: string;
  tone: MailNavigationTone;
  kind: SavedViewKind;
  keywords: string[];
  minAttachmentCount?: number;
}

export interface BuiltInSavedView extends SavedViewDefinition {}

const BUILT_IN_SAVED_VIEWS: BuiltInSavedView[] = [
  {
    id: "codes",
    label: "验证码",
    tone: "blue",
    kind: "keyword",
    keywords: [
      "验证码",
      "驗證碼",
      "动态码",
      "安全码",
      "verification",
      "security code",
      "otp",
      "one-time code",
    ],
  },
  {
    id: "receipts",
    label: "发票/账单",
    tone: "green",
    kind: "keyword",
    keywords: [
      "发票",
      "發票",
      "账单",
      "賬單",
      "收据",
      "收據",
      "invoice",
      "receipt",
      "billing",
      "statement",
    ],
  },
  {
    id: "meetings",
    label: "会议/日程",
    tone: "purple",
    kind: "keyword",
    keywords: [
      "会议",
      "會議",
      "日程",
      "邀请",
      "邀請",
      "meeting",
      "calendar",
      "invite",
      "appointment",
    ],
  },
  {
    id: "travel",
    label: "旅行/酒店/机票",
    tone: "purple",
    kind: "keyword",
    keywords: [
      "旅行",
      "航班",
      "酒店",
      "机票",
      "機票",
      "itinerary",
      "flight",
      "hotel",
      "booking",
    ],
  },
  {
    id: "shipping",
    label: "快递/物流",
    tone: "yellow",
    kind: "keyword",
    keywords: [
      "快递",
      "快遞",
      "物流",
      "订单",
      "訂單",
      "tracking",
      "shipment",
      "shipping",
      "delivery",
      "order",
    ],
  },
  {
    id: "notifications",
    label: "系统告警",
    tone: "coral",
    kind: "keyword",
    keywords: [
      "通知",
      "提醒",
      "告警",
      "警报",
      "alert",
      "notification",
      "notice",
      "no-reply",
      "noreply",
    ],
  },
  {
    id: "newsletters",
    label: "订阅/营销",
    tone: "purple",
    kind: "keyword",
    keywords: [
      "订阅",
      "訂閱",
      "营销",
      "unsubscribe",
      "newsletter",
      "digest",
      "promotion",
      "campaign",
    ],
  },
  {
    id: "needs_reply",
    label: "待回复",
    tone: "coral",
    kind: "message_fact",
    keywords: [
      "待回复",
      "需要回复",
      "请回复",
      "请确认",
      "reply",
      "respond",
      "please confirm",
      "needs action",
    ],
  },
  {
    id: "large_attachments",
    label: "大附件",
    tone: "blue",
    kind: "message_fact",
    keywords: ["附件", "大附件", "attachment", "file"],
    minAttachmentCount: 1,
  },
];

export function getBuiltInSavedViews(): BuiltInSavedView[] {
  return BUILT_IN_SAVED_VIEWS.map((view) => ({
    ...view,
    keywords: [...view.keywords],
  }));
}

export function getBuiltInSavedViewIds(): string[] {
  return BUILT_IN_SAVED_VIEWS.map((view) => view.id);
}

export function findBuiltInSavedView(
  id: string,
): BuiltInSavedView | undefined {
  const normalized = id.trim().toLowerCase();
  const view = BUILT_IN_SAVED_VIEWS.find((candidate) => candidate.id === normalized);
  return view ? { ...view, keywords: [...view.keywords] } : undefined;
}

export function getSavedViewKeywordValuesSql(): string {
  return getBuiltInSavedViews()
    .filter((view) => view.minAttachmentCount === undefined)
    .map(
      (view) =>
        `('${escapeSqlLiteral(view.id)}', ARRAY[${view.keywords
          .map((keyword) => `'${escapeSqlLiteral(keyword)}'`)
          .join(", ")}])`,
    )
    .join(",\n              ");
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
