import type {
  ApproveHermesRuleInput,
  HermesRule,
  HermesRuleCandidate,
  HermesRuleHistoryBackfill,
  HermesRuleService,
  HermesRuleSimulation,
} from "./rules.js";
import type { HermesActionPlanStore } from "./action-plan-store.js";
import type { HermesRunStore } from "./translation.js";
import type {
  HermesWorkspaceContext,
  HermesWorkspaceContextService,
} from "./workspace-context.js";
import type { HermesMemoryDto, HermesMemoryStore } from "./memory-store.js";

export type HermesActionPlanIntent = "create_mailbox_rule";
export type HermesActionPlanStatus = "requires_confirmation" | "completed";
export type HermesActionPlanStepMode =
  | "read_only"
  | "draft"
  | "shadow_simulation"
  | "confirmation_required"
  | "mutation";
export type HermesActionPlanStepStatus =
  | "completed"
  | "requires_confirmation";

export interface HermesActionPlanStep {
  id: string;
  title: string;
  mode: HermesActionPlanStepMode;
  status: HermesActionPlanStepStatus;
  detail: string;
  resource?: {
    type: string;
    id: string;
  };
}

export interface HermesActionPlanSafety {
  requiresUserConfirmation: boolean;
  providerWriteback: boolean;
  appliesToHistory: boolean;
  destructive: boolean;
}

export interface HermesActionPlanWorkspaceSummary {
  accountCount: number;
  selectedAccountId?: string;
  provider?: string;
  quickCategoryCount?: number;
  labelCount: number;
  ruleCount: number;
  pendingRuleCandidateCount: number;
  unavailableModules: string[];
}

export interface HermesActionPlan {
  id: string;
  auditEventId?: string;
  accountId: string;
  command: string;
  intent: HermesActionPlanIntent;
  status: HermesActionPlanStatus;
  createdAt: string;
  candidate: HermesRuleCandidate;
  simulation?: HermesRuleSimulation;
  workspace: HermesActionPlanWorkspaceSummary;
  safety: HermesActionPlanSafety;
  steps: HermesActionPlanStep[];
}

export interface HermesActionPlanConfirmation {
  id: string;
  auditEventId?: string;
  memory?: HermesMemoryDto;
  planId: string;
  accountId: string;
  candidateId: string;
  status: "completed";
  confirmedAt: string;
  rule: HermesRule;
  historyBackfill?: HermesRuleHistoryBackfill;
  safety: HermesActionPlanSafety;
  steps: HermesActionPlanStep[];
}

export interface CreateHermesActionPlanInput {
  accountId: string;
  command?: string;
  candidateId?: string;
  sampleLimit?: number;
}

export interface ConfirmHermesActionPlanInput
  extends ApproveHermesRuleInput {
  planId: string;
}

export interface HermesActionPlanService {
  createPlan(input: CreateHermesActionPlanInput): Promise<HermesActionPlan>;
  confirmPlan(
    input: ConfirmHermesActionPlanInput,
  ): Promise<HermesActionPlanConfirmation | undefined>;
}

export interface CreateHermesActionPlanServiceOptions {
  ruleService: Pick<
    HermesRuleService,
    | "draftRule"
    | "getRuleCandidate"
    | "simulateRule"
    | "approveRule"
    | "backfillRuleHistory"
    | "updateRule"
  >;
  workspaceContextService: Pick<HermesWorkspaceContextService, "getContext">;
  planStore: HermesActionPlanStore;
  runStore?: HermesRunStore;
  memoryStore?: Pick<HermesMemoryStore, "createMemory">;
  createId: () => string;
  now: () => string;
}

export class InvalidHermesActionPlanRequestError extends Error {
  readonly code = "invalid_hermes_action_plan_request";

  constructor() {
    super("invalid_hermes_action_plan_request");
  }
}

const ACTION_PLAN_SKILL_ID = "action_plan";
const ACTION_PLAN_SKILL_TITLE = "执行计划";
const HISTORY_BACKFILL_LIMIT = 5000;

