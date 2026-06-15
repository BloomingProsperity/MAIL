import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
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
});
