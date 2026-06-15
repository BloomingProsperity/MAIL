import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { createPostgresSyncJobQueue } from "../src/postgres-sync-job-queue";
import type { SyncJobRecord } from "../src/sync-job-queue";
import {
  createPostgresTestPool,
  readTestDatabaseUrl,
  resetPostgresTestDatabase,
} from "./postgres-test-db";

const describeIfPostgres = readTestDatabaseUrl() ? describe : describe.skip;

describeIfPostgres("postgres sync job queue stress", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await createPostgresTestPool();
  }, 60_000);

  beforeEach(async () => {
    await dropClaimSleepTrigger(pool);
    await resetPostgresTestDatabase(pool);
  });

  afterAll(async () => {
    if (pool) {
      await dropClaimSleepTrigger(pool);
      await pool.end();
    }
  });

  it("allows only one same-account job to be claimed during an overlapping concurrent wave", async () => {
    const queue = createPostgresSyncJobQueue(pool);
    const now = new Date("2026-06-14T06:00:00.000Z");
    const accountId = "acc_same";

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        queue.enqueueJob({
          id: randomUUID(),
          jobType: "sync_account",
          accountId,
          mailboxId: "INBOX",
          idempotencyKey: `stress:${accountId}:${index}`,
          notBefore: now.toISOString(),
          payload: { index },
        }),
      ),
    );

    await installClaimSleepTrigger(pool);

    let claims: Array<SyncJobRecord | undefined> = [];
    try {
      claims = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          queue.claimNext({
            workerId: `worker_${index}`,
            now,
            leaseSeconds: 30,
          }),
        ),
      );
    } finally {
      await dropClaimSleepTrigger(pool);
    }

    const claimed = claims.filter(
      (job): job is SyncJobRecord => job !== undefined,
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      accountId,
      status: "running",
      attempts: 1,
    });

    await queue.completeJob({
      jobId: claimed[0].id,
      workerId: claimed[0].leaseOwner ?? "",
      now,
    });

    const next = await queue.claimNext({
      workerId: "worker_after_first_complete",
      now,
      leaseSeconds: 30,
    });
    expect(next).toMatchObject({
      accountId,
      status: "running",
      attempts: 1,
    });
  });

  it("reclaims an expired lease without allowing the stale owner to complete it", async () => {
    const queue = createPostgresSyncJobQueue(pool);
    const jobId = randomUUID();
    const now = new Date("2026-06-14T07:00:00.000Z");

    await queue.enqueueJob({
      id: jobId,
      jobType: "sync_account",
      accountId: "acc_reclaim",
      idempotencyKey: "stress:acc_reclaim:expired-lease",
      notBefore: now.toISOString(),
      payload: {},
    });

    const first = await queue.claimNext({
      workerId: "worker_a",
      now,
      leaseSeconds: 1,
    });
    expect(first).toMatchObject({
      id: jobId,
      leaseOwner: "worker_a",
      attempts: 1,
    });

    const beforeExpiry = await queue.claimNext({
      workerId: "worker_b",
      now: new Date(now.getTime() + 500),
      leaseSeconds: 1,
    });
    expect(beforeExpiry).toBeUndefined();

    const afterExpiry = await queue.claimNext({
      workerId: "worker_b",
      now: new Date(now.getTime() + 2_000),
      leaseSeconds: 1,
    });
    expect(afterExpiry).toMatchObject({
      id: jobId,
      leaseOwner: "worker_b",
      attempts: 2,
    });

    await expect(
      queue.completeJob({
        jobId,
        workerId: "worker_a",
        now,
      }),
    ).rejects.toThrow("job lease is not owned by worker_a");

    const completed = await queue.completeJob({
      jobId,
      workerId: "worker_b",
      now,
    });
    expect(completed).toMatchObject({
      id: jobId,
      status: "done",
    });
  });
});

async function installClaimSleepTrigger(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION sync_jobs_claim_sleep_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'running' THEN
        PERFORM pg_sleep(0.15);
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS sync_jobs_claim_sleep_for_test ON sync_jobs;

    CREATE TRIGGER sync_jobs_claim_sleep_for_test
      BEFORE UPDATE ON sync_jobs
      FOR EACH ROW
      EXECUTE FUNCTION sync_jobs_claim_sleep_for_test();
  `);
}

async function dropClaimSleepTrigger(pool: Pool): Promise<void> {
  await pool.query(`
    DROP TRIGGER IF EXISTS sync_jobs_claim_sleep_for_test ON sync_jobs;
    DROP FUNCTION IF EXISTS sync_jobs_claim_sleep_for_test();
  `);
}
