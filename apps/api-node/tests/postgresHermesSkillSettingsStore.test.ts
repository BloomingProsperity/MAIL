import { describe, expect, it } from "vitest";

import { createPostgresHermesSkillSettingsStore } from "../src/hermes/postgres-skill-settings-store";

describe("postgres Hermes skill settings store", () => {
  it("lists editable skill settings keyed by skill id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesSkillSettingsStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              skill_id: "translate_text",
              enabled: false,
              max_context_chars: 12000,
              memory_limit: 2,
              allow_body_read: false,
              allow_memory_write: false,
              require_confirmation: true,
            },
          ],
        };
      },
    });

    const settings = await store.listSettings();

    expect(queries[0].text).toMatch(/FROM hermes_skill_settings/i);
    expect(settings).toEqual({
      translate_text: {
        enabled: false,
        maxContextChars: 12000,
        memoryLimit: 2,
        allowBodyRead: false,
        allowMemoryWrite: false,
        requireConfirmation: true,
      },
    });
  });

  it("upserts editable settings for one skill", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresHermesSkillSettingsStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              skill_id: "reply_draft",
              enabled: true,
              max_context_chars: 32000,
              memory_limit: 8,
              allow_body_read: true,
              allow_memory_write: false,
              require_confirmation: true,
            },
          ],
        };
      },
    });

    const saved = await store.saveSettings({
      skillId: "reply_draft",
      settings: {
        enabled: true,
        maxContextChars: 32000,
        memoryLimit: 8,
        allowBodyRead: true,
        allowMemoryWrite: false,
        requireConfirmation: true,
      },
    });

    expect(queries[0].text).toMatch(/ON CONFLICT \(skill_id\) DO UPDATE/i);
    expect(queries[0].text).toMatch(/max_context_chars = EXCLUDED\.max_context_chars/i);
    expect(queries[0].values).toEqual([
      "reply_draft",
      true,
      32000,
      8,
      true,
      false,
      true,
    ]);
    expect(saved).toEqual({
      enabled: true,
      maxContextChars: 32000,
      memoryLimit: 8,
      allowBodyRead: true,
      allowMemoryWrite: false,
      requireConfirmation: true,
    });
  });
});
