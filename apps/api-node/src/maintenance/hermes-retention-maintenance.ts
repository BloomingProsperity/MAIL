import type { HermesActionPlanStore } from "../hermes/action-plan-store.js";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface HermesRetentionTableStatus {
  table: string;
  timestampColumn: string;
  expiredRows: number;
  scanLimit: number;
  scanLimited: boolean;
}

export interface HermesRetentionCleanupCounts {
  messageTranslations: number;
  messageSummaries: number;
  staleActionPlanConfirmations: number;
  actionPlans: number;
  feedback: number;
  auditEvents: number;
  skillRuns: number;
}

export interface HermesRetentionMaintenanceStatus {
  generatedAt: string;
  retentionMs: number;
  retentionDays: number;
  cleanupLimit: number;
  cutoff: string;
  tables: HermesRetentionTableStatus[];
  expiredRows: number;
  scanLimited: boolean;
}

export interface HermesRetentionMaintenanceCleanupResult {
  generatedAt: string;
  retentionMs: number;
  retentionDays: number;
  cleanupLimit: number;
  cutoff: string;
  cleanup: HermesRetentionCleanupCounts & {
    deleted: number;
  };
  after: HermesRetentionMaintenanceStatus;
}

export interface HermesRetentionMaintenanceStore {
  inspectExpired(input: {
    cutoff: Date;
    scanLimit: number;
  }): Promise<HermesRetentionTableStatus[]>;
  cleanupExpired(input: {
    cutoff: Date;
    limit: number;
  }): Promise<HermesRetentionCleanupCounts>;
}

export interface HermesRetentionMaintenanceService {
  getStatus(): Promise<HermesRetentionMaintenanceStatus>;
  cleanup(input?: {
    retentionDays?: number;
    limit?: number;
  }): Promise<HermesRetentionMaintenanceCleanupResult>;
}

