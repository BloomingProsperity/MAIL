import type {
  SyncControlAccount,
  SyncControlJob,
  SyncControlStore,
} from "./sync-control.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface AccountRow extends Record<string, unknown> {
  account_id: string;
  email: string;
  provider: string;
  auth_method: string;
  sync_state: string;
  engine_provider: string;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  job_type: "sync_account";
  account_id: string;
  idempotency_key: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
  created_at: string | Date;
}

export function createPostgresSyncControlStore(
  client: Queryable,
): SyncControlStore {
  return {
    async getAccount(accountId) {
      const result = await client.query<AccountRow>(
        `
          SELECT
            id AS account_id,
            email,
            provider,
            auth_method,
            sync_state,
            engine_provider
          FROM connected_accounts
          WHERE id = $1
          LIMIT 1
        `,
        [accountId],
      );

      return result.rows[0] ? mapAccount(result.rows[0]) : undefined;
    },

    async enqueueManualSync(input) {
      const result = await client.query<JobRow>(
        `
          WITH active_sync_job AS (
            SELECT
              id,
              job_type,
              account_id,
              idempotency_key,
              status,
              created_at
            FROM sync_jobs
            WHERE account_id = $3
              AND job_type = $2
              AND status IN ('queued', 'running')
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
          ),
          inserted_sync_job AS (
            INSERT INTO sync_jobs (
              id,
              job_type,
              account_id,
              idempotency_key,
              not_before,
              payload
            )
            SELECT $1, $2, $3, $4, $5::timestamptz, $6
            WHERE NOT EXISTS (SELECT 1 FROM active_sync_job)
            RETURNING id, job_type, account_id, idempotency_key, status, created_at
          )
          SELECT id, job_type, account_id, idempotency_key, status, created_at
          FROM inserted_sync_job
          UNION ALL
          SELECT id, job_type, account_id, idempotency_key, status, created_at
          FROM active_sync_job
          LIMIT 1
        `,
        [
          input.jobId,
          "sync_account",
          input.account.accountId,
          `job:manual-sync:${input.account.accountId}:${input.jobId}`,
          input.now,
          {
            source: "sync_control",
            kind: "manual_resync",
            provider: input.account.provider,
            engineProvider: input.account.engineProvider,
          },
        ],
      );

      if (!result.rows[0]) {
        throw new Error("manual sync enqueue returned no rows");
      }

      return mapJob(result.rows[0]);
    },

    async pauseAccount(accountId) {
      return updateAccountState(client, accountId, "paused");
    },

    async resumeAccount(accountId) {
      return updateAccountState(client, accountId, "syncing");
    },

    async retryFailedSync(input) {
      const result = await client.query(
        `
          UPDATE sync_jobs
          SET status = 'queued',
              attempts = 0,
              error_message = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              not_before = $2::timestamptz,
              updated_at = $2::timestamptz
          WHERE account_id = $1
            AND status IN ('failed', 'dead_letter')
            AND NOT EXISTS (
              SELECT 1
              FROM sync_jobs active_same_account
              WHERE active_same_account.account_id = sync_jobs.account_id
                AND active_same_account.id <> sync_jobs.id
                AND active_same_account.status IN ('queued', 'running')
            )
          RETURNING id
        `,
        [input.accountId, input.now],
      );

      return {
        accountId: input.accountId,
        retriedJobCount: result.rows.length,
        retriedJobIds: result.rows
          .map((row) => row.id)
          .filter((id): id is string => typeof id === "string"),
      };
    },
  };
}

async function updateAccountState(
  client: Queryable,
  accountId: string,
  syncState: "paused" | "syncing",
): Promise<SyncControlAccount> {
  const result = await client.query<AccountRow>(
    `
      UPDATE connected_accounts
      SET sync_state = '${syncState}',
          updated_at = now()
      WHERE id = $1
      RETURNING
        id AS account_id,
        email,
        provider,
        auth_method,
        sync_state,
        engine_provider
    `,
    [accountId],
  );

  if (!result.rows[0]) {
    throw new Error("account was not found");
  }

  return mapAccount(result.rows[0]);
}

function mapAccount(row: AccountRow): SyncControlAccount {
  return {
    accountId: String(row.account_id),
    email: row.email,
    provider: row.provider,
    authMethod: row.auth_method === "oauth" ? "oauth" : "password",
    syncState: syncState(row.sync_state),
    engineProvider: row.engine_provider === "native" ? "native" : "emailengine",
  };
}

function mapJob(row: JobRow): SyncControlJob {
  return {
    id: row.id,
    jobType: row.job_type,
    accountId: row.account_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: toIsoString(row.created_at),
  };
}

function syncState(value: string): SyncControlAccount["syncState"] {
  if (value === "paused") {
    return "paused";
  }
  if (value === "syncing") {
    return "syncing";
  }
  return "reauth_required";
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
