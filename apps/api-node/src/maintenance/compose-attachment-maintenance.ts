import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface ComposeAttachmentReferenceStore {
  listActiveStorageKeys(): Promise<string[]>;
}

export interface ComposeAttachmentMaintenanceInspection {
  scanned: number;
  scanLimit: number;
  scanLimited: boolean;
  uploads: number;
  totalBytes: number;
  protected: number;
  fresh: number;
  staleUnreferenced: number;
  staleUnreferencedBytes: number;
  invalid: number;
  oldestCreatedAt?: string;
  newestCreatedAt?: string;
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

export interface ComposeAttachmentMaintenanceBlobStore {
  inspectUploads(input: {
    now: Date;
    minAgeMs: number;
    protectedStorageKeys: Iterable<string>;
    scanLimit: number;
  }): Promise<ComposeAttachmentMaintenanceInspection>;
  pruneUnreferencedUploads(input: {
    now: Date;
    minAgeMs: number;
    protectedStorageKeys: Iterable<string>;
    limit: number;
  }): Promise<ComposeAttachmentPruneResult>;
}

export interface ComposeAttachmentMaintenanceStatus
  extends ComposeAttachmentMaintenanceInspection {
  generatedAt: string;
  storage: "local";
  retentionMs: number;
  cleanupLimit: number;
  protectedStorageKeyCount: number;
}

export interface ComposeAttachmentMaintenanceCleanupResult {
  generatedAt: string;
  storage: "local";
  retentionMs: number;
  cleanupLimit: number;
  protectedStorageKeyCount: number;
  cleanup: ComposeAttachmentPruneResult;
  after: ComposeAttachmentMaintenanceInspection;
}

export interface ComposeAttachmentMaintenanceService {
  getStatus(): Promise<ComposeAttachmentMaintenanceStatus>;
  cleanup(input?: {
    minAgeMs?: number;
    limit?: number;
  }): Promise<ComposeAttachmentMaintenanceCleanupResult>;
}

interface StoredAttachmentMetadata {
  accountId: string;
  storageKey: string;
  byteSize: number;
  createdAt: string;
}

export function createPostgresComposeAttachmentReferenceStore(
  client: Queryable,
): ComposeAttachmentReferenceStore {
  return {
    async listActiveStorageKeys() {
      const result = await client.query<{ storage_key: string | null }>(
        `
          SELECT DISTINCT attachment->>'storageKey' AS storage_key
          FROM email_drafts
          CROSS JOIN LATERAL jsonb_array_elements(attachment_manifest) AS attachment
          WHERE status IN ('draft', 'scheduled', 'queued', 'sending', 'failed')
            AND attachment->>'source' = 'uploaded_file'
            AND attachment ? 'storageKey'
            AND length(trim(attachment->>'storageKey')) > 0
        `,
      );

      return result.rows
        .map((row) => textValue(row.storage_key))
        .filter((value): value is string => Boolean(value));
    },
  };
}

export function createLocalComposeAttachmentMaintenanceBlobStore(input: {
  rootDir: string;
}): ComposeAttachmentMaintenanceBlobStore {
  const rootDir = path.resolve(input.rootDir);

  return {
    async inspectUploads(input) {
      const protectedKeys = normalizedStorageKeySet(input.protectedStorageKeys);
      const files = await listMetadataFiles(rootDir);
      const selectedFiles = files.slice(0, Math.max(0, input.scanLimit));
      const result: ComposeAttachmentMaintenanceInspection = {
        scanned: 0,
        scanLimit: Math.max(0, input.scanLimit),
        scanLimited: files.length > selectedFiles.length,
        uploads: 0,
        totalBytes: 0,
        protected: 0,
        fresh: 0,
        staleUnreferenced: 0,
        staleUnreferencedBytes: 0,
        invalid: 0,
      };
      const cutoffMs = input.now.getTime() - Math.max(0, input.minAgeMs);

      for (const file of selectedFiles) {
        result.scanned += 1;
        let metadata: StoredAttachmentMetadata;
        try {
          metadata = await readMetadata(rootDir, file.storageKey);
        } catch {
          result.invalid += 1;
          continue;
        }

        result.uploads += 1;
        result.totalBytes += metadata.byteSize;
        result.oldestCreatedAt = earlierIso(
          result.oldestCreatedAt,
          metadata.createdAt,
        );
        result.newestCreatedAt = laterIso(
          result.newestCreatedAt,
          metadata.createdAt,
        );
        if (protectedKeys.has(metadata.storageKey)) {
          result.protected += 1;
        } else if (createdAtMs(metadata.createdAt) > cutoffMs) {
          result.fresh += 1;
        } else {
          result.staleUnreferenced += 1;
          result.staleUnreferencedBytes += metadata.byteSize;
        }
      }

      return result;
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

export function createComposeAttachmentMaintenanceService(input: {
  referenceStore: ComposeAttachmentReferenceStore;
  blobStore: ComposeAttachmentMaintenanceBlobStore;
  now: () => Date;
  retentionMs: number;
  cleanupLimit: number;
  statusScanLimit?: number;
}): ComposeAttachmentMaintenanceService {
  const statusScanLimit = input.statusScanLimit ?? 5000;

  return {
    async getStatus() {
      const now = input.now();
      const protectedStorageKeys =
        await input.referenceStore.listActiveStorageKeys();
      const inspection = await input.blobStore.inspectUploads({
        now,
        minAgeMs: input.retentionMs,
        protectedStorageKeys,
        scanLimit: statusScanLimit,
      });

      return {
        generatedAt: now.toISOString(),
        storage: "local",
        retentionMs: input.retentionMs,
        cleanupLimit: input.cleanupLimit,
        protectedStorageKeyCount: protectedStorageKeys.length,
        ...inspection,
      };
    },

    async cleanup(cleanupInput = {}) {
      const now = input.now();
      const retentionMs = cleanupInput.minAgeMs ?? input.retentionMs;
      const cleanupLimit = cleanupInput.limit ?? input.cleanupLimit;
      const protectedStorageKeys =
        await input.referenceStore.listActiveStorageKeys();
      const cleanup = await input.blobStore.pruneUnreferencedUploads({
        now,
        minAgeMs: retentionMs,
        protectedStorageKeys,
        limit: cleanupLimit,
      });
      const after = await input.blobStore.inspectUploads({
        now,
        minAgeMs: retentionMs,
        protectedStorageKeys,
        scanLimit: statusScanLimit,
      });

      return {
        generatedAt: now.toISOString(),
        storage: "local",
        retentionMs,
        cleanupLimit,
        protectedStorageKeyCount: protectedStorageKeys.length,
        cleanup,
        after,
      };
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
    .sort((left, right) => left.localeCompare(right))
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

function earlierIso(current: string | undefined, candidate: string): string {
  if (!current || createdAtMs(candidate) < createdAtMs(current)) {
    return candidate;
  }
  return current;
}

function laterIso(current: string | undefined, candidate: string): string {
  if (!current || createdAtMs(candidate) > createdAtMs(current)) {
    return candidate;
  }
  return current;
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

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : undefined;
}
