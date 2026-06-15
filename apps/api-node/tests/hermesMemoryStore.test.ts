import { describe, expect, it } from "vitest";

import { createPostgresHermesMemoryStore } from "../src/hermes/postgres-memory-store";

describe("postgres Hermes memory store", () => {
  it("creates a new editable Hermes memory", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000010",
              layer: "procedural_memory",
              scope: "global",
              content: {
                source: "translation_preference",
                preference:
                  "When translating English emails, prefer Chinese as the target language.",
              },
              confidence: "0.920",
              created_at: "2026-06-13T09:00:00.000Z",
              updated_at: "2026-06-13T09:00:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesMemoryStore(client);

    const result = await store.createMemory({
      id: "00000000-0000-0000-0000-000000000010",
      layer: "procedural_memory",
      scope: "global",
      content: {
        source: "translation_preference",
        preference:
          "When translating English emails, prefer Chinese as the target language.",
      },
      confidence: 0.92,
    });

    expect(queries[0].text).toMatch(/INSERT INTO hermes_memories/i);
    expect(queries[0].text).toMatch(/RETURNING/i);
    expect(queries[0].values).toEqual([
      "00000000-0000-0000-0000-000000000010",
      "procedural_memory",
      "global",
      {
        source: "translation_preference",
        preference:
          "When translating English emails, prefer Chinese as the target language.",
      },
      0.92,
    ]);
    expect(result).toEqual({
      id: "00000000-0000-0000-0000-000000000010",
      layer: "procedural_memory",
      scope: "global",
      content: {
        source: "translation_preference",
        preference:
          "When translating English emails, prefer Chinese as the target language.",
      },
      confidence: 0.92,
      createdAt: "2026-06-13T09:00:00.000Z",
      updatedAt: "2026-06-13T09:00:00.000Z",
    });
  });

  it("lists memories with optional layer and scope filters", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              layer: "semantic_profile",
              scope: "global",
              content: { preference: "short replies" },
              confidence: "0.750",
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T10:00:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesMemoryStore(client);

    const result = await store.listMemories({
      layer: "semantic_profile",
      scope: "global",
      limit: 25,
    });

    expect(queries[0].text).toMatch(/FROM hermes_memories/i);
    expect(queries[0].text).toMatch(/\(\$1::text IS NULL OR layer = \$1\)/i);
    expect(queries[0].text).toMatch(/\(\$2::text IS NULL OR scope = \$2\)/i);
    expect(queries[0].values).toEqual(["semantic_profile", "global", 25]);
    expect(result.items).toEqual([
      {
        id: "00000000-0000-0000-0000-000000000001",
        layer: "semantic_profile",
        scope: "global",
        content: { preference: "short replies" },
        confidence: 0.75,
        createdAt: "2026-06-12T09:00:00.000Z",
        updatedAt: "2026-06-12T10:00:00.000Z",
      },
    ]);
  });

  it("updates memory content and confidence", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              layer: "semantic_profile",
              scope: "global",
              content: { preference: "concise replies" },
              confidence: "0.900",
              created_at: "2026-06-12T09:00:00.000Z",
              updated_at: "2026-06-12T11:00:00.000Z",
            },
          ],
        };
      },
    };
    const store = createPostgresHermesMemoryStore(client);

    const result = await store.updateMemory({
      id: "00000000-0000-0000-0000-000000000001",
      content: { preference: "concise replies" },
      confidence: 0.9,
    });

    expect(queries[0].text).toMatch(/UPDATE hermes_memories/i);
    expect(queries[0].text).toMatch(/content = COALESCE\(\$2::jsonb, content\)/i);
    expect(queries[0].text).toMatch(
      /confidence = COALESCE\(\$3::numeric, confidence\)/i,
    );
    expect(queries[0].values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      { preference: "concise replies" },
      0.9,
    ]);
    expect(result?.confidence).toBe(0.9);
  });

  it("deletes one memory by id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [{ id: "00000000-0000-0000-0000-000000000001" }] };
      },
    };
    const store = createPostgresHermesMemoryStore(client);

    const deleted = await store.deleteMemory({
      id: "00000000-0000-0000-0000-000000000001",
    });

    expect(deleted).toBe(true);
    expect(queries[0].text).toMatch(/DELETE FROM hermes_memories/i);
    expect(queries[0].text).toMatch(/RETURNING id/i);
    expect(queries[0].values).toEqual([
      "00000000-0000-0000-0000-000000000001",
    ]);
  });
});
