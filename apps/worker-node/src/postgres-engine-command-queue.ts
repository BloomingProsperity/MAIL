import type {
  ClaimNextEngineCommandInput,
  CompleteEngineCommandInput,
  EngineCommandQueue,
  EngineCommandRecord,
  EngineCommandStatus,
  EngineCommandType,
  FailEngineCommandInput,
} from "./engine-command-queue.js";
import type { Queryable } from "./postgres-sync-job-queue.js";

interface EngineCommandRow extends Record<string, unknown> {
  id: string;
  command_type: EngineCommandType;
  account_id: string;
  target: unknown;
  payload: unknown;
  status: EngineCommandStatus;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  not_before: string | Date;
  lease_owner?: string | null;
  lease_expires_at?: string | Date | null;
  error_message?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at?: string | Date | null;
}

export function createPostgresEngineCommandQueue(
  client: Queryable,
): EngineCommandQueue {
  return {
    async claimNext(input) {
      const leaseExpiresAt = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      const result = await client.query<EngineCommandRow>(
        `
          WITH candidate AS (
            SELECT id
            FROM engine_commands
            WHERE
              (
                (
                  status = 'queued'
                  AND not_before <= $1::timestamptz
                )
                OR (
                  status = 'running'
                  AND lease_expires_at <= $1::timestamptz
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM engine_commands active_same_account
                WHERE active_same_account.account_id = engine_commands.account_id
                  AND active_same_account.id <> engine_commands.id
                  AND active_same_account.status = 'running'
                  AND active_same_account.lease_expires_at > $1::timestamptz
              )
            ORDER BY not_before ASC, created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE engine_commands
          SET
            status = 'running',
            attempts = attempts + 1,
            lease_owner = $2,
            lease_expires_at = $3::timestamptz,
            error_message = NULL,
            updated_at = $1::timestamptz
          FROM candidate
          WHERE engine_commands.id = candidate.id
          RETURNING
            engine_commands.id,
            engine_commands.command_type,
            engine_commands.account_id,
            engine_commands.target,
            engine_commands.payload,
            engine_commands.status,
            engine_commands.attempts,
            engine_commands.max_attempts,
            engine_commands.idempotency_key,
            engine_commands.not_before,
            engine_commands.lease_owner,
            engine_commands.lease_expires_at,
            engine_commands.error_message,
            engine_commands.created_at,
            engine_commands.updated_at,
            engine_commands.completed_at
        `,
        [input.now.toISOString(), input.workerId, leaseExpiresAt.toISOString()],
      );

      return result.rows[0] ? rowToCommand(result.rows[0]) : undefined;
    },

    async completeCommand(input) {
      const result = await client.query<EngineCommandRow>(
        `
          UPDATE engine_commands
          SET
            status = 'done',
            lease_owner = NULL,
            lease_expires_at = NULL,
            error_message = NULL,
            completed_at = $3::timestamptz,
            updated_at = $3::timestamptz
          WHERE id = $1
            AND status = 'running'
            AND lease_owner = $2
          RETURNING *
        `,
        [input.commandId, input.workerId, input.now.toISOString()],
      );

      return mustReturnOwnedCommand(result, input);
    },

    async failCommand(input) {
      const result = await client.query<EngineCommandRow>(
        `
          UPDATE engine_commands
          SET
            status = CASE WHEN $5 = FALSE OR attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            not_before = CASE
              WHEN $5 = FALSE OR attempts >= max_attempts THEN not_before
              ELSE (
                $4::timestamptz +
                (
                  LEAST(
                    30 * POWER(2, GREATEST(attempts - 1, 0)),
                    900
                  ) * INTERVAL '1 second'
                )
              )
            END,
            error_message = $3,
            updated_at = $4::timestamptz
          WHERE id = $1
            AND status = 'running'
            AND lease_owner = $2
          RETURNING *
        `,
        [
          input.commandId,
          input.workerId,
          input.errorMessage,
          input.now.toISOString(),
          input.retryable ?? true,
        ],
      );

      return mustReturnOwnedCommand(result, input);
    },
  };
}

function mustReturnOwnedCommand(
  result: { rows: EngineCommandRow[] },
  input: CompleteEngineCommandInput | FailEngineCommandInput,
): EngineCommandRecord {
  if (!result.rows[0]) {
    throw new Error(`engine command lease is not owned by ${input.workerId}`);
  }

  return rowToCommand(result.rows[0]);
}

function rowToCommand(row: EngineCommandRow): EngineCommandRecord {
  return {
    id: row.id,
    commandType: row.command_type,
    accountId: row.account_id,
    target: recordValue(row.target),
    payload: recordValue(row.payload),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    idempotencyKey: row.idempotency_key,
    notBefore: toIsoString(row.not_before),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: toIsoString(row.lease_expires_at) }
      : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.completed_at ? { completedAt: toIsoString(row.completed_at) } : {}),
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
