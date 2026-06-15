import { describe, expect, it } from "vitest";

import { createHermesEmailSearchQaService } from "../src/hermes/search-qa";

describe("Hermes email search QA service", () => {
  it("answers over Postgres-backed mail search results with memory and audit trail", async () => {
    const providerCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const mailSearchCalls: unknown[] = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createHermesEmailSearchQaService({
      createId: () => ids.shift() ?? "unexpected",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return "Lina's launch email needs a reply today.";
        },
      },
      mailReadStore: {
        async listMessages(input) {
          mailSearchCalls.push(input);
          return {
            items: [
              {
                id: "00000000-0000-0000-0000-000000000101",
                accountId: "00000000-0000-0000-0000-000000000001",
                subject: "Launch schedule confirmation",
                from: { email: "lina@example.com", name: "Lina" },
                receivedAt: "2026-06-12T09:58:00.000Z",
                snippet: "Can you confirm the launch schedule today?",
                searchPreview:
                  {
                    source: "indexed_text",
                    text: "Attached launch brief says confirmation is needed today.",
                  },
                unread: true,
                starred: false,
                mailboxIds: ["00000000-0000-0000-0000-000000000201"],
                attachmentCount: 1,
                classification: {
                  bucket: "P2 Important",
                  priorityScore: 82,
                  reasons: ["directly addressed", "project tag"],
                },
              },
            ],
          };
        },
        async listMailboxes() {
          throw new Error("not used");
        },
        async getMessage() {
          throw new Error("not used");
        },
        async getAttachmentDownload() {
          throw new Error("not used");
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
                content: { summary: "Lina is a customer contact." },
                confidence: 0.85,
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

    const result = await service.searchMail({
      accountId: "00000000-0000-0000-0000-000000000001",
      mailboxId: "00000000-0000-0000-0000-000000000201",
      question: "Which launch emails need my reply?",
      searchQuery: "launch reply",
      language: "English",
      limit: 3,
      readMessageIds: ["00000000-0000-0000-0000-000000000099"],
      memoryIds: ["00000000-0000-0000-0000-000000000098"],
      memoryScope: "global",
      memoryLayers: ["contact_memory"],
    });

    expect(mailSearchCalls).toEqual([
      {
        accountId: "00000000-0000-0000-0000-000000000001",
        mailboxId: "00000000-0000-0000-0000-000000000201",
        q: "launch reply",
        limit: 3,
        sort: "smart",
      },
    ]);
    expect(memoryQueries).toEqual([
      { layer: "contact_memory", scope: "global", limit: 6 },
    ]);
    expect(providerCalls[0].systemPrompt).toContain(
      "answer questions about email search results",
    );
    expect(providerCalls[0].userPrompt).toContain("Relevant user memory:");
    expect(providerCalls[0].userPrompt).toContain(
      "[contact_memory/global confidence=0.85] Lina is a customer contact.",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Search question: Which launch emails need my reply?",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "Launch schedule confirmation",
    );
    expect(providerCalls[0].userPrompt).toContain(
      "searchPreview=Attached launch brief says confirmation is needed today.",
    );
    expect(providerCalls[0].userPrompt).toContain("P2 Important score=82");
    expect(result).toEqual({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      skillId: "email_search_qa",
      answerText: "Lina's launch email needs a reply today.",
      searchQuery: "launch reply",
      citations: [
        {
          resultIndex: 1,
          messageId: "00000000-0000-0000-0000-000000000101",
          accountId: "00000000-0000-0000-0000-000000000001",
          subject: "Launch schedule confirmation",
          from: { email: "lina@example.com", name: "Lina" },
          receivedAt: "2026-06-12T09:58:00.000Z",
          snippet: "Can you confirm the launch schedule today?",
          searchPreview: {
            source: "indexed_text",
            text: "Attached launch brief says confirmation is needed today.",
          },
          bucket: "P2 Important",
          reasons: ["directly addressed", "project tag"],
        },
      ],
      matches: [
        {
          id: "00000000-0000-0000-0000-000000000101",
          accountId: "00000000-0000-0000-0000-000000000001",
          subject: "Launch schedule confirmation",
          from: { email: "lina@example.com", name: "Lina" },
          receivedAt: "2026-06-12T09:58:00.000Z",
          snippet: "Can you confirm the launch schedule today?",
          searchPreview: {
            source: "indexed_text",
            text: "Attached launch brief says confirmation is needed today.",
          },
          classification: {
            bucket: "P2 Important",
            priorityScore: 82,
            reasons: ["directly addressed", "project tag"],
          },
        },
      ],
    });
    expect(persisted).toEqual([
      {
        run: {
          id: "run_1",
          skillId: "email_search_qa",
          skillTitle: "Search mail with Hermes",
          input: {
            accountId: "00000000-0000-0000-0000-000000000001",
            mailboxId: "00000000-0000-0000-0000-000000000201",
            question: "Which launch emails need my reply?",
            searchQuery: "launch reply",
            language: "English",
            limit: 3,
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
          output: {
            answerText: "Lina's launch email needs a reply today.",
            searchQuery: "launch reply",
            matchIds: ["00000000-0000-0000-0000-000000000101"],
            citations: [
              {
                resultIndex: 1,
                messageId: "00000000-0000-0000-0000-000000000101",
                accountId: "00000000-0000-0000-0000-000000000001",
                subject: "Launch schedule confirmation",
                from: { email: "lina@example.com", name: "Lina" },
                receivedAt: "2026-06-12T09:58:00.000Z",
                snippet: "Can you confirm the launch schedule today?",
                searchPreview: {
                  source: "indexed_text",
                  text: "Attached launch brief says confirmation is needed today.",
                },
                bucket: "P2 Important",
                reasons: ["directly addressed", "project tag"],
              },
            ],
          },
        },
        auditEvent: {
          id: "audit_1",
          eventType: "hermes.skill.email_search_qa",
          skillRunId: "run_1",
          readMessageIds: [
            "00000000-0000-0000-0000-000000000099",
            "00000000-0000-0000-0000-000000000101",
          ],
          memoryIds: [
            "00000000-0000-0000-0000-000000000098",
            "00000000-0000-0000-0000-000000000011",
          ],
          action: {
            skillId: "email_search_qa",
            accountId: "00000000-0000-0000-0000-000000000001",
            mailboxId: "00000000-0000-0000-0000-000000000201",
            searchQuery: "launch reply",
            language: "English",
            limit: 3,
          },
        },
      },
    ]);
  });

  it("returns an empty citation list when no local messages match", async () => {
    const providerCalls: unknown[] = [];
    const service = createHermesEmailSearchQaService({
      createId: () => "run_empty",
      textProvider: {
        async complete(input) {
          providerCalls.push(input);
          return "should not be used";
        },
      },
      mailReadStore: {
        async listMessages() {
          return { items: [] };
        },
        async listMailboxes() {
          throw new Error("not used");
        },
        async getMessage() {
          throw new Error("not used");
        },
        async getAttachmentDownload() {
          throw new Error("not used");
        },
      },
    });

    await expect(
      service.searchMail({
        accountId: "00000000-0000-0000-0000-000000000001",
        question: "Where is the missing contract?",
      }),
    ).resolves.toMatchObject({
      skillRunId: "run_empty",
      skillId: "email_search_qa",
      answerText: "No matching emails found.",
      citations: [],
      matches: [],
    });
    expect(providerCalls).toEqual([]);
  });

  it("rejects empty questions before searching mail or calling Hermes", async () => {
    const service = createHermesEmailSearchQaService({
      createId: () => "run_1",
      textProvider: {
        async complete() {
          throw new Error("should not call Hermes without a question");
        },
      },
      mailReadStore: {
        async listMessages() {
          throw new Error("should not search mail without a question");
        },
        async listMailboxes() {
          throw new Error("not used");
        },
        async getMessage() {
          throw new Error("not used");
        },
        async getAttachmentDownload() {
          throw new Error("not used");
        },
      },
    });

    await expect(
      service.searchMail({
        accountId: "00000000-0000-0000-0000-000000000001",
        question: " ",
      }),
    ).rejects.toThrow("question is required");
  });
});
