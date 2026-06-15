import { describe, expect, it } from "vitest";

import {
  createHermesQuickReplyService,
  createHermesReplyDraftService,
  createHermesRewritePolishService,
} from "../src/hermes/drafts";

describe("Hermes reply draft service", () => {
  it("generates a preview-only reply draft with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesReplyDraftService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return "Hi Lina,\n\nThanks, I will review this today.";
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000011",
                layer: "writing_style_profile",
                scope: "global",
                content: { preference: "Keep replies concise and concrete." },
                confidence: 0.9,
                createdAt: "2026-06-12T09:00:00.000Z",
                updatedAt: "2026-06-12T10:00:00.000Z",
              },
            ],
          };
        },
        async updateMemory() {
          throw new Error("not used");
        },
        async deleteMemory() {
          throw new Error("not used");
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
        },
      },
    });

    const result = await service.draftReply({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      instruction: "Confirm that I will review it today.",
      tone: "warm professional",
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["writing_style_profile"],
    });

    expect(memoryQueries).toEqual([
      { layer: "writing_style_profile", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("Do not send");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[writing_style_profile/global confidence=0.90] Keep replies concise and concrete.",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Thread context:\nLina: Can you confirm the launch schedule today?",
    );
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "reply_draft",
      draftText: "Hi Lina,\n\nThanks, I will review this today.",
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "reply_draft",
          skillTitle: "Draft reply",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            instruction: "Confirm that I will review it today.",
            tone: "warm professional",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
          output: {
            draftText: "Hi Lina,\n\nThanks, I will review this today.",
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.reply_draft",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "reply_draft",
            tone: "warm professional",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
        },
      },
    ]);
  });

  it("generates a short editable quick reply with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_quick_1", "audit_quick_1"];
    const service = createHermesQuickReplyService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return "Thanks, I will confirm this today.";
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000011",
                layer: "writing_style_profile",
                scope: "global",
                content: { preference: "Keep quick replies under two sentences." },
                confidence: 0.91,
                createdAt: "2026-06-12T09:00:00.000Z",
                updatedAt: "2026-06-12T10:00:00.000Z",
              },
            ],
          };
        },
        async updateMemory() {
          throw new Error("not used");
        },
        async deleteMemory() {
          throw new Error("not used");
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
        },
      },
    });

    const result = await service.quickReply({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      scenario: "confirm",
      instruction: "Confirm that I will review it today.",
      tone: "warm professional",
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["writing_style_profile"],
    });

    expect(memoryQueries).toEqual([
      { layer: "writing_style_profile", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("quick email reply");
    expect(providerCalls[0].systemPrompt).toContain("Do not send");
    expect(providerCalls[0].userPrompt).toContain("Scenario: confirm");
    expect(providerCalls[0].userPrompt).toContain(
      "[writing_style_profile/global confidence=0.91] Keep quick replies under two sentences.",
    );
    expect(result).toEqual({
      skillRunId: "run_quick_1",
      auditEventId: "audit_quick_1",
      skillId: "quick_reply",
      scenario: "confirm",
      draftText: "Thanks, I will confirm this today.",
      editable: true,
      sendsDirectly: false,
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_quick_1",
          skillId: "quick_reply",
          skillTitle: "Quick reply",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            scenario: "confirm",
            instruction: "Confirm that I will review it today.",
            tone: "warm professional",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
          output: {
            scenario: "confirm",
            draftText: "Thanks, I will confirm this today.",
            editable: true,
            sendsDirectly: false,
          },
        },
        auditEvent: {
          id: "audit_quick_1",
          eventType: "hermes.skill.quick_reply",
          skillRunId: "run_quick_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "quick_reply",
            scenario: "confirm",
            tone: "warm professional",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
        },
      },
    ]);
  });

  it("rewrites an editable draft with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_rewrite_1", "audit_rewrite_1"];
    const service = createHermesRewritePolishService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return "Hi Lina,\n\nI will review this today and reply with notes.";
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000012",
                layer: "writing_style_profile",
                scope: "global",
                content: {
                  preference: "Use short paragraphs and avoid filler words.",
                },
                confidence: 0.93,
                createdAt: "2026-06-12T09:00:00.000Z",
                updatedAt: "2026-06-12T10:00:00.000Z",
              },
            ],
          };
        },
        async updateMemory() {
          throw new Error("not used");
        },
        async deleteMemory() {
          throw new Error("not used");
        },
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
        },
      },
    });

    const result = await service.rewritePolish({
      text: "Hi Lina, I will look at this thing today maybe and get back to you.",
      action: "polish",
      instruction: "Keep the promise concrete.",
      tone: "warm professional",
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["writing_style_profile"],
    });

    expect(memoryQueries).toEqual([
      { layer: "writing_style_profile", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("Rewrite or polish");
    expect(providerCalls[0].systemPrompt).toContain("Do not send");
    expect(providerCalls[0].userPrompt).toContain("Action: polish");
    expect(providerCalls[0].userPrompt).toContain(
      "[writing_style_profile/global confidence=0.93] Use short paragraphs and avoid filler words.",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Original draft:\nHi Lina, I will look at this thing today maybe and get back to you.",
    );
    expect(result).toEqual({
      skillRunId: "run_rewrite_1",
      auditEventId: "audit_rewrite_1",
      skillId: "rewrite_polish",
      action: "polish",
      rewrittenText: "Hi Lina,\n\nI will review this today and reply with notes.",
      editable: true,
      sendsDirectly: false,
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_rewrite_1",
          skillId: "rewrite_polish",
          skillTitle: "Rewrite and polish",
          input: {
            text: "Hi Lina, I will look at this thing today maybe and get back to you.",
            action: "polish",
            instruction: "Keep the promise concrete.",
            tone: "warm professional",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
          output: {
            action: "polish",
            rewrittenText:
              "Hi Lina,\n\nI will review this today and reply with notes.",
            editable: true,
            sendsDirectly: false,
          },
        },
        auditEvent: {
          id: "audit_rewrite_1",
          eventType: "hermes.skill.rewrite_polish",
          skillRunId: "run_rewrite_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000012",
          ],
          action: {
            skillId: "rewrite_polish",
            action: "polish",
            tone: "warm professional",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesReplyDraftService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.draftReply({ threadText: " ", subject: "Re: hello" }),
    ).rejects.toThrow("thread text is required");
  });

  it("rejects invalid quick reply scenarios before calling Hermes", async () => {
    const service = createHermesQuickReplyService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes with an invalid scenario");
        },
      },
    });

    await expect(
      service.quickReply({
        threadText: "Can you confirm?",
        scenario: "send_now" as never,
      }),
    ).rejects.toThrow("invalid quick reply scenario");
  });

  it("rejects invalid rewrite polish input before calling Hermes", async () => {
    const service = createHermesRewritePolishService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes with invalid rewrite input");
        },
      },
    });

    await expect(
      service.rewritePolish({ text: " ", action: "polish" }),
    ).rejects.toThrow("text is required");
    await expect(
      service.rewritePolish({ text: "Draft", action: "send_now" as never }),
    ).rejects.toThrow("invalid rewrite polish action");
  });
});
