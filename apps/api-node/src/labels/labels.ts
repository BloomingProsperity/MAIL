export type LabelColor = "coral" | "blue" | "green" | "yellow" | "purple" | "mint";

export interface LabelDto {
  id: string;
  accountId: string;
  name: string;
  color: LabelColor;
  messageCount: number;
  createdAt: string;
}

export interface ListLabelsInput {
  accountId: string;
}

export interface UpsertLabelInput {
  accountId: string;
  name: string;
  color?: LabelColor;
}

export interface LabelStore {
  listLabels(input: ListLabelsInput): Promise<{ items: LabelDto[] }>;
  upsertLabel(input: UpsertLabelInput & { id: string }): Promise<LabelDto>;
}

export interface LabelService {
  listLabels(input: ListLabelsInput): Promise<{ items: LabelDto[] }>;
  upsertLabel(input: UpsertLabelInput): Promise<LabelDto>;
}

export class InvalidLabelRequestError extends Error {
  readonly code = "invalid_label_request";

  constructor(message = "invalid_label_request") {
    super(message);
  }
}

export function createLabelService(options: {
  store: LabelStore;
  createId: () => string;
}): LabelService {
  return {
    async listLabels(input) {
      return options.store.listLabels({
        accountId: normalizeId(input.accountId),
      });
    },
    async upsertLabel(input) {
      return options.store.upsertLabel({
        id: options.createId(),
        accountId: normalizeId(input.accountId),
        name: normalizeLabelName(input.name),
        color: input.color ? normalizeLabelColor(input.color) : "blue",
      });
    },
  };
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidLabelRequestError();
  }
  return value;
}

function normalizeLabelName(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidLabelRequestError();
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 64 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw new InvalidLabelRequestError();
  }
  return name;
}

function normalizeLabelColor(value: unknown): LabelColor {
  if (
    value === "coral" ||
    value === "blue" ||
    value === "green" ||
    value === "yellow" ||
    value === "purple" ||
    value === "mint"
  ) {
    return value;
  }
  throw new InvalidLabelRequestError();
}