interface HermesRetentionTableSpec {
  key: keyof HermesRetentionCleanupCounts;
  table: string;
  timestampColumn: string;
  where?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const HERMES_RETENTION_TABLES: HermesRetentionTableSpec[] = [
  {
    key: "messageTranslations",
    table: "hermes_message_translations",
    timestampColumn: "updated_at",
  },
  {
    key: "messageSummaries",
    table: "hermes_message_summaries",
    timestampColumn: "updated_at",
  },
  {
    key: "actionPlans",
    table: "hermes_action_plans",
    timestampColumn: "created_at",
    where: "status = 'completed'",
  },
  {
    key: "feedback",
    table: "hermes_feedback",
    timestampColumn: "created_at",
  },
  {
    key: "auditEvents",
    table: "hermes_audit_events",
    timestampColumn: "created_at",
  },
  {
    key: "skillRuns",
    table: "hermes_skill_runs",
    timestampColumn: "created_at",
  },
];

export function createPostgresHermesRetentionMaintenanceStore(
  client: Queryable,
): HermesRetentionMaintenanceStore {
  return {
    async inspectExpired(input) {
      const scanLimit = Math.max(0, Math.floor(input.scanLimit));
      const results: HermesRetentionTableStatus[] = [];

      for (const spec of HERMES_RETENTION_TABLES) {
        const expiredRows = await countExpiredCapped({
          client,
          spec,
          cutoff: input.cutoff,
          scanLimit,
        });
        results.push({
          table: spec.table,
          timestampColumn: spec.timestampColumn,
          expiredRows: Math.min(expiredRows, scanLimit),
          scanLimit,
          scanLimited: expiredRows > scanLimit,
        });
      }

      return results;
    },

    async cleanupExpired(input) {
      const counts = emptyCounts();
      for (const spec of HERMES_RETENTION_TABLES) {
        counts[spec.key] = await deleteByTimestamp({
          client,
          spec,
          cutoff: input.cutoff,
          limit: input.limit,
        });
      }

      return counts;
    },
  };
}

export function createHermesRetentionMaintenanceService(input: {
  store: HermesRetentionMaintenanceStore;
  actionPlanStore?: Pick<HermesActionPlanStore, "failStaleConfirmations">;
  now: () => Date;
  retentionMs: number;
  cleanupLimit: number;
}): HermesRetentionMaintenanceService {
  const defaultRetentionMs = positiveInteger(input.retentionMs, DAY_MS * 30);
  const defaultCleanupLimit = positiveInteger(input.cleanupLimit, 500);

  return {
    async getStatus() {
      return buildStatus({
        store: input.store,
        now: input.now(),
        retentionMs: defaultRetentionMs,
        cleanupLimit: defaultCleanupLimit,
      });
    },

    async cleanup(cleanupInput = {}) {
      const retentionDays =
        cleanupInput.retentionDays === undefined
          ? Math.round(defaultRetentionMs / DAY_MS)
          : positiveInteger(
              cleanupInput.retentionDays,
              Math.round(defaultRetentionMs / DAY_MS),
            );
      const retentionMs = retentionDays * DAY_MS;
      const cleanupLimit = positiveInteger(
        cleanupInput.limit ?? defaultCleanupLimit,
        defaultCleanupLimit,
      );
      const now = input.now();
      const cutoff = new Date(now.getTime() - retentionMs);
      const staleConfirmations = input.actionPlanStore
        ? await input.actionPlanStore.failStaleConfirmations({
            before: cutoff.toISOString(),
            limit: cleanupLimit,
            failureMessage: "confirmation_timed_out",
          })
        : { items: [] };
      const cleanupCounts = await input.store.cleanupExpired({
        cutoff,
        limit: cleanupLimit,
      });
      cleanupCounts.staleActionPlanConfirmations =
        staleConfirmations.items.length;
      const after = await buildStatus({
        store: input.store,
        now,
        retentionMs,
        cleanupLimit,
      });

      return {
        generatedAt: now.toISOString(),
        retentionMs,
        retentionDays,
        cleanupLimit,
        cutoff: cutoff.toISOString(),
        cleanup: {
          ...cleanupCounts,
          deleted: sumCounts(cleanupCounts),
        },
        after,
      };
    },
  };
}

async function buildStatus(input: {
  store: HermesRetentionMaintenanceStore;
  now: Date;
  retentionMs: number;
  cleanupLimit: number;
}): Promise<HermesRetentionMaintenanceStatus> {
  const cutoff = new Date(input.now.getTime() - input.retentionMs);
  const scanLimit = input.cleanupLimit;
  const tables = await input.store.inspectExpired({
    cutoff,
    scanLimit,
  });

  return {
    generatedAt: input.now.toISOString(),
    retentionMs: input.retentionMs,
    retentionDays: Math.round(input.retentionMs / DAY_MS),
    cleanupLimit: input.cleanupLimit,
    cutoff: cutoff.toISOString(),
    tables,
    expiredRows: tables.reduce((sum, table) => sum + table.expiredRows, 0),
    scanLimited: tables.some((table) => table.scanLimited),
  };
}

async function countExpiredCapped(input: {
  client: Queryable;
  spec: HermesRetentionTableSpec;
  cutoff: Date;
  scanLimit: number;
}): Promise<number> {
  const whereClause = whereClauseFor(input.spec);
  const result = await input.client.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM (
        SELECT id
        FROM ${input.spec.table}
        WHERE ${whereClause}
        ORDER BY ${input.spec.timestampColumn} ASC
        LIMIT $2
      ) expired
    `,
    [input.cutoff, input.scanLimit + 1],
  );

  return Number.parseInt(result.rows[0]?.count ?? "0", 10) || 0;
}

async function deleteByTimestamp(input: {
  client: Queryable;
  spec: HermesRetentionTableSpec;
  cutoff: Date;
  limit: number;
}): Promise<number> {
  const result = await input.client.query(
    `
      DELETE FROM ${input.spec.table}
      WHERE id IN (
        SELECT id
        FROM ${input.spec.table}
        WHERE ${whereClauseFor(input.spec)}
        ORDER BY ${input.spec.timestampColumn} ASC
        LIMIT $2
      )
    `,
    [input.cutoff, input.limit],
  );

  return result.rowCount ?? 0;
}

function whereClauseFor(spec: HermesRetentionTableSpec): string {
  return spec.where
    ? `${spec.where} AND ${spec.timestampColumn} < $1`
    : `${spec.timestampColumn} < $1`;
}

function emptyCounts(): HermesRetentionCleanupCounts {
  return {
    messageTranslations: 0,
    messageSummaries: 0,
    staleActionPlanConfirmations: 0,
    actionPlans: 0,
    feedback: 0,
    auditEvents: 0,
    skillRuns: 0,
  };
}

function sumCounts(counts: HermesRetentionCleanupCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
