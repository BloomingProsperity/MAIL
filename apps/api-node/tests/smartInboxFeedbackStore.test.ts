import { describe, expect, it } from "vitest";

import { createPostgresSmartInboxFeedbackStore } from "../src/smart-inbox/postgres-feedback-store";

describe("postgres Smart Inbox feedback store", () => {
  it("records important feedback and raises the visible message classification", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM messages")) {
          return {
            rows: [
              {
                id: "message_1",
                account_id: "account_1",
                from_email: "client@example.com",
                bucket: "P4 FYI / Updates",
                priority_score: "20",
                reasons: ["直接发给你"],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSmartInboxFeedbackStore(client, {
      createId: () => "feedback_1",
    });

    const result = await store.recordFeedback({
      accountId: "account_1",
      messageId: "message_1",
      action: "mark_important",
    });

    expect(queries.map((query) => query.text)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
    const feedbackQuery = queries.find((query) =>
      query.text.includes("INSERT INTO feedback_events"),
    );
    expect(feedbackQuery?.values).toEqual([
      "feedback_1",
      "message_1",
      "smart_inbox.mark_important",
      { action: "mark_important", senderEmail: "client@example.com" },
    ]);
    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P2 Important",
      85,
      ["直接发给你", "用户标记重要"],
      "user_feedback",
    ]);
    expect(result).toEqual({
      feedbackEventId: "feedback_1",
      accountId: "account_1",
      messageId: "message_1",
      classification: {
        bucket: "P2 Important",
        priorityScore: 85,
        reasons: ["直接发给你", "用户标记重要"],
      },
    });
  });

  it("creates a sender rule when the user marks a sender as always important", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_2", "memory_2"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM messages")) {
          return {
            rows: [
              {
                id: "message_1",
                account_id: "account_1",
                from_email: "client@example.com",
                bucket: "P3 Needs Action",
                priority_score: "60",
                reasons: [],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSmartInboxFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    await store.recordFeedback({
      accountId: "account_1",
      messageId: "message_1",
      action: "always_important_sender",
    });

    const removeOppositeRule = queries.find((query) =>
      query.text.includes("DELETE FROM smart_inbox_sender_rules"),
    );
    expect(removeOppositeRule?.values).toEqual([
      "account_1",
      "client@example.com",
      "mute",
    ]);
    const senderRuleQuery = queries.find((query) =>
      query.text.includes("INSERT INTO smart_inbox_sender_rules"),
    );
    expect(senderRuleQuery?.values).toEqual([
      "feedback_2",
      "account_1",
      "client@example.com",
      "always_important",
      "feedback_2",
    ]);
    const hermesMemoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(hermesMemoryQuery?.values).toEqual([
      "memory_2",
      "contact_memory",
      "sender:client@example.com",
      {
        source: "smart_inbox_feedback",
        feedbackEventId: "feedback_2",
        accountId: "account_1",
        messageId: "message_1",
        senderEmail: "client@example.com",
        action: "always_important_sender",
        preference: "Prioritize future mail from this sender.",
        classification: {
          bucket: "P2 Important",
          priorityScore: 90,
        },
      },
      0.95,
    ]);
    expect(
      queries.findIndex((query) =>
        query.text.includes("INSERT INTO hermes_memories"),
      ),
    ).toBeLessThan(queries.findIndex((query) => query.text === "COMMIT"));
  });

  it("records low-priority feedback as Hermes contact memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_4", "memory_4"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM messages")) {
          return {
            rows: [
              {
                id: "message_1",
                account_id: "account_1",
                from_email: "newsletter@example.com",
                bucket: "P4 FYI / Updates",
                priority_score: "45",
                reasons: [],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSmartInboxFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    await store.recordFeedback({
      accountId: "account_1",
      messageId: "message_1",
      action: "move_to_feed",
    });

    const hermesMemoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(hermesMemoryQuery?.values).toEqual([
      "memory_4",
      "contact_memory",
      "sender:newsletter@example.com",
      {
        source: "smart_inbox_feedback",
        feedbackEventId: "feedback_4",
        accountId: "account_1",
        messageId: "message_1",
        senderEmail: "newsletter@example.com",
        action: "move_to_feed",
        preference: "Route similar future mail from this sender to Feed.",
        classification: {
          bucket: "P6 Feed",
          priorityScore: 15,
        },
      },
      0.7,
    ]);
  });

  it("updates existing sender feedback memory instead of appending duplicates", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_repeat"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM messages")) {
          return {
            rows: [
              {
                id: "message_2",
                account_id: "account_1",
                from_email: "newsletter@example.com",
                bucket: "P4 FYI / Updates",
                priority_score: "45",
                reasons: [],
              },
            ],
          };
        }
        if (text.includes("FROM hermes_memories")) {
          return {
            rows: [
              {
                id: "memory_existing",
                content: {
                  source: "smart_inbox_feedback",
                  feedbackEventId: "feedback_old",
                  action: "move_to_feed",
                  preference: "Route similar future mail from this sender to Feed.",
                  evidenceCount: 2,
                },
                confidence: "0.700",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSmartInboxFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    await store.recordFeedback({
      accountId: "account_1",
      messageId: "message_2",
      action: "move_to_feed",
    });

    const advisoryLock = queries.find((query) =>
      query.text.includes("pg_advisory_xact_lock"),
    );
    expect(advisoryLock?.values).toEqual([
      "contact_memory:sender:newsletter@example.com:move_to_feed",
    ]);
    expect(
      queries.some((query) => query.text.includes("INSERT INTO hermes_memories")),
    ).toBe(false);
    const updateMemory = queries.find((query) =>
      query.text.includes("UPDATE hermes_memories"),
    );
    expect(updateMemory?.values).toEqual([
      "memory_existing",
      {
        source: "smart_inbox_feedback",
        feedbackEventId: "feedback_repeat",
        action: "move_to_feed",
        preference: "Route similar future mail from this sender to Feed.",
        evidenceCount: 3,
        accountId: "account_1",
        messageId: "message_2",
        senderEmail: "newsletter@example.com",
        firstFeedbackEventId: "feedback_old",
        lastFeedbackEventId: "feedback_repeat",
        classification: {
          bucket: "P6 Feed",
          priorityScore: 15,
        },
      },
      0.73,
    ]);
  });

  it("records Spark category correction as sender rule and Hermes memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_newsletters", "memory_newsletters"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM messages")) {
          return {
            rows: [
              {
                id: "message_1",
                account_id: "account_1",
                from_email: "newsletter@example.com",
                bucket: "P4 FYI / Updates",
                priority_score: "42",
                reasons: ["Baseline update"],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresSmartInboxFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.recordFeedback({
      accountId: "account_1",
      messageId: "message_1",
      action: "move_to_newsletters",
    });

    const senderRuleQuery = queries.find((query) =>
      query.text.includes("INSERT INTO smart_inbox_sender_rules"),
    );
    expect(senderRuleQuery?.values).toEqual([
      "feedback_newsletters",
      "account_1",
      "newsletter@example.com",
      "newsletters",
      "feedback_newsletters",
    ]);
    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P6 Feed",
      15,
      ["Baseline update", "User moved sender to Newsletters"],
      "user_feedback",
    ]);
    const hermesMemoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(hermesMemoryQuery?.values).toEqual([
      "memory_newsletters",
      "contact_memory",
      "sender:newsletter@example.com",
      {
        source: "smart_inbox_feedback",
        feedbackEventId: "feedback_newsletters",
        accountId: "account_1",
        messageId: "message_1",
        senderEmail: "newsletter@example.com",
        action: "move_to_newsletters",
        preference: "Route similar future mail from this sender to Newsletters.",
        classification: {
          bucket: "P6 Feed",
          priorityScore: 15,
        },
      },
      0.75,
    ]);
    expect(result?.classification).toEqual({
      bucket: "P6 Feed",
      priorityScore: 15,
      reasons: ["Baseline update", "User moved sender to Newsletters"],
    });
  });

  it("returns undefined without writing feedback when the message is not visible", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresSmartInboxFeedbackStore(client, {
      createId: () => "feedback_3",
    });

    const result = await store.recordFeedback({
      accountId: "account_1",
      messageId: "missing_message",
      action: "move_to_feed",
    });

    expect(result).toBeUndefined();
    expect(
      queries.some((query) => query.text.includes("INSERT INTO feedback_events")),
    ).toBe(false);
    expect(
      queries.some((query) => query.text.includes("INSERT INTO hermes_memories")),
    ).toBe(false);
    expect(queries.map((query) => query.text)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
  });
});
