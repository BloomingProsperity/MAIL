import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type {
  EmailHubApi,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleExecutionDto,
  HermesRuleSimulationDto,
} from "../../lib/emailHubApi";
import {
  HermesRuleCandidateWorkbench,
  hermesRuleCandidateEditMap,
  type HermesRuleCandidateEditState,
} from "./HermesRuleCandidateWorkbench";
import {
  formatHermesRuleAction,
  formatHermesRuleCondition,
  formatHermesRuleType,
  latestExecutionsByRuleId,
  normalizeHermesRuleSortOrders,
} from "./hermesRules";

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
  const loadRulesRequestRef = useRef(0);

  async function loadRules() {
    const requestId = loadRulesRequestRef.current + 1;
    loadRulesRequestRef.current = requestId;
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
      const accountId = props.accountId;
      const page = await props.api.listHermesRules({
        accountId,
        limit: 50,
      });
      const executionsPage = await props.api
        .listHermesRuleExecutions({
          accountId,
          limit: 100,
        })
        .catch(() => ({ items: [] as HermesRuleExecutionDto[] }));
      const candidatesPage = await props.api
        .listHermesRuleCandidates({
          accountId,
          status: "shadow",
          limit: 50,
        })
        .catch(() => ({ items: [] as HermesRuleCandidateDto[] }));
      if (loadRulesRequestRef.current !== requestId) {
        return;
      }
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
      if (loadRulesRequestRef.current !== requestId) {
        return;
      }
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

      <HermesRuleCandidateWorkbench
        api={props.api}
        accountId={props.accountId}
        previewRule={previewRules[0]}
        previewCandidates={previewCandidates}
        candidateDrafts={candidateDrafts}
        candidateEdits={candidateEdits}
        candidateSimulations={candidateSimulations}
        ruleDraftBusy={ruleDraftBusy}
        setCandidateDrafts={setCandidateDrafts}
        setCandidateEdits={setCandidateEdits}
        setCandidateSimulations={setCandidateSimulations}
        setRuleDraftBusy={setRuleDraftBusy}
        setRuleNotice={setRuleNotice}
        setRules={setRules}
        onRuleApproved={props.onRuleApproved}
      />

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
