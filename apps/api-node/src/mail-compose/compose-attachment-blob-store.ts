import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { MailDraftTransportAttachment } from "./mail-compose.js";

export interface ComposeAttachmentBlobStore {
  saveUploadedAttachment(input: {
    accountId: string;
    bytes: Uint8Array;
    filename: string;
    contentType: string;
    inline?: boolean;
    contentId?: string;
  }): Promise<MailDraftTransportAttachment>;
  saveUploadedAttachmentStream?(input: {
    accountId: string;
    stream: NodeJS.ReadableStream;
    maxBytes: number;
    filename: string;
    contentType: string;
    inline?: boolean;
    contentId?: string;
  }): Promise<MailDraftTransportAttachment>;
  getUploadedAttachment(input: {
    accountId: string;
    storageKey: string;
    attachmentId?: string;
  }): Promise<MailDraftTransportAttachment>;
  loadUploadedAttachmentContent(input: {
    accountId: string;
    storageKey: string;
    maxBytes: number;
  }): Promise<{ contentBase64: string; byteSize: number }>;
}

interface StoredAttachmentMetadata {
  accountId: string;
  attachmentId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
  inline: boolean;
  contentId?: string;
  createdAt: string;
}

export class ComposeAttachmentBlobTooLargeError extends Error {
  readonly code = "request_body_too_large";

  constructor() {
    super("request_body_too_large");
  }
}

