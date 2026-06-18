import { ApiRequestError } from "../../lib/emailHubApi";
import type {
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleExecutionDto,
} from "../../lib/emailHubApi";
import { formatHermesAuditSkillId } from "./hermesSkillLabels";

export function formatHermesRuleType(ruleType: string) {
  const labels: Record<string, string> = {
    content_label: "内容标签",
    sender_priority: "发件人优先级",
    sender_feed: "Feed 分类",
  };
  return labels[ruleType] ?? ruleType;
}

export function formatHermesRuleAction(action: Record<string, unknown>) {
  if (action.type === "apply_label") {
    const labelName =
      typeof action.labelName === "string" && action.labelName.trim()
        ? action.labelName.trim()
        : "标签";
    return `应用标签 ${labelName}`;
  }

  if (action.type === "classify_sender") {
    return typeof action.bucket === "string"
      ? `分类到 ${action.bucket}`
      : "发件人分类";
  }

  return typeof action.type === "string" ? action.type : "规则动作";
}

export function formatHermesRuleCondition(condition: Record<string, unknown>) {
  const keywords = condition.anyKeywords;
  if (Array.isArray(keywords)) {
    const visibleKeywords = keywords
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .slice(0, 4)
      .map((item) => item.trim());
    if (visibleKeywords.length > 0) {
      return `关键词 ${visibleKeywords.join("、")}`;
    }
  }

  if (typeof condition.senderEmail === "string" && condition.senderEmail.trim()) {
    return `发件人 ${condition.senderEmail.trim()}`;
  }

  if (typeof condition.domain === "string" && condition.domain.trim()) {
    return `域名 ${condition.domain.trim()}`;
  }

  return "条件已生成";
}

export function latestExecutionsByRuleId(
  executions: HermesRuleExecutionDto[],
): Record<string, HermesRuleExecutionDto> {
  const result: Record<string, HermesRuleExecutionDto> = {};
  for (const execution of executions) {
    if (!result[execution.ruleId]) {
      result[execution.ruleId] = execution;
    }
  }
  return result;
}

export function normalizeHermesRuleSortOrders(
  rules: HermesRuleDto[],
): HermesRuleDto[] {
  return rules
    .map((rule, index) => ({
      ...rule,
      sortOrder: hermesRuleSortOrderValue(rule, (index + 1) * 1000),
    }))
    .sort(compareHermesRulesByOrder);
}

function hermesRuleSortOrderValue(
  rule: HermesRuleDto,
  fallback: number,
): number {
  const sortOrder = Number(
    (rule as HermesRuleDto & { sortOrder?: unknown }).sortOrder,
  );
  return Number.isFinite(sortOrder) ? sortOrder : fallback;
}

function compareHermesRulesByOrder(
  a: HermesRuleDto,
  b: HermesRuleDto,
): number {
  return (
    hermesRuleSortOrderValue(a, Number.MAX_SAFE_INTEGER) -
      hermesRuleSortOrderValue(b, Number.MAX_SAFE_INTEGER) ||
    b.createdAt.localeCompare(a.createdAt) ||
    b.id.localeCompare(a.id)
  );
}

export function hermesActionPlanErrorNotice(
  error: unknown,
  action: "create" | "confirm",
): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "hermes_skill_disabled") {
      return hermesSkillDisabledNotice(
        error.skillId ?? "action_plan",
        error.requiredPermission,
      );
    }
    if (error.code === "hermes_action_plans_unavailable") {
      return "Hermes 执行计划存储暂时不可用，请联系管理员检查服务配置。";
    }
    if (error.code === "hermes_runtime_not_configured") {
      return "Hermes AI 服务还没配置，请到 Hermes 配置填写服务地址、模型和访问密钥。";
    }
  }

  return action === "create"
    ? "Hermes 执行计划暂时不可用。"
    : "Hermes 执行计划确认失败。";
}

export function hermesDisabledSkillIdFromError(
  error: unknown,
  fallbackSkillId: string,
): string | undefined {
  if (
    error instanceof ApiRequestError &&
    error.code === "hermes_skill_disabled"
  ) {
    return error.skillId ?? fallbackSkillId;
  }

  return undefined;
}

export function hermesSkillDisabledNotice(
  skillId: string,
  requiredPermission?: "body_read" | "memory_write",
): string {
  const skillLabel = formatHermesAuditSkillId(skillId);
  if (requiredPermission === "body_read") {
    return `Hermes ${skillLabel}能力缺少正文读取权限，请到 Hermes 配置 > 能力选项打开“${skillLabel}”的“读取正文”开关。`;
  }
  if (requiredPermission === "memory_write") {
    return `Hermes ${skillLabel}能力缺少记忆写入权限，请到 Hermes 配置 > 能力选项打开“${skillLabel}”的“写入记忆”开关。`;
  }

  return `Hermes ${skillLabel}能力已禁用，请到 Hermes 配置 > 能力选项启用“${skillLabel}”。`;
}

export function hermesRulePreview(
  candidate: HermesRuleCandidateDto,
): { label: string; keywords: string[] } | undefined {
  const savedView = hermesRuleSavedView(candidate.action);
  if (savedView) {
    return {
      label: savedView.label,
      keywords: savedView.keywords,
    };
  }

  const label = hermesRuleLabel(candidate.action);
  if (!label) {
    return undefined;
  }
  return {
    label,
    keywords: hermesRuleKeywords(candidate.condition),
  };
}

export function hermesRuleNavigationTarget(
  rule: HermesRuleDto,
):
  | { kind: "savedView"; id: string; label: string }
  | { kind: "label"; id: string; label: string }
  | undefined {
  const savedView = hermesRuleSavedView(rule.action);
  if (savedView?.id) {
    return { kind: "savedView", id: savedView.id, label: savedView.label };
  }

  const labelId = rule.action.labelId;
  const labelName = hermesRuleLabel(rule.action) ?? rule.title;
  if (typeof labelId === "string" && labelId.trim()) {
    return { kind: "label", id: labelId, label: labelName };
  }

  return undefined;
}

function hermesRuleSavedView(
  action: Record<string, unknown>,
): { id?: string; label: string; keywords: string[] } | undefined {
  if (action.type !== "ensure_saved_view" && action.type !== "apply_label") {
    return undefined;
  }
  const savedView = action.savedView;
  if (!savedView || typeof savedView !== "object" || Array.isArray(savedView)) {
    return undefined;
  }

  const record = savedView as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.label !== "string") {
    return undefined;
  }
  return {
    id: record.id,
    label: record.label,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.filter((keyword): keyword is string => typeof keyword === "string")
      : [],
  };
}

function hermesRuleLabel(action: Record<string, unknown>): string | undefined {
  if (action.type !== "apply_label" || typeof action.labelName !== "string") {
    return undefined;
  }
  return action.labelName;
}

function hermesRuleKeywords(condition: Record<string, unknown>): string[] {
  return Array.isArray(condition.anyKeywords)
    ? condition.anyKeywords.filter((keyword): keyword is string => typeof keyword === "string")
    : [];
}
