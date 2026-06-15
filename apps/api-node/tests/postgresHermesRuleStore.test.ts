import { describe, expect, it } from "vitest";

import { createPostgresHermesRuleStore } from "../src/hermes/postgres-rule-store";

describe("postgres Hermes rule store", () => {
  it("loads repeated Smart Inbox feedback by account for rule suggestions", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              account_id: "account_1",
              message_id: "message_1",
              sender_email: "client@example.com",
              action: "always_important_sender",
              occurred_at: "2026-06-13T09:00:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.listObservedBehaviors({
      accountId: "account_1",
      since: "2026-05-14T00:00:00.000Z",
      limit: 500,
    });

    expect(queries[0].text).toMatch(/FROM feedback_events/i);
    expect(queries[0].text).toMatch(/JOIN messages/i);
    expect(queries[0].text).toMatch(/messages\.account_id = \$1/i);
    expect(queries[0].text).toMatch(/feedback_events\.event_type LIKE 'smart_inbox\.%'/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "2026-05-14T00:00:00.000Z",
      500,
    ]);
    expect(result).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        senderEmail: "client@example.com",
        action: "always_important_sender",
        occurredAt: "2026-06-13T09:00:00.000Z",
      },
    ]);
  });

  it("creates rule candidates with evidence and account scope", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "candidate_1",
              account_id: "account_1",
              title: "Prioritize client@example.com",
              rule_type: "sender_priority",
              condition: { senderEmail: "client@example.com" },
              action: { type: "classify_sender", bucket: "P2 Important" },
              confidence: "0.850",
              status: "shadow",
              evidence_message_ids: ["message_1", "message_2"],
              created_at: "2026-06-13T10:00:00.000Z",
              approved_at: null,
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.createRuleCandidate({
      id: "candidate_1",
      accountId: "account_1",
      title: "Prioritize client@example.com",
      ruleType: "sender_priority",
      condition: { senderEmail: "client@example.com" },
      action: { type: "classify_sender", bucket: "P2 Important" },
      confidence: 0.85,
      status: "shadow",
      evidenceMessageIds: ["message_1", "message_2"],
      createdAt: "2026-06-13T10:00:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO hermes_rule_candidates/i);
    expect(queries[0].text).toMatch(/account_id/i);
    expect(queries[0].text).toMatch(/evidence_message_ids/i);
    expect(queries[0].values).toEqual([
      "candidate_1",
      "account_1",
      "Prioritize client@example.com",
      "sender_priority",
      { senderEmail: "client@example.com" },
      { type: "classify_sender", bucket: "P2 Important" },
      0.85,
      "shadow",
      ["message_1", "message_2"],
    ]);
    expect(result).toMatchObject({
      id: "candidate_1",
      accountId: "account_1",
      confidence: 0.85,
      evidenceMessageIds: ["message_1", "message_2"],
    });
  });

  it("records shadow simulations against a candidate", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    await store.recordRuleSimulation({
      id: "run_1",
      accountId: "account_1",
      candidateId: "candidate_1",
      mode: "shadow",
      matchedCount: 2,
      sampleMessageIds: ["message_1", "message_2"],
      actionPreview: { type: "classify_sender", bucket: "P2 Important" },
      createdAt: "2026-06-13T10:05:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO hermes_rule_runs/i);
    expect(queries[0].text).toMatch(/candidate_id/i);
    expect(queries[0].values).toEqual([
      "run_1",
      "candidate_1",
      "shadow",
      {
        accountId: "account_1",
        matchedCount: 2,
        sampleMessageIds: ["message_1", "message_2"],
        actionPreview: { type: "classify_sender", bucket: "P2 Important" },
        createdAt: "2026-06-13T10:05:00.000Z",
      },
    ]);
  });

  it("approves candidates in one transaction and creates an enabled rule", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("SELECT") && text.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: "candidate_1",
                account_id: "account_1",
                title: "Prioritize client@example.com",
                rule_type: "sender_priority",
                condition: { senderEmail: "client@example.com" },
                action: { type: "classify_sender", bucket: "P2 Important" },
                confidence: "0.850",
                status: "shadow",
                evidence_message_ids: ["message_1", "message_2"],
                created_at: "2026-06-13T10:00:00.000Z",
                approved_at: null,
              },
            ],
          };
        }
        if (text.includes("INSERT INTO hermes_rules")) {
          return {
            rows: [
              {
                id: "rule_1",
                account_id: "account_1",
                candidate_id: "candidate_1",
                title: "Prioritize client@example.com",
                rule_type: "sender_priority",
                condition: { senderEmail: "client@example.com" },
                action: { type: "classify_sender", bucket: "P2 Important" },
                confidence: "0.850",
                enabled: true,
                created_at: "2026-06-13T10:10:00.000Z",
                approved_at: "2026-06-13T10:10:00.000Z",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.approveRuleCandidate({
      accountId: "account_1",
      candidateId: "candidate_1",
      ruleId: "rule_1",
      approvedAt: "2026-06-13T10:10:00.000Z",
    });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "UPDATE",
      "INSERT",
      "COMMIT",
    ]);
    expect(queries[1].values).toEqual(["account_1", "candidate_1"]);
    expect(queries[2].text).toMatch(/UPDATE hermes_rule_candidates/i);
    expect(queries[2].values).toEqual([
      "approved",
      "2026-06-13T10:10:00.000Z",
      "candidate_1",
    ]);
    expect(result).toMatchObject({
      id: "rule_1",
      accountId: "account_1",
      candidateId: "candidate_1",
      enabled: true,
    });
  });
});
