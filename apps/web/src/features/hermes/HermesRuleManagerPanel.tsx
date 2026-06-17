import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type {
  EmailHubApi,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleExecutionDto,
  HermesRuleSimulationDto,
} from "../../lib/emailHubApi";
import {
  formatHermesRuleAction,
  formatHermesRuleCondition,
  formatHermesRuleType,
  hermesActionPlanErrorNotice,
  hermesRuleNavigationTarget,
  latestExecutionsByRuleId,
  normalizeHermesRuleSortOrders,
} from "./hermesRules";

interface HermesRuleCandidateEditState {
  labelName: string;
  keywordsText: string;
  applyToHistory: boolean;
}

export interface HermesRuleManagerPanelProps {
  api?: EmailHubApi;
  accountId?: string;
  onRuleApproved?: (rule: HermesRuleDto) => void;
}

const PREVIEW_ACCOUNT_ID = "account_1";

export function HermesRuleManagerPanel(props: HermesRuleManagerPanelProps) {
  const previewRules: HermesRuleDto[] = [
    {
      id: "preview_rule_codes",
      accountId: props.accountId ?? PREVIEW_ACCOUNT_ID,
      candidateId: "preview_candidate_codes",
      title: "启用验证码智能分组",
      ruleType: "content_label",
      condition: { anyKeywords: ["验证码", "verification", "otp"] },
      action: {
        type: "apply_label",
        labelId: "preview_label_codes",
        labelName: "验证码",
        providerWriteback: false,
      },
      confidence: 0.9,
      enabled: true,
      sortOrder: 1000,
      createdAt: "2026-06-15T08:00:00.000Z",
      approvedAt: "2026-06-15T08:00:00.000Z",
    },
  ];
  const previewCandidates: HermesRuleCandidateDto[] = [
    {
      id: "preview_candidate_codes",
      accountId: props.accountId ?? PREVIEW_ACCOUNT_ID,
      title: "启用验证码智能分组",
      ruleType: "content_label",
      condition: { anyKeywords: ["验证码", "verification", "otp"] },
      action: {
        type: "apply_label",
        labelName: "验证码",
        labelColor: "blue",
        providerWriteback: false,
        applyToHistory: true,
        requiresConfirmation: true,
      },
      confidence: 0.9,
      status: "shadow",
      evidenceMessageIds: [],
      createdAt: "2026-06-15T08:00:00.000Z",
    },
  ];
  const [rules, setRules] = useState<HermesRuleDto[]>([]);
  const [ruleNotice, setRuleNotice] = useState("正在读取 Hermes 规则...");
  const [busyRuleId, setBusyRuleId] = useState("");
  const [ruleExecutions, setRuleExecutions] = useState<
    Record<string, HermesRuleExecutionDto>
  >({});
  const [draftCommand, setDraftCommand] = useState(
    "帮我创建一个规则，左侧加一个验证码分组，账号里的所有验证码邮件都进这个分组",
  );
  const [candidateDrafts, setCandidateDrafts] = useState<
    HermesRuleCandidateDto[]
  >([]);
  const [candidateEdits, setCandidateEdits] = useState<
    Record<string, HermesRuleCandidateEditState>
  >({});
  const [candidateSimulations, setCandidateSimulations] = useState<
    Record<string, HermesRuleSimulationDto>
  >({});
  const [ruleDraftBusy, setRuleDraftBusy] = useState("");

  async function loadRules() {
    if (!props.api) {
      setRules(normalizeHermesRuleSortOrders(previewRules));
      setRuleNotice("本地预览规则，连接后会读取真实 Hermes 规则。");
      return;
    }

    if (!props.accountId) {
      setRules([]);
      setRuleNotice("请先添加邮箱并完成同步，再查看 Hermes 规则。");
      return;
    }

    setRuleNotice("正在读取 Hermes 规则...");
    try {
      const page = await props.api.listHermesRules({
        accountId: props.accountId,
        limit: 50,
      });
      const executionsPage = await props.api
        .listHermesRuleExecutions({
          accountId: props.accountId,
          limit: 100,
        })
        .catch(() => ({ items: [] as HermesRuleExecutionDto[] }));
      const candidatesPage = await props.api
        .listHermesRuleCandidates({
          accountId: props.accountId,
          status: "shadow",
          limit: 50,
        })
        .catch(() => ({ items: [] as HermesRuleCandidateDto[] }));
      setRules(normalizeHermesRuleSortOrders(page.items));
      setRuleExecutions(latestExecutionsByRuleId(executionsPage.items));
      setCandidateDrafts(candidatesPage.items);
      setCandidateEdits(hermesRuleCandidateEditMap(candidatesPage.items));
      setRuleNotice(
        page.items.length === 0
          ? candidatesPage.items.length === 0
            ? "当前账号还没有 Hermes 规则。"
            : `已读取 ${candidatesPage.items.length} 条待确认 Hermes 规则草案。`
          : `已读取 ${page.items.length} 条 Hermes 规则，${candidatesPage.items.length} 条待确认草案。`,
      );
    } catch {
      setRules([]);
      setCandidateDrafts([]);
      setCandidateEdits({});
      setRuleNotice("Hermes 规则暂时不可用。");
    }
  }

  useEffect(() => {
    void loadRules();
    // Rules are refreshed by explicit button and after toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.accountId, props.api]);

  async function setRuleEnabled(rule: HermesRuleDto, enabled: boolean) {
    if (!props.api) {
      setRules((current) =>
        normalizeHermesRuleSortOrders(
          current.map((item) =>
            item.id === rule.id ? { ...item, enabled } : item,
          ),
        ),
      );
      setRuleNotice(enabled ? "预览规则已恢复。" : "预览规则已停用。");
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再更新 Hermes 规则。");
      return;
    }

    setBusyRuleId(`toggle:${rule.id}`);
    setRuleNotice(enabled ? "正在恢复 Hermes 规则..." : "正在停用 Hermes 规则...");
    try {
      const updated = await props.api.updateHermesRule({
        accountId: props.accountId,
        ruleId: rule.id,
        enabled,
      });
      setRules((current) =>
        normalizeHermesRuleSortOrders(
          current.map((item) => (item.id === updated.id ? updated : item)),
        ),
      );
      setRuleNotice(
        enabled
          ? `Hermes 规则已恢复：${updated.title}。`
          : `Hermes 规则已停用：${updated.title}。`,
      );
    } catch {
      setRuleNotice("Hermes 规则更新失败。");
    } finally {
      setBusyRuleId("");
    }
  }

  async function moveRule(rule: HermesRuleDto, direction: "up" | "down") {
    const orderedRules = normalizeHermesRuleSortOrders(rules);
    const index = orderedRules.findIndex((item) => item.id === rule.id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    const target = orderedRules[swapIndex];
    if (!target) {
      return;
    }

    if (!props.api) {
      setRules((current) =>
        normalizeHermesRuleSortOrders(
          current.map((item) => {
            if (item.id === rule.id) {
              return { ...item, sortOrder: target.sortOrder };
            }
            if (item.id === target.id) {
              return { ...item, sortOrder: rule.sortOrder };
            }
            return item;
          }),
        ),
      );
      setRuleNotice("预览规则顺序已调整。");
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再调整 Hermes 规则顺序。");
      return;
    }

    setBusyRuleId(`order:${rule.id}`);
    setRuleNotice("正在调整 Hermes 规则顺序...");
    try {
      const [updatedRule, updatedTarget] = await Promise.all([
        props.api.updateHermesRule({
          accountId: props.accountId,
          ruleId: rule.id,
          sortOrder: target.sortOrder,
        }),
        props.api.updateHermesRule({
          accountId: props.accountId,
          ruleId: target.id,
          sortOrder: rule.sortOrder,
        }),
      ]);
      setRules((current) =>
        normalizeHermesRuleSortOrders(
          current.map((item) => {
            if (item.id === updatedRule.id) return updatedRule;
            if (item.id === updatedTarget.id) return updatedTarget;
            return item;
          }),
        ),
      );
      setRuleNotice(`Hermes 规则顺序已调整：${rule.title}。`);
    } catch {
      setRuleNotice("Hermes 规则顺序调整失败。");
    } finally {
      setBusyRuleId("");
    }
  }

  async function runRuleNow(rule: HermesRuleDto) {
    if (!rule.enabled) {
      setRuleNotice("请先恢复规则，再手动运行。");
      return;
    }

    if (!props.api) {
      const execution: HermesRuleExecutionDto = {
        id: "preview_rule_execution",
        accountId: rule.accountId,
        ruleId: rule.id,
        mode: "active",
        matchedCount: 4,
        appliedCount: 2,
        sampleMessageIds: ["preview_message_1", "preview_message_2"],
        actionPreview: rule.action,
        createdAt: new Date().toISOString(),
      };
      setRuleExecutions((current) => ({
        ...current,
        [rule.id]: execution,
      }));
      setRuleNotice("预览规则已运行：命中 4 封邮件，新增 2 个标签关联。");
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再运行 Hermes 规则。");
      return;
    }

    setBusyRuleId(`run:${rule.id}`);
    setRuleNotice("正在运行 Hermes 规则...");
    try {
      const execution = await props.api.runHermesRule({
        accountId: props.accountId,
        ruleId: rule.id,
        limit: 5000,
      });
      setRuleExecutions((current) => ({
        ...current,
        [rule.id]: execution,
      }));
      setRuleNotice(
        `Hermes 规则已运行：${rule.title}，命中 ${execution.matchedCount} 封邮件，新增 ${execution.appliedCount} 个标签关联。`,
      );
    } catch {
      setRuleNotice("Hermes 规则运行失败。");
    } finally {
      setBusyRuleId("");
    }
  }

  async function draftRuleFromCommand() {
    const command = draftCommand.trim();
    if (!command) {
      setRuleNotice("请输入要让 Hermes 创建的规则。");
      return;
    }

    if (!props.api) {
      setCandidateDrafts(previewCandidates);
      setCandidateEdits(hermesRuleCandidateEditMap(previewCandidates));
      setCandidateSimulations({});
      setRuleNotice("预览规则草案已生成，连接后会先影子模拟再确认启用。");
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再让 Hermes 创建规则。");
      return;
    }

    setRuleDraftBusy("draft");
    setRuleNotice("Hermes 正在生成规则草案...");
    try {
      const result = await props.api.draftHermesRule({
        accountId: props.accountId,
        command,
      });
      setCandidateDrafts(result.candidates);
      setCandidateEdits(hermesRuleCandidateEditMap(result.candidates));
      setCandidateSimulations({});
      setRuleNotice(
        result.candidates.length === 0
          ? "Hermes 没有生成可用规则草案。"
          : `Hermes 已生成 ${result.candidates.length} 条规则草案，请先模拟再确认。`,
      );
    } catch {
      setCandidateDrafts([]);
      setRuleNotice("Hermes 规则草案生成失败。");
    } finally {
      setRuleDraftBusy("");
    }
  }

  function updateRuleCandidateEdit(
    candidate: HermesRuleCandidateDto,
    patch: Partial<HermesRuleCandidateEditState>,
  ) {
    setCandidateEdits((current) => ({
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
      candidateEdits[candidate.id] ??
      hermesRuleCandidateEditFromCandidate(candidate);
    const labelName = edit.labelName.trim();
    const keywords = parseHermesRuleCandidateKeywords(edit.keywordsText);
    if (!labelName || keywords.length === 0) {
      setRuleNotice("请填写分组名称和至少一个关键词。");
      return;
    }

    if (!props.api) {
      const updated = applyHermesRuleCandidateEdit(candidate, {
        ...edit,
        labelName,
        keywordsText: keywords.join("、"),
      });
      setCandidateDrafts((current) =>
        current.map((item) => (item.id === candidate.id ? updated : item)),
      );
      setCandidateEdits((current) => ({
        ...current,
        [candidate.id]: hermesRuleCandidateEditFromCandidate(updated),
      }));
      setCandidateSimulations((current) => {
        const next = { ...current };
        delete next[candidate.id];
        return next;
      });
      setRuleNotice("预览规则草案已保存，请重新模拟后再确认。");
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再保存 Hermes 规则草案。");
      return;
    }

    setRuleDraftBusy(`save:${candidate.id}`);
    setRuleNotice("正在保存 Hermes 规则草案...");
    try {
      const updated = await props.api.updateHermesRuleCandidate({
        accountId: props.accountId,
        candidateId: candidate.id,
        labelName,
        keywords,
        applyToHistory: edit.applyToHistory,
      });
      setCandidateDrafts((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setCandidateEdits((current) => ({
        ...current,
        [updated.id]: hermesRuleCandidateEditFromCandidate(updated),
      }));
      setCandidateSimulations((current) => {
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
      setRuleNotice("Hermes 规则草案已保存，请重新运行 shadow simulation。");
    } catch {
      setRuleNotice("Hermes 规则草案保存失败。");
    } finally {
      setRuleDraftBusy("");
    }
  }

  async function simulateRuleCandidate(candidate: HermesRuleCandidateDto) {
    if (!props.api) {
      setCandidateSimulations((current) => ({
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
      setRuleNotice("预览影子模拟已完成：命中 4 封邮件。");
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再模拟 Hermes 规则。");
      return;
    }

    setRuleDraftBusy(`simulate:${candidate.id}`);
    setRuleNotice("Hermes 正在影子模拟规则...");
    try {
      const simulation = await props.api.simulateHermesRule({
        accountId: props.accountId,
        candidateId: candidate.id,
        sampleLimit: 25,
      });
      setCandidateSimulations((current) => ({
        ...current,
        [candidate.id]: simulation,
      }));
      setRuleNotice(
        `Shadow simulation 已完成：命中 ${simulation.matchedCount} 封邮件。`,
      );
    } catch {
      setRuleNotice("Hermes 规则影子模拟失败。");
    } finally {
      setRuleDraftBusy("");
    }
  }

  async function approveRuleCandidate(candidate: HermesRuleCandidateDto) {
    if (!candidateSimulations[candidate.id]) {
      setRuleNotice("请先运行 shadow simulation，再确认启用规则。");
      return;
    }

    if (!props.api) {
      const previewRule: HermesRuleDto = {
        ...previewRules[0],
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
      setRules((current) =>
        normalizeHermesRuleSortOrders([previewRule, ...current]),
      );
      setCandidateDrafts((current) =>
        current.map((item) =>
          item.id === candidate.id ? { ...item, status: "approved" } : item,
        ),
      );
      setRuleNotice(`预览规则已启用：${candidate.title}。`);
      return;
    }

    if (!props.accountId) {
      setRuleNotice("请先添加邮箱并完成同步，再确认 Hermes 规则。");
      return;
    }

    setRuleDraftBusy(`approve:${candidate.id}`);
    setRuleNotice("正在生成并确认 Hermes 执行计划...");
    let actionPlanStage: "create" | "confirm" = "create";
    try {
      const plan = await props.api.createHermesActionPlan({
        accountId: props.accountId,
        candidateId: candidate.id,
        sampleLimit: 25,
      });
      actionPlanStage = "confirm";
      const confirmation = await props.api.confirmHermesActionPlan({
        planId: plan.id,
        accountId: props.accountId,
        candidateId: plan.candidate.id,
      });
      const approvedRule = confirmation.rule;
      setRules((current) =>
        normalizeHermesRuleSortOrders([
          approvedRule,
          ...current.filter((rule) => rule.id !== approvedRule.id),
        ]),
      );
      setCandidateDrafts((current) =>
        current.map((item) =>
          item.id === candidate.id ? { ...item, status: "approved" } : item,
        ),
      );
      const target = props.onRuleApproved
        ? hermesRuleNavigationTarget(approvedRule)
        : undefined;
      setRuleNotice(
        confirmation.historyBackfill
          ? `Hermes 执行计划已完成：${approvedRule.title}，已回填 ${confirmation.historyBackfill.appliedCount} 封历史邮件。${target ? `已打开${target.label}。` : ""}`
          : `Hermes 执行计划已完成：${approvedRule.title}${target ? `，已打开${target.label}` : ""}。`,
      );
      props.onRuleApproved?.(approvedRule);
    } catch (error) {
      setRuleNotice(hermesActionPlanErrorNotice(error, actionPlanStage));
    } finally {
      setRuleDraftBusy("");
    }
  }

  return (
    <section className="settings-subpanel" aria-label="Hermes 规则管理">
      <header className="settings-panel-head">
        <div>
          <h3>规则管理</h3>
          <p>查看 Hermes 已启用或停用的规则；停用后只影响后续自动分类。</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void loadRules()}>
          刷新规则
        </button>
      </header>

      <div className="backend-notice compact" role="status">
        {ruleNotice}
      </div>

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
            disabled={Boolean(ruleDraftBusy)}
            onClick={() => void draftRuleFromCommand()}
          >
            生成规则草案
          </button>
        </div>
        {candidateDrafts.length > 0 ? (
          <div className="rule-candidate-list">
            {candidateDrafts.map((candidate) => {
              const simulation = candidateSimulations[candidate.id];
              const edit =
                candidateEdits[candidate.id] ??
                hermesRuleCandidateEditFromCandidate(candidate);
              const isSimulating = ruleDraftBusy === `simulate:${candidate.id}`;
              const isApproving = ruleDraftBusy === `approve:${candidate.id}`;
              const isSaving = ruleDraftBusy === `save:${candidate.id}`;
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
                        disabled={Boolean(ruleDraftBusy) || isCandidateLocked}
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
                        disabled={Boolean(ruleDraftBusy) || isCandidateLocked}
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
                        disabled={Boolean(ruleDraftBusy) || isCandidateLocked}
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
                      disabled={Boolean(ruleDraftBusy) || isCandidateLocked}
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
                      disabled={Boolean(ruleDraftBusy)}
                      aria-label={`Simulate Hermes rule ${candidate.title}`}
                      onClick={() => void simulateRuleCandidate(candidate)}
                    >
                      {isSimulating ? "模拟中" : "模拟规则"}
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={Boolean(ruleDraftBusy) || candidate.status === "approved"}
                      aria-label={`Confirm Hermes action plan ${candidate.title}`}
                      onClick={() => void approveRuleCandidate(candidate)}
                    >
                      {isApproving
                        ? "确认中"
                        : candidate.status === "approved"
                          ? "已启用"
                          : "确认启用"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="task-list">
        {normalizeHermesRuleSortOrders(rules).map((rule, index, orderedRules) => {
          const execution = ruleExecutions[rule.id];
          const isToggling = busyRuleId === `toggle:${rule.id}`;
          const isRunning = busyRuleId === `run:${rule.id}`;
          const isOrdering = busyRuleId === `order:${rule.id}`;
          return (
            <div className="task-row" key={rule.id}>
              <Sparkles size={19} />
              <div>
                <strong>{rule.title}</strong>
                <span>
                  {formatHermesRuleType(rule.ruleType)} ·{" "}
                  {formatHermesRuleAction(rule.action)} ·{" "}
                  顺序 {rule.sortOrder.toLocaleString()} ·{" "}
                  {rule.enabled ? "已启用" : "已停用"} ·{" "}
                  {Math.round(rule.confidence * 100)}%
                </span>
                {execution ? (
                  <span>
                    最近运行：命中 {execution.matchedCount} 封，新增{" "}
                    {execution.appliedCount} 个标签关联
                  </span>
                ) : null}
              </div>
              <div className="task-actions">
                <button
                  type="button"
                  aria-label={`Move Hermes rule up ${rule.title}`}
                  disabled={index === 0 || isOrdering || isRunning || isToggling}
                  onClick={() => void moveRule(rule, "up")}
                >
                  上移
                </button>
                <button
                  type="button"
                  aria-label={`Move Hermes rule down ${rule.title}`}
                  disabled={
                    index === orderedRules.length - 1 ||
                    isOrdering ||
                    isRunning ||
                    isToggling
                  }
                  onClick={() => void moveRule(rule, "down")}
                >
                  下移
                </button>
                <button
                  type="button"
                  aria-label={`Run Hermes rule ${rule.title}`}
                  disabled={!rule.enabled || isRunning || isToggling || isOrdering}
                  onClick={() => void runRuleNow(rule)}
                >
                  {isRunning ? "运行中" : "运行"}
                </button>
                <button
                  type="button"
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} Hermes rule ${rule.title}`}
                  disabled={isRunning || isToggling || isOrdering}
                  onClick={() => void setRuleEnabled(rule, !rule.enabled)}
                >
                  {rule.enabled ? "停用" : "恢复"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
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

function hermesRuleCandidateEditMap(
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
