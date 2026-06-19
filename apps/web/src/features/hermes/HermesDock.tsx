import { useState } from "react";
import type { FormEvent } from "react";
import { Send, Sparkles, X } from "lucide-react";
import type {
  HermesActionPlanDto,
  HermesEmailSearchQaResult,
  HermesMemoryDto,
  HermesRuleCandidateDto,
  HermesRuleHistoryBackfillDto,
  HermesRuleSimulationDto,
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
  noticeActionLabel?: string;
  formatDate: (value: string) => string;
  onPromptChange: (value: string) => void;
  onOpen: () => void;
  onSubmit: (prompt: string) => void;
  onApproveRule: () => void;
  onNoticeAction?: () => void;
  onOpenSearch: (query: string, options?: HermesSearchLaunchOptions) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  function showDock() {
    if (!isOpen) {
      props.onOpen();
    }
    setIsOpen(true);
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
  const hasAssistantOutput = Boolean(props.notice || result || ruleCandidate);

  function submitSuggestedPrompt(prompt: string) {
    showDock();
    props.onPromptChange(prompt);
    props.onSubmit(prompt);
  }

  const dockBody = (
    <div className="dock-body" aria-label="Hermes 内容">
      <HermesWorkspaceContextBar
        context={props.workspaceContext}
        loading={props.workspaceContextLoading}
      />
      {props.notice ? (
        <HermesNotice
          className="dock-result-status"
          notice={props.notice}
          actionLabel={props.noticeActionLabel}
          onAction={props.onNoticeAction}
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
                  aria-label={`打开引用邮件 ${citation.subject}`}
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
                    {props.formatDate(citation.receivedAt)} · {citation.bucket}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
          <button
            className="dock-action"
            type="button"
            aria-label="打开搜索结果"
            onClick={() =>
              props.onOpenSearch(result.searchQuery, searchLaunchOptions)
            }
          >
            打开搜索结果
          </button>
        </div>
      ) : null}
      {ruleCandidate ? (
        <div className="dock-result" aria-label="Hermes 整理建议">
          <div className="dock-result-head">
            <strong>Hermes 整理建议</strong>
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
              整理到：{rulePreview.label} · 依据{" "}
              {rulePreview.keywords.slice(0, 5).join("，")}
            </p>
          ) : null}
          {props.ruleSimulation ? (
            <p>影响预览：命中 {props.ruleSimulation.matchedCount} 封邮件</p>
          ) : null}
          {props.historyBackfill ? (
            <p>已整理 {props.historyBackfill.appliedCount} 封历史邮件。</p>
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
              : "确认整理"}
          </button>
        </div>
      ) : null}
      {!hasAssistantOutput ? (
        <HermesDockEmptyState onPrompt={submitSuggestedPrompt} />
      ) : null}
    </div>
  );

  return (
    <section
      className={`hermes-dock is-blurred ${isOpen ? "is-open" : "is-collapsed"}`}
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
              placeholder="搜索邮件、总结、翻译或整理收件箱..."
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
            <button
              className="dock-close"
              type="button"
              aria-label="收起 Hermes"
              onClick={() => setIsOpen(false)}
            >
              <X size={18} />
            </button>
          </form>
          {dockBody}
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
    return null;
  }

  const context = props.context;
  if (!context) {
    return null;
  }
  const categoryCount = context.navigation?.quickCategories.length ?? 0;
  const chips = [
    context.accounts.length > 0 ? `${context.accounts.length} 个邮箱` : "",
    categoryCount > 0 ? `${categoryCount} 个分组` : "",
  ].filter(Boolean);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="dock-context" aria-label="Hermes 邮箱信息">
      {chips.map((chip) => (
        <span key={chip}>{chip}</span>
      ))}
    </div>
  );
}

function HermesDockEmptyState(props: { onPrompt: (prompt: string) => void }) {
  const suggestions = [
    "总结今天最重要的邮件",
    "找最近收到的验证码",
    "整理发票和账单邮件",
    "帮我写一封跟进回复",
  ];

  return (
    <div className="dock-empty" aria-label="Hermes 快捷问题">
      <div className="dock-empty-head">
        <strong>想查什么？</strong>
        <span>直接问 Hermes，它会在邮箱里找答案、总结内容或整理邮件。</span>
      </div>
      <div className="dock-quick-prompts">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => props.onPrompt(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
