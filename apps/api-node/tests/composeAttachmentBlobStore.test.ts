import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalComposeAttachmentBlobStore } from "../src/mail-compose/compose-attachment-blob-store";

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
});
