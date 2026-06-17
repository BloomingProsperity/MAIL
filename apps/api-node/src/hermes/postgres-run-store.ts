import { type PoolLike, type Queryable, withTransaction } from "../db/transaction.js";
import type { HermesRunStore, HermesRunStoreInput } from "./translation.js";

interface CountRow extends Record<string, unknown> {
  count: number | string;
}

export function createPostgresHermesRunStore(client: PoolLike): HermesRunStore {
  return {
    async recordCompletedSkillRun(input: HermesRunStoreInput) {
      await withTransaction(client, async (tx) => {
        if (input.accountId) {
          await assertReadMessagesBelongToAccount(
            tx,
            input.accountId,
            input.auditEvent.readMessageIds,
          );
          await assertMemoriesBelongToAccount(
            tx,
            input.accountId,
            input.auditEvent.memoryIds,
          );
        }

        await tx.query(
          `
            INSERT INTO hermes_skills (
              id,
              title,
              enabled
            )
            VALUES ($1, $2, TRUE)
            ON CONFLICT (id)
            DO UPDATE SET title = EXCLUDED.title
          `,
          [input.run.skillId, input.run.skillTitle],
        );

        await tx.query(
          `
            INSERT INTO hermes_skill_runs (
              id,
              account_id,
              skill_id,
              input,
              output
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            input.run.id,
            input.accountId ?? null,
            input.run.skillId,
            input.run.input,
            input.run.output,
          ],
        );

        await tx.query(
          `
            INSERT INTO hermes_audit_events (
              id,
              account_id,
              event_type,
              skill_run_id,
              read_message_ids,
              memory_ids,
              action
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            input.auditEvent.id,
            input.accountId ?? null,
            input.auditEvent.eventType,
            input.auditEvent.skillRunId,
            input.auditEvent.readMessageIds,
            input.auditEvent.memoryIds,
            input.auditEvent.action,
          ],
        );
      });
    },
  };
}

async function assertReadMessagesBelongToAccount(
  client: Queryable,
  accountId: string,
  messageIds: string[],
): Promise<void> {
  const uniqueIds = uniqueNonEmptyStrings(messageIds);
  if (uniqueIds.length === 0) {
    return;
  }

  const result = await client.query<CountRow>(
    `
      SELECT COUNT(DISTINCT id)::int AS count
      FROM messages
      WHERE account_id = $1::uuid
        AND id = ANY($2::uuid[])
    `,
    [accountId, uniqueIds],
  );
  if (toCount(result.rows[0]?.count) !== uniqueIds.length) {
    throw new Error("Hermes run read message scope mismatch");
  }
}

async function assertMemoriesBelongToAccount(
  client: Queryable,
  accountId: string,
  memoryIds: string[],
): Promise<void> {
  const uniqueIds = uniqueNonEmptyStrings(memoryIds);
  if (uniqueIds.length === 0) {
    return;
  }

  const result = await client.query<CountRow>(
    `
      SELECT COUNT(DISTINCT id)::int AS count
      FROM hermes_memories
      WHERE account_id = $1::uuid
        AND id = ANY($2::uuid[])
    `,
    [accountId, uniqueIds],
  );
  if (toCount(result.rows[0]?.count) !== uniqueIds.length) {
    throw new Error("Hermes run memory scope mismatch");
  }
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function toCount(value: number | string | undefined): number {
  return typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);
}
