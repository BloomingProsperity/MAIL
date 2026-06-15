import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalScheduledAttachmentBlobStore } from "../src/compose-attachment-blob-store";

describe("local scheduled attachment blob store", () => {
  it("hydrates uploaded bytes from the shared compose attachment volume", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-scheduled-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      await writeFile(path.join(rootDir, `${storageKey}.bin`), "hello");
      await writeFile(
        path.join(rootDir, `${storageKey}.json`),
        JSON.stringify({
          accountId: "acc_1",
          storageKey,
          byteSize: 5,
        }),
        "utf8",
      );

      const store = createLocalScheduledAttachmentBlobStore({ rootDir });

      await expect(
        store.loadUploadedAttachmentContent({
          accountId: "acc_2",
          storageKey,
          maxBytes: 5,
        }),
      ).rejects.toThrow("attachment blob was not found");

      expect(
        await store.loadUploadedAttachmentContent({
          accountId: "acc_1",
          storageKey,
          maxBytes: 5,
        }),
      ).toEqual({
        contentBase64: Buffer.from("hello").toString("base64"),
        byteSize: 5,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
