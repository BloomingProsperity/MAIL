import type {
  ApproveHermesRuleInput,
  DraftHermesRuleInput,
  HermesRule,
  HermesRuleCandidate,
  HermesRuleService,
  HermesRuleSimulation,
} from "./rules.js";
import type { HermesRunStore } from "./translation.js";
import type {
  HermesWorkspaceContext,
  HermesWorkspaceContextService,
} from "./workspace-context.js";

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
  planId: string;
  accountId: string;
  candidateId: string;
  status: "completed";
  confirmedAt: string;
  rule: HermesRule;
  safety: HermesActionPlanSafety;
  steps: HermesActionPlanStep[];
}

export interface CreateHermesActionPlanInput
  extends DraftHermesRuleInput {
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
    "draftRule" | "simulateRule" | "approveRule"
  >;
  workspaceContextService: Pick<HermesWorkspaceContextService, "getContext">;
  runStore?: HermesRunStore;
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

export function createHermesActionPlanService(
  options: CreateHermesActionPlanServiceOptions,
): HermesActionPlanService {
  return {
    async createPlan(input) {
      const accountId = requireText(input.accountId);
      const command = requireCommand(input.command);
      const sampleLimit = optionalLimit(input.sampleLimit ?? 25, 1, 100);
      if (!isMailboxRulePlanCommand(command)) {
        throw new InvalidHermesActionPlanRequestError();
      }

      const workspace = await options.workspaceContextService.getContext({
        accountId,
        ruleLimit: 25,
        labelLimit: 50,
      });
      const draft = await options.ruleService.draftRule({ accountId, command });
      const candidate = draft.candidates[0];
      if (!candidate) {
        throw new InvalidHermesActionPlanRequestError();
      }

      const simulation = await options.ruleService.simulateRule({
        accountId,
        candidateId: candidate.id,
        sampleLimit,
      });
      if (!simulation) {
        throw new InvalidHermesActionPlanRequestError();
      }

      const plan: HermesActionPlan = {
        id: options.createId(),
        accountId,
        command,
        intent: "create_mailbox_rule",
        status: "requires_confirmation",
        createdAt: options.now(),
        candidate,
        simulation,
        workspace: summarizeWorkspace(workspace),
        safety: rulePlanSafety(candidate),
        steps: buildDraftSteps(candidate, simulation),
      };
      const auditEventId = await recordActionPlanRun(options, {
        runId: plan.id,
        eventType: "hermes.action_plan.created",
        readMessageIds: simulation.sampleMessageIds,
        input: {
          accountId,
          command,
          sampleLimit,
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

      return auditEventId ? { ...plan, auditEventId } : plan;
    },

    async confirmPlan(input) {
      const planId = requireText(input.planId);
      const accountId = requireText(input.accountId);
      const candidateId = requireText(input.candidateId);
      const rule = await options.ruleService.approveRule({
        accountId,
        candidateId,
      });
      if (!rule) {
        return undefined;
      }

      const confirmedAt = options.now();
      const confirmation: HermesActionPlanConfirmation = {
        id: options.createId(),
        planId,
        accountId,
        candidateId,
        status: "completed",
        confirmedAt,
        rule,
        safety: confirmedRuleSafety(rule),
        steps: buildConfirmationSteps(rule),
      };
      const auditEventId = await recordActionPlanRun(options, {
        runId: confirmation.id,
        eventType: "hermes.action_plan.confirmed",
        readMessageIds: [],
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
        },
        action: {
          type: "confirm_action_plan",
          planId,
          candidateId,
          ruleId: rule.id,
          status: confirmation.status,
        },
      });

      return auditEventId
        ? { ...confirmation, auditEventId }
        : confirmation;
    },
  };
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
      detail: "确认后才会创建本地标签/左侧分组并启用规则。",
      resource: { type: "hermes_rule_candidate", id: candidate.id },
    },
  ];
}

function buildConfirmationSteps(rule: HermesRule): HermesActionPlanStep[] {
  return [
    {
      id: "approve_rule_candidate",
      title: "启用规则",
      mode: "mutation",
      status: "completed",
      detail: rule.title,
      resource: { type: "hermes_rule", id: rule.id },
    },
    {
      id: "refresh_workspace_context",
      title: "刷新邮箱环境",
      mode: "read_only",
      status: "completed",
      detail: "前端会刷新左侧分组、标签和 Hermes workspace context。",
    },
  ];
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

async function recordActionPlanRun(
  options: CreateHermesActionPlanServiceOptions,
  input: {
    runId: string;
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
  return /规则|分组|分类|标签|filter|rule/i.test(command);
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
