import { describe, expect, it } from "vitest";

import { loadHermesMemoryContext } from "../src/hermes/memory-context";
import type { HermesMemoryDto } from "../src/hermes/memory-store";

describe("Hermes memory context", () => {
  it("loads global memories together with the requested scoped memories", async () => {
    const calls: unknown[] = [];
    const memoriesByScope: Record<string, HermesMemoryDto[]> = {
      global: [
        memory("memory_global", "writing_style_profile", "global", {
          preference: "Prefer concise replies.",
        }),
      ],
      "recipient:lina@example.com": [
        memory(
          "memory_lina",
          "writing_style_profile",
          "recipient:lina@example.com",
          {
            preference: "With Lina, keep scheduling replies direct.",
          },
        ),
      ],
    };

    const result = await loadHermesMemoryContext(
      {
        memoryScope: "recipient:lina@example.com",
        memoryLayers: ["writing_style_profile"],
      },
      {
        memoryLimit: 6,
        defaultLayers: ["writing_style_profile"],
        memoryStore: {
          async listMemories(input) {
            calls.push(input);
            return {
              items: memoriesByScope[input.scope ?? "global"] ?? [],
            };
          },
        },
      },
    );

    expect(calls).toEqual([
      {
        layer: "writing_style_profile",
        scope: "global",
        limit: 3,
      },
      {
        layer: "writing_style_profile",
        scope: "recipient:lina@example.com",
        limit: 3,
      },
    ]);
    expect(result.map((item) => item.id)).toEqual([
      "memory_global",
      "memory_lina",
    ]);
  });

  it("lets a skill run memory limit override the service default", async () => {
    const calls: unknown[] = [];

    await loadHermesMemoryContext(
      {
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory", "procedural_memory"],
        memoryLimit: 2,
      },
      {
        memoryLimit: 10,
        defaultLayers: ["contact_memory", "procedural_memory"],
        memoryStore: {
          async listMemories(input) {
            calls.push(input);
            return { items: [] };
          },
        },
      },
    );

    expect(calls).toEqual([
      { layer: "contact_memory", scope: "global", limit: 1 },
      { layer: "contact_memory", scope: "sender:client@example.com", limit: 1 },
      { layer: "procedural_memory", scope: "global", limit: 1 },
      {
        layer: "procedural_memory",
        scope: "sender:client@example.com",
        limit: 1,
      },
    ]);
  });

  it("passes account scope to every memory lookup", async () => {
    const calls: unknown[] = [];

    await loadHermesMemoryContext(
      {
        accountId: "account_1",
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory"],
      },
      {
        memoryLimit: 4,
        defaultLayers: ["contact_memory"],
        memoryStore: {
          async listMemories(input) {
            calls.push(input);
            return { items: [] };
          },
        },
      },
    );

    expect(calls).toEqual([
      {
        accountId: "account_1",
        layer: "contact_memory",
        scope: "global",
        limit: 2,
      },
      {
        accountId: "account_1",
        layer: "contact_memory",
        scope: "sender:client@example.com",
        limit: 2,
      },
    ]);
  });

  it("skips memory store queries when the skill memory limit is zero", async () => {
    const calls: unknown[] = [];

    const result = await loadHermesMemoryContext(
      {
        memoryScope: "sender:client@example.com",
        memoryLayers: ["contact_memory"],
        memoryLimit: 0,
      },
      {
        memoryLimit: 10,
        defaultLayers: ["contact_memory"],
        memoryStore: {
          async listMemories(input) {
            calls.push(input);
            return { items: [] };
          },
        },
      },
    );

    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("deduplicates and caps requested memory layers before querying", async () => {
    const calls: unknown[] = [];

    await loadHermesMemoryContext(
      {
        memoryLayers: [
          "contact_memory",
          "procedural_memory",
          "contact_memory",
          "writing_style_profile",
          "translation_preferences",
          "sender_rules",
          "follow_up_patterns",
          "extra_layer",
        ],
        memoryLimit: 12,
      },
      {
        memoryLimit: 20,
        defaultLayers: ["contact_memory"],
        memoryStore: {
          async listMemories(input) {
            calls.push(input);
            return { items: [] };
          },
        },
      },
    );

    expect(calls).toEqual([
      { layer: "contact_memory", scope: "global", limit: 2 },
      { layer: "procedural_memory", scope: "global", limit: 2 },
      { layer: "writing_style_profile", scope: "global", limit: 2 },
      { layer: "translation_preferences", scope: "global", limit: 2 },
      { layer: "sender_rules", scope: "global", limit: 2 },
      { layer: "follow_up_patterns", scope: "global", limit: 2 },
    ]);
  });

  it("returns empty context when no memory layers are available", async () => {
    const calls: unknown[] = [];

    const result = await loadHermesMemoryContext(
      {
        memoryLayers: [" "],
        memoryLimit: 6,
      },
      {
        memoryLimit: 6,
        defaultLayers: [],
        memoryStore: {
          async listMemories(input) {
            calls.push(input);
            return { items: [] };
          },
        },
      },
    );

    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });
});

function memory(
  id: string,
  layer: string,
  scope: string,
  content: Record<string, unknown>,
): HermesMemoryDto {
  return {
    id,
    layer,
    scope,
    content,
    confidence: 0.8,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  };
}
