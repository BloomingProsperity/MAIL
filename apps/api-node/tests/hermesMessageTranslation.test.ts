import { describe, expect, it } from "vitest";

import {
  createHermesMessageTranslationService,
  hashTranslationSource,
  InvalidHermesMessageTranslationRequestError,
  type HermesMessageTranslationRecord,
  type HermesMessageTranslationStore,
} from "../src/hermes/message-translation";
import type { MessageDetailDto } from "../src/mail-read/mail-read-store";

describe("Hermes message translation service", () => {
  it("loads the selected message body and audits the read message id", async () => {
    const translationCalls: unknown[] = [];
    const saved: unknown[] = [];
    const store: HermesMessageTranslationStore = {
      async getCachedTranslation() {
        return undefined;
      },
      async saveTranslation(input) {
        saved.push(input);
        return {
          ...input,
          translatedText: input.translatedText,
          skillRunId: input.skillRunId,
          auditEventId: input.auditEventId,
          createdAt: "2026-06-16T09:00:00.000Z",
          updatedAt: "2026-06-16T09:00:00.000Z",
        };
      },
    };
    const service = createHermesMessageTranslationService({
      createId: () => "translation_cache_1",
      store,
      mailReadStore: {
        async getMessage(input) {
          expect(input).toEqual({
            accountId: "account_1",
            messageId: "message_1",
          });
          return message({
            bodyText: "Please confirm the launch schedule.",
          });
        },
      },
      translationService: {
        async translate(input) {
          translationCalls.push(input);
          return {
            skillRunId: "run_translate_1",
            auditEventId: "audit_translate_1",
            skillId: "translate_text",
            sourceLanguage: "auto",
            targetLanguage: "Chinese",
            translatedText: "请确认发布时间。",
          };
        },
      },
    });

    const result = await service.translateMessage({
      accountId: "account_1",
      messageId: "message_1",
      targetLanguage: "Chinese",
    });

    expect(translationCalls).toEqual([
      {
        text: "Please confirm the launch schedule.",
        targetLanguage: "Chinese",
        sourceLanguage: "auto",
        tone: "preserve original meaning and formatting",
        readMessageIds: ["message_1"],
        memoryIds: undefined,
        memoryScope: "sender:client@example.com",
        memoryLayers: undefined,
      },
    ]);
    expect(saved).toEqual([
      expect.objectContaining({
        id: "translation_cache_1",
        accountId: "account_1",
        messageId: "message_1",
        bodyHash: hashTranslationSource("Please confirm the launch schedule."),
        targetLanguage: "Chinese",
        sourceLanguage: "auto",
        tone: "preserve original meaning and formatting",
        translatedText: "请确认发布时间。",
        skillRunId: "run_translate_1",
        auditEventId: "audit_translate_1",
      }),
    ]);
    expect(result).toEqual({
      skillRunId: "run_translate_1",
      auditEventId: "audit_translate_1",
      skillId: "translate_text",
      accountId: "account_1",
      messageId: "message_1",
      sourceLanguage: "auto",
      targetLanguage: "Chinese",
      translatedText: "请确认发布时间。",
      cached: false,
    });
  });

  it("uses cached translations for the same message body and language", async () => {
    const cached: HermesMessageTranslationRecord = {
      id: "translation_cache_1",
      accountId: "account_1",
      messageId: "message_1",
      bodyHash: hashTranslationSource("Hello from HTML"),
      targetLanguage: "Chinese",
      sourceLanguage: "auto",
      tone: "preserve original meaning and formatting",
      translatedText: "来自 HTML 的你好",
      skillRunId: "run_cached",
      auditEventId: "audit_cached",
      createdAt: "2026-06-16T09:00:00.000Z",
      updatedAt: "2026-06-16T09:00:00.000Z",
    };
    const lookups: unknown[] = [];
    const service = createHermesMessageTranslationService({
      createId: () => "unused",
      store: {
        async getCachedTranslation(input) {
          lookups.push(input);
          return cached;
        },
        async saveTranslation() {
          throw new Error("cached translation should not be saved again");
        },
      },
      mailReadStore: {
        async getMessage() {
          return message({
            bodyText: undefined,
            bodyHtml: "<p>Hello&nbsp;from <strong>HTML</strong></p>",
          });
        },
      },
      translationService: {
        async translate() {
          throw new Error("cached translation should not call Hermes");
        },
      },
    });

    const result = await service.translateMessage({
      accountId: "account_1",
      messageId: "message_1",
      targetLanguage: "Chinese",
    });

    expect(lookups).toEqual([
      {
        accountId: "account_1",
        messageId: "message_1",
        bodyHash: hashTranslationSource("Hello from HTML"),
        targetLanguage: "Chinese",
        sourceLanguage: "auto",
        tone: "preserve original meaning and formatting",
      },
    ]);
    expect(result).toMatchObject({
      skillRunId: "run_cached",
      translatedText: "来自 HTML 的你好",
      cached: true,
    });
  });

  it("returns undefined for a message outside the account scope", async () => {
    const service = createHermesMessageTranslationService({
      createId: () => "unused",
      mailReadStore: {
        async getMessage() {
          return undefined;
        },
      },
      translationService: {
        async translate() {
          throw new Error("missing message should not call Hermes");
        },
      },
    });

    await expect(
      service.translateMessage({
        accountId: "account_1",
        messageId: "message_404",
        targetLanguage: "Chinese",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects messages without readable text", async () => {
    const service = createHermesMessageTranslationService({
      createId: () => "unused",
      mailReadStore: {
        async getMessage() {
          return message({ bodyText: " ", bodyHtml: " ", snippet: " " });
        },
      },
      translationService: {
        async translate() {
          throw new Error("empty message should not call Hermes");
        },
      },
    });

    await expect(
      service.translateMessage({
        accountId: "account_1",
        messageId: "message_1",
        targetLanguage: "Chinese",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesMessageTranslationRequestError);
  });
});

function message(
  overrides: Partial<MessageDetailDto> = {},
): MessageDetailDto {
  return {
    id: "message_1",
    accountId: "account_1",
    subject: "Launch schedule",
    from: { email: "client@example.com" },
    receivedAt: "2026-06-16T09:00:00.000Z",
    snippet: "Please confirm.",
    unread: true,
    starred: false,
    mailboxIds: ["inbox_1"],
    attachmentCount: 0,
    classification: {
      bucket: "P2 Important",
      priorityScore: 80,
      reasons: ["direct conversation"],
    },
    to: ["me@example.com"],
    cc: [],
    bodyText: "Please confirm the launch schedule.",
    attachments: [],
    ...overrides,
  };
}
