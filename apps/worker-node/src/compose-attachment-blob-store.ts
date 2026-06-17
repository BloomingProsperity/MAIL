import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
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
  sha256?: string;
  createdAt: string;
}

interface UploadArtifact {
  storageKey: string;
  paths: string[];
  byteSize: number;
  modifiedAtMs: number;
}

interface ExistingArtifactFile {
  filePath: string;
  byteSize: number;
  modifiedAtMs: number;
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
      if (metadata.sha256 && sha256Hex(bytes) !== metadata.sha256) {
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
      const orphanArtifacts = await listOrphanUploadArtifacts(rootDir);
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
          const artifact = await invalidMetadataArtifact(rootDir, file.storageKey);
          if (
            !artifact ||
            protectedKeys.has(file.storageKey) ||
            artifact.modifiedAtMs > cutoffMs
          ) {
            result.skippedInvalid += 1;
            continue;
          }

          await deleteArtifact(artifact);
          result.deleted += 1;
          result.bytesDeleted += artifact.byteSize;
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

      for (const artifact of orphanArtifacts) {
        if (result.deleted >= limit) {
          break;
        }
        result.scanned += 1;

        if (protectedKeys.has(artifact.storageKey)) {
          result.skippedProtected += 1;
          result.retained += 1;
          continue;
        }

        if (artifact.modifiedAtMs > cutoffMs) {
          result.skippedFresh += 1;
          result.retained += 1;
          continue;
        }

        await deleteArtifact(artifact);
        result.deleted += 1;
        result.bytesDeleted += artifact.byteSize;
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
    ...(typeof metadata.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(metadata.sha256)
      ? { sha256: metadata.sha256 }
      : {}),
    createdAt:
      typeof metadata.createdAt === "string"
        ? metadata.createdAt
        : new Date(0).toISOString(),
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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

async function listOrphanUploadArtifacts(
  rootDir: string,
): Promise<UploadArtifact[]> {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return [];
  }

  const entrySet = new Set(entries);
  const artifacts = await Promise.all(
    entries
      .sort((left, right) => left.localeCompare(right))
      .map(async (entry): Promise<UploadArtifact | undefined> => {
        const storageKey = storageKeyFromOrphanEntry(entry, entrySet);
        if (!storageKey) {
          return undefined;
        }
        const filePath = path.join(rootDir, entry);
        try {
          const fileStat = await stat(filePath);
          return {
            storageKey,
            paths: [filePath],
            byteSize: Math.max(0, fileStat.size),
            modifiedAtMs: fileStat.mtimeMs,
          };
        } catch {
          return undefined;
        }
      }),
  );

  return artifacts.filter((item): item is UploadArtifact => Boolean(item));
}

async function invalidMetadataArtifact(
  rootDir: string,
  storageKey: string,
): Promise<UploadArtifact | undefined> {
  const key = safeStorageKey(storageKey);
  const paths = [metadataPath(rootDir, key), blobPath(rootDir, key)];
  const stats = await Promise.all(
    paths.map(async (filePath) => {
      try {
        const fileStat = await stat(filePath);
        return {
          filePath,
          byteSize: Math.max(0, fileStat.size),
          modifiedAtMs: fileStat.mtimeMs,
        };
      } catch {
        return undefined;
      }
    }),
  );
  const existing = stats.filter(
    (item): item is ExistingArtifactFile => Boolean(item),
  );
  if (existing.length === 0) {
    return undefined;
  }

  return {
    storageKey: key,
    paths: existing.map((item) => item.filePath),
    byteSize: existing.reduce(
      (sum, item) => sum + item.byteSize,
      0,
    ),
    modifiedAtMs: Math.max(...existing.map((item) => item.modifiedAtMs)),
  };
}

async function deleteArtifact(artifact: UploadArtifact): Promise<void> {
  await Promise.all(artifact.paths.map((filePath) => rm(filePath, { force: true })));
}

function storageKeyFromOrphanEntry(
  entry: string,
  entrySet: Set<string>,
): string | undefined {
  if (entry.endsWith(".bin.part")) {
    return safeStorageKeyOrUndefined(entry.slice(0, -".bin.part".length));
  }
  if (entry.endsWith(".json.part")) {
    return safeStorageKeyOrUndefined(entry.slice(0, -".json.part".length));
  }
  if (!entry.endsWith(".bin")) {
    return undefined;
  }
  const storageKey = safeStorageKeyOrUndefined(entry.slice(0, -".bin".length));
  if (!storageKey || entrySet.has(`${storageKey}.json`)) {
    return undefined;
  }
  return storageKey;
}

function safeStorageKeyOrUndefined(value: string): string | undefined {
  try {
    return safeStorageKey(value);
  } catch {
    return undefined;
  }
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
