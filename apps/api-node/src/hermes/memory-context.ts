import type { HermesMemoryDto, HermesMemoryStore } from "./memory-store.js";

const MAX_MEMORY_LAYERS_PER_RUN = 6;

export interface HermesMemoryContextInput {
  accountId?: string;
  memoryScope?: string;
  memoryLayers?: string[];
  memoryLimit?: number;
}

export interface HermesMemoryContextOptions {
  memoryStore?: Pick<HermesMemoryStore, "listMemories">;
  memoryLimit?: number;
  defaultLayers: string[];
}

export async function loadHermesMemoryContext(
  input: HermesMemoryContextInput,
  options: HermesMemoryContextOptions,
): Promise<HermesMemoryDto[]> {
  if (!options.memoryStore) {
    return [];
  }

  const limit = normalizeMemoryLimit(input.memoryLimit ?? options.memoryLimit ?? 6);
  if (limit <= 0) {
    return [];
  }

  const layers = normalizeMemoryLayers(input.memoryLayers, options.defaultLayers);
  if (layers.length === 0) {
    return [];
  }

  const scopes = normalizeMemoryScopes(input.memoryScope);
  const perQueryLimit = Math.max(
    1,
    Math.ceil(limit / (layers.length * scopes.length)),
  );
  const pages = await Promise.all(
    layers.flatMap((layer) =>
      scopes.map((scope) =>
        options.memoryStore!.listMemories({
          ...(input.accountId ? { accountId: input.accountId } : {}),
          layer,
          scope,
          limit: perQueryLimit,
        }),
      ),
    ),
  );

  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.items)
    .filter((memory) => {
      if (seen.has(memory.id)) {
        return false;
      }

      seen.add(memory.id);
      return true;
    })
    .slice(0, limit);
}

export function appendHermesMemoryPromptSection(
  lines: string[],
  memories: HermesMemoryDto[],
): void {
  if (memories.length === 0) {
    return;
  }

  lines.push("", "Relevant user memory:");
  lines.push(...memories.map(formatMemoryLine));
}

export function usedHermesMemoryIds(
  explicitMemoryIds: string[] | undefined,
  memories: HermesMemoryDto[],
): string[] {
  return Array.from(
    new Set([...(explicitMemoryIds ?? []), ...memories.map((memory) => memory.id)]),
  );
}

function normalizeMemoryLayers(
  layers: string[] | undefined,
  defaultLayers: string[],
): string[] {
  const normalized = uniqueNonEmptyLayers(layers ?? defaultLayers);

  return (normalized.length > 0 ? normalized : uniqueNonEmptyLayers(defaultLayers))
    .slice(0, MAX_MEMORY_LAYERS_PER_RUN);
}

function uniqueNonEmptyLayers(layers: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const layer of layers) {
    const trimmed = layer.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeMemoryLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeMemoryScopes(scope: string | undefined): string[] {
  const trimmed = scope?.trim();
  if (!trimmed || trimmed.length === 0 || trimmed === "global") {
    return ["global"];
  }

  return ["global", trimmed];
}

function formatMemoryLine(memory: HermesMemoryDto): string {
  return [
    `[${memory.layer}/${memory.scope} confidence=${formatConfidence(
      memory.confidence,
    )}]`,
    formatMemoryContent(memory.content),
  ].join(" ");
}

function formatMemoryContent(content: Record<string, unknown>): string {
  for (const key of ["preference", "summary", "rule", "style", "text", "value"]) {
    const value = content[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return clampOneLine(value);
    }
  }

  return clampOneLine(JSON.stringify(content));
}

function clampOneLine(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 300
    ? `${normalized.slice(0, 297).trimEnd()}...`
    : normalized;
}

function formatConfidence(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
