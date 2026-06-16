import { describe, expect, it } from "vitest";

import { createPostgresHermesMessageTranslationStore } from "../src/hermes/postgres-message-translation-store";

describe("postgres Hermes message translation store", () => {
  it("looks up cached message translations by body hash and language tuple", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesMessageTranslationStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "translation_1",
              account_id: "account_1",
              message_id: "message_1",
              body_hash: "hash_1",
              target_language: "Chinese",
              source_language: "auto",
              tone: "preserve original meaning and formatting",
              translated_text: "你好",
              skill_run_id: "run_1",
              audit_event_id: "audit_1",
              created_at: "2026-06-16T09:00:00.000Z",
              updated_at: "2026-06-16T09:00:00.000Z",
            },
          ],
        };
      },
    });

    const result = await store.getCachedTranslation({
      accountId: "account_1",
      messageId: "message_1",
      bodyHash: "hash_1",
      targetLanguage: "Chinese",
      sourceLanguage: "auto",
      tone: "preserve original meaning and formatting",
    });

    expect(queries[0].text).toMatch(/FROM hermes_message_translations/i);
    expect(queries[0].text).toMatch(/body_hash = \$3/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "message_1",
      "hash_1",
      "Chinese",
      "auto",
      "preserve original meaning and formatting",
    ]);
    expect(result).toMatchObject({
      id: "translation_1",
      accountId: "account_1",
      messageId: "message_1",
      translatedText: "你好",
      skillRunId: "run_1",
      auditEventId: "audit_1",
    });
  });

  it("upserts translations without duplicating concurrent requests", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesMessageTranslationStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "translation_1",
              account_id: "account_1",
              message_id: "message_1",
              body_hash: "hash_1",
              target_language: "Chinese",
              source_language: "auto",
              tone: "preserve original meaning and formatting",
              translated_text: "你好",
              skill_run_id: "run_1",
              audit_event_id: null,
              created_at: "2026-06-16T09:00:00.000Z",
              updated_at: "2026-06-16T09:00:00.000Z",
            },
          ],
        };
      },
    });

    const result = await store.saveTranslation({
      id: "translation_1",
      accountId: "account_1",
      messageId: "message_1",
      bodyHash: "hash_1",
      targetLanguage: "Chinese",
      sourceLanguage: "auto",
      tone: "preserve original meaning and formatting",
      translatedText: "你好",
      skillRunId: "run_1",
    });

    expect(queries[0].text).toMatch(/ON CONFLICT/i);
    expect(queries[0].text).toMatch(
      /account_id,\s*message_id,\s*target_language,\s*source_language,\s*tone,\s*body_hash/i,
    );
    expect(queries[0].values).toEqual([
      "translation_1",
      "account_1",
      "message_1",
      "hash_1",
      "Chinese",
      "auto",
      "preserve original meaning and formatting",
      "你好",
      "run_1",
      null,
    ]);
    expect(result).toMatchObject({
      id: "translation_1",
      translatedText: "你好",
      skillRunId: "run_1",
    });
    expect(result.auditEventId).toBeUndefined();
  });
});