export function createLocalComposeAttachmentBlobStore(input: {
  rootDir: string;
  createId?: () => string;
  now?: () => Date;
}): ComposeAttachmentBlobStore {
  const createId = input.createId ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const rootDir = path.resolve(input.rootDir);

  return {
    async saveUploadedAttachment(attachment) {
      const storageKey = safeStorageKey(createId());
      const attachmentId = `upload_${storageKey}`;
      const bytes = Buffer.from(attachment.bytes);
      const tempBlobPath = path.join(rootDir, `${storageKey}.bin.part`);
      const tempMetadataPath = path.join(rootDir, `${storageKey}.json.part`);
      const metadata: StoredAttachmentMetadata = {
        accountId: attachment.accountId,
        attachmentId,
        storageKey,
        filename: sanitizeFilename(attachment.filename || "attachment"),
        contentType: sanitizeContentType(
          attachment.contentType || "application/octet-stream",
        ),
        byteSize: bytes.byteLength,
        inline: Boolean(attachment.inline),
        ...(attachment.contentId
          ? { contentId: sanitizeContentId(attachment.contentId) }
          : {}),
        createdAt: now().toISOString(),
      };

      await mkdir(rootDir, { recursive: true });
      try {
        await writeFile(tempBlobPath, bytes, { flag: "wx" });
        await writeFile(tempMetadataPath, JSON.stringify(metadata), {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(tempBlobPath, blobPath(rootDir, storageKey));
        await rename(tempMetadataPath, metadataPath(rootDir, storageKey));
      } catch (error) {
        await Promise.all([
          rm(tempBlobPath, { force: true }),
          rm(tempMetadataPath, { force: true }),
          rm(blobPath(rootDir, storageKey), { force: true }),
          rm(metadataPath(rootDir, storageKey), { force: true }),
        ]);
        throw error;
      }

      return transportAttachment(metadata);
    },

    async saveUploadedAttachmentStream(attachment) {
      const storageKey = safeStorageKey(createId());
      const attachmentId = `upload_${storageKey}`;
      const tempBlobPath = path.join(rootDir, `${storageKey}.bin.part`);
      const tempMetadataPath = path.join(rootDir, `${storageKey}.json.part`);

      await mkdir(rootDir, { recursive: true });
      try {
        const byteSize = await writeLimitedStream(
          attachment.stream,
          tempBlobPath,
          attachment.maxBytes,
        );
        const metadata: StoredAttachmentMetadata = {
          accountId: attachment.accountId,
          attachmentId,
          storageKey,
          filename: sanitizeFilename(attachment.filename || "attachment"),
          contentType: sanitizeContentType(
            attachment.contentType || "application/octet-stream",
          ),
          byteSize,
          inline: Boolean(attachment.inline),
          ...(attachment.contentId
            ? { contentId: sanitizeContentId(attachment.contentId) }
            : {}),
          createdAt: now().toISOString(),
        };

        await writeFile(tempMetadataPath, JSON.stringify(metadata), {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(tempBlobPath, blobPath(rootDir, storageKey));
        await rename(tempMetadataPath, metadataPath(rootDir, storageKey));

        return transportAttachment(metadata);
      } catch (error) {
        await Promise.all([
          rm(tempBlobPath, { force: true }),
          rm(tempMetadataPath, { force: true }),
          rm(blobPath(rootDir, storageKey), { force: true }),
          rm(metadataPath(rootDir, storageKey), { force: true }),
        ]);
        throw error;
      }
    },

    async getUploadedAttachment(attachment) {
      const metadata = await readMetadata(rootDir, attachment.storageKey);
      assertAccount(metadata, attachment.accountId);
      if (
        attachment.attachmentId &&
        attachment.attachmentId !== metadata.attachmentId
      ) {
        throw new Error("attachment blob does not match attachment id");
      }

      return transportAttachment(metadata);
    },

    async loadUploadedAttachmentContent(attachment) {
      const metadata = await readMetadata(rootDir, attachment.storageKey);
      assertAccount(metadata, attachment.accountId);
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

async function writeLimitedStream(
  stream: NodeJS.ReadableStream,
  destination: string,
  maxBytes: number,
): Promise<number> {
  const limiter = new ByteLimitTransform(maxBytes);
  await pipeline(stream, limiter, createWriteStream(destination, { flags: "wx" }));
  return limiter.byteSize;
}

class ByteLimitTransform extends Transform {
  byteSize = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.byteSize += chunk.byteLength;
    if (this.byteSize > this.maxBytes) {
      callback(new ComposeAttachmentBlobTooLargeError());
      return;
    }

    callback(null, chunk);
  }
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
    !metadata.attachmentId ||
    !metadata.storageKey ||
    !metadata.filename ||
    !metadata.contentType ||
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
    attachmentId: metadata.attachmentId,
    storageKey: metadataStorageKey,
    filename: sanitizeFilename(metadata.filename),
    contentType: sanitizeContentType(metadata.contentType),
    byteSize: Math.max(0, Math.floor(metadata.byteSize)),
    inline: metadata.inline === true,
    ...(metadata.contentId
      ? { contentId: sanitizeContentId(metadata.contentId) }
      : {}),
    createdAt:
      typeof metadata.createdAt === "string"
        ? metadata.createdAt
        : new Date(0).toISOString(),
  };
}

function transportAttachment(
  metadata: StoredAttachmentMetadata,
): MailDraftTransportAttachment {
  return {
    id: metadata.attachmentId,
    source: "uploaded_file",
    attachmentId: metadata.attachmentId,
    storageKey: metadata.storageKey,
    filename: metadata.filename,
    contentType: metadata.contentType,
    byteSize: metadata.byteSize,
    inline: metadata.inline,
    ...(metadata.contentId ? { contentId: metadata.contentId } : {}),
  };
}

function assertAccount(
  metadata: StoredAttachmentMetadata,
  accountId: string,
): void {
  if (metadata.accountId !== accountId) {
    throw new Error("attachment blob was not found");
  }
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

function sanitizeFilename(value: string): string {
  const trimmed = value.replace(/[\u0000-\u001f/\\]/g, "_").trim();
  return trimmed.slice(0, 180) || "attachment";
}

function sanitizeContentType(value: string): string {
  const trimmed = value.replace(/[\u0000-\u001f]/g, "").trim().toLowerCase();
  return trimmed.includes("/")
    ? trimmed.slice(0, 120)
    : "application/octet-stream";
}

function sanitizeContentId(value: string): string {
  return value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 180);
}
