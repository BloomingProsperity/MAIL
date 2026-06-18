import { useEffect, useRef, useState } from "react";
import type {
  EmailHubApi,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleSimulationDto,
} from "../../lib/emailHubApi";
import {
  formatHermesRuleAction,
  formatHermesRuleCondition,
  formatHermesRuleType,
  hermesActionPlanErrorNotice,
  hermesRuleNavigationTarget,
  normalizeHermesRuleSortOrders,
} from "./hermesRules";

export interface HermesRuleCandidateEditState {
  labelName: string;
  keywordsText: string;
  applyToHistory: boolean;
}

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export interface HermesRuleCandidateWorkbenchProps {
  api?: EmailHubApi;
  accountId?: string;
  previewRule: HermesRuleDto;
  previewCandidates: HermesRuleCandidateDto[];
  candidateDrafts: HermesRuleCandidateDto[];
  candidateEdits: Record<string, HermesRuleCandidateEditState>;
  candidateSimulations: Record<string, HermesRuleSimulationDto>;
  ruleDraftBusy: string;
  setCandidateDrafts: StateSetter<HermesRuleCandidateDto[]>;
  setCandidateEdits: StateSetter<Record<string, HermesRuleCandidateEditState>>;
  setCandidateSimulations: StateSetter<Record<string, HermesRuleSimulationDto>>;
  setRuleDraftBusy: StateSetter<string>;
  setRuleNotice: StateSetter<string>;
  setRules: StateSetter<HermesRuleDto[]>;
  onRuleApproved?: (rule: HermesRuleDto) => void;
}

