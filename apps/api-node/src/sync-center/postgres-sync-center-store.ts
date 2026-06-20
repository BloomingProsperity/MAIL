import type {
  ReauthorizationTask,
  ReauthorizationTaskStatus,
  SyncCenterAccount,
  SyncCenterAccountState,
  SyncCenterAuthMethod,
  SyncCenterEngineProvider,
  SyncCenterJobStatus,
  SyncCenterNextAction,
  SyncCenterStore,
} from "./sync-center-store.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface SyncCenterAccountRow extends Record<string, unknown> {
  account_id: string;
  email: string;
  provider: string;
  auth_method: string;
  display_name?: string | null;
  sync_state: string;
  engine_provider: string;
  account_updated_at: string | Date;
  job_id?: string | null;
  job_type?: string | null;
  job_status?: string | null;
  attempts?: number | null;
  max_attempts?: number | null;
  not_before?: string | Date | null;
  lease_expires_at?: string | Date | null;
  error_message?: string | null;
  job_updated_at?: string | Date | null;
  completed_at?: string | Date | null;
}

interface ReauthorizationTaskRow extends Record<string, unknown> {
  task_id: string;
  email: string;
  provider: string;
  auth_method: string;
  status: string;
  error_message?: string | null;
  payload: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

export function createPostgresSyncCenterStore(
  client: Queryable,
): SyncCenterStore {
  return {
    async listAccounts() {
      const result = await client.query<SyncCenterAccountRow>(
        `
          WITH latest_sync_job AS (
            SELECT DISTINCT ON (account_id)
              account_id,
              id,
              job_type,
              status,
              attempts,
              max_attempts,
              not_before,
              lease_expires_at,
              error_message,
              updated_at,
              completed_at
            FROM sync_jobs
            WHERE account_id IS NOT NULL
            ORDER BY account_id, updated_at DESC, created_at DESC
          )
          SELECT
            connected_accounts.id AS account_id,
            connected_accounts.email,
            connected_accounts.provider,
            connected_accounts.auth_method,
            connected_accounts.display_name,
            connected_accounts.sync_state,
            connected_accounts.engine_provider,
            connected_accounts.updated_at AS account_updated_at,
            latest_sync_job.id AS job_id,
            latest_sync_job.job_type,
            latest_sync_job.status AS job_status,
            latest_sync_job.attempts,
            latest_sync_job.max_attempts,
            latest_sync_job.not_before,
            latest_sync_job.lease_expires_at,
            latest_sync_job.error_message,
            latest_sync_job.updated_at AS job_updated_at,
            latest_sync_job.completed_at
          FROM connected_accounts
          LEFT JOIN latest_sync_job
            ON latest_sync_job.account_id = connected_accounts.id::text
          ORDER BY connected_accounts.updated_at DESC, connected_accounts.email ASC
        `,
      );

      return { items: result.rows.map(mapAccount) };
    },

    async listReauthorizations() {
      const result = await client.query<ReauthorizationTaskRow>(
        `
          SELECT
            id AS task_id,
            email,
            provider,
            auth_method,
            status,
            error_message,
            payload,
            created_at,
            updated_at
          FROM onboarding_tasks
          WHERE status IN ('pending', 'failed')
            AND (
              payload ->> 'reauthRequired' = 'true'
              OR payload ->> 'source' IN (
                'csv_import',
                'account_transfer_import'
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM connected_accounts active_accounts
              WHERE lower(active_accounts.email) = lower(onboarding_tasks.email)
                AND lower(active_accounts.provider) = lower(onboarding_tasks.provider)
                AND active_accounts.sync_state IN ('syncing', 'paused')
            )
          ORDER BY created_at DESC, id DESC
        `,
      );

      return { items: result.rows.map(mapReauthorizationTask) };
    },
  };
}

function mapAccount(row: SyncCenterAccountRow): SyncCenterAccount {
  const syncState = mapSyncState(row.sync_state);
  const latestSyncJob = row.job_id ? mapLatestJob(row) : undefined;

  return {
    accountId: String(row.account_id),
    email: row.email,
    provider: row.provider,
    authMethod: mapAuthMethod(row.auth_method),
    displayName:
      typeof row.display_name === "string" ? row.display_name : undefined,
    syncState,
    engineProvider: mapEngineProvider(row.engine_provider),
    reauthRequired: syncState === "reauth_required",
    nextAction: nextAction(syncState, latestSyncJob?.status),
    accountUpdatedAt: toIsoString(row.account_updated_at),
    ...(latestSyncJob ? { latestSyncJob } : {}),
  };
}

function mapLatestJob(row: SyncCenterAccountRow): SyncCenterAccount["latestSyncJob"] {
  if (!row.job_id || !row.job_status || !row.not_before || !row.job_updated_at) {
    return undefined;
  }

  return compactObject({
    id: String(row.job_id),
    jobType: String(row.job_type ?? "sync_account"),
    status: mapJobStatus(row.job_status),
    attempts: readNumber(row.attempts),
    maxAttempts: readNumber(row.max_attempts),
    notBefore: toIsoString(row.not_before),
    leaseExpiresAt: row.lease_expires_at
      ? toIsoString(row.lease_expires_at)
      : undefined,
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : undefined,
    updatedAt: toIsoString(row.job_updated_at),
    completedAt: row.completed_at ? toIsoString(row.completed_at) : undefined,
  });
}

function mapReauthorizationTask(
  row: ReauthorizationTaskRow,
): ReauthorizationTask {
  const payload = recordValue(row.payload);

  return compactObject({
    taskId: String(row.task_id),
    email: row.email,
    provider: row.provider,
    authMethod: mapAuthMethod(row.auth_method),
    status: mapTaskStatus(row.status),
    source: readString(payload.source),
    displayName: readString(payload.displayName),
    transferVersion: readNumberOrUndefined(payload.transferVersion),
    reauthRequired: payload.reauthRequired === true,
    loginHint: readString(payload.loginHint),
    providerPreset: readString(payload.providerPreset),
    username: readString(payload.username),
    labels: readStringArray(payload.labels),
    group: readString(payload.group),
    notes: readString(payload.notes),
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  });
}

function nextAction(
  syncState: SyncCenterAccountState,
  jobStatus: SyncCenterJobStatus | undefined,
): SyncCenterNextAction {
  if (syncState === "paused") {
    return "resume_sync";
  }
  if (syncState === "reauth_required") {
    return "reauthorize";
  }
  if (jobStatus === "queued" || jobStatus === "running") {
    return "wait_for_sync";
  }
  if (jobStatus === "failed" || jobStatus === "dead_letter") {
    return "fix_sync_error";
  }

  return "none";
}

function mapAuthMethod(value: string): SyncCenterAuthMethod {
  return value === "oauth" ? "oauth" : "password";
}

function mapSyncState(value: string): SyncCenterAccountState {
  if (value === "paused") {
    return "paused";
  }

  return value === "syncing" ? "syncing" : "reauth_required";
}

function mapEngineProvider(value: string): SyncCenterEngineProvider {
  return value === "native" ? "native" : "emailengine";
}

function mapJobStatus(value: string): SyncCenterJobStatus {
  if (
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "dead_letter"
  ) {
    return value;
  }

  return "queued";
}

function mapTaskStatus(value: string): ReauthorizationTaskStatus {
  return value === "failed" ? "failed" : "pending";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
