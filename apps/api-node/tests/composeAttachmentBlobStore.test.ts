import { Buffer } from "node:buffer";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  ComposeAttachmentBlobTooLargeError,
  createLocalComposeAttachmentBlobStore,
} from "../src/mail-compose/compose-attachment-blob-store";

describe("local compose attachment blob store", () => {
  it("saves uploaded bytes, reloads metadata, and enforces account ownership", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      const store = createLocalComposeAttachmentBlobStore({
        rootDir,
        createId: () => storageKey,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
      });

      const attachment = await store.saveUploadedAttachment({
        accountId: "acc_1",
        bytes: Buffer.from("hello"),
        filename: "brief.txt",
        contentType: "text/plain",
      });

      expect(attachment).toEqual({
        id: `upload_${storageKey}`,
        source: "uploaded_file",
        attachmentId: `upload_${storageKey}`,
        storageKey,
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
        inline: false,
      });

      await expect(
        store.getUploadedAttachment({
          accountId: "acc_2",
          storageKey,
        }),
      ).rejects.toThrow("attachment blob was not found");

      await expect(
        store.loadUploadedAttachmentContent({
          accountId: "acc_1",
          storageKey,
          maxBytes: 4,
        }),
      ).rejects.toThrow("attachments are too large");

      expect(
        await store.loadUploadedAttachmentContent({
          accountId: "acc_1",
          storageKey,
          maxBytes: 5,
        }),
      ).toEqual({
        contentBase64: "aGVsbG8=",
        byteSize: 5,
      });
      await expect(readMetadata(rootDir, storageKey)).resolves.toMatchObject({
        sha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects metadata when the stored key does not match the filename", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      const store = createLocalComposeAttachmentBlobStore({
        rootDir,
        createId: () => storageKey,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
      });
      await store.saveUploadedAttachment({
        accountId: "acc_1",
        bytes: Buffer.from("hello"),
        filename: "brief.txt",
        contentType: "text/plain",
      });
      await writeFile(
        path.join(rootDir, `${storageKey}.json`),
        JSON.stringify({
          accountId: "acc_1",
          attachmentId: `upload_${storageKey}`,
          storageKey: "22222222-2222-4222-8222-222222222222",
          filename: "brief.txt",
          contentType: "text/plain",
          byteSize: 5,
          inline: false,
          createdAt: "2026-06-15T00:00:00.000Z",
        }),
        "utf8",
      );

      await expect(
        store.getUploadedAttachment({
          accountId: "acc_1",
          storageKey,
        }),
      ).rejects.toThrow("attachment blob metadata is invalid");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("streams uploaded bytes to disk without requiring an in-memory body", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      const store = createLocalComposeAttachmentBlobStore({
        rootDir,
        createId: () => storageKey,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
      });

      const attachment = await store.saveUploadedAttachmentStream!({
        accountId: "acc_1",
        stream: Readable.from([Buffer.from("hel"), Buffer.from("lo")]),
        maxBytes: 5,
        filename: "brief.txt",
        contentType: "text/plain",
      });

      expect(attachment).toMatchObject({
        id: `upload_${storageKey}`,
        storageKey,
        filename: "brief.txt",
        contentType: "text/plain",
        byteSize: 5,
      });
      expect(
        await store.loadUploadedAttachmentContent({
          accountId: "acc_1",
          storageKey,
          maxBytes: 5,
        }),
      ).toEqual({
        contentBase64: "aGVsbG8=",
        byteSize: 5,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("removes partial stream uploads when the body exceeds the upload limit", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      const store = createLocalComposeAttachmentBlobStore({
        rootDir,
        createId: () => storageKey,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
      });

      await expect(
        store.saveUploadedAttachmentStream!({
          accountId: "acc_1",
          stream: Readable.from([Buffer.from("hello")]),
          maxBytes: 4,
          filename: "brief.txt",
          contentType: "text/plain",
        }),
      ).rejects.toBeInstanceOf(ComposeAttachmentBlobTooLargeError);

      expect(await readdir(rootDir)).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps concurrent streamed uploads isolated by storage key", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-attachments-"),
    );
    const storageKeys = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ];
    let nextStorageKey = 0;

    try {
      const store = createLocalComposeAttachmentBlobStore({
        rootDir,
        createId: () => storageKeys[nextStorageKey++]!,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
      });

      const attachments = await Promise.all(
        storageKeys.map((storageKey, index) =>
          store.saveUploadedAttachmentStream!({
            accountId: "acc_1",
            stream: Readable.from([Buffer.from(`payload-${index}`)]),
            maxBytes: 32,
            filename: `brief-${index}.txt`,
            contentType: "text/plain",
          }).then((attachment) => ({ storageKey, attachment, index })),
        ),
      );

      expect(attachments.map((item) => item.attachment.storageKey)).toEqual(
        storageKeys,
      );
      await Promise.all(
        attachments.map(async ({ storageKey, index }) => {
          await expect(
            store.loadUploadedAttachmentContent({
              accountId: "acc_1",
              storageKey,
              maxBytes: 32,
            }),
          ).resolves.toEqual({
            contentBase64: Buffer.from(`payload-${index}`).toString("base64"),
            byteSize: `payload-${index}`.length,
          });
        }),
      );

      expect((await readdir(rootDir)).sort()).toEqual(
        storageKeys
          .flatMap((storageKey) => [`${storageKey}.bin`, `${storageKey}.json`])
          .sort(),
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects corrupted uploaded blobs when metadata has a checksum", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      const store = createLocalComposeAttachmentBlobStore({
        rootDir,
        createId: () => storageKey,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
      });
      await store.saveUploadedAttachment({
        accountId: "acc_1",
        bytes: Buffer.from("hello"),
        filename: "brief.txt",
        contentType: "text/plain",
      });
      await writeFile(path.join(rootDir, `${storageKey}.bin`), "HELLO");

      await expect(
        store.loadUploadedAttachmentContent({
          accountId: "acc_1",
          storageKey,
          maxBytes: 5,
        }),
      ).rejects.toThrow("attachment blob metadata mismatch");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

async function readMetadata(rootDir: string, storageKey: string) {
  return JSON.parse(
    await readFile(path.join(rootDir, `${storageKey}.json`), "utf8"),
  ) as Record<string, unknown>;
}
