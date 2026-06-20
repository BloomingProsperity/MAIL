import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApiHandler } from "../src/http/router";
import { HermesRuntimeNotConfiguredError } from "../src/hermes/runtime-config";
import { createHermesSkillSettingsService } from "../src/hermes/skill-settings";
import type { HermesSkillSettings } from "../src/hermes/skills";

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

describe("Hermes message routes", () => {
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
              sourceLanguage: "English",
              tone: "preserve original meaning",
              memoryIds: ["memory_translation_1"],
              memoryScope: "sender:client@example.com",
              memoryLayers: ["contact_memory", "procedural_memory"],
              forceRefresh: true,
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
        sourceLanguage: "English",
        tone: "preserve original meaning",
        memoryIds: ["memory_translation_1"],
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory", "procedural_memory"],
        forceRefresh: true,
      },
    ]);
  });

  it("passes editable Hermes skill context and memory budgets to message-scoped routes", async () => {
    const calls: unknown[] = [];
    const hermesSkillSettingsService = {
      async listSkills() {
        throw new Error("not used");
      },
      async updateSkillSettings() {
        throw new Error("not used");
      },
      async getSkill(skillId: string) {
        expect(skillId).toBe("translate_text");
        return {
          id: "translate_text",
          title: "翻译邮件",
          mode: "read",
          description: "翻译邮件正文",
          settings: {
            enabled: true,
            maxContextChars: 12000,
            memoryLimit: 3,
            allowBodyRead: true,
            allowMemoryWrite: false,
            requireConfirmation: false,
            customInstructions: "Use formal Chinese.",
          },
          settingBounds: {
            maxContextChars: { min: 1000, max: 200000, step: 1000 },
            memoryLimit: { min: 0, max: 50, step: 1 },
            customInstructions: { maxLength: 2000 },
          },
        };
      },
    };
    const hermesMessageTranslationService = {
      async translateMessage(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_message_translate_1",
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
            body: JSON.stringify({ targetLanguage: "Chinese" }),
          },
        );

        expect(response.status).toBe(202);
      },
      { hermesMessageTranslationService, hermesSkillSettingsService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        targetLanguage: "Chinese",
        maxContextChars: 12000,
        memoryLimit: 3,
        customInstructions: "Use formal Chinese.",
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

  it("blocks message translation body reads when the skill disallows them", async () => {
    const hermesSkillSettingsService = {
      async listSkills() {
        throw new Error("not used");
      },
      async updateSkillSettings() {
        throw new Error("not used");
      },
      async getSkill(skillId: string) {
        return {
          id: skillId,
          title: "翻译邮件",
          mode: "read",
          description: "翻译邮件正文",
          settings: {
            enabled: true,
            maxContextChars: 24000,
            memoryLimit: 6,
            allowBodyRead: false,
            allowMemoryWrite: false,
            requireConfirmation: false,
          },
          settingBounds: {
            maxContextChars: { min: 1000, max: 200000, step: 1000 },
            memoryLimit: { min: 0, max: 50, step: 1 },
          },
        };
      },
    };
    const hermesMessageTranslationService = {
      async translateMessage() {
        throw new Error("translation should not run without body read access");
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

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: "hermes_skill_disabled",
          skillId: "translate_text",
          requiredPermission: "body_read",
        });
      },
      { hermesMessageTranslationService, hermesSkillSettingsService },
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

  it("rejects message-scoped translation requests that supply client message text", async () => {
    const calls: unknown[] = [];
    const hermesMessageTranslationService = {
      async translateMessage(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        for (const payload of [
          { targetLanguage: "Chinese", text: "client supplied text" },
          { targetLanguage: "Chinese", bodyText: "client supplied body" },
          { targetLanguage: "Chinese", bodyHtml: "<p>client body</p>" },
          { targetLanguage: "Chinese", subject: "client subject" },
          { targetLanguage: "Chinese", threadText: "client thread" },
          { targetLanguage: "Chinese", readMessageIds: ["message_1"] },
        ]) {
          const response = await fetch(
            `${baseUrl}/api/accounts/account_1/messages/message_1/translate`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            },
          );

          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: "invalid_hermes_message_translation_request",
          });
        }
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

  it("organizes a selected account message through the message-scoped route", async () => {
    const calls: unknown[] = [];
    const hermesMessageOrganizationService = {
      async organizeMessage(input: unknown) {
        calls.push(input);
        return {
          accountId: "account_1",
          messageId: "message_1",
          priority: {
            skillRunId: "run_priority_1",
            skillId: "priority_triage",
            priority: "high",
            bucket: "P1 Urgent",
            score: 94,
            reasons: ["deadline today"],
          },
          labels: {
            skillRunId: "run_labels_1",
            skillId: "label_suggest",
            labels: [{ name: "客户", confidence: 0.91 }],
            actions: [{ type: "apply_label", label: "客户" }],
          },
          newsletter: {
            skillRunId: "run_newsletter_1",
            skillId: "newsletter_cleanup",
            isNewsletter: false,
            confidence: 0.88,
            senderCategory: "personal",
            reasons: ["direct conversation"],
            actions: [{ type: "keep_in_inbox" }],
          },
          actionItems: {
            skillRunId: "run_actions_1",
            skillId: "action_item_extract",
            items: [{ title: "Confirm launch schedule", owner: "me" }],
          },
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/organize`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              language: "zh-CN",
              memoryScope: "sender:client@example.com",
              memoryLayers: ["contact_memory", "semantic_profile"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({
          accountId: "account_1",
          messageId: "message_1",
          priority: { skillRunId: "run_priority_1" },
          labels: { skillRunId: "run_labels_1" },
          newsletter: { skillRunId: "run_newsletter_1" },
          actionItems: { skillRunId: "run_actions_1" },
        });
      },
      { hermesMessageOrganizationService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        language: "zh-CN",
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory", "semantic_profile"],
      },
    ]);
  });

  it("rejects message-scoped organization requests that provide client-side mail context", async () => {
    const calls: unknown[] = [];
    const hermesMessageOrganizationService = {
      async organizeMessage(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/organize`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              threadText: "Client supplied body must be rejected.",
              availableLabels: ["客户"],
              currentBucket: "P1 Urgent",
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_message_organization_request",
        });
      },
      { hermesMessageOrganizationService },
    );

    expect(calls).toEqual([]);
  });

  it("returns 404 when message-scoped Hermes organization cannot read the message", async () => {
    const hermesMessageOrganizationService = {
      async organizeMessage() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/missing/organize`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: "zh-CN" }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "message_not_found" });
      },
      { hermesMessageOrganizationService },
    );
  });

  it("returns 503 when message-scoped Hermes organization is not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/messages/message_1/organize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language: "zh-CN" }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_message_organization_unavailable",
      });
    });
  });

  it("tracks follow-up for a selected account message through the message-scoped route", async () => {
    const calls: unknown[] = [];
    const hermesMessageFollowupTrackerService = {
      async trackMessageFollowup(input: unknown) {
        calls.push(input);
        return {
          skillRunId: "run_message_followup_1",
          skillId: "followup_tracker",
          accountId: "account_1",
          messageId: "message_1",
          status: "waiting_on_them",
          followupNeeded: true,
          owner: "them",
          confidence: 0.88,
          dueAt: "2026-06-17T09:00:00.000Z",
          nextAction: "Check whether Lina replied",
          reasons: ["we asked for confirmation and no reply yet"],
        };
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/followup-track`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              language: "zh-CN",
              memoryScope: "sender:client@example.com",
              memoryLayers: ["contact_memory", "procedural_memory"],
            }),
          },
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({
          skillRunId: "run_message_followup_1",
          skillId: "followup_tracker",
          accountId: "account_1",
          messageId: "message_1",
          status: "waiting_on_them",
          followupNeeded: true,
          owner: "them",
          confidence: 0.88,
          dueAt: "2026-06-17T09:00:00.000Z",
          nextAction: "Check whether Lina replied",
          reasons: ["we asked for confirmation and no reply yet"],
        });
      },
      { hermesMessageFollowupTrackerService },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        language: "zh-CN",
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory", "procedural_memory"],
      },
    ]);
  });

  it("rejects message-scoped follow-up requests that provide client-side mail context", async () => {
    const calls: unknown[] = [];
    const hermesMessageFollowupTrackerService = {
      async trackMessageFollowup(input: unknown) {
        calls.push(input);
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/message_1/followup-track`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subject: "Client supplied subject",
              threadText: "Client supplied body must be rejected.",
              participants: ["me@example.com"],
              readMessageIds: ["message_1"],
            }),
          },
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: "invalid_hermes_message_followup_request",
        });
      },
      { hermesMessageFollowupTrackerService },
    );

    expect(calls).toEqual([]);
  });

  it("returns 404 when message-scoped Hermes follow-up cannot read the message", async () => {
    const hermesMessageFollowupTrackerService = {
      async trackMessageFollowup() {
        return undefined;
      },
    };

    await withApi(
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/accounts/account_1/messages/missing/followup-track`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: "zh-CN" }),
          },
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "message_not_found" });
      },
      { hermesMessageFollowupTrackerService },
    );
  });

  it("returns 503 when message-scoped Hermes follow-up is not wired", async () => {
    await withApi(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/accounts/account_1/messages/message_1/followup-track`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language: "zh-CN" }),
        },
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "hermes_message_followup_unavailable",
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
              accountId: "account_1",
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
            accountId: "account_1",
            mode: "always",
            sourceLanguage: "English",
            targetLanguage: "Chinese",
            reason: "User clicked always translate.",
          },
        ]);
      },
      { hermesTranslationPreferenceService, apiAccessAccountIds: ["account_1"] },
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
              accountId: "account_1",
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

  it("blocks translation preference memory writes when the skill disallows them", async () => {
    const calls: unknown[] = [];
    const hermesTranslationPreferenceService = {
      async confirmTranslationPreference(input: unknown) {
        calls.push(input);
        return {};
      },
    };
    const hermesSkillSettingsService = {
      async listSkills() {
        throw new Error("not used");
      },
      async updateSkillSettings() {
        throw new Error("not used");
      },
      async getSkill(skillId: string) {
        return {
          id: skillId,
          title: "翻译邮件",
          mode: "read",
          description: "翻译邮件正文",
          settings: {
            enabled: true,
            maxContextChars: 24000,
            memoryLimit: 6,
            allowBodyRead: true,
            allowMemoryWrite: false,
            requireConfirmation: false,
          },
          settingBounds: {
            maxContextChars: { min: 1000, max: 200000, step: 1000 },
            memoryLimit: { min: 0, max: 50, step: 1 },
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
              accountId: "account_1",
              mode: "always",
              sourceLanguage: "English",
              targetLanguage: "Chinese",
            }),
          },
        );

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          error: "hermes_skill_disabled",
          skillId: "translate_text",
          requiredPermission: "memory_write",
        });
      },
      { hermesTranslationPreferenceService, hermesSkillSettingsService },
    );

    expect(calls).toEqual([]);
  });
});

function disabledHermesSkillSettingsService(skillId: string) {
  return {
    async getSkill(requestedSkillId: string) {
      if (requestedSkillId !== skillId) {
        return undefined;
      }

      return {
        id: skillId,
        settings: {
          enabled: false,
        },
      };
    },
  };
}
