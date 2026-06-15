import type {
  ComposeAttachmentPruneResult,
  ScheduledAttachmentBlobStore,
} from "./compose-attachment-blob-store.js";
import type { ComposeAttachmentReferenceStore } from "./postgres-compose-attachment-reference-store.js";

export type ComposeAttachmentCleanupResult =
  | { status: "idle" }
  | ({
      status: "processed";
    } & ComposeAttachmentPruneResult);

export interface RunComposeAttachmentCleanupInput {
  referenceStore: ComposeAttachmentReferenceStore;
  blobStore: Pick<ScheduledAttachmentBlobStore, "pruneUnreferencedUploads">;
  now: Date;
  minAgeMs: number;
  limit: number;
}

export interface CreateComposeAttachmentCleanupLaneInput
  extends Omit<RunComposeAttachmentCleanupInput, "now"> {
  clock(): Date;
  intervalMs: number;
}

export async function runComposeAttachmentCleanupOnce(
  input: RunComposeAttachmentCleanupInput,
): Promise<ComposeAttachmentCleanupResult> {
  const protectedStorageKeys = await input.referenceStore.listActiveStorageKeys();
  const result = await input.blobStore.pruneUnreferencedUploads({
    now: input.now,
    minAgeMs: input.minAgeMs,
    protectedStorageKeys,
    limit: input.limit,
  });

  if (result.deleted === 0) {
    return { status: "idle" };
  }

  return {
    status: "processed",
    ...result,
  };
}

export function createComposeAttachmentCleanupLane(
  input: CreateComposeAttachmentCleanupLaneInput,
): () => Promise<ComposeAttachmentCleanupResult[]> {
  let nextRunAt = 0;

  return async () => {
    const now = input.clock();
    if (now.getTime() < nextRunAt) {
      return [{ status: "idle" }];
    }
    nextRunAt = now.getTime() + Math.max(1, input.intervalMs);

    return [
      await runComposeAttachmentCleanupOnce({
        referenceStore: input.referenceStore,
        blobStore: input.blobStore,
        now,
        minAgeMs: input.minAgeMs,
        limit: input.limit,
      }),
    ];
  };
}