export function HermesRuleCandidateWorkbench(
  props: HermesRuleCandidateWorkbenchProps,
) {
  const [draftCommand, setDraftCommand] = useState(
    "帮我创建一个规则，左侧加一个验证码分组，账号里的所有验证码邮件都进这个分组",
  );
  const ruleDraftRequestRef = useRef(0);

  useEffect(() => {
    ruleDraftRequestRef.current += 1;
    props.setRuleDraftBusy("");
  }, [props.accountId, props.api]);

  function beginRuleDraftRequest(): number {
    const requestId = ruleDraftRequestRef.current + 1;
    ruleDraftRequestRef.current = requestId;
    return requestId;
  }

  function isCurrentRuleDraftRequest(requestId: number): boolean {
    return ruleDraftRequestRef.current === requestId;
  }

  async function draftRuleFromCommand() {
    const command = draftCommand.trim();
    if (!command) {
      props.setRuleNotice("请输入要让 Hermes 创建的规则。");
      return;
    }

    if (!props.api) {
      props.setCandidateDrafts(props.previewCandidates);
      props.setCandidateEdits(
        hermesRuleCandidateEditMap(props.previewCandidates),
      );
      props.setCandidateSimulations({});
      props.setRuleNotice("预览规则草案已生成，连接后会先影子模拟再确认启用。");
      return;
    }

    if (!props.accountId) {
      props.setRuleNotice("请先添加邮箱并完成同步，再让 Hermes 创建规则。");
      return;
    }

    const requestId = beginRuleDraftRequest();
    const accountId = props.accountId;
    props.setRuleDraftBusy("draft");
    props.setRuleNotice("Hermes 正在生成规则草案...");
    try {
      const result = await props.api.draftHermesRule({
        accountId,
        command,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setCandidateDrafts(result.candidates);
      props.setCandidateEdits(hermesRuleCandidateEditMap(result.candidates));
      props.setCandidateSimulations({});
      props.setRuleNotice(
        result.candidates.length === 0
          ? "Hermes 没有生成可用规则草案。"
          : `Hermes 已生成 ${result.candidates.length} 条规则草案，请先模拟再确认。`,
      );
    } catch {
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setCandidateDrafts([]);
      props.setRuleNotice("Hermes 规则草案生成失败。");
    } finally {
      if (isCurrentRuleDraftRequest(requestId)) {
        props.setRuleDraftBusy("");
      }
    }
  }

  async function suggestRulesFromRecentBehavior() {
    if (!props.api) {
      props.setCandidateDrafts(props.previewCandidates);
      props.setCandidateEdits(
        hermesRuleCandidateEditMap(props.previewCandidates),
      );
      props.setCandidateSimulations({});
      props.setRuleNotice(
        "预览行为候选已生成，连接后会从最近行为学习并先影子模拟。",
      );
      return;
    }

    if (!props.accountId) {
      props.setRuleNotice("请先添加邮箱并完成同步，再让 Hermes 学习规则。");
      return;
    }

    const requestId = beginRuleDraftRequest();
    const accountId = props.accountId;
    props.setRuleDraftBusy("suggest");
    props.setRuleNotice("Hermes 正在从最近行为学习规则...");
    try {
      const result = await props.api.suggestHermesRules({
        accountId,
        behaviorWindowDays: 30,
        minEvidenceCount: 2,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setCandidateDrafts(result.candidates);
      props.setCandidateEdits(hermesRuleCandidateEditMap(result.candidates));
      props.setCandidateSimulations({});
      props.setRuleNotice(
        result.candidates.length === 0
          ? "Hermes 暂时没有从最近行为发现稳定规则。"
          : `Hermes 已生成 ${result.candidates.length} 条行为候选规则，请先模拟再确认。`,
      );
    } catch {
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setRuleNotice("Hermes 行为规则学习失败。");
    } finally {
      if (isCurrentRuleDraftRequest(requestId)) {
        props.setRuleDraftBusy("");
      }
    }
  }

  function updateRuleCandidateEdit(
    candidate: HermesRuleCandidateDto,
    patch: Partial<HermesRuleCandidateEditState>,
  ) {
    props.setCandidateEdits((current) => ({
      ...current,
      [candidate.id]: {
        ...(current[candidate.id] ??
          hermesRuleCandidateEditFromCandidate(candidate)),
        ...patch,
      },
    }));
  }

  async function saveRuleCandidateEdit(candidate: HermesRuleCandidateDto) {
    const edit =
      props.candidateEdits[candidate.id] ??
      hermesRuleCandidateEditFromCandidate(candidate);
    const labelName = edit.labelName.trim();
    const keywords = parseHermesRuleCandidateKeywords(edit.keywordsText);
    if (!labelName || keywords.length === 0) {
      props.setRuleNotice("请填写分组名称和至少一个关键词。");
      return;
    }

    if (!props.api) {
      const updated = applyHermesRuleCandidateEdit(candidate, {
        ...edit,
        labelName,
        keywordsText: keywords.join("、"),
      });
      props.setCandidateDrafts((current) =>
        current.map((item) => (item.id === candidate.id ? updated : item)),
      );
      props.setCandidateEdits((current) => ({
        ...current,
        [candidate.id]: hermesRuleCandidateEditFromCandidate(updated),
      }));
      props.setCandidateSimulations((current) => {
        const next = { ...current };
        delete next[candidate.id];
        return next;
      });
      props.setRuleNotice("预览规则草案已保存，请重新模拟后再确认。");
      return;
    }

    if (!props.accountId) {
      props.setRuleNotice("请先添加邮箱并完成同步，再保存 Hermes 规则草案。");
      return;
    }

    const requestId = beginRuleDraftRequest();
    const accountId = props.accountId;
    props.setRuleDraftBusy(`save:${candidate.id}`);
    props.setRuleNotice("正在保存 Hermes 规则草案...");
    try {
      const updated = await props.api.updateHermesRuleCandidate({
        accountId,
        candidateId: candidate.id,
        labelName,
        keywords,
        applyToHistory: edit.applyToHistory,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setCandidateDrafts((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      props.setCandidateEdits((current) => ({
        ...current,
        [updated.id]: hermesRuleCandidateEditFromCandidate(updated),
      }));
      props.setCandidateSimulations((current) => {
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
      props.setRuleNotice("Hermes 规则草案已保存，请重新运行 shadow simulation。");
    } catch {
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setRuleNotice("Hermes 规则草案保存失败。");
    } finally {
      if (isCurrentRuleDraftRequest(requestId)) {
        props.setRuleDraftBusy("");
      }
    }
  }

  async function simulateRuleCandidate(candidate: HermesRuleCandidateDto) {
    if (!props.api) {
      props.setCandidateSimulations((current) => ({
        ...current,
        [candidate.id]: {
          id: "preview_rule_simulation",
          accountId: candidate.accountId,
          candidateId: candidate.id,
          mode: "shadow",
          matchedCount: 4,
          sampleMessageIds: ["preview_message_1", "preview_message_2"],
          actionPreview: candidate.action,
          createdAt: new Date().toISOString(),
        },
      }));
      props.setRuleNotice("预览影子模拟已完成：命中 4 封邮件。");
      return;
    }

    if (!props.accountId) {
      props.setRuleNotice("请先添加邮箱并完成同步，再模拟 Hermes 规则。");
      return;
    }

    const requestId = beginRuleDraftRequest();
    const accountId = props.accountId;
    props.setRuleDraftBusy(`simulate:${candidate.id}`);
    props.setRuleNotice("Hermes 正在影子模拟规则...");
    try {
      const simulation = await props.api.simulateHermesRule({
        accountId,
        candidateId: candidate.id,
        sampleLimit: 25,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setCandidateSimulations((current) => ({
        ...current,
        [candidate.id]: simulation,
      }));
      props.setRuleNotice(
        `Shadow simulation 已完成：命中 ${simulation.matchedCount} 封邮件。`,
      );
    } catch {
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setRuleNotice("Hermes 规则影子模拟失败。");
    } finally {
      if (isCurrentRuleDraftRequest(requestId)) {
        props.setRuleDraftBusy("");
      }
    }
  }

  async function approveRuleCandidate(candidate: HermesRuleCandidateDto) {
    if (!props.candidateSimulations[candidate.id]) {
      props.setRuleNotice("请先运行 shadow simulation，再确认启用规则。");
      return;
    }

    if (!props.api) {
      const previewRule: HermesRuleDto = {
        ...props.previewRule,
        id: "preview_rule_approved",
        candidateId: candidate.id,
        title: candidate.title,
        ruleType: candidate.ruleType,
        condition: candidate.condition,
        action: {
          ...candidate.action,
          requiresConfirmation: false,
        },
        enabled: true,
        approvedAt: new Date().toISOString(),
      };
      props.setRules((current) =>
        normalizeHermesRuleSortOrders([previewRule, ...current]),
      );
      removeRuleCandidateDraft(candidate.id);
      props.setRuleNotice(`预览规则已启用：${candidate.title}。`);
      return;
    }

    if (!props.accountId) {
      props.setRuleNotice("请先添加邮箱并完成同步，再确认 Hermes 规则。");
      return;
    }

    const requestId = beginRuleDraftRequest();
    const accountId = props.accountId;
    props.setRuleDraftBusy(`approve:${candidate.id}`);
    props.setRuleNotice("正在生成并确认 Hermes 执行计划...");
    let actionPlanStage: "create" | "confirm" = "create";
    try {
      const plan = await props.api.createHermesActionPlan({
        accountId,
        candidateId: candidate.id,
        sampleLimit: 25,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      actionPlanStage = "confirm";
      const confirmation = await props.api.confirmHermesActionPlan({
        planId: plan.id,
        accountId,
        candidateId: plan.candidate.id,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      const approvedRule = confirmation.rule;
      props.setRules((current) =>
        normalizeHermesRuleSortOrders([
          approvedRule,
          ...current.filter((rule) => rule.id !== approvedRule.id),
        ]),
      );
      removeRuleCandidateDraft(candidate.id);
      const target = props.onRuleApproved
        ? hermesRuleNavigationTarget(approvedRule)
        : undefined;
      props.setRuleNotice(
        confirmation.historyBackfill
          ? `Hermes 执行计划已完成：${approvedRule.title}，已回填 ${confirmation.historyBackfill.appliedCount} 封历史邮件。${target ? `已打开${target.label}。` : ""}`
          : `Hermes 执行计划已完成：${approvedRule.title}${target ? `，已打开${target.label}` : ""}。`,
      );
      props.onRuleApproved?.(approvedRule);
    } catch (error) {
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setRuleNotice(hermesActionPlanErrorNotice(error, actionPlanStage));
    } finally {
      if (isCurrentRuleDraftRequest(requestId)) {
        props.setRuleDraftBusy("");
      }
    }
  }

  async function dismissRuleCandidate(candidate: HermesRuleCandidateDto) {
    if (!props.api) {
      removeRuleCandidateDraft(candidate.id);
      props.setRuleNotice(`预览规则草案已驳回：${candidate.title}。`);
      return;
    }

    if (!props.accountId) {
      props.setRuleNotice("请先添加邮箱并完成同步，再驳回 Hermes 规则草案。");
      return;
    }

    const requestId = beginRuleDraftRequest();
    const accountId = props.accountId;
    props.setRuleDraftBusy(`dismiss:${candidate.id}`);
    props.setRuleNotice("正在驳回 Hermes 规则草案...");
    try {
      await props.api.dismissHermesRuleCandidate({
        accountId,
        candidateId: candidate.id,
      });
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      removeRuleCandidateDraft(candidate.id);
      props.setRuleNotice(`Hermes 规则草案已驳回：${candidate.title}。`);
    } catch {
      if (!isCurrentRuleDraftRequest(requestId)) {
        return;
      }
      props.setRuleNotice("Hermes 规则草案驳回失败。");
    } finally {
      if (isCurrentRuleDraftRequest(requestId)) {
        props.setRuleDraftBusy("");
      }
    }
  }

  function removeRuleCandidateDraft(candidateId: string) {
    props.setCandidateDrafts((current) =>
      current.filter((item) => item.id !== candidateId),
    );
    props.setCandidateEdits((current) => {
      const next = { ...current };
      delete next[candidateId];
      return next;
    });
    props.setCandidateSimulations((current) => {
      const next = { ...current };
      delete next[candidateId];
      return next;
    });
  }

  return (
    <div className="rule-draft-workbench" aria-label="Hermes 规则草案工作台">
      <label>
        <span>自然语言规则</span>
        <textarea
          aria-label="Hermes rule command"
          value={draftCommand}
          onChange={(event) => setDraftCommand(event.target.value)}
        />
      </label>
      <div className="inline-actions">
        <button
          className="primary-button"
          type="button"
          disabled={Boolean(props.ruleDraftBusy)}
          onClick={() => void draftRuleFromCommand()}
        >
          生成规则草案
        </button>
        <button
          className="ghost-button"
          type="button"
          disabled={Boolean(props.ruleDraftBusy)}
          onClick={() => void suggestRulesFromRecentBehavior()}
        >
          {props.ruleDraftBusy === "suggest"
            ? "学习中"
            : "从最近行为生成候选规则"}
        </button>
      </div>
      {props.candidateDrafts.length > 0 ? (
        <div className="rule-candidate-list">
          {props.candidateDrafts.map((candidate) => {
            const simulation = props.candidateSimulations[candidate.id];
            const edit =
              props.candidateEdits[candidate.id] ??
              hermesRuleCandidateEditFromCandidate(candidate);
            const isSimulating =
              props.ruleDraftBusy === `simulate:${candidate.id}`;
            const isApproving =
              props.ruleDraftBusy === `approve:${candidate.id}`;
            const isSaving = props.ruleDraftBusy === `save:${candidate.id}`;
            const isDismissing =
              props.ruleDraftBusy === `dismiss:${candidate.id}`;
            const isCandidateLocked = candidate.status === "approved";
            return (
              <article className="rule-candidate-card" key={candidate.id}>
                <div className="hermes-memory-meta">
                  <div>
                    <strong>{candidate.title}</strong>
                    <span>
                      {formatHermesRuleType(candidate.ruleType)} ·{" "}
                      {formatHermesRuleAction(candidate.action)} ·{" "}
                      {formatHermesRuleCondition(candidate.condition)} ·{" "}
                      {Math.round(candidate.confidence * 100)}% ·{" "}
                      {candidate.status === "approved" ? "已启用" : "草案"}
                    </span>
                  </div>
                  <span>{formatHermesRuleDate(candidate.createdAt)}</span>
                </div>
                {simulation ? (
                  <p>
                    Shadow simulation：命中 {simulation.matchedCount} 封邮件
                    {simulation.sampleMessageIds.length > 0
                      ? `，样本 ${simulation.sampleMessageIds.slice(0, 3).join("、")}`
                      : ""}
                  </p>
                ) : (
                  <p>确认前必须先运行 shadow simulation，不会直接修改邮箱。</p>
                )}
                <div className="rule-candidate-editor">
                  <label>
                    <span>分组名称</span>
                    <input
                      aria-label={`Hermes rule label ${candidate.title}`}
                      value={edit.labelName}
                      disabled={Boolean(props.ruleDraftBusy) || isCandidateLocked}
                      onChange={(event) =>
                        updateRuleCandidateEdit(candidate, {
                          labelName: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>关键词</span>
                    <input
                      aria-label={`Hermes rule keywords ${candidate.title}`}
                      value={edit.keywordsText}
                      disabled={Boolean(props.ruleDraftBusy) || isCandidateLocked}
                      onChange={(event) =>
                        updateRuleCandidateEdit(candidate, {
                          keywordsText: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="rule-candidate-toggle">
                    <input
                      type="checkbox"
                      aria-label={`Apply Hermes rule to history ${candidate.title}`}
                      checked={edit.applyToHistory}
                      disabled={Boolean(props.ruleDraftBusy) || isCandidateLocked}
                      onChange={(event) =>
                        updateRuleCandidateEdit(candidate, {
                          applyToHistory: event.target.checked,
                        })
                      }
                    />
                    <span>回填已有邮件</span>
                  </label>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={Boolean(props.ruleDraftBusy) || isCandidateLocked}
                    aria-label={`Save Hermes rule candidate ${candidate.title}`}
                    onClick={() => void saveRuleCandidateEdit(candidate)}
                  >
                    {isSaving ? "保存中" : "保存草案"}
                  </button>
                </div>
                <div className="inline-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={Boolean(props.ruleDraftBusy)}
                    aria-label={`Simulate Hermes rule ${candidate.title}`}
                    onClick={() => void simulateRuleCandidate(candidate)}
                  >
                    {isSimulating ? "模拟中" : "模拟规则"}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      Boolean(props.ruleDraftBusy) ||
                      candidate.status === "approved"
                    }
                    aria-label={`Confirm Hermes action plan ${candidate.title}`}
                    onClick={() => void approveRuleCandidate(candidate)}
                  >
                    {isApproving
                      ? "确认中"
                      : candidate.status === "approved"
                        ? "已启用"
                        : "确认启用"}
                  </button>
                  <button
                    className="ghost-button danger"
                    type="button"
                    disabled={Boolean(props.ruleDraftBusy) || isCandidateLocked}
                    aria-label={`Dismiss Hermes rule candidate ${candidate.title}`}
                    onClick={() => void dismissRuleCandidate(candidate)}
                  >
                    {isDismissing ? "驳回中" : "驳回草案"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function hermesRuleCandidateEditFromCandidate(
  candidate: HermesRuleCandidateDto,
): HermesRuleCandidateEditState {
  return {
    labelName: hermesRuleCandidateLabelName(candidate),
    keywordsText: hermesRuleCandidateKeywords(candidate).join("、"),
    applyToHistory: candidate.action.applyToHistory === true,
  };
}

export function hermesRuleCandidateEditMap(
  candidates: HermesRuleCandidateDto[],
): Record<string, HermesRuleCandidateEditState> {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      hermesRuleCandidateEditFromCandidate(candidate),
    ]),
  );
}

function hermesRuleCandidateLabelName(candidate: HermesRuleCandidateDto): string {
  return typeof candidate.action.labelName === "string" &&
    candidate.action.labelName.trim()
    ? candidate.action.labelName.trim()
    : candidate.title;
}

function hermesRuleCandidateKeywords(candidate: HermesRuleCandidateDto): string[] {
  const keywords = candidate.condition.anyKeywords;
  if (!Array.isArray(keywords)) {
    return [];
  }

  return keywords
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function parseHermesRuleCandidateKeywords(value: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of value.split(/[,\n，、]+/)) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keywords.push(trimmed);
  }

  return keywords;
}

function applyHermesRuleCandidateEdit(
  candidate: HermesRuleCandidateDto,
  edit: HermesRuleCandidateEditState,
): HermesRuleCandidateDto {
  const labelName = edit.labelName.trim();
  const keywords = parseHermesRuleCandidateKeywords(edit.keywordsText);
  return {
    ...candidate,
    title: `创建${labelName}智能分组`,
    condition: {
      ...candidate.condition,
      anyKeywords: keywords,
    },
    action: {
      ...candidate.action,
      type: "apply_label",
      labelName,
      applyToHistory: edit.applyToHistory,
      providerWriteback: false,
      requiresConfirmation: true,
    },
  };
}

function formatHermesRuleDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
