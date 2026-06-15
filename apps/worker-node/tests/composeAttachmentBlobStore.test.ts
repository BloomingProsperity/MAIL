import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("prunes stale unreferenced uploads while protecting active storage keys", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-scheduled-attachments-"),
    );
    const staleKey = "11111111-1111-4111-8111-111111111111";
    const protectedKey = "22222222-2222-4222-8222-222222222222";
    const freshKey = "33333333-3333-4333-8333-333333333333";
    const mismatchedKey = "44444444-4444-4444-8444-444444444444";

    try {
      await writeStoredAttachment(rootDir, {
        storageKey: staleKey,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await writeStoredAttachment(rootDir, {
        storageKey: protectedKey,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await writeStoredAttachment(rootDir, {
        storageKey: freshKey,
        createdAt: "2026-06-14T23:00:00.000Z",
      });
      await writeFile(path.join(rootDir, `${mismatchedKey}.bin`), "hello");
      await writeFile(
        path.join(rootDir, `${mismatchedKey}.json`),
        JSON.stringify({
          accountId: "acc_1",
          storageKey: "55555555-5555-4555-8555-555555555555",
          byteSize: 5,
          createdAt: "2026-06-01T00:00:00.000Z",
        }),
        "utf8",
      );

      const store = createLocalScheduledAttachmentBlobStore({ rootDir });

      await expect(
        store.pruneUnreferencedUploads({
          now: new Date("2026-06-15T00:00:00.000Z"),
          minAgeMs: 24 * 60 * 60 * 1000,
          protectedStorageKeys: [protectedKey],
          limit: 10,
        }),
      ).resolves.toEqual({
        scanned: 4,
        deleted: 1,
        retained: 2,
        skippedFresh: 1,
        skippedProtected: 1,
        skippedInvalid: 1,
        bytesDeleted: 5,
      });

      await expect(readFile(path.join(rootDir, `${staleKey}.bin`))).rejects.toThrow();
      await expect(
        readFile(path.join(rootDir, `${protectedKey}.bin`), "utf8"),
      ).resolves.toBe("hello");
      await expect(
        readFile(path.join(rootDir, `${freshKey}.bin`), "utf8"),
      ).resolves.toBe("hello");
      await expect(
        readFile(path.join(rootDir, `${mismatchedKey}.bin`), "utf8"),
      ).resolves.toBe("hello");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

async function writeStoredAttachment(
  rootDir: string,
  input: {
    storageKey: string;
    createdAt: string;
  },
): Promise<void> {
  await writeFile(path.join(rootDir, `${input.storageKey}.bin`), "hello");
  await writeFile(
    path.join(rootDir, `${input.storageKey}.json`),
    JSON.stringify({
      accountId: "acc_1",
      storageKey: input.storageKey,
      byteSize: 5,
      createdAt: input.createdAt,
    }),
    "utf8",
  );
}