export function createHermesActionPlanService(
  options: CreateHermesActionPlanServiceOptions,
): HermesActionPlanService {
  return {
    async createPlan(input) {
      const accountId = requireText(input.accountId);
      const requestedCandidateId =
        input.candidateId === undefined
          ? undefined
          : requireText(input.candidateId);
      const command =
        input.command === undefined
          ? undefined
          : requireCommand(input.command);
      const sampleLimit = optionalLimit(input.sampleLimit ?? 25, 1, 100);
      if (!requestedCandidateId && !command) {
        throw new InvalidHermesActionPlanRequestError();
      }
      if (!requestedCandidateId && command && !isMailboxRulePlanCommand(command)) {
        throw new InvalidHermesActionPlanRequestError();
      }

      const workspace = await options.workspaceContextService.getContext({
        accountId,
        ruleLimit: 25,
        labelLimit: 50,
      });
      const candidate = requestedCandidateId
        ? await options.ruleService.getRuleCandidate({
            accountId,
            candidateId: requestedCandidateId,
          })
        : (await options.ruleService.draftRule({
            accountId,
            command: command ?? "",
          })).candidates[0];
      if (!candidate || candidate.status !== "shadow") {
        throw new InvalidHermesActionPlanRequestError();
      }
      const planCommand = command ?? `确认 Hermes 规则候选：${candidate.title}`;

      const simulation = await options.ruleService.simulateRule({
        accountId,
        candidateId: candidate.id,
        sampleLimit,
      });
      if (!simulation) {
        throw new InvalidHermesActionPlanRequestError();
      }

      const planId = options.createId();
      const createdAt = options.now();
      const workspaceSummary = summarizeWorkspace(workspace);
      const safety = rulePlanSafety(candidate);
      const steps = buildDraftSteps(candidate, simulation);
      const record = await options.planStore.createPlan({
        id: planId,
        accountId,
        command: planCommand,
        intent: "create_mailbox_rule",
        candidateId: candidate.id,
        simulationId: simulation.id,
        workspace: workspaceSummary,
        safety,
        steps,
        createdAt,
      });
      const plan: HermesActionPlan = {
        id: record.id,
        accountId,
        command: record.command,
        intent: record.intent,
        status: "requires_confirmation",
        createdAt: record.createdAt,
        candidate,
        simulation,
        workspace: record.workspace,
        safety: record.safety,
        steps: record.steps,
      };
      const auditEventId = await recordActionPlanRun(options, {
        runId: plan.id,
        accountId,
        eventType: "hermes.action_plan.created",
        readMessageIds: simulation.sampleMessageIds,
        input: {
          accountId,
          command: plan.command,
          sampleLimit,
          ...(requestedCandidateId ? { candidateId: requestedCandidateId } : {}),
          intent: plan.intent,
          workspace: plan.workspace,
        },
        output: {
          planId: plan.id,
          candidateId: candidate.id,
          matchedCount: simulation.matchedCount,
          safety: plan.safety,
          steps: plan.steps.map((step) => ({
            id: step.id,
            status: step.status,
            mode: step.mode,
          })),
        },
        action: {
          type: "create_action_plan",
          planId: plan.id,
          intent: plan.intent,
          candidateId: candidate.id,
          requiresUserConfirmation: true,
        },
      });

      if (!auditEventId) {
        return plan;
      }

      await options.planStore.setPlanAuditEvent({
        planId: plan.id,
        auditEventId,
      });
      return { ...plan, auditEventId };
    },

    async confirmPlan(input) {
      const planId = requireText(input.planId);
      const accountId = requireText(input.accountId);
      const candidateId = requireText(input.candidateId);
      const lockedPlan = await options.planStore.beginConfirmation({
        planId,
        accountId,
        candidateId,
        confirmingAt: options.now(),
      });
      if (!lockedPlan) {
        return undefined;
      }
      let approvedRule: HermesRule | undefined;
      try {
        if (!isConfirmableRulePlan(lockedPlan)) {
          await failActionPlanConfirmation(options.planStore, {
            planId,
            accountId,
            candidateId,
            failureMessage: "action_plan_not_confirmable",
          });
          return undefined;
        }

        const rule = await options.ruleService.approveRule({
          accountId,
          candidateId: lockedPlan.candidateId,
        });
        if (!rule) {
          await failActionPlanConfirmation(options.planStore, {
            planId,
            accountId,
            candidateId,
            failureMessage: "rule_candidate_unavailable",
          });
          return undefined;
        }
        approvedRule = rule;

        const historyBackfill =
          rule.action.applyToHistory === true
            ? await options.ruleService.backfillRuleHistory({
                accountId,
                ruleId: rule.id,
                limit: HISTORY_BACKFILL_LIMIT,
              })
            : undefined;
        const confirmedAt = options.now();
        const memory = await rememberConfirmedRule(options, {
          planId,
          command: lockedPlan.command,
          rule,
        });
        const confirmation: HermesActionPlanConfirmation = {
          id: options.createId(),
          planId,
          accountId,
          candidateId,
          status: "completed",
          confirmedAt,
          rule,
          ...(memory ? { memory } : {}),
          ...(historyBackfill ? { historyBackfill } : {}),
          safety: confirmedRuleSafety(rule),
          steps: buildConfirmationSteps(rule, historyBackfill, memory),
        };
        const auditEventId = await recordActionPlanRun(options, {
          runId: confirmation.id,
          accountId,
          eventType: "hermes.action_plan.confirmed",
          readMessageIds: historyBackfill?.sampleMessageIds ?? [],
          input: {
            planId,
            accountId,
            candidateId,
          },
          output: {
            planId,
            ruleId: rule.id,
            status: confirmation.status,
            safety: confirmation.safety,
            ...(historyBackfill ? { historyBackfill } : {}),
            ...(memory
              ? {
                  memory: {
                    id: memory.id,
                    layer: memory.layer,
                    scope: memory.scope,
                  },
                }
              : {}),
          },
          action: {
            type: "confirm_action_plan",
            planId,
            candidateId,
            ruleId: rule.id,
            status: confirmation.status,
            ...(memory ? { memoryId: memory.id } : {}),
            ...(historyBackfill
              ? {
                  historyBackfill: {
                    matchedCount: historyBackfill.matchedCount,
                    appliedCount: historyBackfill.appliedCount,
                  },
                }
              : {}),
          },
        });

        const completedPlan = await options.planStore.completePlan({
          planId,
          accountId,
          candidateId,
          confirmationId: confirmation.id,
          ruleId: rule.id,
          confirmedAt,
          ...(auditEventId ? { confirmationAuditEventId: auditEventId } : {}),
        });
        if (!completedPlan) {
          await disableRuleAfterFailedConfirmation(options.ruleService, {
            accountId,
            ruleId: rule.id,
          });
          await failActionPlanConfirmation(options.planStore, {
            planId,
            accountId,
            candidateId,
            failureMessage: "action_plan_confirmation_lost",
          });
          return undefined;
        }

        return auditEventId
          ? { ...confirmation, auditEventId }
          : confirmation;
      } catch (error) {
        if (approvedRule) {
          await disableRuleAfterFailedConfirmation(options.ruleService, {
            accountId,
            ruleId: approvedRule.id,
          });
        }
        await failActionPlanConfirmation(options.planStore, {
          planId,
          accountId,
          candidateId,
          failureMessage: confirmationFailureMessage(error),
        });
        throw error;
      }
    },
  };
}

function confirmationFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `confirm_action_plan_failed:${error.message.slice(0, 120)}`;
  }
  return "confirm_action_plan_failed";
}

async function disableRuleAfterFailedConfirmation(
  ruleService: Pick<HermesRuleService, "updateRule">,
  input: { accountId: string; ruleId: string },
): Promise<void> {
  try {
    await ruleService.updateRule({
      accountId: input.accountId,
      ruleId: input.ruleId,
      enabled: false,
    });
  } catch {
    // Preserve the original confirmation failure for the caller.
  }
}

async function failActionPlanConfirmation(
  planStore: HermesActionPlanStore,
  input: {
    planId: string;
    accountId: string;
    candidateId: string;
    failureMessage: string;
  },
): Promise<void> {
  try {
    await planStore.failConfirmation(input);
  } catch {
    // Preserve the original confirmation failure for the caller.
  }
}

function buildDraftSteps(
  candidate: HermesRuleCandidate,
  simulation: HermesRuleSimulation,
): HermesActionPlanStep[] {
  return [
    {
      id: "read_workspace_context",
      title: "读取邮箱环境",
      mode: "read_only",
      status: "completed",
      detail: "Hermes 已读取账号、左侧分组、标签、规则和能力边界。",
    },
    {
      id: "draft_rule_candidate",
      title: "生成规则草案",
      mode: "draft",
      status: "completed",
      detail: candidate.title,
      resource: { type: "hermes_rule_candidate", id: candidate.id },
    },
    {
      id: "shadow_simulation",
      title: "影子模拟",
      mode: "shadow_simulation",
      status: "completed",
      detail: `命中 ${simulation.matchedCount} 封已同步邮件。`,
      resource: { type: "hermes_rule_simulation", id: simulation.id },
    },
    {
      id: "confirm_rule",
      title: "等待用户确认",
      mode: "confirmation_required",
      status: "requires_confirmation",
      detail:
        candidate.action.applyToHistory === true
          ? "确认后会创建本地标签/左侧分组、启用规则，并回填已同步匹配邮件。"
          : "确认后才会创建本地标签/左侧分组并启用规则。",
      resource: { type: "hermes_rule_candidate", id: candidate.id },
    },
  ];
}

