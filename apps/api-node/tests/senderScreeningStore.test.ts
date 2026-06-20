import { describe, expect, it } from "vitest";

import { createPostgresSenderScreeningStore } from "../src/gatekeeper/postgres-sender-screening-store";

describe("postgres sender screening store", () => {
  it("lists unknown P7 Screen senders with stable local sender ids", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT screening.id")) {
          return {
            rows: [
              {
                id: "screen_1",
                sender_email: "new@example.com",
                domain: "example.com",
                status: "unknown",
                message_count: "2",
                latest_message_id: "message_2",
                latest_received_at: "2026-06-13T10:00:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSenderScreeningStore(client, {
      createId: () => "screen_1",
    });

    const result = await store.listSenders({
      accountId: "account_1",
      status: "unknown",
    });

    expect(queries.map((query) => query.text)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
    expect(
      queries.some(
        (query) =>
          query.text.includes("INSERT INTO sender_screening_rules") &&
          query.text.includes("message_classification.bucket = 'P7 Screen'") &&
          query.text.includes("ON CONFLICT"),
      ),
    ).toBe(true);
    expect(result).toEqual({
      items: [
        {
          senderId: "screen_1",
          email: "new@example.com",
          domain: "example.com",
          status: "unknown",
          messageCount: 2,
          latestMessageId: "message_2",
          latestReceivedAt: "2026-06-13T10:00:00.000Z",
          bulkAvailable: true,
        },
      ],
    });
  });

  it("accepts a sender, records an event, releases screened messages, and writes Hermes memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["event_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (
          text.includes("FROM sender_screening_rules") &&
          text.includes("WHERE id = $1")
        ) {
          return {
            rows: [
              {
                id: "screen_1",
                account_id: "account_1",
                sender_email: "new@example.com",
                domain: "example.com",
                scope: "email",
                status: "unknown",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSenderScreeningStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.acceptSender({
      accountId: "account_1",
      senderId: "screen_1",
    });

    const loadQuery = queries.find(
      (query) =>
        query.text.includes("FROM sender_screening_rules") &&
        query.text.includes("WHERE id = $1"),
    );
    expect(loadQuery?.values).toEqual(["screen_1", "account_1"]);

    const updateRule = queries.find(
      (query) =>
        query.text.includes("UPDATE sender_screening_rules") &&
        query.text.includes("status = $2"),
    );
    expect(updateRule?.values).toEqual(["screen_1", "accepted"]);

    const eventQuery = queries.find((query) =>
      query.text.includes("INSERT INTO sender_screening_events"),
    );
    expect(eventQuery?.values).toEqual([
      "event_1",
      "screen_1",
      "account_1",
      "accept",
      {
        senderEmail: "new@example.com",
        domain: "example.com",
        scope: "email",
      },
    ]);

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "account_1",
      "new@example.com",
      "P2 Important",
      70,
      ["Sender accepted"],
      "gatekeeper",
    ]);

    const hermesMemoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(hermesMemoryQuery?.values).toEqual([
      "memory_1",
      "account_1",
      "contact_memory",
      "sender:new@example.com",
      {
        source: "sender_screening",
        eventId: "event_1",
        action: "accept",
        senderEmail: "new@example.com",
        domain: "example.com",
        preference: "Allow future mail from this sender into the inbox.",
      },
      0.95,
    ]);
    expect(result).toEqual({
      senderId: "screen_1",
      email: "new@example.com",
      domain: "example.com",
      status: "accepted",
      action: "accept",
      eventId: "event_1",
    });
  });

  it("blocks a domain without needing a provider mutation", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["domain_rule_1", "event_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO sender_screening_rules") && text.includes("RETURNING")) {
          return {
            rows: [
              {
                id: "domain_rule_1",
                account_id: "account_1",
                sender_email: null,
                domain: "example.com",
                scope: "domain",
                status: "blocked",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSenderScreeningStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.blockDomain({
      accountId: "account_1",
      domain: "Example.COM",
    });

    const upsertRule = queries.find(
      (query) =>
        query.text.includes("INSERT INTO sender_screening_rules") &&
        query.text.includes("ON CONFLICT") &&
        query.text.includes("RETURNING"),
    );
    expect(upsertRule?.values).toEqual([
      "domain_rule_1",
      "account_1",
      "domain",
      null,
      "example.com",
      "blocked",
    ]);
    const hermesMemoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(hermesMemoryQuery?.values).toEqual([
      "memory_1",
      "account_1",
      "contact_memory",
      "domain:example.com",
      {
        source: "sender_screening",
        eventId: "event_1",
        action: "block_domain",
        domain: "example.com",
        preference: "Keep future mail from this domain in Gatekeeper Screen.",
      },
      0.95,
    ]);
    expect(result).toEqual({
      senderId: "domain_rule_1",
      domain: "example.com",
      status: "blocked",
      action: "block_domain",
      eventId: "event_1",
    });
  });

  it("bulk accepts existing senders and reports missing local sender ids", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["event_1", "memory_1", "event_2", "memory_2"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM sender_screening_rules") && text.includes("ANY")) {
          return {
            rows: [
              {
                id: "screen_1",
                account_id: "account_1",
                sender_email: "new@example.com",
                domain: "example.com",
                scope: "email",
                status: "unknown",
              },
              {
                id: "screen_2",
                account_id: "account_1",
                sender_email: "other@example.com",
                domain: "example.com",
                scope: "email",
                status: "unknown",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSenderScreeningStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.bulkDecideSenders({
      accountId: "account_1",
      senderIds: ["screen_1", "screen_2", "missing_sender"],
      action: "accept",
    });

    expect(queries.map((query) => query.text)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
    const loadQuery = queries.find(
      (query) =>
        query.text.includes("FROM sender_screening_rules") &&
        query.text.includes("ANY"),
    );
    expect(loadQuery?.values).toEqual([
      "account_1",
      ["screen_1", "screen_2", "missing_sender"],
    ]);
    expect(
      queries.filter((query) =>
        query.text.includes("INSERT INTO sender_screening_events"),
      ),
    ).toHaveLength(2);
    expect(
      queries.filter((query) =>
        query.text.includes("INSERT INTO message_classification"),
      ),
    ).toHaveLength(2);
    expect(result).toEqual({
      items: [
        {
          senderId: "screen_1",
          email: "new@example.com",
          domain: "example.com",
          status: "accepted",
          action: "accept",
          eventId: "event_1",
        },
        {
          senderId: "screen_2",
          email: "other@example.com",
          domain: "example.com",
          status: "accepted",
          action: "accept",
          eventId: "event_2",
        },
      ],
      missingSenderIds: ["missing_sender"],
    });
  });

  it("returns undefined when a sender decision targets a missing local sender id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresSenderScreeningStore(client, {
      createId: () => "event_1",
    });

    const result = await store.blockSender({
      accountId: "account_1",
      senderId: "missing_sender",
    });

    expect(result).toBeUndefined();
    const loadQuery = queries.find(
      (query) =>
        query.text.includes("FROM sender_screening_rules") &&
        query.text.includes("WHERE id = $1"),
    );
    expect(loadQuery?.values).toEqual(["missing_sender", "account_1"]);
    expect(
      queries.some((query) =>
        query.text.includes("INSERT INTO sender_screening_events"),
      ),
    ).toBe(false);
  });
});
