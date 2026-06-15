import { describe, expect, it } from "vitest";

import { createPostgresDomainAliasStore } from "../src/domains/postgres-domain-alias-store";

describe("Postgres domain alias store", () => {
  it("upserts domains and returns app-owned DNS guidance fields", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresDomainAliasStore(queryable(queries, [
      [
        {
          id: "domain_1",
          domain: "example.com",
          verification_status: "pending",
          created_at: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]));

    const result = await store.createDomain({
      id: "domain_1",
      domain: "example.com",
    });

    expect(queries[0].text).toMatch(/INSERT INTO domains/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(domain\) DO UPDATE/i);
    expect(queries[0].values).toEqual(["domain_1", "example.com"]);
    expect(result).toMatchObject({
      id: "domain_1",
      domain: "example.com",
      verificationStatus: "pending",
    });
  });

  it("creates aliases and routes in one transaction", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresDomainAliasStore(poolLike(queries, [
      [],
      [{ id: "domain_1", domain: "example.com", verification_status: "pending", created_at: "2026-06-13T08:00:00.000Z" }],
      [{ id: "dest_1", email: "owner@example.net", verified: false, created_at: "2026-06-13T08:00:00.000Z" }],
      [{ id: "alias_1", domain_id: "domain_1", local_part: "sales", enabled: true, created_at: "2026-06-13T08:00:00.000Z" }],
      [],
      [],
      [{ destination_ids: ["dest_1"] }],
      [],
    ]));

    const result = await store.createAlias({
      id: "alias_1",
      domainId: "domain_1",
      localPart: "sales",
      destinationIds: ["dest_1"],
    });

    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN",
      expect.stringMatching(/SELECT[\s\S]*FROM domains/i),
      expect.stringMatching(/SELECT[\s\S]*FROM destinations/i),
      expect.stringMatching(/INSERT INTO aliases/i),
      expect.stringMatching(/DELETE FROM alias_routes/i),
      expect.stringMatching(/INSERT INTO alias_routes/i),
      expect.stringMatching(/ARRAY_AGG/i),
      "COMMIT",
    ]);
    expect(result).toMatchObject({
      id: "alias_1",
      address: "sales@example.com",
      destinationIds: ["dest_1"],
    });
  });

  it("lists destinations through domain destination mappings", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresDomainAliasStore(queryable(queries, [
      [
        {
          id: "dest_1",
          email: "owner@example.net",
          verified: false,
          created_at: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]));

    const result = await store.listDestinations({ domainId: "domain_1" });

    expect(queries[0].text).toMatch(/SELECT DISTINCT/i);
    expect(queries[0].text).toMatch(/FROM destinations/i);
    expect(queries[0].text).toMatch(/JOIN domain_destinations/i);
    expect(queries[0].values).toEqual(["domain_1"]);
    expect(result).toEqual([
      {
        id: "dest_1",
        domainId: "domain_1",
        email: "owner@example.net",
        verified: false,
        createdAt: "2026-06-13T08:00:00.000Z",
      },
    ]);
  });

  it("writes catch-all routing rules idempotently", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresDomainAliasStore(queryable(queries, [
      [
        {
          id: "rule_1",
          domain_id: "domain_1",
          rule_type: "catch_all",
          config: { mode: "forward", destinationIds: ["dest_1"] },
          enabled: true,
          created_at: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]));

    await store.setCatchAll({
      id: "rule_1",
      domainId: "domain_1",
      config: { mode: "forward", destinationIds: ["dest_1"] },
    });

    expect(queries[0].text).toMatch(/INSERT INTO routing_rules/i);
    expect(queries[0].text).toMatch(/ON CONFLICT/i);
    expect(queries[0].values).toEqual([
      "rule_1",
      "domain_1",
      "catch_all",
      { mode: "forward", destinationIds: ["dest_1"] },
    ]);
  });

  it("reads current catch-all routing rules without writing defaults", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresDomainAliasStore(queryable(queries, [
      [
        {
          id: "rule_1",
          domain_id: "domain_1",
          rule_type: "catch_all",
          config: { mode: "discard" },
          enabled: true,
          created_at: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]));

    const rule = await store.getCatchAll({ domainId: "domain_1" });

    expect(queries[0].text).toMatch(/SELECT id, domain_id, rule_type, config/i);
    expect(queries[0].text).toMatch(/FROM routing_rules/i);
    expect(queries[0].text).toMatch(/rule_type = 'catch_all'/i);
    expect(queries[0].values).toEqual(["domain_1"]);
    expect(rule).toMatchObject({
      id: "rule_1",
      domainId: "domain_1",
      config: { mode: "discard" },
    });
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

function poolLike(
  queries: Array<{ text: string; values?: unknown[] }>,
  rows: Array<Array<Record<string, unknown>>>,
) {
  return {
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          queries.push({ text: normalizeSql(text), values });
          return { rows: rows.shift() ?? [] };
        },
        release() {},
      };
    },
    async query(text: string, values?: unknown[]) {
      queries.push({ text: normalizeSql(text), values });
      return { rows: rows.shift() ?? [] };
    },
  };
}

function normalizeSql(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
