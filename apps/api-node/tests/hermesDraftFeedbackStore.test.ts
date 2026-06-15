import { describe, expect, it } from "vitest";

import { createPostgresHermesDraftFeedbackStore } from "../src/hermes/draft-feedback";

describe("postgres Hermes draft feedback store", () => {
  it("records edited reply drafts and writes a writing style memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
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

  it("scopes learned writing style to the recipient when feedback includes a recipient email", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const ids = ["feedback_1", "memory_1"];
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
    expect(memoryQuery?.values?.[1]).toBe("writing_style_profile");
    expect(memoryQuery?.values?.[2]).toBe("recipient:lina@example.com");
    expect(memoryQuery?.values?.[3]).toMatchObject({
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

  it("does not write feedback when the skill run is missing or not a reply draft", async () => {
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