function buildConfirmationSteps(
  rule: HermesRule,
  historyBackfill?: HermesRuleHistoryBackfill,
  memory?: HermesMemoryDto,
): HermesActionPlanStep[] {
  const steps: HermesActionPlanStep[] = [
    {
      id: "approve_rule_candidate",
      title: "启用规则",
      mode: "mutation",
      status: "completed",
      detail: rule.title,
      resource: { type: "hermes_rule", id: rule.id },
    },
  ];
  if (historyBackfill) {
    steps.push({
      id: "backfill_history_labels",
      title: "回填历史邮件",
      mode: "mutation",
      status: "completed",
      detail: `匹配 ${historyBackfill.matchedCount} 封已同步邮件，新增 ${historyBackfill.appliedCount} 个标签关联。`,
      resource: { type: "hermes_rule", id: rule.id },
    });
  }

  if (memory) {
    steps.push({
      id: "learn_procedural_memory",
      title: "学习用户习惯",
      mode: "mutation",
      status: "completed",
      detail: "Hermes 已把确认过的邮箱规则写入程序记忆。",
      resource: { type: "hermes_memory", id: memory.id },
    });
  }

  steps.push(
    {
      id: "refresh_workspace_context",
      title: "刷新邮箱环境",
      mode: "read_only",
      status: "completed",
      detail: "前端会刷新左侧分组、标签和 Hermes workspace context。",
    },
  );
  return steps;
}

async function rememberConfirmedRule(
  options: CreateHermesActionPlanServiceOptions,
  input: {
    planId: string;
    command: string;
    rule: HermesRule;
  },
): Promise<HermesMemoryDto | undefined> {
  if (!options.memoryStore) {
    return undefined;
  }

  try {
    return await options.memoryStore.createMemory({
      id: options.createId(),
      accountId: input.rule.accountId,
      layer: "procedural_memory",
      scope: "global",
      confidence: Math.max(0.75, Math.min(0.98, input.rule.confidence)),
      content: compactObject({
        source: "hermes_action_plan",
        planId: input.planId,
        ruleId: input.rule.id,
        candidateId: input.rule.candidateId,
        accountId: input.rule.accountId,
        command: input.command,
        ruleType: input.rule.ruleType,
        title: input.rule.title,
        condition: input.rule.condition,
        action: memorySafeRuleAction(input.rule.action),
        preference: confirmedRulePreferenceText(input.rule),
      }),
    });
  } catch {
    return undefined;
  }
}

function confirmedRulePreferenceText(rule: HermesRule): string {
  const labelName =
    typeof rule.action.labelName === "string" ? rule.action.labelName : "目标分组";
  const keywords = Array.isArray(rule.condition.anyKeywords)
    ? rule.condition.anyKeywords.filter(
        (keyword): keyword is string => typeof keyword === "string",
      )
    : [];
  const keywordText =
    keywords.length > 0 ? ` matching ${keywords.slice(0, 6).join(", ")}` : "";
  if (rule.ruleType === "content_label" && rule.action.type === "apply_label") {
    return `For account ${rule.accountId}, keep emails${keywordText} in the "${labelName}" left-side group.`;
  }

  return `For account ${rule.accountId}, keep the confirmed mailbox rule "${rule.title}" enabled.`;
}

