import type {
  HermesActionPlanIntent,
  HermesActionPlanSafety,
  HermesActionPlanStep,
  HermesActionPlanWorkspaceSummary,
} from "./action-plan.js";

export type HermesActionPlanRecordStatus =
  | "requires_confirmation"
  | "confirming"
  | "completed"
  | "failed";

export interface HermesActionPlanRecord {
  id: string;
  accountId: string;
  command: string;
  intent: HermesActionPlanIntent;
  status: HermesActionPlanRecordStatus;
  candidateId: string;
  simulationId?: string;
  workspace: HermesActionPlanWorkspaceSummary;
  safety: HermesActionPlanSafety;
  steps: HermesActionPlanStep[];
  auditEventId?: string;
  confirmationId?: string;
  confirmationAuditEventId?: string;
  ruleId?: string;
  createdAt: string;
  confirmingAt?: string;
  confirmedAt?: string;
  failureMessage?: string;
}

export interface CreateHermesActionPlanRecordInput {
  id: string;
  accountId: string;
  command: string;
  intent: HermesActionPlanIntent;
  candidateId: string;
  simulationId?: string;
  workspace: HermesActionPlanWorkspaceSummary;
  safety: HermesActionPlanSafety;
  steps: HermesActionPlanStep[];
  createdAt: string;
}

export interface BeginHermesActionPlanConfirmationInput {
  planId: string;
  accountId: string;
  candidateId: string;
  confirmingAt: string;
}

export interface ReleaseHermesActionPlanConfirmationInput {
  planId: string;
  accountId: string;
  candidateId: string;
}

export interface FailHermesActionPlanConfirmationInput {
  planId: string;
  accountId: string;
  candidateId: string;
  failureMessage: string;
}

export interface CompleteHermesActionPlanInput {
  planId: string;
  accountId: string;
  candidateId: string;
  confirmationId: string;
  ruleId: string;
  confirmedAt: string;
  confirmationAuditEventId?: string;
}

export interface FailStaleHermesActionPlanConfirmationsInput {
  before: string;
  limit: number;
  failureMessage: string;
  accountId?: string;
}

export interface HermesActionPlanStore {
  createPlan(
    input: CreateHermesActionPlanRecordInput,
  ): Promise<HermesActionPlanRecord>;
  setPlanAuditEvent(input: {
    planId: string;
    auditEventId: string;
  }): Promise<HermesActionPlanRecord | undefined>;
  beginConfirmation(
    input: BeginHermesActionPlanConfirmationInput,
  ): Promise<HermesActionPlanRecord | undefined>;
  releaseConfirmation(
    input: ReleaseHermesActionPlanConfirmationInput,
  ): Promise<HermesActionPlanRecord | undefined>;
  failConfirmation(
    input: FailHermesActionPlanConfirmationInput,
  ): Promise<HermesActionPlanRecord | undefined>;
  completePlan(
    input: CompleteHermesActionPlanInput,
  ): Promise<HermesActionPlanRecord | undefined>;
  failStaleConfirmations(
    input: FailStaleHermesActionPlanConfirmationsInput,
  ): Promise<{ items: HermesActionPlanRecord[] }>;
}

interface InMemoryHermesActionPlanStoreSeed {
  plans?: HermesActionPlanRecord[];
}

export function createInMemoryHermesActionPlanStore(
  seed: InMemoryHermesActionPlanStoreSeed = {},
): HermesActionPlanStore & {
  listPlans(): HermesActionPlanRecord[];
} {
  const plans = seed.plans?.map(cloneRecord) ?? [];

  return {
    async createPlan(input) {
      const record: HermesActionPlanRecord = {
        ...input,
        status: "requires_confirmation",
        steps: input.steps.map(cloneStep),
      };
      plans.push(cloneRecord(record));
      return cloneRecord(record);
    },

    async setPlanAuditEvent(input) {
      const plan = plans.find((item) => item.id === input.planId);
      if (!plan) {
        return undefined;
      }

      plan.auditEventId = input.auditEventId;
      return cloneRecord(plan);
    },

    async beginConfirmation(input) {
      const plan = plans.find(
        (item) =>
          item.id === input.planId &&
          item.accountId === input.accountId &&
          item.candidateId === input.candidateId &&
          item.status === "requires_confirmation",
      );
      if (!plan) {
        return undefined;
      }

      plan.status = "confirming";
      plan.confirmingAt = input.confirmingAt;
      delete plan.failureMessage;
      return cloneRecord(plan);
    },

    async releaseConfirmation(input) {
      const plan = plans.find(
        (item) =>
          item.id === input.planId &&
          item.accountId === input.accountId &&
          item.candidateId === input.candidateId &&
          item.status === "confirming",
      );
      if (!plan) {
        return undefined;
      }

      plan.status = "requires_confirmation";
      delete plan.confirmingAt;
      return cloneRecord(plan);
    },

    async failConfirmation(input) {
      const plan = plans.find(
        (item) =>
          item.id === input.planId &&
          item.accountId === input.accountId &&
          item.candidateId === input.candidateId &&
          item.status === "confirming",
      );
      if (!plan) {
        return undefined;
      }

      plan.status = "failed";
      plan.failureMessage = input.failureMessage;
      return cloneRecord(plan);
    },

    async completePlan(input) {
      const plan = plans.find(
        (item) =>
          item.id === input.planId &&
          item.accountId === input.accountId &&
          item.candidateId === input.candidateId &&
          item.status === "confirming",
      );
      if (!plan) {
        return undefined;
      }

      plan.status = "completed";
      plan.confirmationId = input.confirmationId;
      plan.ruleId = input.ruleId;
      plan.confirmedAt = input.confirmedAt;
      if (input.confirmationAuditEventId) {
        plan.confirmationAuditEventId = input.confirmationAuditEventId;
      }
      delete plan.failureMessage;
      return cloneRecord(plan);
    },

    async failStaleConfirmations(input) {
      const stalePlans = plans
        .filter(
          (plan) =>
            plan.status === "confirming" &&
            typeof plan.confirmingAt === "string" &&
            plan.confirmingAt < input.before &&
            (!input.accountId || plan.accountId === input.accountId),
        )
        .sort((a, b) => a.confirmingAt!.localeCompare(b.confirmingAt!))
        .slice(0, input.limit);

      for (const plan of stalePlans) {
        plan.status = "failed";
        plan.failureMessage = input.failureMessage;
      }

      return { items: stalePlans.map(cloneRecord) };
    },

    listPlans() {
      return plans.map(cloneRecord);
    },
  };
}

function cloneRecord(input: HermesActionPlanRecord): HermesActionPlanRecord {
  return {
    ...input,
    workspace: {
      ...input.workspace,
      unavailableModules: [...input.workspace.unavailableModules],
    },
    safety: { ...input.safety },
    steps: input.steps.map(cloneStep),
  };
}

function cloneStep(input: HermesActionPlanStep): HermesActionPlanStep {
  return {
    ...input,
    ...(input.resource ? { resource: { ...input.resource } } : {}),
  };
}
