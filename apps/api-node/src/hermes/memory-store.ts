export interface HermesMemoryDto {
  id: string;
  layer: string;
  scope: string;
  content: Record<string, unknown>;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListHermesMemoriesInput {
  layer?: string;
  scope?: string;
  limit: number;
}

export interface CreateHermesMemoryInput {
  id: string;
  layer: string;
  scope: string;
  content: Record<string, unknown>;
  confidence: number;
}

export interface UpdateHermesMemoryInput {
  id: string;
  content?: Record<string, unknown>;
  confidence?: number;
}

export interface DeleteHermesMemoryInput {
  id: string;
}

export interface HermesMemoryPage {
  items: HermesMemoryDto[];
}

export interface HermesMemoryStore {
  createMemory(input: CreateHermesMemoryInput): Promise<HermesMemoryDto>;
  listMemories(input: ListHermesMemoriesInput): Promise<HermesMemoryPage>;
  updateMemory(
    input: UpdateHermesMemoryInput,
  ): Promise<HermesMemoryDto | undefined>;
  deleteMemory(input: DeleteHermesMemoryInput): Promise<boolean>;
}
