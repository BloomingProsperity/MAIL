import { describe, expect, it } from "vitest";

import { createHermesNewsletterCleanupService } from "../src/hermes/newsletter-cleanup";

describe("Hermes newsletter cleanup service", () => {
  it("returns preview-only cleanup actions with memory context and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesNewsletterCleanupService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return JSON.stringify({
            isNewsletter: true,
            confidence: 0.92,
            senderCategory: "marketing",
            reasons: ["Contains unsubscribe link", "Promotional digest"],
            actions: [
              {
                type: "move_to_feed",
                reason: "Marketing digest should not stay in priority inbox.",
              },
              {
                type: "unsubscribe_later",
                unsubscribeUrl: "https://example.com/unsubscribe",
                reason: "User rarely opens this sender.",
              },
            ],
          });
        },
      },
      memoryStore: {
        async listMemories(input) {
          memoryQueries.push(input);
          return {
            items:
              input.scope === "sender:news@example.com"
                ? [
                    {
                      id: "00000000-0000-0000-0000-000000000011",
                      layer: "contact_memory",
                      scope: "sender:news@example.com",
                      content: {
                        preference:
                          "Route similar future mail from this sender to Feed.",
                      },
                      confidence: 0.7,
                      createdAt: "2026-06-12T09:00:00.000Z",
                      updatedAt: "2026-06-12T10:00:00.000Z",
                    },
                  ]
                : [],
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

    const result = await service.cleanupNewsletter({
      subject: "Weekly product digest",
      threadText:
        "This week in product updates. Sale, discount, unsubscribe at https://example.com/unsubscribe",
      senderEmail: "news@example.com",
      listId: "weekly.example.com",
      currentBucket: "P4 FYI / Updates",
      language: "English",
      readMessageIds: ["00000000-0000-0000-0000-000000000001"],
      memoryScope: "sender:news@example.com",
      memoryLayers: ["contact_memory"],
    });

    expect(memoryQueries).toEqual([
      { layer: "contact_memory", scope: "global", limit: 3 },
      { layer: "contact_memory", scope: "sender:news@example.com", limit: 3 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain("newsletter cleanup");
    expect(providerCalls[0].systemPrompt).toContain("preview-only");
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[contact_memory/sender:news@example.com confidence=0.70] Route similar future mail from this sender to Feed.",
    );
    expect(providerCalls[0].userPrompt).toContain("List-ID: weekly.example.com");
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "newsletter_cleanup",
      isNewsletter: true,
      confidence: 0.92,
      senderCategory: "marketing",
      reasons: ["Contains unsubscribe link", "Promotional digest"],
      actions: [
        {
          type: "move_to_feed",
          reason: "Marketing digest should not stay in priority inbox.",
        },
        {
          type: "unsubscribe_later",
          unsubscribeUrl: "https://example.com/unsubscribe",
          reason: "User rarely opens this sender.",
        },
      ],
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "newsletter_cleanup",
          skillTitle: "Newsletter cleanup",
          input: {
            subject: "Weekly product digest",
            threadText:
              "This week in product updates. Sale, discount, unsubscribe at https://example.com/unsubscribe",
            senderEmail: "news@example.com",
            listId: "weekly.example.com",
            currentBucket: "P4 FYI / Updates",
            language: "English",
            memoryScope: "sender:news@example.com",
            memoryLayers: ["contact_memory"],
          },
          output: {
            isNewsletter: true,
            confidence: 0.92,
            senderCategory: "marketing",
            reasons: ["Contains unsubscribe link", "Promotional digest"],
            actions: [
              {
                type: "move_to_feed",
                reason: "Marketing digest should not stay in priority inbox.",
              },
              {
                type: "unsubscribe_later",
                unsubscribeUrl: "https://example.com/unsubscribe",
                reason: "User rarely opens this sender.",
              },
            ],
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.newsletter_cleanup",
          skillRunId: "run_1",
          readMessageIds: ["00000000-0000-0000-0000-000000000001"],
          memoryIds: ["00000000-0000-0000-0000-000000000011"],
          action: {
            skillId: "newsletter_cleanup",
            senderEmail: "news@example.com",
            listId: "weekly.example.com",
            currentBucket: "P4 FYI / Updates",
            language: "English",
            memoryScope: "sender:news@example.com",
            memoryLayers: ["contact_memory"],
            previewOnly: true,
          },
        },
      },
    ]);
  });

  it("rejects empty thread text before calling Hermes", async () => {
    const service = createHermesNewsletterCleanupService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without thread text");
        },
      },
    });

    await expect(
      service.cleanupNewsletter({
        threadText: " ",
        subject: "Weekly digest",
      }),
    ).rejects.toThrow("thread text is required");
  });

  it("rejects unsafe cleanup actions from Hermes output", async () => {
    const service = createHermesNewsletterCleanupService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          return JSON.stringify({
            isNewsletter: true,
            confidence: 0.9,
            reasons: [],
            actions: [{ type: "delete" }],
          });
        },
      },
    });

    await expect(
      service.cleanupNewsletter({
        threadText: "unsubscribe newsletter",
      }),
    ).rejects.toThrow("newsletter cleanup action type is invalid");
  });
});
