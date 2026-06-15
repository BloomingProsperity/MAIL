import { type PoolLike, withTransaction } from "../db/transaction.js";
import type { HermesRunStore, HermesRunStoreInput } from "./translation.js";

export function createPostgresHermesRunStore(client: PoolLike): HermesRunStore {
  return {
    async recordCompletedSkillRun(input: HermesRunStoreInput) {
      await withTransaction(client, async (tx) => {
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
              skill_id,
              input,
              output
            )
            VALUES ($1, $2, $3, $4)
          `,
          [
            input.run.id,
            input.run.skillId,
            input.run.input,
            input.run.output,
          ],
        );

        await tx.query(
          `
            INSERT INTO hermes_audit_events (
              id,
              event_type,
              skill_run_id,
              read_message_ids,
              memory_ids,
              action
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            input.auditEvent.id,
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
