import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";

let server: Server | undefined;

async function withApi(
  test: (baseUrl: string) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  server = createServer(
    createApiHandler({
      apiName: "email-hub-api",
      emailEngineUrl: "http://emailengine:3000",
      emailEngineWebhookSecret: "webhook-secret",
      ...overrides,
    } as any),
  );

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }

  await test(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe("Hermes routes", () => {
  it("lists built-in Hermes skills including translation", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/skills`);

      expect(response.status).toBe(200);
      const skills = await response.json();
      expect(skills.map((skill: { id: string }) => skill.id)).toEqual(
        expect.arrayContaining(["translate_text", "email_search_qa"]),
      );
    });
  });

  it("lists Hermes audit events with account, skill, message, and memory filters", async () => {
    const calls: unknown[] = [];
    const hermesAuditLogService = {
      async listAuditEvents(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "audit_1",
              eventType: "hermes.skill.email_search_qa",
              skillRunId: "run_1",
              skillId: "email_search_qa",
              skillTitle: "自然语言查邮件",
              readMessageIds: ["message_1"],
              memoryIds: ["memory_1"],
              action: { skillId: "email_search_qa", operation: "search" },
              input: { accountId: "account_1", question: "合同" },
              output: { answerText: "找到 1 封" },
              createdAt: "2026-06-14T08:00:00.000Z",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/audit-log?accountId=account_1&skillId=email_search_qa&messageId=message_1&memoryId=memory_1&limit=25`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              id: "audit_1",
              eventType: "hermes.skill.email_search_qa",
              skillRunId: "run_1",
              skillId: "email_search_qa",
              skillTitle: "自然语言查邮件",
              readMessageIds: ["message_1"],
              memoryIds: ["memory_1"],
              action: { skillId: "email_search_qa", operation: "search" },
              input: { accountId: "account_1", question: "合同" },
              output: { answerText: "找到 1 封" },
              createdAt: "2026-06-14T08:00:00.000Z",
            },
          ],
        });
        expect(calls).toEqual([
          {
            accountId: "account_1",
            skillId: "email_search_qa",
            messageId: "message_1",
            memoryId: "memory_1",
            limit: 25,
          },
        ]);
      },
      { hermesAuditLogService },
    );
  });

  it("returns a clear error when Hermes audit logs are not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/audit-log`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_audit_log_unavailable",
      });
    });
  });

  it("rejects invalid Hermes audit log query limits", async () => {
    const hermesAuditLogService = {
      async listAuditEvents() {
        throw new Error("service should not be called");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/audit-log?limit=0`);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_audit_log_request",
        });
      },
      { hermesAuditLogService },
    );
  });

  it("runs the translate_text skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_1",
          skillId: "translate_text",
          sourceLanguage: "English",
          targetLanguage: "Chinese",
          translatedText: "你好",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/translate_text/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: "Hello",
              sourceLanguage: "English",
              targetLanguage: "Chinese",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["writing_style_profile", "contact_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_1",
          skillId: "translate_text",
          sourceLanguage: "English",
          targetLanguage: "Chinese",
          translatedText: "你好",
        });
        expect(calls).toEqual([
          {
            text: "Hello",
            sourceLanguage: "English",
            targetLanguage: "Chinese",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["writing_style_profile", "contact_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("rejects invalid translate_text requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const invalidBodies = [
          {
            text: "Hello",
          },
          {
            text: " ",
            targetLanguage: "Chinese",
          },
          {
            text: "Hello",
            targetLanguage: "Chinese",
            memoryLayers: ["contact_memory", " "],
          },
        ];

        for (const body of invalidBodies) {
          const response = await fetch(
            `${baseUrl}/api/hermes/skills/translate_text/run`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_translation_request",
          });
        }
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("translates a selected account message through the message-scoped Hermes route", async () => {
    const calls: unknown[] = [];
    const hermesMessageTranslationService = {
      async translateMessage(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_message_translate_1",
          auditEventId: "audit_message_translate_1",
          skillId: "translate_text",
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "auto",
          targetLanguage: "Chinese",
          translatedText: "你好",
          cached: false,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/translate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              targetLanguage: "Chinese",
              tone: "preserve original meaning",
              memoryScope: "sender:client@example.com",
              memoryLayers: ["contact_memory", "procedural_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_message_translate_1",
          auditEventId: "audit_message_translate_1",
          skillId: "translate_text",
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "auto",
          targetLanguage: "Chinese",
          translatedText: "你好",
          cached: false,
        });
      },
      { hermesMessageTranslationService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        targetLanguage: "Chinese",
        tone: "preserve original meaning",
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory", "procedural_memory"],
      },
    ]);
  });

  it("returns cached message translations with a 200 response", async () => {
    const hermesMessageTranslationService = {
      async translateMessage() {
        return {
          skillRunId: "run_cached",
          skillId: "translate_text",
          accountId: "account_1",
          messageId: "message_1",
          sourceLanguage: "auto",
          targetLanguage: "Chinese",
          translatedText: "你好",
          cached: true,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/translate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetLanguage: "Chinese" }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          skillRunId: "run_cached",
          cached: true,
        });
      },
      { hermesMessageTranslationService },
    );
  });

  it("returns 404 when message-scoped Hermes translation cannot read the message", async () => {
    const hermesMessageTranslationService = {
      async translateMessage() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/missing/translate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetLanguage: "Chinese" }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "message_not_found" });
      },
      { hermesMessageTranslationService },
    );
  });

  it("rejects invalid message-scoped translation requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesMessageTranslationService = {
      async translateMessage(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/translate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              targetLanguage: " ",
              forceRefresh: "yes",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_message_translation_request",
        });
      },
      { hermesMessageTranslationService },
    );

    expect(calls).toEqual([]);
  });

  it("returns 503 when message-scoped Hermes translation is not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/messages/message_1/translate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetLanguage: "Chinese" }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_message_translation_unavailable",
      });
    });
  });

  it("summarizes a selected account message through the message-scoped Hermes route", async () => {
    const calls: unknown[] = [];
    const hermesMessageSummaryService = {
      async summarizeMessage(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_message_summary_1",
          auditEventId: "audit_message_summary_1",
          skillId: "thread_summarize",
          accountId: "account_1",
          messageId: "message_1",
          mode: "action_points",
          summaryText: "需要今天回复。",
          cached: false,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/summary`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "action_points",
              focus: "decisions and reply needs",
              language: "zh-CN",
              memoryScope: "global",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_message_summary_1",
          auditEventId: "audit_message_summary_1",
          skillId: "thread_summarize",
          accountId: "account_1",
          messageId: "message_1",
          mode: "action_points",
          summaryText: "需要今天回复。",
          cached: false,
        });
      },
      { hermesMessageSummaryService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        mode: "action_points",
        focus: "decisions and reply needs",
        language: "zh-CN",
        memoryScope: "global",
      },
    ]);
  });

  it("returns cached message summaries with a 200 response", async () => {
    const hermesMessageSummaryService = {
      async summarizeMessage() {
        return {
          skillRunId: "run_cached",
          skillId: "thread_summarize",
          accountId: "account_1",
          messageId: "message_1",
          mode: "short",
          summaryText: "Reply today.",
          cached: true,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/summary`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "short" }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          skillRunId: "run_cached",
          cached: true,
        });
      },
      { hermesMessageSummaryService },
    );
  });

  it("returns 404 when message-scoped Hermes summary cannot read the message", async () => {
    const hermesMessageSummaryService = {
      async summarizeMessage() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/missing/summary`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "short" }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "message_not_found" });
      },
      { hermesMessageSummaryService },
    );
  });

  it("rejects invalid message-scoped summary requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesMessageSummaryService = {
      async summarizeMessage(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/summary`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "everything",
              forceRefresh: "yes",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_message_summary_request",
        });
      },
      { hermesMessageSummaryService },
    );

    expect(calls).toEqual([]);
  });

  it("returns 503 when message-scoped Hermes summary is not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/messages/message_1/summary`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "short" }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_message_summary_unavailable",
      });
    });
  });

  it("drafts a reply for a selected account message through the message-scoped route", async () => {
    const calls: unknown[] = [];
    const hermesMessageReplyService = {
      async draftMessageReply(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_message_reply_1",
          auditEventId: "audit_message_reply_1",
          skillId: "reply_draft",
          accountId: "account_1",
          messageId: "message_1",
          draftText: "Hi,\n\nI can confirm this today.",
        };
      },
      async quickMessageReply() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/reply-draft`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              instruction: "Confirm politely.",
              tone: "warm professional",
              language: "English",
              memoryIds: ["memory_1"],
              memoryScope: "sender:client@example.com",
              memoryLayers: ["writing_style_profile"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_message_reply_1",
          auditEventId: "audit_message_reply_1",
          skillId: "reply_draft",
          accountId: "account_1",
          messageId: "message_1",
          draftText: "Hi,\n\nI can confirm this today.",
        });
      },
      { hermesMessageReplyService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        instruction: "Confirm politely.",
        tone: "warm professional",
        language: "English",
        memoryIds: ["memory_1"],
        memoryScope: "sender:client@example.com",
        memoryLayers: ["writing_style_profile"],
      },
    ]);
  });

  it("quick replies to a selected account message through the message-scoped route", async () => {
    const calls: unknown[] = [];
    const hermesMessageReplyService = {
      async draftMessageReply() {
        throw new Error("not used");
      },
      async quickMessageReply(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_message_quick_1",
          skillId: "quick_reply",
          accountId: "account_1",
          messageId: "message_1",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/quick-reply`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scenario: "thanks",
              instruction: "Thank them briefly.",
              tone: "warm professional",
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_message_quick_1",
          skillId: "quick_reply",
          accountId: "account_1",
          messageId: "message_1",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        });
      },
      { hermesMessageReplyService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        scenario: "thanks",
        instruction: "Thank them briefly.",
        tone: "warm professional",
      },
    ]);
  });

  it("returns 404 when message-scoped Hermes reply cannot read the message", async () => {
    const hermesMessageReplyService = {
      async draftMessageReply() {
        return undefined;
      },
      async quickMessageReply() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/missing/reply-draft`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ instruction: "Reply politely." }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "message_not_found" });
      },
      { hermesMessageReplyService },
    );
  });

  it("rejects message-scoped reply requests that provide client-side mail text", async () => {
    const calls: unknown[] = [];
    const hermesMessageReplyService = {
      async draftMessageReply(input: unknown) {
        calls.push(input);
        return undefined;
      },
      async quickMessageReply() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/reply-draft`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              threadText: "Client supplied body must be rejected.",
              readMessageIds: ["message_1"],
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_message_reply_request",
        });
      },
      { hermesMessageReplyService },
    );

    expect(calls).toEqual([]);
  });

  it("rejects invalid message-scoped quick reply scenarios", async () => {
    const hermesMessageReplyService = {
      async draftMessageReply() {
        throw new Error("not used");
      },
      async quickMessageReply() {
        throw new Error("invalid request should not hit Hermes");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/quick-reply`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scenario: "send_now" }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_message_reply_request",
        });
      },
      { hermesMessageReplyService },
    );
  });

  it("returns 503 when message-scoped Hermes replies are not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/messages/message_1/reply-draft`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction: "Reply politely." }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_message_reply_unavailable",
      });
    });
  });

  it("confirms an explicit Hermes translation preference", async () => {
    const calls: unknown[] = [];
    const hermesTranslationPreferenceService = {
      async confirmTranslationPreference(input: unknown) {
        calls.push(input);
        return {
          memory: {
            id: "00000000-0000-0000-0000-000000000010",
            layer: "procedural_memory",
            scope: "global",
            content: {
              source: "translation_preference",
              mode: "always",
              sourceLanguage: "English",
              targetLanguage: "Chinese",
              preference:
                "When translating English emails, prefer Chinese as the target language.",
            },
            confidence: 0.92,
            createdAt: "2026-06-13T09:00:00.000Z",
            updatedAt: "2026-06-13T09:00:00.000Z",
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/translation-preferences`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "always",
              sourceLanguage: "English",
              targetLanguage: "Chinese",
              reason: "User clicked always translate.",
            }),
          },
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({
          memory: {
            layer: "procedural_memory",
            content: {
              source: "translation_preference",
              mode: "always",
              sourceLanguage: "English",
              targetLanguage: "Chinese",
            },
          },
        });
        expect(calls).toEqual([
          {
            mode: "always",
            sourceLanguage: "English",
            targetLanguage: "Chinese",
            reason: "User clicked always translate.",
          },
        ]);
      },
      { hermesTranslationPreferenceService },
    );
  });

  it("rejects invalid Hermes translation preference requests before storage", async () => {
    const calls: unknown[] = [];
    const hermesTranslationPreferenceService = {
      async confirmTranslationPreference(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/translation-preferences`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "always",
              sourceLanguage: "English",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_translation_preference_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesTranslationPreferenceService },
    );
  });

  it("runs the reply_draft skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_reply_1",
          skillId: "reply_draft",
          draftText: "Hi Lina,\n\nI will review this today.",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/reply_draft/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              instruction: "Confirm review today.",
              tone: "warm professional",
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["writing_style_profile"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_reply_1",
          skillId: "reply_draft",
          draftText: "Hi Lina,\n\nI will review this today.",
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            instruction: "Confirm review today.",
            tone: "warm professional",
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the quick_reply skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async quickReply(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_quick_1",
          skillId: "quick_reply",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/quick_reply/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              scenario: "thanks",
              instruction: "Acknowledge and say I will review.",
              tone: "warm professional",
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["writing_style_profile"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_quick_1",
          skillId: "quick_reply",
          scenario: "thanks",
          draftText: "Thanks, I will take a look.",
          editable: true,
          sendsDirectly: false,
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            scenario: "thanks",
            instruction: "Acknowledge and say I will review.",
            tone: "warm professional",
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the rewrite_polish skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async quickReply() {
        throw new Error("not used");
      },
      async rewritePolish(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_rewrite_1",
          skillId: "rewrite_polish",
          action: "shorten",
          rewrittenText: "Hi Lina, I will review this today.",
          editable: true,
          sendsDirectly: false,
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/rewrite_polish/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: "Hi Lina, I will review this in detail today and then get back to you.",
              action: "shorten",
              instruction: "Keep it direct.",
              tone: "warm professional",
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["writing_style_profile"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_rewrite_1",
          skillId: "rewrite_polish",
          action: "shorten",
          rewrittenText: "Hi Lina, I will review this today.",
          editable: true,
          sendsDirectly: false,
        });
        expect(calls).toEqual([
          {
            text: "Hi Lina, I will review this in detail today and then get back to you.",
            action: "shorten",
            instruction: "Keep it direct.",
            tone: "warm professional",
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["writing_style_profile"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the thread_summarize skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_summary_1",
          skillId: "thread_summarize",
          mode: "short",
          summaryText: "Decision: schedule needs confirmation.",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/thread_summarize/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              mode: "short",
              focus: "decisions",
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["contact_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_summary_1",
          skillId: "thread_summarize",
          mode: "short",
          summaryText: "Decision: schedule needs confirmation.",
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            mode: "short",
            focus: "decisions",
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the email_search_qa skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async searchMail(input: unknown) {
        calls.push(input);
        return {
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
              bucket: "P2 Important",
              reasons: ["directly addressed"],
            },
          ],
          matches: [],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
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
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
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
              bucket: "P2 Important",
              reasons: ["directly addressed"],
            },
          ],
          matches: [],
        });
        expect(calls).toEqual([
          {
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
          },
        ]);
      },
      { hermesService },
    );
  });

  it("returns a clear error when Hermes email_search_qa is not wired", async () => {
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "00000000-0000-0000-0000-000000000001",
              question: "Which launch emails need my reply?",
            }),
          },
        );

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: "hermes_search_unavailable",
        });
      },
      { hermesService },
    );
  });

  it("runs the action_item_extract skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_action_1",
          skillId: "action_item_extract",
          items: [
            {
              title: "Confirm launch schedule",
              owner: "me",
              dueAt: "2026-06-12T17:00:00.000Z",
              priority: "high",
              status: "open",
            },
          ],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/action_item_extract/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              language: "English",
              now: "2026-06-12T10:00:00.000Z",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["contact_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_action_1",
          skillId: "action_item_extract",
          items: [
            {
              title: "Confirm launch schedule",
              owner: "me",
              dueAt: "2026-06-12T17:00:00.000Z",
              priority: "high",
              status: "open",
            },
          ],
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            language: "English",
            now: "2026-06-12T10:00:00.000Z",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the label_suggest skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_label_1",
          skillId: "label_suggest",
          labels: [{ name: "客户", confidence: 0.86 }],
          actions: [{ type: "keep_in_inbox" }],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/label_suggest/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              senderEmail: "lina@example.com",
              currentLabels: ["工作"],
              availableLabels: ["工作", "客户"],
              language: "Chinese",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["procedural_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_label_1",
          skillId: "label_suggest",
          labels: [{ name: "客户", confidence: 0.86 }],
          actions: [{ type: "keep_in_inbox" }],
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            senderEmail: "lina@example.com",
            currentLabels: ["工作"],
            availableLabels: ["工作", "客户"],
            language: "Chinese",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["procedural_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the newsletter_cleanup skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels() {
        throw new Error("not used");
      },
      async cleanupNewsletter(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_newsletter_1",
          skillId: "newsletter_cleanup",
          isNewsletter: true,
          confidence: 0.91,
          senderCategory: "marketing",
          reasons: ["Contains unsubscribe link"],
          actions: [{ type: "move_to_feed", reason: "Marketing digest" }],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/newsletter_cleanup/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Weekly digest",
              threadText: "Sale, discount, unsubscribe",
              senderEmail: "news@example.com",
              listId: "weekly.example.com",
              currentBucket: "P4 FYI / Updates",
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryScope: "sender:news@example.com",
              memoryLayers: ["contact_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_newsletter_1",
          skillId: "newsletter_cleanup",
          isNewsletter: true,
          confidence: 0.91,
          senderCategory: "marketing",
          reasons: ["Contains unsubscribe link"],
          actions: [{ type: "move_to_feed", reason: "Marketing digest" }],
        });
        expect(calls).toEqual([
          {
            subject: "Weekly digest",
            threadText: "Sale, discount, unsubscribe",
            senderEmail: "news@example.com",
            listId: "weekly.example.com",
            currentBucket: "P4 FYI / Updates",
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryScope: "sender:news@example.com",
            memoryLayers: ["contact_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("runs the priority_triage skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels() {
        throw new Error("not used");
      },
      async triagePriority(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_priority_1",
          skillId: "priority_triage",
          priority: "high",
          bucket: "P1 Urgent",
          score: 91,
          reasons: ["needs reply today"],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/priority_triage/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              senderEmail: "lina@example.com",
              currentBucket: "P3 Needs Action",
              currentScore: 82,
              currentReasons: ["directly addressed"],
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["contact_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_priority_1",
          skillId: "priority_triage",
          priority: "high",
          bucket: "P1 Urgent",
          score: 91,
          reasons: ["needs reply today"],
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            senderEmail: "lina@example.com",
            currentBucket: "P3 Needs Action",
            currentScore: 82,
            currentReasons: ["directly addressed"],
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("rejects invalid priority_triage requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels() {
        throw new Error("not used");
      },
      async triagePriority(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/priority_triage/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_priority_triage_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("runs the followup_tracker skill through the Hermes service", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels() {
        throw new Error("not used");
      },
      async triagePriority() {
        throw new Error("not used");
      },
      async trackFollowup(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_followup_1",
          skillId: "followup_tracker",
          status: "needs_reply",
          followupNeeded: true,
          owner: "me",
          confidence: 0.88,
          reasons: ["customer asked for confirmation today"],
          nextAction: "Reply with the final launch schedule.",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/followup_tracker/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: "Can you confirm the launch schedule today?",
              userEmail: "me@example.com",
              participants: ["lina@example.com", "me@example.com"],
              now: "2026-06-13T09:00:00.000Z",
              language: "English",
              readMessageIds: ["00000000-0000-0000-0000-000000000001"],
              memoryIds: ["00000000-0000-0000-0000-000000000002"],
              memoryScope: "global",
              memoryLayers: ["contact_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_followup_1",
          skillId: "followup_tracker",
          status: "needs_reply",
          followupNeeded: true,
          owner: "me",
          confidence: 0.88,
          reasons: ["customer asked for confirmation today"],
          nextAction: "Reply with the final launch schedule.",
        });
        expect(calls).toEqual([
          {
            subject: "Re: launch schedule",
            threadText: "Can you confirm the launch schedule today?",
            userEmail: "me@example.com",
            participants: ["lina@example.com", "me@example.com"],
            now: "2026-06-13T09:00:00.000Z",
            language: "English",
            readMessageIds: ["00000000-0000-0000-0000-000000000001"],
            memoryIds: ["00000000-0000-0000-0000-000000000002"],
            memoryScope: "global",
            memoryLayers: ["contact_memory"],
          },
        ]);
      },
      { hermesService },
    );
  });

  it("rejects invalid followup_tracker requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels() {
        throw new Error("not used");
      },
      async triagePriority() {
        throw new Error("not used");
      },
      async trackFollowup(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/followup_tracker/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_followup_tracker_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("confirms a Hermes follow-up suggestion into a durable reminder", async () => {
    const calls: unknown[] = [];
    const hermesFollowUpReminderService = {
      async confirmFollowUpSuggestion(input: unknown) {
        calls.push(input);
        return {
          id: "fu_1",
          accountId: "acc_1",
          messageId: "msg_1",
          kind: "waiting_on_them",
          status: "open",
          dueAt: "2026-06-14T09:00:00.000Z",
          title: "Check whether Lina replied",
          note: "Hermes suggested this follow-up.",
          source: "hermes_followup",
          hermesSkillRunId: "run_followup_1",
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/follow-ups/confirm`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "acc_1",
              messageId: "msg_1",
              skillRunId: "run_followup_1",
              status: "waiting_on_them",
              dueAt: "2026-06-14T09:00:00.000Z",
              nextAction: "Check whether Lina replied",
              reasons: ["we asked for confirmation and no reply yet"],
              sourceQuote: "Please confirm the launch schedule.",
            }),
          },
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({
          id: "fu_1",
          source: "hermes_followup",
          hermesSkillRunId: "run_followup_1",
        });
        expect(calls).toEqual([
          {
            accountId: "acc_1",
            messageId: "msg_1",
            skillRunId: "run_followup_1",
            status: "waiting_on_them",
            dueAt: "2026-06-14T09:00:00.000Z",
            nextAction: "Check whether Lina replied",
            reasons: ["we asked for confirmation and no reply yet"],
            sourceQuote: "Please confirm the launch schedule.",
          },
        ]);
      },
      { hermesFollowUpReminderService },
    );
  });

  it("rejects invalid Hermes follow-up confirmation requests before creating reminders", async () => {
    const calls: unknown[] = [];
    const hermesFollowUpReminderService = {
      async confirmFollowUpSuggestion(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/follow-ups/confirm`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "acc_1",
              messageId: "msg_1",
              skillRunId: "run_followup_1",
              status: "no_followup",
              dueAt: "2026-06-14T09:00:00.000Z",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_follow_up_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesFollowUpReminderService },
    );
  });

  it("rejects invalid newsletter_cleanup requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async cleanupNewsletter(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/newsletter_cleanup/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Weekly digest",
              threadText: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_newsletter_cleanup_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid label_suggest requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems() {
        throw new Error("not used");
      },
      async suggestLabels(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/label_suggest/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_label_suggest_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid action_item_extract requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async extractActionItems(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/action_item_extract/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_action_item_extract_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid email_search_qa requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async searchMail(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "00000000-0000-0000-0000-000000000001",
              question: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_email_search_qa_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid email_search_qa limits before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread() {
        throw new Error("not used");
      },
      async searchMail(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/email_search_qa/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accountId: "00000000-0000-0000-0000-000000000001",
              question: "Which launch emails need my reply?",
              limit: 21,
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_email_search_qa_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid thread_summarize requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async summarizeThread(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const invalidBodies = [
          {
            subject: "Re: launch schedule",
            threadText: " ",
          },
          {
            threadText: "Can you confirm the launch schedule today?",
            mode: "verbose",
          },
          {
            threadText: "Can you confirm the launch schedule today?",
            readMessageIds: ["00000000-0000-0000-0000-000000000001", ""],
          },
        ];

        for (const body of invalidBodies) {
          const response = await fetch(
            `${baseUrl}/api/hermes/skills/thread_summarize/run`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_thread_summary_request",
          });
        }
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid reply_draft requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/reply_draft/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Re: launch schedule",
              threadText: " ",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_reply_draft_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("rejects invalid rewrite_polish requests before hitting Hermes", async () => {
    const calls: unknown[] = [];
    const hermesService = {
      async translate() {
        throw new Error("not used");
      },
      async draftReply() {
        throw new Error("not used");
      },
      async rewritePolish(input: unknown) {
        calls.push(input);
        return {};
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/skills/rewrite_polish/run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: "Draft body",
              action: "send_now",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_rewrite_polish_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesService },
    );
  });

  it("records reply draft feedback through the draft feedback store", async () => {
    const calls: unknown[] = [];
    const hermesDraftFeedbackStore = {
      async recordDraftFeedback(input: unknown) {
        calls.push(input);
        return {
          feedbackId: "feedback_1",
          skillRunId: "run_1",
          learned: true,
          memoryId: "memory_1",
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/drafts/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillRunId: "run_1",
            draftText: "Hi Lina,\n\nThanks for the details.",
            finalText: "Hi Lina,\n\nThanks.",
            subject: "Re: launch",
            recipientEmail: "lina@example.com",
          }),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          feedbackId: "feedback_1",
          skillRunId: "run_1",
          learned: true,
          memoryId: "memory_1",
        });
        expect(calls).toEqual([
          {
            skillRunId: "run_1",
            draftText: "Hi Lina,\n\nThanks for the details.",
            finalText: "Hi Lina,\n\nThanks.",
            subject: "Re: launch",
            recipientEmail: "lina@example.com",
          },
        ]);
      },
      { hermesDraftFeedbackStore },
    );
  });

  it("rejects invalid reply draft feedback before hitting the store", async () => {
    const calls: unknown[] = [];
    const hermesDraftFeedbackStore = {
      async recordDraftFeedback(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/drafts/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillRunId: "run_1",
            draftText: "",
            finalText: "Final",
          }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_draft_feedback_request",
        });
        expect(calls).toEqual([]);
      },
      { hermesDraftFeedbackStore },
    );
  });

  it("returns 404 when reply draft feedback references a missing run", async () => {
    const hermesDraftFeedbackStore = {
      async recordDraftFeedback() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/hermes/drafts/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skillRunId: "run_missing",
            draftText: "Draft",
            finalText: "Final",
          }),
        });

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "draft_run_not_found" });
      },
      { hermesDraftFeedbackStore },
    );
  });

  it("returns 503 when reply draft feedback storage is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/drafts/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skillRunId: "run_1",
          draftText: "Draft",
          finalText: "Final",
        }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_draft_feedback_unavailable",
      });
    });
  });

  it("lists Hermes memories through the memory store", async () => {
    const calls: unknown[] = [];
    const hermesMemoryStore = {
      async listMemories(input: unknown) {
        calls.push(input);
        return {
          items: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              layer: "semantic_profile",
              scope: "global",
              content: { preference: "short replies" },
              confidence: 0.75,
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
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/memories?layer=semantic_profile&scope=global&limit=25`,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          items: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              layer: "semantic_profile",
              scope: "global",
              content: { preference: "short replies" },
              confidence: 0.75,
              createdAt: "2026-06-12T09:00:00.000Z",
              updatedAt: "2026-06-12T10:00:00.000Z",
            },
          ],
        });
        expect(calls).toEqual([
          { layer: "semantic_profile", scope: "global", limit: 25 },
        ]);
      },
      { hermesMemoryStore },
    );
  });

  it("updates one Hermes memory", async () => {
    const calls: unknown[] = [];
    const hermesMemoryStore = {
      async listMemories() {
        throw new Error("not used");
      },
      async updateMemory(input: unknown) {
        calls.push(input);
        return {
          id: "00000000-0000-0000-0000-000000000001",
          layer: "semantic_profile",
          scope: "global",
          content: { preference: "concise replies" },
          confidence: 0.9,
          createdAt: "2026-06-12T09:00:00.000Z",
          updatedAt: "2026-06-12T11:00:00.000Z",
        };
      },
      async deleteMemory() {
        throw new Error("not used");
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/memories/00000000-0000-0000-0000-000000000001`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: { preference: "concise replies" },
              confidence: 0.9,
            }),
          },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: "00000000-0000-0000-0000-000000000001",
          content: { preference: "concise replies" },
          confidence: 0.9,
        });
        expect(calls).toEqual([
          {
            id: "00000000-0000-0000-0000-000000000001",
            content: { preference: "concise replies" },
            confidence: 0.9,
          },
        ]);
      },
      { hermesMemoryStore },
    );
  });

  it("deletes one Hermes memory", async () => {
    const calls: unknown[] = [];
    const hermesMemoryStore = {
      async listMemories() {
        throw new Error("not used");
      },
      async updateMemory() {
        throw new Error("not used");
      },
      async deleteMemory(input: unknown) {
        calls.push(input);
        return true;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/hermes/memories/00000000-0000-0000-0000-000000000001`,
          { method: "DELETE" },
        );

        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
        expect(calls).toEqual([
          { id: "00000000-0000-0000-0000-000000000001" },
        ]);
      },
      { hermesMemoryStore },
    );
  });

  it("rejects invalid Hermes memory requests before hitting the store", async () => {
    const calls: unknown[] = [];
    const hermesMemoryStore = {
      async listMemories(input: unknown) {
        calls.push(input);
        return { items: [] };
      },
      async updateMemory(input: unknown) {
        calls.push(input);
        return undefined;
      },
      async deleteMemory(input: unknown) {
        calls.push(input);
        return false;
      },
    };

    await withApi(
      async (baseUrl) => {
        const responses = await Promise.all([
          fetch(`${baseUrl}/api/hermes/memories?limit=0`),
          fetch(
            `${baseUrl}/api/hermes/memories/00000000-0000-0000-0000-000000000001`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ confidence: 2 }),
            },
          ),
          fetch(
            `${baseUrl}/api/hermes/memories/00000000-0000-0000-0000-000000000001`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ content: [] }),
            },
          ),
        ]);

        for (const response of responses) {
          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_hermes_memory_request",
          });
        }
        expect(calls).toEqual([]);
      },
      { hermesMemoryStore },
    );
  });

  it("returns 503 for Hermes memory routes when Postgres is unavailable", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/hermes/memories`);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_memory_unavailable",
      });
    });
  });
});
