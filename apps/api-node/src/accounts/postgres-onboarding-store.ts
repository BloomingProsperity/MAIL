import type {
  AccountOnboardingResult,
  AccountOnboardingStore,
  ConnectedAccount,
  OnboardingTask,
} from "./imap-smtp-onboarding.js";
import type {
  BootstrapSyncJob,
  EnqueueInitialSyncInput,
} from "./bootstrap-sync-job-store.js";
import { type PoolLike, type Queryable, withTransaction } from "../db/transaction.js";

interface PostgresAccountOnboardingStoreOptions {
  createId?: () => string;
  now?: () => Date;
}

export function createPostgresAccountOnboardingStore(
  client: PoolLike,
  options: PostgresAccountOnboardingStoreOptions = {},
): AccountOnboardingStore {
  return {
    async createTask(input) {
      const result = await client.query(
        `
          INSERT INTO onboarding_tasks (
            id,
            email,
            provider,
            auth_method,
            status,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, email, provider, auth_method, status, error_message, payload
        `,
        [
          input.id,
          input.email,
          input.provider,
          input.authMethod,
          input.status,
          input.payload ?? {},
        ],
      );

      return mapTask(result.rows[0]);
    },
    async completeTask(input) {
      return completeTask(client, input);
    },
    async completeTaskAndEnqueueInitialSync(input) {
      if (!options.createId) {
        throw new Error("createId is required to enqueue initial sync jobs");
      }

      return withTransaction(client, async (tx) => {
        const completed = await completeTask(tx, input);
        const syncJob = await enqueueInitialSyncJob(tx, input.initialSync, {
          createId: options.createId!,
          now: options.now,
        });

        return {
          ...completed,
          syncJob,
        };
      });
    },
    async failTask(input) {
      const result = await client.query(
        `
          UPDATE onboarding_tasks
          SET status = 'failed',
              error_message = $2,
              updated_at = now()
          WHERE id = $1
          RETURNING id, email, provider, auth_method, status, error_message, payload
        `,
        [input.taskId, input.errorMessage],
      );

      return mapTask(result.rows[0]);
    },
  };
}

async function completeTask(
  client: Queryable,
  input: {
    taskId: string;
    account: ConnectedAccount;
  },
): Promise<AccountOnboardingResult> {
  const accountResult = await client.query(
    `
      INSERT INTO connected_accounts (
        id,
        email,
        provider,
        auth_method,
        display_name,
        sync_state,
        engine_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email, provider)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        sync_state = EXCLUDED.sync_state,
        engine_provider = EXCLUDED.engine_provider,
        updated_at = now()
      RETURNING id, email, provider, auth_method, display_name, sync_state, engine_provider
    `,
    [
      input.account.id,
      input.account.email,
      input.account.provider,
      input.account.authMethod,
      input.account.displayName ?? null,
      input.account.syncState,
      input.account.engineProvider,
    ],
  );
  const account = mapAccount(accountResult.rows[0]);

  const taskResult = await client.query(
    `
      UPDATE onboarding_tasks
      SET status = 'completed',
          error_message = NULL,
          updated_at = now()
      WHERE id = $1
      RETURNING id, email, provider, auth_method, status, error_message, payload
    `,
    [input.taskId],
  );

  return {
    task: publicTask(mapTask(taskResult.rows[0])),
    account,
  } satisfies AccountOnboardingResult;
}

async function enqueueInitialSyncJob(
  client: Queryable,
  input: EnqueueInitialSyncInput,
  options: { createId: () => string; now?: () => Date },
): Promise<BootstrapSyncJob> {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const result = await client.query(
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

  return mapSyncJob(result.rows[0]);
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

function mapTask(row: Record<string, unknown>): OnboardingTask {
  return {
    id: String(row.id),
    email: String(row.email),
    provider: String(row.provider),
    authMethod: row.auth_method === "oauth" ? "oauth" : "password",
    status: mapTaskStatus(row.status),
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : undefined,
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : undefined,
  };
}

function mapAccount(row: Record<string, unknown>): ConnectedAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    provider: String(row.provider),
    authMethod: "password",
    displayName:
      typeof row.display_name === "string" ? row.display_name : undefined,
    syncState: row.sync_state === "syncing" ? "syncing" : "reauth_required",
    engineProvider: "emailengine",
  };
}

function mapSyncJob(row: Record<string, unknown>): BootstrapSyncJob {
  return {
    id: String(row.id),
    jobType: "sync_account",
    accountId: String(row.account_id),
    idempotencyKey: String(row.idempotency_key),
    status: mapSyncJobStatus(row.status),
    createdAt: toIsoString(row.created_at),
  };
}

function mapSyncJobStatus(value: unknown): BootstrapSyncJob["status"] {
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

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapTaskStatus(value: unknown): OnboardingTask["status"] {
  if (value === "completed" || value === "failed") {
    return value;
  }

  return "pending";
}

function publicTask(task: OnboardingTask): OnboardingTask {
  return {
    id: task.id,
    email: task.email,
    provider: task.provider,
    authMethod: task.authMethod,
    status: task.status,
    errorMessage: task.errorMessage,
  };
}
