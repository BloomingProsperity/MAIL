import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ScheduledAttachmentBlobStore {
  loadUploadedAttachmentContent(input: {
    accountId: string;
    storageKey: string;
    maxBytes: number;
  }): Promise<{ contentBase64: string; byteSize: number }>;
}

interface StoredAttachmentMetadata {
  accountId: string;
  storageKey: string;
  byteSize: number;
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

  return {
    accountId: metadata.accountId,
    storageKey: safeStorageKey(metadata.storageKey),
    byteSize: Math.max(0, Math.floor(metadata.byteSize)),
  };
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
