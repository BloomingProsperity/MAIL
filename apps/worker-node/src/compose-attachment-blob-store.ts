import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

export interface ScheduledAttachmentBlobStore {
  loadUploadedAttachmentContent(input: {
    accountId: string;
    storageKey: string;
    maxBytes: number;
  }): Promise<{ contentBase64: string; byteSize: number }>;
  pruneUnreferencedUploads(input: {
    now: Date;
    minAgeMs: number;
    protectedStorageKeys: Iterable<string>;
    limit: number;
  }): Promise<ComposeAttachmentPruneResult>;
}

export interface ComposeAttachmentPruneResult {
  scanned: number;
  deleted: number;
  retained: number;
  skippedFresh: number;
  skippedProtected: number;
  skippedInvalid: number;
  bytesDeleted: number;
}

interface StoredAttachmentMetadata {
  accountId: string;
  storageKey: string;
  byteSize: number;
  createdAt: string;
}

export function createLocalScheduledAttachmentBlobStore(input: {
  rootDir: string;
}): ScheduledAttachmentBlobStore {
  const rootDir = path.resolve(input.rootDir);

  return {
    async loadUploadedAttachmentContent(attachment) {
      const metadata = await readMetadata(rootDir, attachment.storageKey);
      if (metadata.accountId !== attachment.accountId) {
        throw new Error("attachment blob was not found");
      }
      if (metadata.byteSize > attachment.maxBytes) {
        throw new Error("attachments are too large");
      }

      const bytes = await readFile(blobPath(rootDir, metadata.storageKey));
      if (bytes.byteLength !== metadata.byteSize) {
        throw new Error("attachment blob metadata mismatch");
      }
      if (bytes.byteLength > attachment.maxBytes) {
        throw new Error("attachments are too large");
      }

      return {
        contentBase64: bytes.toString("base64"),
        byteSize: bytes.byteLength,
      };
    },

    async pruneUnreferencedUploads(input) {
      const protectedKeys = normalizedStorageKeySet(input.protectedStorageKeys);
      const limit = Math.max(0, Math.floor(input.limit));
      const cutoffMs = input.now.getTime() - Math.max(0, input.minAgeMs);
      const files = await listMetadataFiles(rootDir);
      const result: ComposeAttachmentPruneResult = {
        scanned: 0,
        deleted: 0,
        retained: 0,
        skippedFresh: 0,
        skippedProtected: 0,
        skippedInvalid: 0,
        bytesDeleted: 0,
      };

      for (const file of files) {
        if (result.deleted >= limit) {
          break;
        }
        result.scanned += 1;

        let metadata: StoredAttachmentMetadata;
        try {
          metadata = await readMetadata(rootDir, file.storageKey);
        } catch {
          result.skippedInvalid += 1;
          continue;
        }

        if (protectedKeys.has(metadata.storageKey)) {
          result.skippedProtected += 1;
          result.retained += 1;
          continue;
        }

        if (createdAtMs(metadata.createdAt) > cutoffMs) {
          result.skippedFresh += 1;
          result.retained += 1;
          continue;
        }

        await Promise.all([
          rm(blobPath(rootDir, metadata.storageKey), { force: true }),
          rm(metadataPath(rootDir, metadata.storageKey), { force: true }),
        ]);
        result.deleted += 1;
        result.bytesDeleted += metadata.byteSize;
      }

      return result;
    },
  };
}

async function readMetadata(
  rootDir: string,
  storageKey: string,
): Promise<StoredAttachmentMetadata> {
  const key = safeStorageKey(storageKey);
  const metadata = JSON.parse(
    await readFile(metadataPath(rootDir, key), "utf8"),
  ) as Partial<StoredAttachmentMetadata>;
  if (
    !metadata.accountId ||
    !metadata.storageKey ||
    typeof metadata.byteSize !== "number"
  ) {
    throw new Error("attachment blob metadata is invalid");
  }
  const metadataStorageKey = safeStorageKey(metadata.storageKey);
  if (metadataStorageKey !== key) {
    throw new Error("attachment blob metadata is invalid");
  }

  return {
    accountId: metadata.accountId,
    storageKey: metadataStorageKey,
    byteSize: Math.max(0, Math.floor(metadata.byteSize)),
    createdAt:
      typeof metadata.createdAt === "string"
        ? metadata.createdAt
        : new Date(0).toISOString(),
  };
}

async function listMetadataFiles(
  rootDir: string,
): Promise<Array<{ storageKey: string }>> {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .map((storageKey) => {
      try {
        return { storageKey: safeStorageKey(storageKey) };
      } catch {
        return undefined;
      }
    })
    .filter((item): item is { storageKey: string } => Boolean(item));
}

function normalizedStorageKeySet(values: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    try {
      keys.add(safeStorageKey(value));
    } catch {
      continue;
    }
  }
  return keys;
}

function createdAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeStorageKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9-]{32,64}$/.test(normalized)) {
    throw new Error("attachment storage key is invalid");
  }
  return normalized;
}

function blobPath(rootDir: string, storageKey: string): string {
  return path.join(rootDir, `${safeStorageKey(storageKey)}.bin`);
}

function metadataPath(rootDir: string, storageKey: string): string {
  return path.join(rootDir, `${safeStorageKey(storageKey)}.json`);
}
