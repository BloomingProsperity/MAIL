import { describe, expect, it } from "vitest";

import { createHermesFollowupTrackerService } from "../src/hermes/followup-tracker";

describe("Hermes follow-up tracker service", () => {
  it("tracks follow-up state with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesFollowupTrackerService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return JSON.stringify({
            status: "needs_reply",
            followupNeeded: true,
            owner: "me",
            dueAt: "2026-06-13T17:00:00.000Z",
            dueText: "today 17:00",
            confidence: 0.88,
            reasons: ["customer asked for confirmation today"],
            nextAction: "Reply with the final launch schedule.",
            sourceQuote: "Can you confirm the launch schedule today?",
          });
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000011",
                layer: "contact_memory",
                scope: "global",
                content: { summary: "Lina is a VIP customer contact." },
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

    const result = await service.trackFollowup({
      subject: "Re: launch schedule",
      threadText: "Lina: Can you confirm the launch schedule today?",
      userEmail: "me@example.com",
      participants: ["lina@example.com", "me@example.com"],
      now: "2026-06-13T09:00:00.000Z",
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryIds: ["00000000-0000-0000-0000-000000000099"],
      memoryScope: "global",
      memoryLayers: ["contact_memory"],
    });

    expect(memoryQueries).toEqual([
      { layer: "contact_memory", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("track follow-up state");
    expect(providerCalls[0].systemPrompt).toContain("JSON object");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[contact_memory/global confidence=0.93] Lina is a VIP customer contact.",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Participants: lina@example.com, me@example.com",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Thread context:\nLina: Can you confirm the launch schedule today?",
    );
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "followup_tracker",
      status: "needs_reply",
      followupNeeded: true,
      owner: "me",
      dueAt: "2026-06-13T17:00:00.000Z",
      dueText: "today 17:00",
      confidence: 0.88,
      reasons: ["customer asked for confirmation today"],
      nextAction: "Reply with the final launch schedule.",
      sourceQuote: "Can you confirm the launch schedule today?",
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "followup_tracker",
          skillTitle: "Track follow-up",
          input: {
            subject: "Re: launch schedule",
            threadText: "Lina: Can you confirm the launch schedule today?",
            userEmail: "me@example.com",
            participants: ["lina@example.com", "me@example.com"],
            now: "2026-06-13T09:00:00.000Z",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
          output: {
            status: "needs_reply",
            followupNeeded: true,
            owner: "me",
            dueAt: "2026-06-13T17:00:00.000Z",
            dueText: "today 17:00",
            confidence: 0.88,
            reasons: ["customer asked for confirmation today"],
            nextAction: "Reply with the final launch schedule.",
            sourceQuote: "Can you confirm the launch schedule today?",
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.followup_tracker",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "followup_tracker",
            userEmail: "me@example.com",
            now: "2026-06-13T09:00:00.000Z",
            language: "English",
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesFollowupTrackerService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.trackFollowup({ threadText: " ", subject: "Re: hello" }),
    ).rejects.toThrow("thread text is required");
  });

  it("rejects invalid follow-up status output", async () => {
    const service = createHermesFollowupTrackerService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          return JSON.stringify({
            status: "maybe_later",
            followupNeeded: true,
            owner: "me",
            confidence: 0.8,
            reasons: ["invalid status"],
          });
        },
      },
    });

    await expect(
      service.trackFollowup({ threadText: "Please reply today." }),
    ).rejects.toThrow("follow-up status is invalid");
  });
});
