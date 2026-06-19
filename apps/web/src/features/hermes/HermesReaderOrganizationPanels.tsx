import { Sparkles } from "lucide-react";
import type {
  HermesActionItem,
  HermesMessageOrganizationResult,
  HermesMessageSummaryResult,
  MailAction,
  SmartInboxFeedbackAction,
} from "../../lib/emailHubApi";

export type HermesOrganizationApplyAction =
  | {
      id: string;
      label: string;
      kind: "smart_inbox";
      action: SmartInboxFeedbackAction;
    }
  | {
      id: string;
      label: string;
      kind: "mail";
      action: Extract<MailAction, "archive">;
    }
  | {
      id: string;
      label: string;
      kind: "label";
      labelName: string;
    };

export function HermesReaderSummaryPanel(props: {
  summary: HermesMessageSummaryResult;
}) {
  return (
    <div className="reason-box hermes-reader-result" role="status">
      <div>
        <Sparkles size={18} />
        <strong>Hermes 摘要</strong>
      </div>
      <p>{props.summary.summaryText}</p>
    </div>
  );
}

export function HermesReaderOrganizationPanel(props: {
  organization: HermesMessageOrganizationResult;
  applyBusyId?: string;
  formatDate: (value: string) => string;
  onApplyAction: (action: HermesOrganizationApplyAction) => void;
  onCreateActionItemFollowUp: (item: HermesActionItem, index: number) => void;
}) {
  const applyActions = hermesOrganizationApplyActions(props.organization);
  const unsupportedActionCount = hermesOrganizationUnsupportedActionCount(
    props.organization,
  );

  return (
    <div
      className="reason-box hermes-reader-result hermes-organize-result"
      role="status"
      aria-label="Hermes 整理建议"
    >
      <div>
        <Sparkles size={18} />
        <strong>Hermes 整理建议</strong>
      </div>
      <p>
        优先级：{formatHermesPriorityBucket(props.organization.priority.bucket)}
        {props.organization.priority.reasons.length > 0
          ? `，${props.organization.priority.reasons.join("，")}`
          : ""}
      </p>
      {props.organization.priority.explanation ? (
        <p>{props.organization.priority.explanation}</p>
      ) : null}
      {props.organization.labels.labels.length > 0 ? (
        <p>
          标签：{" "}
          {props.organization.labels.labels
            .map((label) =>
              label.reason ? `${label.name}（${label.reason}）` : label.name,
            )
            .join("，")}
        </p>
      ) : null}
      {props.organization.labels.actions.length > 0 ? (
        <p>
          建议动作：{" "}
          {props.organization.labels.actions.map(formatHermesLabelAction).join("，")}
        </p>
      ) : null}
      <p>
        订阅判断：{formatHermesNewsletterCategory(
          props.organization.newsletter.senderCategory,
          props.organization.newsletter.isNewsletter,
        )}
        {props.organization.newsletter.reasons.length > 0
          ? `，${props.organization.newsletter.reasons.join("，")}`
          : ""}
      </p>
      {props.organization.newsletter.actions.length > 0 ? (
        <p>
          订阅建议：{" "}
          {props.organization.newsletter.actions
            .map(formatHermesNewsletterAction)
            .join("，")}
        </p>
      ) : null}
      {applyActions.length > 0 ? (
        <div className="hermes-apply-actions" aria-label="Hermes 可执行整理动作">
          {applyActions.map((action) => (
            <button
              key={action.id}
              className="tiny-button"
              type="button"
              aria-label={`执行 Hermes 整理动作：${action.label}`}
              disabled={Boolean(props.applyBusyId)}
              onClick={() => props.onApplyAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {unsupportedActionCount > 0 ? (
        <p>
          还有 {unsupportedActionCount} 条建议需要标签、稍后或退订能力，当前仅展示不执行。
        </p>
      ) : null}
      {props.organization.actionItems.items.length > 0 ? (
        <ul className="hermes-action-list">
          {props.organization.actionItems.items.map((item, index) => {
            const applyId = hermesActionItemApplyId(item, index);
            return (
              <li key={hermesActionItemKey(item, index)}>
                <span>
                  <strong>{item.title}</strong>
                  {item.owner ? ` · ${item.owner}` : ""}
                  {item.dueText ?? item.dueAt
                    ? ` · ${item.dueText ?? props.formatDate(item.dueAt!)}`
                    : ""}
                  {item.priority ? ` · ${formatHermesActionItemPriority(item.priority)}` : ""}
                </span>
                {item.dueAt ? (
                  <button
                    className="tiny-button"
                    type="button"
                    aria-label={`创建 Hermes 跟进提醒：${item.title}`}
                    disabled={Boolean(props.applyBusyId)}
                    onClick={() => props.onCreateActionItemFollowUp(item, index)}
                  >
                    创建提醒
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>待办：未发现明确待办。</p>
      )}
    </div>
  );
}

export function hermesOrganizationApplyActions(
  result: HermesMessageOrganizationResult,
): HermesOrganizationApplyAction[] {
  const actions = new Map<string, HermesOrganizationApplyAction>();
  const add = (action: HermesOrganizationApplyAction) => {
    if (!actions.has(action.id)) {
      actions.set(action.id, action);
    }
  };

  for (const action of result.labels.actions) {
    if (action.type === "archive") {
      add({ id: "mail:archive", kind: "mail", action: "archive", label: "归档" });
    }
    if (action.type === "apply_label" && action.label?.trim()) {
      const labelName = action.label.trim();
      add({
        id: `label:${labelName.toLowerCase()}`,
        kind: "label",
        label: `应用标签 ${labelName}`,
        labelName,
      });
    }
    if (action.type === "move_to_feed") {
      add({
        id: "smart_inbox:move_to_feed",
        kind: "smart_inbox",
        action: "move_to_feed",
        label: "移到动态",
      });
    }
    if (action.type === "mark_important") {
      add({
        id: "smart_inbox:mark_important",
        kind: "smart_inbox",
        action: "mark_important",
        label: "标为重要",
      });
    }
  }

  for (const action of result.newsletter.actions) {
    if (action.type === "archive") {
      add({ id: "mail:archive", kind: "mail", action: "archive", label: "归档" });
    }
    if (action.type === "move_to_feed") {
      add({
        id: "smart_inbox:move_to_feed",
        kind: "smart_inbox",
        action: "move_to_feed",
        label: "移到动态",
      });
    }
    if (action.type === "mark_not_important") {
      add({
        id: "smart_inbox:mark_not_important",
        kind: "smart_inbox",
        action: "mark_not_important",
        label: "降低优先级",
      });
    }
  }

  return [...actions.values()];
}

export function hermesActionItemApplyId(
  item: HermesActionItem,
  index: number,
): string {
  return `followup:${hermesActionItemKey(item, index)}`;
}

function formatHermesPriorityBucket(bucket: string): string {
  if (bucket.includes("Urgent")) return "优先";
  if (bucket.includes("Important")) return "重要";
  if (bucket.includes("Feed")) return "动态";
  if (bucket.includes("Transactions")) return "通知";
  return "邮件";
}

function formatHermesNewsletterCategory(
  senderCategory: string,
  isNewsletter: boolean,
): string {
  if (isNewsletter) return "订阅邮件";
  if (senderCategory === "personal") return "个人邮件";
  if (senderCategory === "transactional") return "通知邮件";
  return "普通邮件";
}

function formatHermesActionItemPriority(priority: string): string {
  const labels: Record<string, string> = {
    high: "高",
    medium: "中",
    low: "低",
  };
  return labels[priority.toLowerCase()] ?? priority;
}

export function formatHermesActionItemNote(item: HermesActionItem): string {
  return [
    item.owner ? `负责人：${item.owner}` : undefined,
    item.priority ? `优先级：${item.priority}` : undefined,
    item.status ? `状态：${item.status}` : undefined,
    item.sourceQuote ? `来源：${item.sourceQuote}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function hermesOrganizationUnsupportedActionCount(
  result: HermesMessageOrganizationResult,
): number {
  const unsupportedLabelActions = result.labels.actions.filter(
    (action) =>
      (action.type === "apply_label" && !action.label?.trim()) ||
      action.type === "snooze" ||
      action.type === "keep_in_inbox",
  ).length;
  const unsupportedNewsletterActions = result.newsletter.actions.filter(
    (action) => action.type === "unsubscribe_later" || action.type === "keep_in_inbox",
  ).length;
  return unsupportedLabelActions + unsupportedNewsletterActions;
}

function hermesActionItemKey(item: HermesActionItem, index: number): string {
  return `${index}:${item.title}:${item.dueAt ?? item.dueText ?? ""}`;
}

function formatHermesLabelAction(
  action: HermesMessageOrganizationResult["labels"]["actions"][number],
): string {
  const actionLabels: Record<typeof action.type, string> = {
    apply_label: "应用标签",
    archive: "归档",
    snooze: "稍后",
    keep_in_inbox: "保留收件箱",
    move_to_feed: "移入动态",
    mark_important: "标为重要",
  };
  const target = action.label ?? action.snoozeUntil;
  const base = target ? `${actionLabels[action.type]} ${target}` : actionLabels[action.type];
  return action.reason ? `${base}（${action.reason}）` : base;
}

function formatHermesNewsletterAction(
  action: HermesMessageOrganizationResult["newsletter"]["actions"][number],
): string {
  const actionLabels: Record<typeof action.type, string> = {
    move_to_feed: "移入动态",
    archive: "归档",
    unsubscribe_later: "稍后退订",
    keep_in_inbox: "保留收件箱",
    mark_not_important: "降低优先级",
  };
  const base = action.unsubscribeUrl
    ? `${actionLabels[action.type]} ${action.unsubscribeUrl}`
    : actionLabels[action.type];
  return action.reason ? `${base}（${action.reason}）` : base;
}
