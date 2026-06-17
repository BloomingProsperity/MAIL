import type { PoolLike } from "../db/transaction.js";
import type {
  HermesActionPlanRecord,
  HermesActionPlanRecordStatus,
  HermesActionPlanStore,
} from "./action-plan-store.js";

interface ActionPlanRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  command: string;
  intent: string;
  status: string;
  candidate_id: string;
  simulation_id?: string | null;
  workspace: Record<string, unknown>;
  safety: Record<string, unknown>;
  steps: unknown[];
  audit_event_id?: string | null;
  confirmation_id?: string | null;
  confirmation_audit_event_id?: string | null;
  rule_id?: string | null;
  created_at: string;
  confirming_at?: string | null;
  confirmed_at?: string | null;
  failure_message?: string | null;
}

const ACTION_PLAN_RETURNING_COLUMNS = `
  id,
  account_id,
  command,
  intent,
  status,
  candidate_id,
  simulation_id,
  workspace,
  safety,
  steps,
  audit_event_id,
  confirmation_id,
  confirmation_audit_event_id,
  rule_id,
  created_at,
  confirming_at,
  confirmed_at,
  failure_message
`;

export function createPostgresHermesActionPlanStore(
  client: PoolLike,
): HermesActionPlanStore {
  return {
    async createPlan(input) {
      const result = await client.query<ActionPlanRow>(
        `
          INSERT INTO hermes_action_plans (
            id,
            account_id,
            command,
            intent,
            status,
            candidate_id,
            simulation_id,
            workspace,
            safety,
            steps,
            created_at
          )
          VALUES ($1, $2, $3, $4, 'requires_confirmation', $5, $6, $7, $8, $9, $10)
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [
          input.id,
          input.accountId,
          input.command,
          input.intent,
          input.candidateId,
          input.simulationId ?? null,
          JSON.stringify(input.workspace),
          JSON.stringify(input.safety),
          JSON.stringify(input.steps),
          input.createdAt,
        ],
      );

      return planFromRow(result.rows[0]);
    },

    async setPlanAuditEvent(input) {
      const result = await client.query<ActionPlanRow>(
        `
          UPDATE hermes_action_plans
          SET audit_event_id = $2
          WHERE id = $1
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [input.planId, input.auditEventId],
      );

      return result.rows[0] ? planFromRow(result.rows[0]) : undefined;
    },

    async beginConfirmation(input) {
      const result = await client.query<ActionPlanRow>(
        `
          UPDATE hermes_action_plans
          SET status = 'confirming',
              confirming_at = $4,
              failure_message = NULL
          WHERE id = $1
            AND account_id = $2
            AND candidate_id = $3
            AND status = 'requires_confirmation'
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [
          input.planId,
          input.accountId,
          input.candidateId,
          input.confirmingAt,
        ],
      );

      return result.rows[0] ? planFromRow(result.rows[0]) : undefined;
    },

    async releaseConfirmation(input) {
      const result = await client.query<ActionPlanRow>(
        `
          UPDATE hermes_action_plans
          SET status = 'requires_confirmation',
              confirming_at = NULL
          WHERE id = $1
            AND account_id = $2
            AND candidate_id = $3
            AND status = 'confirming'
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [input.planId, input.accountId, input.candidateId],
      );

      return result.rows[0] ? planFromRow(result.rows[0]) : undefined;
    },

    async failConfirmation(input) {
      const result = await client.query<ActionPlanRow>(
        `
          UPDATE hermes_action_plans
          SET status = 'failed',
              failure_message = $4
          WHERE id = $1
            AND account_id = $2
            AND candidate_id = $3
            AND status = 'confirming'
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [
          input.planId,
          input.accountId,
          input.candidateId,
          input.failureMessage,
        ],
      );

      return result.rows[0] ? planFromRow(result.rows[0]) : undefined;
    },

    async completePlan(input) {
      const result = await client.query<ActionPlanRow>(
        `
          UPDATE hermes_action_plans
          SET status = 'completed',
              confirmation_id = $4,
              rule_id = $5,
              confirmed_at = $6,
              confirmation_audit_event_id = $7,
              failure_message = NULL
          WHERE id = $1
            AND account_id = $2
            AND candidate_id = $3
            AND status = 'confirming'
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [
          input.planId,
          input.accountId,
          input.candidateId,
          input.confirmationId,
          input.ruleId,
          input.confirmedAt,
          input.confirmationAuditEventId ?? null,
        ],
      );

      return result.rows[0] ? planFromRow(result.rows[0]) : undefined;
    },

    async failStaleConfirmations(input) {
      const result = await client.query<ActionPlanRow>(
        `
          WITH stale_plans AS (
            SELECT id
            FROM hermes_action_plans
            WHERE status = 'confirming'
              AND confirming_at < $1::timestamptz
              AND ($4::uuid IS NULL OR account_id = $4)
            ORDER BY confirming_at ASC, id ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED
          )
          UPDATE hermes_action_plans
          SET status = 'failed',
              failure_message = $2
          WHERE id IN (SELECT id FROM stale_plans)
            AND status = 'confirming'
            AND confirming_at < $1::timestamptz
            AND ($4::uuid IS NULL OR account_id = $4)
          RETURNING
            ${ACTION_PLAN_RETURNING_COLUMNS}
        `,
        [
          input.before,
          input.failureMessage,
          input.limit,
          input.accountId ?? null,
        ],
      );

      return { items: result.rows.map(planFromRow) };
    },
  };
}

