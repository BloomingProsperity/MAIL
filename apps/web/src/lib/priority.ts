export type PriorityBucket =
  | "P0 Pinned"
  | "P1 Urgent"
  | "P2 Important"
  | "P3 Needs Action"
  | "P4 FYI / Updates"
  | "P5 Transactions"
  | "P6 Feed"
  | "P7 Screen";

export interface PrioritySignals {
  directness: number;
  relationship: number;
  actionability: number;
  urgency: number;
  threadMomentum: number;
  userContext: number;
  noise: number;
  negativeHistory: number;
  pinned?: boolean;
  transaction?: boolean;
}

export interface PriorityResult {
  score: number;
  bucket: PriorityBucket;
  reasons: string[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function scoreMessage(input: PrioritySignals): PriorityResult {
  const signals: Required<PrioritySignals> = {
    pinned: false,
    transaction: false,
    ...input
  };

  const score =
    35 * clamp01(signals.directness) +
    25 * clamp01(signals.relationship) +
    20 * clamp01(signals.actionability) +
    15 * clamp01(signals.urgency) +
    10 * clamp01(signals.threadMomentum) +
    10 * clamp01(signals.userContext) -
    35 * clamp01(signals.noise) -
    25 * clamp01(signals.negativeHistory);

  const reasons: string[] = [];
  if (signals.pinned) reasons.push("置顶规则");
  if (signals.directness >= 0.75) reasons.push("直接发给你");
  if (signals.relationship >= 0.75) reasons.push("你常回复此发件人");
  if (signals.actionability >= 0.75) reasons.push("Hermes 识别为需要回复");
  if (signals.urgency >= 0.75) reasons.push("今天 17:00 截止");
  if (signals.userContext >= 0.65) reasons.push("来自项目标签");
  if (signals.noise >= 0.65) reasons.push("newsletter / bulk sender 扣分");
  if (signals.negativeHistory >= 0.65) reasons.push("你过去常忽略此类邮件");

  let bucket: PriorityBucket;
  if (signals.pinned) {
    bucket = "P0 Pinned";
  } else if (signals.noise >= 0.72) {
    bucket = "P6 Feed";
  } else if (signals.negativeHistory >= 0.85 && score < 20) {
    bucket = "P7 Screen";
  } else if (score >= 90 || signals.urgency >= 0.85) {
    bucket = "P1 Urgent";
  } else if (score >= 68) {
    bucket = "P2 Important";
  } else if (signals.actionability >= 0.7) {
    bucket = "P3 Needs Action";
  } else if (signals.transaction) {
    bucket = "P5 Transactions";
  } else {
    bucket = "P4 FYI / Updates";
  }

  return {
    score: Math.round(score),
    bucket,
    reasons
  };
}
