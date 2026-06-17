import { describe, expect, it } from "vitest";

import { createPostgresHermesDraftFeedbackStore } from "../src/hermes/draft-feedback";

describe("postgres Hermes draft feedback store", () => {
  it("looks up editable draft feedback runs before memory writes", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return { rows: [{ id: "run_1", skill_id: "quick_reply" }] };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => "unused",
    });

    await expect(
      store.getDraftFeedbackSkillRun({ skillRunId: "run_1" }),
    ).resolves.toEqual({
      skillRunId: "run_1",
      skillId: "quick_reply",
    });
    expect(queries[0].values).toEqual(["run_1"]);
  });

  it("records edited reply drafts and writes a writing style memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return {
            rows: [{ id: "run_1", account_id: "account_1", skill_id: "reply_draft" }],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.recordDraftFeedback({
      skillRunId: "run_1",
      draftText:
        "Hi Lina,\n\nThanks for the details. I will review this today and get back to you soon.\n\nBest,\nHua",
      finalText: "Hi Lina,\n\nThanks. I will review this today.\n\nHua",
      subject: "Re: launch schedule",
      recipientEmail: "lina@example.com",
    });

    expect(queries.map((query) => query.text)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
    const feedbackQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_feedback"),
    );
    expect(feedbackQuery?.values).toEqual([
      "feedback_1",
      "run_1",
      "reply_draft.final_edit",
      {
        source: "reply_draft_feedback",
        draftText:
          "Hi Lina,\n\nThanks for the details. I will review this today and get back to you soon.\n\nBest,\nHua",
        finalText: "Hi Lina,\n\nThanks. I will review this today.\n\nHua",
        subject: "Re: launch schedule",
        recipientEmail: "lina@example.com",
        analysis: {
          draftWordCount: 19,
          finalWordCount: 9,
          changes: ["shortened_reply", "removed_formal_signoff"],
          preference:
            "Prefer shorter reply drafts with less extra phrasing. Avoid adding a formal sign-off unless the user wrote one.",
        },
      },
    ]);
    const memoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(memoryQuery?.values).toEqual([
      "memory_1",
      "account_1",
      "writing_style_profile",
      "recipient:lina@example.com",
      {
        source: "reply_draft_feedback",
        feedbackId: "feedback_1",
        skillRunId: "run_1",
        scope: "recipient:lina@example.com",
        subject: "Re: launch schedule",
        recipientEmail: "lina@example.com",
        preference:
          "Prefer shorter reply drafts with less extra phrasing. Avoid adding a formal sign-off unless the user wrote one.",
        changes: ["shortened_reply", "removed_formal_signoff"],
        example: {
          before:
            "Hi Lina,\n\nThanks for the details. I will review this today and get back to you soon.\n\nBest,\nHua",
          after: "Hi Lina,\n\nThanks. I will review this today.\n\nHua",
        },
      },
      0.8,
    ]);
    expect(result).toEqual({
      feedbackId: "feedback_1",
      skillRunId: "run_1",
      learned: true,
      memoryId: "memory_1",
    });
  });

  it("records edited quick replies as writing style feedback", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return {
            rows: [
              {
                id: "run_quick_1",
                account_id: "account_1",
                skill_id: "quick_reply",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.recordDraftFeedback({
      skillRunId: "run_quick_1",
      draftText: "Thanks for the note. I will review it today.",
      finalText: "Thanks. I will review it today.",
      recipientEmail: "lina@example.com",
    });

    const feedbackQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_feedback"),
    );
    expect(feedbackQuery?.values).toMatchObject([
      "feedback_1",
      "run_quick_1",
      "quick_reply.final_edit",
      {
        source: "quick_reply_feedback",
        draftText: "Thanks for the note. I will review it today.",
        finalText: "Thanks. I will review it today.",
        recipientEmail: "lina@example.com",
      },
    ]);
    const memoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(memoryQuery?.values?.[1]).toBe("account_1");
    expect(memoryQuery?.values?.[4]).toMatchObject({
      source: "quick_reply_feedback",
      feedbackId: "feedback_1",
      skillRunId: "run_quick_1",
      recipientEmail: "lina@example.com",
    });
    expect(result).toEqual({
      feedbackId: "feedback_1",
      skillRunId: "run_quick_1",
      learned: true,
      memoryId: "memory_1",
    });
  });

  it("records edited rewrite polish drafts as writing style feedback", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return {
            rows: [
              {
                id: "run_rewrite_1",
                account_id: "account_1",
                skill_id: "rewrite_polish",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.recordDraftFeedback({
      skillRunId: "run_rewrite_1",
      draftText:
        "Hi Lina,\n\nPlease review the launch plan today and let me know if anything is missing.\n\nBest,\nHua",
      finalText: "Hi Lina,\n\nPlease review the launch plan today.\n\nHua",
      subject: "Launch plan",
      recipientEmail: "lina@example.com",
    });

    const feedbackQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_feedback"),
    );
    expect(feedbackQuery?.values).toMatchObject([
      "feedback_1",
      "run_rewrite_1",
      "rewrite_polish.final_edit",
      {
        source: "rewrite_polish_feedback",
        subject: "Launch plan",
        recipientEmail: "lina@example.com",
      },
    ]);
    const memoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(memoryQuery?.values?.[1]).toBe("account_1");
    expect(memoryQuery?.values?.[4]).toMatchObject({
      source: "rewrite_polish_feedback",
      feedbackId: "feedback_1",
      skillRunId: "run_rewrite_1",
      scope: "recipient:lina@example.com",
      preference:
        "Prefer shorter reply drafts with less extra phrasing. Avoid adding a formal sign-off unless the user wrote one.",
    });
    expect(result).toEqual({
      feedbackId: "feedback_1",
      skillRunId: "run_rewrite_1",
      learned: true,
      memoryId: "memory_1",
    });
  });

  it("records accepted rewrite polish output as writing style memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return {
            rows: [
              {
                id: "run_rewrite_1",
                account_id: "account_1",
                skill_id: "rewrite_polish",
                input: {
                  text: "please review launch plan",
                  action: "polish",
                },
                output: {
                  rewrittenText:
                    "Hi Lina,\n\nPlease review the launch plan today.",
                },
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    const result = await store.recordDraftFeedback({
      skillRunId: "run_rewrite_1",
      draftText: "Hi Lina,\n\nPlease review the launch plan today.",
      finalText: "Hi Lina,\n\nPlease review the launch plan today.",
      subject: "Launch plan",
      recipientEmail: "lina@example.com",
    });

    const memoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(memoryQuery?.values).toEqual([
      "memory_1",
      "account_1",
      "writing_style_profile",
      "recipient:lina@example.com",
      {
        source: "rewrite_polish_feedback",
        feedbackId: "feedback_1",
        skillRunId: "run_rewrite_1",
        scope: "recipient:lina@example.com",
        subject: "Launch plan",
        recipientEmail: "lina@example.com",
        action: "polish",
        originalText: "please review launch plan",
        preference:
          "The user accepted Hermes polished wording; prefer similarly clear, polished phrasing for future drafts.",
        changes: ["accepted_rewrite_polish"],
        example: {
          before: "please review launch plan",
          after: "Hi Lina,\n\nPlease review the launch plan today.",
        },
      },
      0.7,
    ]);
    expect(result).toEqual({
      feedbackId: "feedback_1",
      skillRunId: "run_rewrite_1",
      learned: true,
      memoryId: "memory_1",
    });
  });

  it("scopes learned writing style to the recipient when feedback includes a recipient email", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return {
            rows: [{ id: "run_1", account_id: "account_1", skill_id: "reply_draft" }],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => ids.shift() ?? "unexpected",
    });

    await store.recordDraftFeedback({
      skillRunId: "run_1",
      draftText:
        "Hi Lina,\n\nThanks for the detailed launch plan. I will review everything and send a longer answer soon.\n\nBest,\nHua",
      finalText: "Hi Lina,\n\nThanks. I will review it today.\n\nHua",
      recipientEmail: " Lina@Example.COM ",
    });

    const memoryQuery = queries.find((query) =>
      query.text.includes("INSERT INTO hermes_memories"),
    );
    expect(memoryQuery?.values?.[1]).toBe("account_1");
    expect(memoryQuery?.values?.[2]).toBe("writing_style_profile");
    expect(memoryQuery?.values?.[3]).toBe("recipient:lina@example.com");
    expect(memoryQuery?.values?.[4]).toMatchObject({
      recipientEmail: "lina@example.com",
      scope: "recipient:lina@example.com",
      preference:
        "Prefer shorter reply drafts with less extra phrasing. Avoid adding a formal sign-off unless the user wrote one.",
    });
  });

  it("records unchanged draft feedback without creating memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return { rows: [{ id: "run_1", skill_id: "reply_draft" }] };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => "feedback_1",
    });

    const result = await store.recordDraftFeedback({
      skillRunId: "run_1",
      draftText: "Looks good to me.",
      finalText: "Looks good to me.",
    });

    expect(
      queries.some((query) => query.text.includes("INSERT INTO hermes_feedback")),
    ).toBe(true);
    expect(
      queries.some((query) => query.text.includes("INSERT INTO hermes_memories")),
    ).toBe(false);
    expect(result).toEqual({
      feedbackId: "feedback_1",
      skillRunId: "run_1",
      learned: false,
    });
  });

  it("does not write feedback when the skill run is missing or not an editable reply skill", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM hermes_skill_runs")) {
          return { rows: [{ id: "run_1", skill_id: "translate_text" }] };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresHermesDraftFeedbackStore(client, {
      createId: () => "feedback_1",
    });

    const result = await store.recordDraftFeedback({
      skillRunId: "run_1",
      draftText: "Draft",
      finalText: "Final",
    });

    expect(result).toBeUndefined();
    expect(
      queries.some((query) => query.text.includes("INSERT INTO hermes_feedback")),
    ).toBe(false);
    expect(
      queries.some((query) => query.text.includes("INSERT INTO hermes_memories")),
    ).toBe(false);
  });
});
