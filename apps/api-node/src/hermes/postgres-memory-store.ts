import type { Queryable } from "../db/transaction.js";
import type {
  CreateHermesMemoryInput,
  DeleteHermesMemoryInput,
  HermesMemoryDto,
  HermesMemoryStore,
  ListHermesMemoriesInput,
  UpdateHermesMemoryInput,
} from "./memory-store.js";

interface HermesMemoryRow extends Record<string, unknown> {
  id: string;
  layer: string;
  scope: string;
  content: unknown;
  confidence: string | number;
  created_at: string | Date;
  updated_at: string | Date;
}

interface DeletedMemoryRow extends Record<string, unknown> {
  id: string;
}

export function createPostgresHermesMemoryStore(
  client: Queryable,
): HermesMemoryStore {
  return {
    async createMemory(input: CreateHermesMemoryInput) {
      const result = await client.query<HermesMemoryRow>(
        `
          INSERT INTO hermes_memories (
            id,
            layer,
            scope,
            content,
            confidence
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING
            id,
            layer,
            scope,
            content,
            confidence,
            created_at,
            updated_at
        `,
        [
          input.id,
          input.layer,
          input.scope,
          input.content,
          input.confidence,
        ],
      );

      return rowToMemory(result.rows[0]);
    },

    async listMemories(input: ListHermesMemoriesInput) {
      const result = await client.query<HermesMemoryRow>(
        `
          SELECT
            id,
            layer,
            scope,
            content,
            confidence,
            created_at,
            updated_at
          FROM hermes_memories
          WHERE ($1::text IS NULL OR layer = $1)
            AND ($2::text IS NULL OR scope = $2)
          ORDER BY updated_at DESC, id DESC
          LIMIT $3
        `,
        [input.layer ?? null, input.scope ?? null, input.limit],
      );

      return { items: result.rows.map(rowToMemory) };
    },

    async updateMemory(input: UpdateHermesMemoryInput) {
      const result = await client.query<HermesMemoryRow>(
        `
          UPDATE hermes_memories
          SET
            content = COALESCE($2::jsonb, content),
            confidence = COALESCE($3::numeric, confidence),
            updated_at = now()
          WHERE id = $1
          RETURNING
            id,
            layer,
            scope,
            content,
            confidence,
            created_at,
            updated_at
        `,
        [input.id, input.content ?? null, input.confidence ?? null],
      );

      return result.rows[0] ? rowToMemory(result.rows[0]) : undefined;
    },

    async deleteMemory(input: DeleteHermesMemoryInput) {
      const result = await client.query<DeletedMemoryRow>(
        `
          DELETE FROM hermes_memories
          WHERE id = $1
          RETURNING id
        `,
        [input.id],
      );

      return result.rows.length > 0;
    },
  };
}

function rowToMemory(row: HermesMemoryRow): HermesMemoryDto {
  return {
    id: row.id,
    layer: row.layer,
    scope: row.scope,
    content: asRecord(row.content),
    confidence: toNumber(row.confidence),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
