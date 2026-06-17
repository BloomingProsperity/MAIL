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

  it("lists rule candidates by account and status in newest-first order", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "candidate_new",
              account_id: "account_1",
              title: "启用发票智能分组",
              rule_type: "content_label",
              condition: { anyKeywords: ["发票", "invoice"] },
              action: {
                type: "apply_label",
                labelName: "发票",
                requiresConfirmation: true,
              },
              confidence: "0.820",
              status: "shadow",
              evidence_message_ids: ["message_2"],
              created_at: "2026-06-13T10:30:00.000Z",
              approved_at: null,
            },
            {
              id: "candidate_old",
              account_id: "account_1",
              title: "启用验证码智能分组",
              rule_type: "content_label",
              condition: { anyKeywords: ["验证码", "otp"] },
              action: {
                type: "apply_label",
                labelName: "验证码",
                requiresConfirmation: true,
              },
              confidence: "0.900",
              status: "shadow",
              evidence_message_ids: ["message_1"],
              created_at: "2026-06-13T10:00:00.000Z",
              approved_at: null,
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.listRuleCandidates({
      accountId: "account_1",
      status: "shadow",
      limit: 20,
    });

    expect(queries[0].text).toMatch(/FROM hermes_rule_candidates/i);
    expect(queries[0].text).toMatch(/WHERE account_id = \$1/i);
    expect(queries[0].text).toMatch(/\(\$2::text IS NULL OR status = \$2\)/i);
    expect(queries[0].text).toMatch(/ORDER BY created_at DESC, id DESC/i);
    expect(queries[0].values).toEqual(["account_1", "shadow", 20]);
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "candidate_new",
          accountId: "account_1",
          status: "shadow",
          confidence: 0.82,
        }),
        expect.objectContaining({
          id: "candidate_old",
          accountId: "account_1",
          status: "shadow",
          confidence: 0.9,
        }),
      ],
    });
  });

  it("updates only shadow rule candidates within the account scope", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "candidate_codes",
              account_id: "account_1",
              title: "创建票据智能分组",
              rule_type: "content_label",
              condition: { anyKeywords: ["receipt", "invoice"] },
              action: {
                type: "apply_label",
                labelName: "票据",
                requiresConfirmation: true,
              },
              confidence: "0.900",
              status: "shadow",
              evidence_message_ids: [],
              created_at: "2026-06-13T10:00:00.000Z",
              approved_at: null,
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.updateRuleCandidate({
      accountId: "account_1",
      candidateId: "candidate_codes",
      title: "创建票据智能分组",
      labelName: "票据",
      keywords: ["receipt", "invoice"],
      applyToHistory: true,
      condition: { anyKeywords: ["receipt", "invoice"] },
      action: {
        type: "apply_label",
        labelName: "票据",
        requiresConfirmation: true,
      },
    });

    expect(queries[0].text).toMatch(/UPDATE hermes_rule_candidates/i);
    expect(queries[0].text).toMatch(/WHERE account_id = \$1/i);
    expect(queries[0].text).toMatch(/AND id = \$2/i);
    expect(queries[0].text).toMatch(/AND status = 'shadow'/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "candidate_codes",
      "创建票据智能分组",
      { anyKeywords: ["receipt", "invoice"] },
      {
        type: "apply_label",
        labelName: "票据",
        requiresConfirmation: true,
      },
    ]);
    expect(result).toMatchObject({
      id: "candidate_codes",
      accountId: "account_1",
      title: "创建票据智能分组",
      status: "shadow",
    });
  });

  it("dismisses only shadow rule candidates within the account scope", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "candidate_codes",
              account_id: "account_1",
              title: "启用验证码智能分组",
              rule_type: "content_label",
              condition: { anyKeywords: ["验证码", "otp"] },
              action: {
                type: "apply_label",
                labelName: "验证码",
                requiresConfirmation: true,
              },
              confidence: "0.900",
              status: "dismissed",
              evidence_message_ids: [],
              created_at: "2026-06-13T10:00:00.000Z",
              approved_at: null,
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.dismissRuleCandidate({
      accountId: "account_1",
      candidateId: "candidate_codes",
    });

    expect(queries[0].text).toMatch(/UPDATE hermes_rule_candidates/i);
    expect(queries[0].text).toMatch(/SET status = 'dismissed'/i);
    expect(queries[0].text).toMatch(/WHERE account_id = \$1/i);
    expect(queries[0].text).toMatch(/AND id = \$2/i);
    expect(queries[0].text).toMatch(/AND status = 'shadow'/i);
    expect(queries[0].values).toEqual(["account_1", "candidate_codes"]);
    expect(result).toMatchObject({
      id: "candidate_codes",
      accountId: "account_1",
      status: "dismissed",
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
    expect(queries[0].text).toMatch(/account_id/i);
    expect(queries[0].values).toEqual([
      "run_1",
      "candidate_1",
      "account_1",
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

  it("matches content saved-view candidates with keyword search", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              message_id: "message_1",
              sender_email: "login@example.com",
              subject: "Your OTP code",
              received_at: "2026-06-13T10:00:00.000Z",
              current_bucket: "P5 Transactions",
              current_score: "60",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.listCandidateMatches({
      accountId: "account_1",
      candidate: {
        id: "candidate_codes",
        accountId: "account_1",
        title: "启用验证码智能分组",
        ruleType: "content_saved_view",
        condition: { anyKeywords: ["验证码", "otp"] },
        action: { type: "ensure_saved_view" },
        confidence: 0.9,
        status: "shadow",
        evidenceMessageIds: [],
        createdAt: "2026-06-13T10:00:00.000Z",
      },
      limit: 10,
    });

    expect(queries[0].text).toMatch(/unnest\(\$2::text\[\]\)/i);
    expect(queries[0].text).toMatch(/search_documents\.raw_text/i);
    expect(queries[0].values).toEqual([
      "account_1",
      ["验证码", "otp"],
      10,
    ]);
    expect(result).toEqual([
      {
        messageId: "message_1",
        senderEmail: "login@example.com",
        subject: "Your OTP code",
        receivedAt: "2026-06-13T10:00:00.000Z",
        currentBucket: "P5 Transactions",
        currentScore: 60,
      },
    ]);
  });

  it("upserts Hermes saved views when a custom rule is approved", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    await store.upsertSavedView({
      id: "hermes_contract",
      label: "合同",
      tone: "blue",
      kind: "keyword",
      keywords: ["合同", "contract"],
    });

    expect(queries[0].text).toMatch(/INSERT INTO saved_views/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(id\) DO UPDATE/i);
    expect(queries[0].values).toEqual([
      "hermes_contract",
      "合同",
      "blue",
      "keyword",
      ["合同", "contract"],
      {},
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
          const action = values?.[6] as Record<string, unknown>;
          return {
            rows: [
              {
                id: "rule_1",
                account_id: "account_1",
                candidate_id: "candidate_1",
                title: "Prioritize client@example.com",
                rule_type: "sender_priority",
                condition: { senderEmail: "client@example.com" },
                action,
                confidence: "0.850",
                enabled: true,
                sort_order: 1000,
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
      actionOverride: {
        type: "apply_label",
        labelId: "label_codes",
        labelName: "验证码",
      },
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
    expect(queries[3].values?.[6]).toEqual({
      type: "apply_label",
      labelId: "label_codes",
      labelName: "验证码",
    });
    expect(result).toMatchObject({
      id: "rule_1",
      accountId: "account_1",
      candidateId: "candidate_1",
      enabled: true,
      sortOrder: 1000,
      action: {
        type: "apply_label",
        labelId: "label_codes",
        labelName: "验证码",
      },
    });
  });

  it("backfills local label assignments for approved content rules", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              matched_count: "3",
              applied_count: "2",
              sample_message_ids: ["message_1", "message_2"],
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.backfillContentLabelRule({
      accountId: "account_1",
      limit: 5000,
      rule: {
        id: "rule_codes",
        accountId: "account_1",
        candidateId: "candidate_codes",
        title: "启用验证码智能分组",
        ruleType: "content_label",
        condition: { anyKeywords: ["验证码", "otp"] },
        action: {
          type: "apply_label",
          labelId: "11111111-1111-4111-8111-111111111111",
          labelName: "验证码",
          applyToHistory: true,
          providerWriteback: false,
        },
        confidence: 0.9,
        enabled: true,
        sortOrder: 1000,
        createdAt: "2026-06-13T10:10:00.000Z",
        approvedAt: "2026-06-13T10:10:00.000Z",
      },
    });

    expect(queries[0].text).toMatch(/WITH matching_messages AS/i);
    expect(queries[0].text).toMatch(/INSERT INTO label_assignments/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(message_id, label_id\) DO NOTHING/i);
    expect(queries[0].text).toMatch(/labels\.account_id = \$1/i);
    expect(queries[0].values).toEqual([
      "account_1",
      ["验证码", "otp"],
      "11111111-1111-4111-8111-111111111111",
      5000,
    ]);
    expect(result).toEqual({
      accountId: "account_1",
      ruleId: "rule_codes",
      matchedCount: 3,
      appliedCount: 2,
      sampleMessageIds: ["message_1", "message_2"],
    });
  });

  it("records active Hermes rule executions", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.recordRuleExecution({
      id: "run_active_1",
      accountId: "account_1",
      ruleId: "rule_codes",
      mode: "active",
      matchedCount: 3,
      appliedCount: 2,
      sampleMessageIds: ["message_1", "message_2"],
      actionPreview: {
        type: "apply_label",
        labelId: "label_codes",
      },
      createdAt: "2026-06-13T10:30:00.000Z",
    });

    expect(queries[0].text).toMatch(/INSERT INTO hermes_rule_runs/i);
    expect(queries[0].text).toMatch(/rule_id/i);
    expect(queries[0].text).toMatch(/account_id/i);
    expect(queries[0].values).toEqual([
      "run_active_1",
      "rule_codes",
      "account_1",
      "active",
      {
        accountId: "account_1",
        ruleId: "rule_codes",
        matchedCount: 3,
        appliedCount: 2,
        sampleMessageIds: ["message_1", "message_2"],
        actionPreview: {
          type: "apply_label",
          labelId: "label_codes",
        },
        createdAt: "2026-06-13T10:30:00.000Z",
      },
    ]);
    expect(result).toMatchObject({
      id: "run_active_1",
      mode: "active",
      matchedCount: 3,
      appliedCount: 2,
    });
  });

  it("lists active Hermes rule executions by account and rule", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "run_active_1",
              account_id: "account_1",
              rule_id: "rule_codes",
              mode: "active",
              result: {
                matchedCount: 7,
                appliedCount: 3,
                sampleMessageIds: ["message_1", "message_2"],
                actionPreview: {
                  type: "apply_label",
                  labelId: "label_codes",
                },
                createdAt: "2026-06-13T10:30:00.000Z",
              },
              created_at: "2026-06-13T10:31:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.listRuleExecutions({
      accountId: "account_1",
      ruleId: "rule_codes",
      limit: 20,
    });

    expect(queries[0].text).toMatch(/FROM hermes_rule_runs/i);
    expect(queries[0].text).toMatch(/mode = 'active'/i);
    expect(queries[0].text).toMatch(/rule_id IS NOT NULL/i);
    expect(queries[0].text).toMatch(/ORDER BY created_at DESC, id DESC/i);
    expect(queries[0].values).toEqual(["account_1", "rule_codes", 20]);
    expect(result).toEqual({
      items: [
        {
          id: "run_active_1",
          accountId: "account_1",
          ruleId: "rule_codes",
          mode: "active",
          matchedCount: 7,
          appliedCount: 3,
          sampleMessageIds: ["message_1", "message_2"],
          actionPreview: {
            type: "apply_label",
            labelId: "label_codes",
          },
          createdAt: "2026-06-13T10:31:00.000Z",
        },
      ],
    });
  });

  it("does not approve a candidate that already left shadow mode", async () => {
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
                status: "approved",
                evidence_message_ids: ["message_1", "message_2"],
                created_at: "2026-06-13T10:00:00.000Z",
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
      approvedAt: "2026-06-13T10:11:00.000Z",
    });

    expect(result).toBeUndefined();
    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "COMMIT",
    ]);
  });

  it("lists approved rules in account priority order", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "rule_first",
              account_id: "account_1",
              candidate_id: "candidate_first",
              title: "First rule",
              rule_type: "sender_priority",
              condition: { senderEmail: "first@example.com" },
              action: { type: "classify_sender", bucket: "P2 Important" },
              confidence: "0.900",
              sort_order: 1000,
              enabled: true,
              created_at: "2026-06-13T10:00:00.000Z",
              approved_at: "2026-06-13T10:00:00.000Z",
            },
            {
              id: "rule_second",
              account_id: "account_1",
              candidate_id: "candidate_second",
              title: "Second rule",
              rule_type: "sender_feed",
              condition: { senderEmail: "second@example.com" },
              action: { type: "classify_sender", bucket: "P6 Feed" },
              confidence: "0.700",
              sort_order: 2000,
              enabled: true,
              created_at: "2026-06-13T10:30:00.000Z",
              approved_at: "2026-06-13T10:30:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.listRules({
      accountId: "account_1",
      enabled: true,
      limit: 20,
    });

    expect(queries[0].text).toMatch(/FROM hermes_rules/i);
    expect(queries[0].text).toMatch(/\(\$2::boolean IS NULL OR enabled = \$2\)/i);
    expect(queries[0].text).toMatch(
      /ORDER BY sort_order ASC, created_at DESC, id DESC/i,
    );
    expect(queries[0].values).toEqual(["account_1", true, 20]);
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "rule_first",
          sortOrder: 1000,
          enabled: true,
        }),
        expect.objectContaining({
          id: "rule_second",
          sortOrder: 2000,
          enabled: true,
        }),
      ],
    });
  });

  it("updates rule enabled state by account and rule id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "rule_codes",
              account_id: "account_1",
              candidate_id: "candidate_codes",
              title: "启用验证码智能分组",
              rule_type: "content_label",
              condition: { anyKeywords: ["验证码", "otp"] },
              action: { type: "apply_label", labelId: "label_codes" },
              confidence: "0.900",
              enabled: false,
              sort_order: 2000,
              created_at: "2026-06-13T10:10:00.000Z",
              approved_at: "2026-06-13T10:10:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesRuleStore(client);

    const result = await store.updateRule({
      accountId: "account_1",
      ruleId: "rule_codes",
      enabled: false,
      sortOrder: 2000,
    });

    expect(queries[0].text).toMatch(/UPDATE hermes_rules/i);
    expect(queries[0].text).toMatch(/enabled = COALESCE\(\$3::boolean, enabled\)/i);
    expect(queries[0].text).toMatch(
      /sort_order = COALESCE\(\$4::integer, sort_order\)/i,
    );
    expect(queries[0].text).toMatch(/WHERE account_id = \$1/i);
    expect(queries[0].text).toMatch(/AND id = \$2/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "rule_codes",
      false,
      2000,
    ]);
    expect(result).toMatchObject({
      id: "rule_codes",
      accountId: "account_1",
      enabled: false,
      sortOrder: 2000,
    });
  });
});
