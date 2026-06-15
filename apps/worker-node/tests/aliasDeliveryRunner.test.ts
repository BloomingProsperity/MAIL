import { describe, expect, it } from "vitest";

import type {
  AliasDeliveryJob,
  AliasRoutingStore,
} from "../src/alias-routing/alias-router";
import {
  PermanentAliasDeliveryError,
  TemporaryAliasDeliveryError,
  runAliasDeliveryBatch,
  runAliasDeliveryOnce,
} from "../src/alias-routing/alias-delivery-runner";

describe("alias delivery runner", () => {
  it("delivers a claimed alias job, records delivered, and completes the lease", async () => {
    const store = createStore([job()]);
    const transportCalls: unknown[] = [];

    const result = await runAliasDeliveryOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T10:00:00.000Z"),
      leaseSeconds: 30,
      transport: {
        async deliver(input) {
          transportCalls.push(input);
          return { providerMessageId: "smtp-queued-1" };
        },
      },
      createId: sequenceIds(["log_delivered"]),
    });

    expect(result).toEqual({
      status: "processed",
      jobId: "job_1",
      deliveryStatus: "delivered",
    });
    expect(transportCalls).toEqual([
      {
        recipient: "sales@example.com",
        destinationEmail: "owner@example.net",
        sender: "lead@client.test",
        rawMessageRef: "raw://message-1",
        messageFingerprint: "sha256:message-1",
      },
    ]);
    expect(store.completed).toEqual([
      {
        jobId: "job_1",
        workerId: "worker-a",
        now: new Date("2026-06-13T10:00:00.000Z"),
      },
    ]);
    expect(store.logs).toMatchObject([
      {
        id: "log_delivered",
        domainId: "domain_1",
        aliasId: "alias_1",
        recipient: "sales@example.com",
        status: "delivered",
        detail: "delivered to owner@example.net via smtp-queued-1",
      },
    ]);
  });

  it("records deferred and releases the lease for temporary delivery errors", async () => {
    const store = createStore([job()]);

    const result = await runAliasDeliveryOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T10:00:00.000Z"),
      leaseSeconds: 30,
      transport: {
        async deliver() {
          throw new TemporaryAliasDeliveryError("upstream temporarily unavailable");
        },
      },
      createId: sequenceIds(["log_deferred"]),
    });

    expect(result).toEqual({
      status: "failed",
      jobId: "job_1",
      deliveryStatus: "deferred",
      errorMessage: "upstream temporarily unavailable",
    });
    expect(store.failed).toEqual([
      {
        jobId: "job_1",
        workerId: "worker-a",
        errorMessage: "upstream temporarily unavailable",
        now: new Date("2026-06-13T10:00:00.000Z"),
      },
    ]);
    expect(store.logs).toMatchObject([
      {
        id: "log_deferred",
        status: "deferred",
        detail: "upstream temporarily unavailable",
      },
    ]);
  });

  it("records bounced for permanent delivery errors before failing the job", async () => {
    const store = createStore([job()]);

    const result = await runAliasDeliveryOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T10:00:00.000Z"),
      leaseSeconds: 30,
      transport: {
        async deliver() {
          throw new PermanentAliasDeliveryError("destination rejected recipient");
        },
      },
      createId: sequenceIds(["log_bounced"]),
    });

    expect(result).toEqual({
      status: "failed",
      jobId: "job_1",
      deliveryStatus: "bounced",
      errorMessage: "destination rejected recipient",
    });
    expect(store.logs).toMatchObject([
      {
        id: "log_bounced",
        status: "bounced",
        detail: "destination rejected recipient",
      },
    ]);
  });

  it("claims up to concurrency jobs in one batch", async () => {
    const store = createStore([job("job_1", "dest_1"), job("job_2", "dest_2")]);
    const delivered: string[] = [];

    const results = await runAliasDeliveryBatch({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T10:00:00.000Z"),
      leaseSeconds: 30,
      concurrency: 2,
      transport: {
        async deliver(input) {
          delivered.push(input.destinationEmail);
          return {};
        },
      },
      createId: sequenceIds(["log_1", "log_2"]),
    });

    expect(results.map((item) => item.status)).toEqual([
      "processed",
      "processed",
    ]);
    expect(delivered).toEqual(["owner@example.net", "dest_2@example.net"]);
  });

  it("returns idle when no alias delivery job is due", async () => {
    const store = createStore([]);

    await expect(
      runAliasDeliveryBatch({
        store,
        workerId: "worker-a",
        now: new Date("2026-06-13T10:00:00.000Z"),
        leaseSeconds: 30,
        concurrency: 4,
        transport: {
          async deliver() {
            throw new Error("should not be called");
          },
        },
        createId: () => "unused",
      }),
    ).resolves.toEqual([{ status: "idle" }]);
  });
});

function createStore(jobs: AliasDeliveryJob[]) {
  const queue = [...jobs];
  return {
    logs: [] as unknown[],
    completed: [] as unknown[],
    failed: [] as unknown[],
    async claimNextDeliveryJob() {
      return queue.shift();
    },
    async completeDeliveryJob(input: unknown) {
      this.completed.push(input);
      return job();
    },
    async failDeliveryJob(input: unknown) {
      this.failed.push(input);
      return job();
    },
    async recordDeliveryLog(input: unknown) {
      this.logs.push(input);
      return input as never;
    },
  } satisfies Pick<
    AliasRoutingStore,
    | "claimNextDeliveryJob"
    | "completeDeliveryJob"
    | "failDeliveryJob"
    | "recordDeliveryLog"
  > & {
    logs: unknown[];
    completed: unknown[];
    failed: unknown[];
  };
}

function job(id = "job_1", destinationId = "dest_1"): AliasDeliveryJob {
  return {
    id,
    domainId: "domain_1",
    aliasId: "alias_1",
    recipient: "sales@example.com",
    destinationId,
    destinationEmail:
      destinationId === "dest_1" ? "owner@example.net" : `${destinationId}@example.net`,
    sender: "lead@client.test",
    messageFingerprint: "sha256:message-1",
    rawMessageRef: "raw://message-1",
    idempotencyKey: `alias-delivery:sha256:message-1:${destinationId}`,
    status: "running",
    attempts: 1,
    maxAttempts: 8,
    notBefore: "2026-06-13T10:00:00.000Z",
    leaseOwner: "worker-a",
    leaseExpiresAt: "2026-06-13T10:00:30.000Z",
    payload: { routeType: "alias" },
    createdAt: "2026-06-13T09:59:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z",
  };
}

function sequenceIds(ids: string[]): () => string {
  return () => ids.shift() ?? "extra_id";
}
