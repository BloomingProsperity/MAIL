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

export interface HermesRetentionCleanupCounts {
  staleActionPlanConfirmations: number;
  messageTranslations: number;
  messageSummaries: number;
  actionPlans: number;
  feedback: number;
  auditEvents: number;
  skillRuns: number;
}

export interface HermesRetentionCleanupStore {
  cleanupExpired(input: {
    cutoff: Date;
    limit: number;
  }): Promise<HermesRetentionCleanupCounts>;
}

export type HermesRetentionCleanupResult =
  | { status: "idle" }
  | ({
      status: "processed";
      cutoff: string;
      deleted: number;
    } & HermesRetentionCleanupCounts);

export interface RunHermesRetentionCleanupInput {
  store: HermesRetentionCleanupStore;
  now: Date;
  retentionMs: number;
  limit: number;
}

export interface CreateHermesRetentionCleanupLaneInput
  extends Omit<RunHermesRetentionCleanupInput, "now"> {
  clock(): Date;
  intervalMs: number;
}

export function createPostgresHermesRetentionCleanupStore(
  client: Queryable,
): HermesRetentionCleanupStore {
  return {
    async cleanupExpired(input) {
      return {
        staleActionPlanConfirmations: await failStaleActionPlanConfirmations({
          client,
          cutoff: input.cutoff,
          limit: input.limit,
          failureMessage: "confirmation_timed_out",
        }),
        messageTranslations: await deleteByTimestamp({
          client,
          table: "hermes_message_translations",
          timestampColumn: "updated_at",
          cutoff: input.cutoff,
          limit: input.limit,
        }),
        messageSummaries: await deleteByTimestamp({
          client,
          table: "hermes_message_summaries",
          timestampColumn: "updated_at",
          cutoff: input.cutoff,
          limit: input.limit,
        }),
        actionPlans: await deleteByTimestamp({
          client,
          table: "hermes_action_plans",
          timestampColumn: "created_at",
          cutoff: input.cutoff,
          limit: input.limit,
          where: "status = 'completed'",
        }),
        feedback: await deleteByTimestamp({
          client,
          table: "hermes_feedback",
          timestampColumn: "created_at",
          cutoff: input.cutoff,
          limit: input.limit,
        }),
        auditEvents: await deleteByTimestamp({
          client,
          table: "hermes_audit_events",
          timestampColumn: "created_at",
          cutoff: input.cutoff,
          limit: input.limit,
        }),
        skillRuns: await deleteByTimestamp({
          client,
          table: "hermes_skill_runs",
          timestampColumn: "created_at",
          cutoff: input.cutoff,
          limit: input.limit,
        }),
      };
    },
  };
}

export async function runHermesRetentionCleanupOnce(
  input: RunHermesRetentionCleanupInput,
): Promise<HermesRetentionCleanupResult> {
  const cutoff = new Date(input.now.getTime() - input.retentionMs);
  const counts = await input.store.cleanupExpired({
    cutoff,
    limit: input.limit,
  });
  const deleted = Object.values(counts).reduce((sum, count) => sum + count, 0);

  if (deleted === 0) {
    return { status: "idle" };
  }

  return {
    status: "processed",
    cutoff: cutoff.toISOString(),
    deleted,
    ...counts,
  };
}

export function createHermesRetentionCleanupLane(
  input: CreateHermesRetentionCleanupLaneInput,
): () => Promise<HermesRetentionCleanupResult[]> {
  let nextRunAt = 0;

  return async () => {
    const now = input.clock();
    if (now.getTime() < nextRunAt) {
      return [{ status: "idle" }];
    }
    nextRunAt = now.getTime() + Math.max(1, input.intervalMs);

    return [
      await runHermesRetentionCleanupOnce({
        store: input.store,
        now,
        retentionMs: input.retentionMs,
        limit: input.limit,
      }),
    ];
  };
}

async function deleteByTimestamp(input: {
  client: Queryable;
  table: string;
  timestampColumn: string;
  cutoff: Date;
  limit: number;
  where?: string;
}): Promise<number> {
  const whereClause = input.where
    ? `${input.where} AND ${input.timestampColumn} < $1`
    : `${input.timestampColumn} < $1`;
  const result = await input.client.query(
    `
      DELETE FROM ${input.table}
      WHERE id IN (
        SELECT id
        FROM ${input.table}
        WHERE ${whereClause}
        ORDER BY ${input.timestampColumn} ASC
        LIMIT $2
      )
    `,
    [input.cutoff, input.limit],
  );

  return result.rowCount ?? 0;
}

async function failStaleActionPlanConfirmations(input: {
  client: Queryable;
  cutoff: Date;
  limit: number;
  failureMessage: string;
}): Promise<number> {
  const result = await input.client.query(
    `
      WITH stale_plans AS (
        SELECT id
        FROM hermes_action_plans
        WHERE status = 'confirming'
          AND confirming_at < $1
        ORDER BY confirming_at ASC, id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE hermes_action_plans
      SET status = 'failed',
          failure_message = $3
      WHERE id IN (SELECT id FROM stale_plans)
        AND status = 'confirming'
        AND confirming_at < $1
    `,
    [input.cutoff, input.limit, input.failureMessage],
  );

  return result.rowCount ?? 0;
}
