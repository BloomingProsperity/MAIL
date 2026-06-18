import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import type {
  HermesActionPlanDto,
  HermesEmailSearchQaResult,
  HermesMemoryDto,
  HermesRuleCandidateDto,
  HermesRuleHistoryBackfillDto,
  HermesRuleSimulationDto,
  HermesSkillRequiredPermission,
  HermesWorkspaceContextDto,
} from "../../lib/emailHubApi";
import { hermesRulePreview } from "./hermesRules";
import {
  searchLaunchFromHermesResult,
  type HermesSearchLaunchOptions,
} from "./hermesSearchLaunch";
import { HermesNotice } from "./HermesNotice";

export function HermesDock(props: {
  prompt: string;
  notice?: string;
  result?: HermesEmailSearchQaResult;
  searchAccountId?: string;
  actionPlan?: HermesActionPlanDto;
  ruleCandidate?: HermesRuleCandidateDto;
  ruleSimulation?: HermesRuleSimulationDto;
  historyBackfill?: HermesRuleHistoryBackfillDto;
  learnedMemory?: HermesMemoryDto;
  workspaceContext?: HermesWorkspaceContextDto;
  workspaceContextLoading?: boolean;
  busy: boolean;
  noticeActionSkillId?: string;
  noticeActionPermission?: HermesSkillRequiredPermission;
  noticeActionLabel?: string;
  formatDate: (value: string) => string;
  onPromptChange: (value: string) => void;
  onOpen: () => void;
  onSubmit: (prompt: string) => void;
  onApproveRule: () => void;
  onNoticeAction?: () => void;
  onOpenSearch: (query: string, options?: HermesSearchLaunchOptions) => void;
  onOpenHermesSkillSettings: (
    skillId: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activityVersion, setActivityVersion] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsOpen(false);
    }, 5_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activityVersion, isOpen, props.prompt]);

  function showDock() {
    if (!isOpen) {
      props.onOpen();
    }
    setIsOpen(true);
    setActivityVersion((version) => version + 1);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    showDock();
    props.onSubmit(props.prompt);
  }

  const result = props.result;
  const actionPlan = props.actionPlan;
  const ruleCandidate = props.ruleCandidate;
  const rulePreview = ruleCandidate
    ? hermesRulePreview(ruleCandidate)
    : undefined;
  const searchLaunchOptions = result
    ? searchLaunchFromHermesResult(result, props.searchAccountId)
    : undefined;

  return (
    <section
      className={`hermes-dock dock-short is-blurred ${isOpen ? "is-open" : "is-collapsed"}`}
      aria-label="Hermes 底部输入"
      onFocus={showDock}
      onMouseMove={isOpen ? showDock : undefined}
    >
      {!isOpen ? (
        <button
          className="dock-launcher"
          type="button"
          aria-label="打开 Hermes"
          onClick={showDock}
        >
          <Sparkles size={18} />
          <span>随便问问</span>
        </button>
      ) : (
        <>
          <form className="dock-command-form" onSubmit={submitPrompt}>
            <button className="dock-model" type="button" onClick={showDock}>
              <Sparkles size={18} />
              Hermes
            </button>
            <input
              className="dock-command-input"
              aria-label="Hermes 指令"
              value={props.prompt}
              placeholder="搜索邮件、创建规则、整理收件箱..."
              onChange={(event) => {
                props.onPromptChange(event.target.value);
                showDock();
              }}
              onKeyDown={showDock}
            />
            <button
              className="dock-send"
              type="submit"
              aria-label="发送给 Hermes"
              disabled={props.busy}
            >
              <Send size={18} />
            </button>
          </form>
          <HermesWorkspaceContextBar
            context={props.workspaceContext}
            loading={props.workspaceContextLoading}
          />
          {props.notice ? (
            <HermesNotice
              className="dock-result-status"
              notice={props.notice}
              skillId={props.noticeActionSkillId}
              requiredPermission={props.noticeActionPermission}
              actionLabel={props.noticeActionLabel}
              onAction={props.onNoticeAction}
              onOpenSkillSettings={props.onOpenHermesSkillSettings}
            />
          ) : null}
          {result ? (
            <div className="dock-result" aria-label="Hermes 搜索回答">
              <div className="dock-result-head">
                <strong>Hermes 搜索回答</strong>
                <span>{result.searchQuery}</span>
              </div>
              {result.searchPlan.filters.length > 0 ? (
                <div className="dock-plan-steps" aria-label="Hermes 搜索条件">
                  {result.searchPlan.filters.slice(0, 4).map((filter) => (
                    <span key={`${filter.field}-${filter.label}`}>
                      {filter.label}
                    </span>
                  ))}
                </div>
              ) : null}
              <p>{result.answerText}</p>
              {result.citations.length > 0 ? (
                <div className="dock-citations" aria-label="Hermes 引用邮件">
                  {result.citations.slice(0, 3).map((citation) => (
                    <button
                      className="dock-citation"
                      type="button"
                      key={`${citation.messageId}-${citation.resultIndex}`}
                      aria-label={`Hermes citation ${citation.subject}`}
                      onClick={() =>
                        props.onOpenSearch(
                          result.searchQuery,
                          searchLaunchOptions,
                        )
                      }
                    >
                      <span>{citation.subject}</span>
                      <small>
                        {citation.from.name ?? citation.from.email} ·{" "}
                        {props.formatDate(citation.receivedAt)} ·{" "}
                        {citation.bucket}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                className="dock-action"
                type="button"
                onClick={() =>
                  props.onOpenSearch(result.searchQuery, searchLaunchOptions)
                }
              >
                同步到搜索页
              </button>
            </div>
          ) : null}
          {ruleCandidate ? (
            <div className="dock-result" aria-label="Hermes 执行计划">
              <div className="dock-result-head">
                <strong>Hermes 执行计划</strong>
                <span>
                  {actionPlan?.status === "completed" ||
                  ruleCandidate.status === "approved"
                    ? "已完成"
                    : "待确认"}
                </span>
              </div>
              <p>{ruleCandidate.title}</p>
              {rulePreview ? (
                <p>
                  左侧分组：{rulePreview.label} · 关键词{" "}
                  {rulePreview.keywords.slice(0, 5).join("，")}
                </p>
              ) : null}
              {actionPlan ? (
                <div className="dock-plan-steps" aria-label="Hermes 执行步骤">
                  {actionPlan.steps.slice(0, 4).map((step) => (
                    <span key={step.id}>
                      {step.status === "completed" ? "✓" : "·"} {step.title}
                    </span>
                  ))}
                </div>
              ) : null}
              {props.ruleSimulation ? (
                <p>
                  试运行：命中 {props.ruleSimulation.matchedCount} 封邮件
                </p>
              ) : null}
              {props.historyBackfill ? (
                <p>
                  历史回填：匹配 {props.historyBackfill.matchedCount} 封，新增{" "}
                  {props.historyBackfill.appliedCount} 个标签关联
                </p>
              ) : null}
              {props.learnedMemory ? (
                <p>用户习惯学习：已写入 {props.learnedMemory.layer}</p>
              ) : null}
              {actionPlan ? (
                <p>
                  安全边界：
                  {actionPlan.safety.providerWriteback ? "会写回服务商" : "不写回服务商"}
                  {" · "}
                  {actionPlan.safety.appliesToHistory
                    ? "会处理历史邮件"
                    : "不回填历史"}
                </p>
              ) : null}
              <button
                className="dock-action"
                type="button"
                disabled={
                  props.busy ||
                  ruleCandidate.status === "approved" ||
                  actionPlan?.status === "completed"
                }
                onClick={props.onApproveRule}
              >
                {actionPlan?.status === "completed" ||
                ruleCandidate.status === "approved"
                  ? "已完成"
                  : "确认计划"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function HermesWorkspaceContextBar(props: {
  context?: HermesWorkspaceContextDto;
  loading?: boolean;
}) {
  if (props.loading && !props.context) {
    return (
      <div className="dock-context" role="status">
        <span>正在读取邮箱环境...</span>
      </div>
    );
  }

  const context = props.context;
  if (!context) {
    return null;
  }

  const confirmationBoundary = context.operationBoundaries.find(
    (boundary) => boundary.mode === "confirmation_required",
  );
  const statusLabel =
    context.mailEngine?.readiness.status === "ready"
      ? "邮件同步服务正常"
      : "邮件同步服务需检查";

  return (
    <div className="dock-context" aria-label="Hermes 邮箱环境">
      <span>{context.accounts.length} 个账号</span>
      <span>{context.navigation?.quickCategories.length ?? 0} 个分组</span>
      <span>{context.rules.length} 条规则</span>
      <span>{statusLabel}</span>
      {confirmationBoundary ? <span>规则需确认</span> : null}
    </div>
  );
}