function planFromRow(row: ActionPlanRow): HermesActionPlanRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    command: row.command,
    intent: row.intent as HermesActionPlanRecord["intent"],
    status: row.status as HermesActionPlanRecordStatus,
    candidateId: row.candidate_id,
    ...(row.simulation_id ? { simulationId: row.simulation_id } : {}),
    workspace: {
      accountCount: Number(row.workspace.accountCount ?? 0),
      ...(typeof row.workspace.selectedAccountId === "string"
        ? { selectedAccountId: row.workspace.selectedAccountId }
        : {}),
      ...(typeof row.workspace.provider === "string"
        ? { provider: row.workspace.provider }
        : {}),
      ...(typeof row.workspace.quickCategoryCount === "number"
        ? { quickCategoryCount: row.workspace.quickCategoryCount }
        : {}),
      labelCount: Number(row.workspace.labelCount ?? 0),
      ruleCount: Number(row.workspace.ruleCount ?? 0),
      pendingRuleCandidateCount: Number(
        row.workspace.pendingRuleCandidateCount ?? 0,
      ),
      unavailableModules: Array.isArray(row.workspace.unavailableModules)
        ? row.workspace.unavailableModules.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    },
    safety: {
      requiresUserConfirmation:
        row.safety.requiresUserConfirmation === true,
      providerWriteback: row.safety.providerWriteback === true,
      appliesToHistory: row.safety.appliesToHistory === true,
      destructive: row.safety.destructive === true,
    },
    steps: row.steps
      .filter(isActionPlanStep)
      .map((step) => ({
        id: step.id,
        title: step.title,
        mode: step.mode,
        status: step.status,
        detail: step.detail,
        ...(step.resource ? { resource: step.resource } : {}),
      })),
    ...(row.audit_event_id ? { auditEventId: row.audit_event_id } : {}),
    ...(row.confirmation_id ? { confirmationId: row.confirmation_id } : {}),
    ...(row.confirmation_audit_event_id
      ? { confirmationAuditEventId: row.confirmation_audit_event_id }
      : {}),
    ...(row.rule_id ? { ruleId: row.rule_id } : {}),
    createdAt: row.created_at,
    ...(row.confirming_at ? { confirmingAt: row.confirming_at } : {}),
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
  };
}

function isActionPlanStep(input: unknown): input is {
  id: string;
  title: string;
  mode:
    | "read_only"
    | "draft"
    | "shadow_simulation"
    | "confirmation_required"
    | "mutation";
  status: "completed" | "requires_confirmation";
  detail: string;
  resource?: { type: string; id: string };
} {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as Record<string, unknown>;
  const resource = value.resource as Record<string, unknown> | undefined;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.mode === "string" &&
    typeof value.status === "string" &&
    typeof value.detail === "string" &&
    (resource === undefined ||
      (typeof resource.type === "string" && typeof resource.id === "string"))
  );
}