function memorySafeRuleAction(action: Record<string, unknown>): Record<string, unknown> {
  return compactObject({
    type: action.type,
    labelId: action.labelId,
    labelName: action.labelName,
    labelColor: action.labelColor,
    applyToHistory: action.applyToHistory,
    providerWriteback: action.providerWriteback,
    savedView: action.savedView,
  });
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function summarizeWorkspace(
  context: HermesWorkspaceContext,
): HermesActionPlanWorkspaceSummary {
  return {
    accountCount: context.accounts.length,
    ...(context.accountScope.selectedAccount
      ? {
          selectedAccountId: context.accountScope.selectedAccount.accountId,
          provider: context.accountScope.selectedAccount.provider,
        }
      : {}),
    ...(context.navigation
      ? { quickCategoryCount: context.navigation.quickCategories.length }
      : {}),
    labelCount: context.labels.length,
    ruleCount: context.rules.length,
    pendingRuleCandidateCount: context.pendingRuleCandidates.length,
    unavailableModules: [...context.unavailableModules],
  };
}

function rulePlanSafety(candidate: HermesRuleCandidate): HermesActionPlanSafety {
  return {
    requiresUserConfirmation: true,
    providerWriteback: candidate.action.providerWriteback === true,
    appliesToHistory: candidate.action.applyToHistory === true,
    destructive: false,
  };
}

function confirmedRuleSafety(rule: HermesRule): HermesActionPlanSafety {
  return {
    requiresUserConfirmation: false,
    providerWriteback: rule.action.providerWriteback === true,
    appliesToHistory: rule.action.applyToHistory === true,
    destructive: false,
  };
}

function isConfirmableRulePlan(input: {
  intent: HermesActionPlanIntent;
  status: string;
  simulationId?: string;
  safety: HermesActionPlanSafety;
}): boolean {
  return (
    input.intent === "create_mailbox_rule" &&
    input.status === "confirming" &&
    typeof input.simulationId === "string" &&
    input.simulationId.length > 0 &&
    input.safety.providerWriteback === false &&
    input.safety.destructive === false
  );
}

async function recordActionPlanRun(
  options: CreateHermesActionPlanServiceOptions,
  input: {
    runId: string;
    accountId: string;
    eventType: string;
    readMessageIds: string[];
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    action: Record<string, unknown>;
  },
): Promise<string | undefined> {
  if (!options.runStore) {
    return undefined;
  }

  const auditEventId = options.createId();
  await options.runStore.recordCompletedSkillRun({
    accountId: input.accountId,
    run: {
      id: input.runId,
      skillId: ACTION_PLAN_SKILL_ID,
      skillTitle: ACTION_PLAN_SKILL_TITLE,
      input: input.input,
      output: input.output,
    },
    auditEvent: {
      id: auditEventId,
      eventType: input.eventType,
      skillRunId: input.runId,
      readMessageIds: input.readMessageIds,
      memoryIds: [],
      action: input.action,
    },
  });

  return auditEventId;
}

function isMailboxRulePlanCommand(command: string): boolean {
  return isMailboxRuleCommand(command);
}

export function isMailboxRuleCommand(command: string): boolean {
  const value = command.trim();
  if (isMailboxSearchCommand(value) && !isMailboxAutomationCommand(value)) {
    return false;
  }

  return isMailboxAutomationCommand(value);
}

function isMailboxSearchCommand(command: string): boolean {
  return /搜索|查找|查询|寻找|找一下|找出|找找|搜一下|有哪些|哪些|有没有|在哪里|在哪|search|find|show|list|filter/i.test(
    command,
  );
}

function isMailboxAutomationCommand(command: string): boolean {
  return (
    /(?:create|add|set up|setup|make|build|enable).*(?:rule|filter|label|folder|category)/i.test(
      command,
    ) ||
    /(?:auto|automatically|always).*(?:rule|filter|label|move|categorize|classify)/i.test(
      command,
    ) ||
    /(?:创建|新增|添加|新建|设置|建立|启用|生成).*(?:规则|分组|分类|标签|filter|rule)/iu.test(
      command,
    ) ||
    /(?:自动|以后|今后|每次|总是|一律|都).*(?:规则|分组|分类|标签|归类|移动到|移到|放到|放进|归到|归入|整理到|分配到)/u.test(
      command,
    ) ||
    /(?:把|将).*(?:邮件|邮箱|收件箱).*(?:放到|放进|归到|归入|归类|移动到|移到|整理到|分配到).*(?:分组|分类|标签|左侧|文件夹)/u.test(
      command,
    ) ||
    /(?:邮件|邮箱|收件箱).*(?:加|打|应用).*(?:标签|分类|分组)/u.test(
      command,
    ) ||
    /(?:创建|新增|添加|新建|加|放到|放进|归到|归入|归类|移动到|移到|整理到|分配到|自动).*(?:邮件|邮箱|收件箱|左侧)/u.test(
      command,
    )
  );
}

function requireText(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidHermesActionPlanRequestError();
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001f]/.test(trimmed)) {
    throw new InvalidHermesActionPlanRequestError();
  }
  return trimmed;
}

function requireCommand(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidHermesActionPlanRequestError();
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 500) {
    throw new InvalidHermesActionPlanRequestError();
  }
  if (/[\u0000-\u001f]/.test(trimmed)) {
    throw new InvalidHermesActionPlanRequestError();
  }
  return trimmed;
}

function optionalLimit(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min
  ) {
    throw new InvalidHermesActionPlanRequestError();
  }
  return Math.min(value, max);
}
