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
