import { describe, expect, it } from "vitest";

import { createPostgresAliasRoutingStore } from "../src/alias-routing/postgres-alias-routing-store";

describe("postgres alias routing store", () => {
  it("loads exact alias routes before catch-all routing", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAliasRoutingStore(queryable(queries, [
      [
        {
          route_type: "alias",
          domain_id: "domain_1",
          domain: "example.com",
          alias_id: "alias_1",
          local_part: "sales",
          destination_ids: ["dest_1"],
          destination_emails: ["owner@example.net"],
        },
      ],
    ]));

    const route = await store.findRoute({
      domain: "example.com",
      localPart: "sales",
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/FROM aliases/i);
    expect(queries[0].text).toMatch(/JOIN domains/i);
    expect(queries[0].text).toMatch(/JOIN alias_routes/i);
    expect(queries[0].text).toMatch(/JOIN destinations/i);
    expect(queries[0].text).toMatch(/aliases\.enabled = TRUE/i);
    expect(queries[0].values).toEqual(["example.com", "sales"]);
    expect(route).toEqual({
      routeType: "alias",
      domainId: "domain_1",
      domain: "example.com",
      aliasId: "alias_1",
      localPart: "sales",
      destinationIds: ["dest_1"],
      destinationEmails: ["owner@example.net"],
    });
  });

  it("falls back to catch-all routes when exact aliases are absent", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAliasRoutingStore(queryable(queries, [
      [],
      [
        {
          route_type: "catch_all",
          domain_id: "domain_1",
          domain: "example.com",
          alias_id: null,
          local_part: "*",
          catch_all_mode: "forward",
          destination_ids: ["dest_1"],
          destination_emails: ["owner@example.net"],
        },
      ],
    ]));

    const route = await store.findRoute({
      domain: "example.com",
      localPart: "random",
    });

    expect(queries).toHaveLength(2);
    expect(queries[1].text).toMatch(/FROM routing_rules/i);
    expect(queries[1].text).toMatch(/rule_type = 'catch_all'/i);
    expect(queries[1].text).toMatch(/enabled = TRUE/i);
    expect(route).toMatchObject({
      routeType: "catch_all",
      catchAllMode: "forward",
      destinationEmails: ["owner@example.net"],
    });
  });

  it("enqueues alias delivery jobs idempotently", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAliasRoutingStore(queryable(queries, [
      [
        {
          id: "job_1",
          domain_id: "domain_1",
          alias_id: "alias_1",
          recipient: "sales@example.com",
          destination_id: "dest_1",
          destination_email: "owner@example.net",
          sender: "lead@client.test",
          message_fingerprint: "sha256:message-1",
          raw_message_ref: "raw://message-1",
          idempotency_key: "alias-delivery:sha256:message-1:dest_1",
          status: "queued",
          attempts: 0,
          max_attempts: 8,
          not_before: "2026-06-13T09:00:00.000Z",
          lease_owner: null,
          lease_expires_at: null,
          payload: { routeType: "alias" },
          error_message: null,
          created_at: "2026-06-13T09:00:00.000Z",
          updated_at: "2026-06-13T09:00:00.000Z",
          completed_at: null,
        },
      ],
    ]));

    const job = await store.enqueueDeliveryJob({
      id: "job_1",
      domainId: "domain_1",
      aliasId: "alias_1",
      recipient: "sales@example.com",
      destinationId: "dest_1",
      destinationEmail: "owner@example.net",
      sender: "lead@client.test",
      messageFingerprint: "sha256:message-1",
      rawMessageRef: "raw://message-1",
      idempotencyKey: "alias-delivery:sha256:message-1:dest_1",
      notBefore: "2026-06-13T09:00:00.000Z",
      payload: { routeType: "alias" },
    });

    expect(queries[0].text).toMatch(/INSERT INTO alias_delivery_jobs/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(idempotency_key\)/i);
    expect(queries[0].values).toEqual([
      "job_1",
      "domain_1",
      "alias_1",
      "sales@example.com",
      "dest_1",
      "owner@example.net",
      "lead@client.test",
      "sha256:message-1",
      "raw://message-1",
      "alias-delivery:sha256:message-1:dest_1",
      8,
      "2026-06-13T09:00:00.000Z",
      { routeType: "alias" },
    ]);
    expect(job).toMatchObject({
      id: "job_1",
      status: "queued",
      destinationEmail: "owner@example.net",
    });
  });

  it("records delivery logs without exposing raw provider payloads", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAliasRoutingStore(queryable(queries, [
      [
        {
          id: "log_1",
          domain_id: "domain_1",
          alias_id: "alias_1",
          recipient: "sales@example.com",
          status: "queued",
          detail: "queued alias delivery to owner@example.net",
          created_at: "2026-06-13T09:00:00.000Z",
        },
      ],
    ]));

    await store.recordDeliveryLog({
      id: "log_1",
      domainId: "domain_1",
      aliasId: "alias_1",
      recipient: "sales@example.com",
      status: "queued",
      detail: "queued alias delivery to owner@example.net",
      createdAt: "2026-06-13T09:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO delivery_logs/i);
    expect(queries[0].values).toEqual([
      "log_1",
      "domain_1",
      "alias_1",
      "sales@example.com",
      "queued",
      "queued alias delivery to owner@example.net",
      "2026-06-13T09:00:00.000Z",
    ]);
  });

  it("claims due delivery jobs with leases and SKIP LOCKED", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresAliasRoutingStore(queryable(queries, [
      [
        {
          id: "job_1",
          domain_id: "domain_1",
          alias_id: "alias_1",
          recipient: "sales@example.com",
          destination_id: "dest_1",
          destination_email: "owner@example.net",
          sender: null,
          message_fingerprint: "sha256:message-1",
          raw_message_ref: null,
          idempotency_key: "alias-delivery:sha256:message-1:dest_1",
          status: "running",
          attempts: 1,
          max_attempts: 8,
          not_before: "2026-06-13T09:00:00.000Z",
          lease_owner: "worker-a",
          lease_expires_at: "2026-06-13T09:00:30.000Z",
          payload: { routeType: "alias" },
          error_message: null,
          created_at: "2026-06-13T09:00:00.000Z",
          updated_at: "2026-06-13T09:00:00.000Z",
          completed_at: null,
        },
      ],
    ]));

    const job = await store.claimNextDeliveryJob({
      workerId: "worker-a",
      now: new Date("2026-06-13T09:00:00.000Z"),
      leaseSeconds: 30,
    });

    expect(queries[0].text).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(queries[0].text).toMatch(/lease_owner/i);
    expect(queries[0].text).toMatch(/lease_expires_at/i);
    expect(job).toMatchObject({
      id: "job_1",
      status: "running",
      leaseOwner: "worker-a",
    });
  });

  it("completes owned leases and dead-letters exhausted delivery jobs", async () => {
    const completeQueries: Array<{ text: string; values?: unknown[] }> = [];
    const completeStore = createPostgresAliasRoutingStore(
      queryable(completeQueries, [
        [
          {
            ...jobRow(),
            status: "done",
            lease_owner: null,
            completed_at: "2026-06-13T09:01:00.000Z",
          },
        ],
      ]),
    );

    const completed = await completeStore.completeDeliveryJob({
      jobId: "job_1",
      workerId: "worker-a",
      now: new Date("2026-06-13T09:01:00.000Z"),
    });

    expect(completeQueries[0].text).toMatch(/status = 'done'/i);
    expect(completeQueries[0].text).toMatch(/lease_owner = \$2/i);
    expect(completed.status).toBe("done");
    expect(completed.completedAt).toBe("2026-06-13T09:01:00.000Z");

    const failQueries: Array<{ text: string; values?: unknown[] }> = [];
    const failStore = createPostgresAliasRoutingStore(
      queryable(failQueries, [
        [
          {
            ...jobRow(),
            status: "dead_letter",
            attempts: 8,
            max_attempts: 8,
            lease_owner: null,
            error_message: "smtp rejected recipient",
          },
        ],
      ]),
    );

    const failed = await failStore.failDeliveryJob({
      jobId: "job_1",
      workerId: "worker-a",
      errorMessage: "smtp rejected recipient",
      now: new Date("2026-06-13T09:01:00.000Z"),
    });

    expect(failQueries[0].text).toMatch(/CASE WHEN attempts >= max_attempts/i);
    expect(failQueries[0].text).toMatch(/POWER/i);
    expect(failQueries[0].text).toMatch(/dead_letter/i);
    expect(failed.status).toBe("dead_letter");
    expect(failed.errorMessage).toBe("smtp rejected recipient");
  });
});

function queryable(
  queries: Array<{ text: string; values?: unknown[] }>,
  rows: Array<Array<Record<string, unknown>>>,
) {
  return {
    async query(text: string, values?: unknown[]) {
      queries.push({ text: normalizeSql(text), values });
      return { rows: rows.shift() ?? [] };
    },
  };
}

function normalizeSql(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function jobRow(): Record<string, unknown> {
  return {
    id: "job_1",
    domain_id: "domain_1",
    alias_id: "alias_1",
    recipient: "sales@example.com",
    destination_id: "dest_1",
    destination_email: "owner@example.net",
    sender: null,
    message_fingerprint: "sha256:message-1",
    raw_message_ref: null,
    idempotency_key: "alias-delivery:sha256:message-1:dest_1",
    status: "running",
    attempts: 1,
    max_attempts: 8,
    not_before: "2026-06-13T09:00:00.000Z",
    lease_owner: "worker-a",
    lease_expires_at: "2026-06-13T09:00:30.000Z",
    payload: { routeType: "alias" },
    error_message: null,
    created_at: "2026-06-13T09:00:00.000Z",
    updated_at: "2026-06-13T09:01:00.000Z",
    completed_at: null,
  };
}
