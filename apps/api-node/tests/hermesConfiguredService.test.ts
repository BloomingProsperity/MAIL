import { describe, expect, it } from "vitest";

import { createConfiguredHermesTranslationService } from "../src/hermes/configured-service";

describe("configured Hermes translation service", () => {
  it("returns undefined until a Hermes chat endpoint is configured", () => {
    expect(createConfiguredHermesTranslationService({ env: {} })).toBeUndefined();
  });

  it("builds translation service from environment and optional run store", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const memoryQueries: unknown[] = [];
    const persisted: unknown[] = [];
    const ids = ["run_1", "audit_1"];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_API_KEY: "hermes-secret",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => ids.shift() ?? "unexpected",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [{ message: { content: "你好" } }],
        });
      },
      runStore: {
        async recordCompletedSkillRun(input) {
          persisted.push(input);
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
                content: { preference: "Prefer concise replies." },
                confidence: 0.92,
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
    });

    const result = await service?.translate({
      text: "Hello",
      targetLanguage: "Chinese",
      memoryScope: "global",
      memoryLayers: ["writing_style_profile"],
    });

    expect(result).toMatchObject({
      skillRunId: "run_1",
      auditEventId: "audit_1",
      translatedText: "你好",
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer hermes-secret",
    });
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[1].content,
    ).toContain("[writing_style_profile/global confidence=0.92]");
    expect(memoryQueries).toEqual([
      { layer: "writing_style_profile", scope: "global", limit: 6 },
    ]);
    expect(persisted).toHaveLength(1);
    expect((persisted[0] as any).auditEvent.memoryIds).toEqual([
      "00000000-0000-0000-0000-000000000011",
    ]);
  });

  it("builds reply draft support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_reply_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [{ message: { content: "Hi Lina,\n\nI will review this." } }],
        });
      },
    });

    const result = await service?.draftReply({
      subject: "Re: launch",
      threadText: "Can you review this today?",
      instruction: "Confirm review.",
    });

    expect(result).toEqual({
      skillRunId: "run_reply_1",
      skillId: "reply_draft",
      draftText: "Hi Lina,\n\nI will review this.",
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("Do not send");
  });

  it("builds quick reply support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_quick_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: "Thanks, I will take a look.",
              },
            },
          ],
        });
      },
    });

    const result = await service?.quickReply({
      subject: "Re: launch",
      threadText: "Can you review this today?",
      scenario: "thanks",
      instruction: "Acknowledge and say I will review.",
    });

    expect(result).toEqual({
      skillRunId: "run_quick_1",
      skillId: "quick_reply",
      scenario: "thanks",
      draftText: "Thanks, I will take a look.",
      editable: true,
      sendsDirectly: false,
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.messages[0].content).toContain("quick email reply");
    expect(body.messages[0].content).toContain("Do not send");
    expect(body.messages[1].content).toContain("Scenario: thanks");
  });

  it("builds rewrite polish support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_rewrite_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: "Hi Lina, I will review this today.",
              },
            },
          ],
        });
      },
    });

    const result = await service?.rewritePolish({
      text: "Hi Lina, I will review this in detail today and then get back to you.",
      action: "shorten",
      instruction: "Keep it direct.",
      tone: "warm professional",
      language: "English",
    });

    expect(result).toEqual({
      skillRunId: "run_rewrite_1",
      skillId: "rewrite_polish",
      action: "shorten",
      rewrittenText: "Hi Lina, I will review this today.",
      editable: true,
      sendsDirectly: false,
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.messages[0].content).toContain("Rewrite or polish");
    expect(body.messages[0].content).toContain("Do not send");
    expect(body.messages[1].content).toContain("Action: shorten");
    expect(body.messages[1].content).toContain("Original draft:");
  });

  it("builds thread summary support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_summary_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: "Decision: schedule needs confirmation.",
              },
            },
          ],
        });
      },
    });

    const result = await service?.summarizeThread({
      subject: "Re: launch",
      threadText: "Can you review this today?",
      mode: "short",
      focus: "decisions",
    });

    expect(result).toEqual({
      skillRunId: "run_summary_1",
      skillId: "thread_summarize",
      mode: "short",
      summaryText: "Decision: schedule needs confirmation.",
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("summarize email threads");
  });

  it("builds email search QA support from the same Hermes endpoint and mail store", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mailSearchCalls: unknown[] = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_search_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: "Lina's launch email needs a reply.",
              },
            },
          ],
        });
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
                from: { email: "lina@example.com" },
                receivedAt: "2026-06-12T09:58:00.000Z",
                snippet: "Can you confirm the launch schedule today?",
                unread: true,
                starred: false,
                mailboxIds: [],
                attachmentCount: 0,
                classification: {
                  bucket: "P2 Important",
                  priorityScore: 82,
                  reasons: ["directly addressed"],
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
    });

    const result = await service?.searchMail({
      accountId: "00000000-0000-0000-0000-000000000001",
      question: "Which launch emails need a reply?",
      searchQuery: "launch reply",
    });

    expect(result).toMatchObject({
      skillRunId: "run_search_1",
      skillId: "email_search_qa",
      answerText: "Lina's launch email needs a reply.",
      searchQuery: "launch reply",
      citations: [
        {
          resultIndex: 1,
          messageId: "00000000-0000-0000-0000-000000000101",
          accountId: "00000000-0000-0000-0000-000000000001",
          subject: "Launch schedule confirmation",
          from: { email: "lina@example.com" },
          receivedAt: "2026-06-12T09:58:00.000Z",
          snippet: "Can you confirm the launch schedule today?",
          bucket: "P2 Important",
          reasons: ["directly addressed"],
        },
      ],
    });
    expect(mailSearchCalls).toEqual([
      {
        accountId: "00000000-0000-0000-0000-000000000001",
        q: "launch reply",
        limit: 5,
        sort: "smart",
      },
    ]);
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("answer questions about email search results");
  });

  it("builds action item extraction support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_action_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    title: "Confirm launch schedule",
                    owner: "me",
                    priority: "high",
                    status: "open",
                  },
                ]),
              },
            },
          ],
        });
      },
    });

    const result = await service?.extractActionItems({
      subject: "Re: launch",
      threadText: "Can you confirm the launch schedule today?",
    });

    expect(result).toEqual({
      skillRunId: "run_action_1",
      skillId: "action_item_extract",
      items: [
        {
          title: "Confirm launch schedule",
          owner: "me",
          priority: "high",
          status: "open",
        },
      ],
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("extract action items");
  });

  it("builds label suggestion support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_label_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  labels: [{ name: "客户", confidence: 0.86 }],
                  actions: [{ type: "keep_in_inbox" }],
                }),
              },
            },
          ],
        });
      },
    });

    const result = await service?.suggestLabels({
      subject: "Re: launch",
      threadText: "Can you confirm the launch schedule today?",
      availableLabels: ["工作", "客户"],
    });

    expect(result).toEqual({
      skillRunId: "run_label_1",
      skillId: "label_suggest",
      labels: [{ name: "客户", confidence: 0.86 }],
      actions: [{ type: "keep_in_inbox" }],
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("suggest labels");
  });

  it("builds priority triage support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_priority_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  priority: "high",
                  bucket: "P1 Urgent",
                  score: 91,
                  reasons: ["needs reply today"],
                }),
              },
            },
          ],
        });
      },
    });

    const result = await service?.triagePriority({
      subject: "Re: launch",
      threadText: "Can you confirm the launch schedule today?",
      currentBucket: "P3 Needs Action",
      currentScore: 82,
    });

    expect(result).toEqual({
      skillRunId: "run_priority_1",
      skillId: "priority_triage",
      priority: "high",
      bucket: "P1 Urgent",
      score: 91,
      reasons: ["needs reply today"],
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("triage email priority");
  });

  it("builds follow-up tracker support from the same Hermes endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const service = createConfiguredHermesTranslationService({
      env: {
        HERMES_CHAT_COMPLETIONS_URL: "http://hermes:8081/v1/chat/completions",
        HERMES_MODEL: "hermes-email",
      },
      createId: () => "run_followup_1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "waiting_on_them",
                  followupNeeded: true,
                  owner: "them",
                  confidence: 0.83,
                  reasons: ["we asked for confirmation and no reply yet"],
                  nextAction: "Follow up tomorrow morning.",
                }),
              },
            },
          ],
        });
      },
    });

    const result = await service?.trackFollowup({
      subject: "Re: launch",
      threadText: "Me: Please confirm the launch schedule.",
      userEmail: "me@example.com",
      participants: ["me@example.com", "lina@example.com"],
    });

    expect(result).toEqual({
      skillRunId: "run_followup_1",
      skillId: "followup_tracker",
      status: "waiting_on_them",
      followupNeeded: true,
      owner: "them",
      confidence: 0.83,
      reasons: ["we asked for confirmation and no reply yet"],
      nextAction: "Follow up tomorrow morning.",
    });
    expect(calls[0].url).toBe("http://hermes:8081/v1/chat/completions");
    expect(
      JSON.parse(String(calls[0].init?.body)).messages[0].content,
    ).toContain("track follow-up state");
  });
});
