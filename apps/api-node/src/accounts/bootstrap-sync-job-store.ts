export interface BootstrapSyncJob {
  id: string;
  jobType: "sync_account";
  accountId: string;
  idempotencyKey: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
  createdAt: string;
}

export interface EnqueueInitialSyncInput {
  accountId: string;
  provider: string;
  engineProvider: "emailengine" | "native";
  sourceTaskId: string;
}

export interface BootstrapSyncJobStore {
  enqueueInitialSync(
    input: EnqueueInitialSyncInput,
  ): Promise<BootstrapSyncJob>;
}

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface BootstrapSyncJobRow extends Record<string, unknown> {
  id: string;
  job_type: "sync_account";
  account_id: string;
  idempotency_key: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
  created_at: string | Date;
}

export function createPostgresBootstrapSyncJobStore(
  client: Queryable,
  options: { createId: () => string; now?: () => Date },
): BootstrapSyncJobStore {
  return {
    async enqueueInitialSync(input) {
      const now = (options.now ?? (() => new Date()))().toISOString();
      const result = await client.query<BootstrapSyncJobRow>(
        `
          INSERT INTO sync_jobs (
            id,
            job_type,
            account_id,
            mailbox_id,
            trigger_event_id,
            idempotency_key,
            not_before,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
          ON CONFLICT (idempotency_key) DO UPDATE
          SET updated_at = sync_jobs.updated_at
          RETURNING
            id,
            job_type,
            account_id,
            idempotency_key,
            status,
            created_at
        `,
        [
          options.createId(),
          "sync_account",
          input.accountId,
          null,
          null,
          `job:initial-sync:${input.accountId}`,
          now,
          initialSyncPayload(input),
        ],
      );

      if (!result.rows[0]) {
        throw new Error("initial sync job enqueue returned no rows");
      }

      return rowToJob(result.rows[0]);
    },
  };
}

function initialSyncPayload(input: EnqueueInitialSyncInput) {
  return {
    source: "account_onboarding",
    kind:
      input.engineProvider === "native"
        ? "native_folder_discovery"
        : "initial_bootstrap",
    provider: input.provider,
    engineProvider: input.engineProvider,
    sourceTaskId: input.sourceTaskId,
  };
}

function rowToJob(row: BootstrapSyncJobRow): BootstrapSyncJob {
  return {
    id: row.id,
    jobType: row.job_type,
    accountId: row.account_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: toIsoString(row.created_at),
  };
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
