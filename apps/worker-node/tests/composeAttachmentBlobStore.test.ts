import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

  it("rejects corrupted uploaded bytes when metadata includes a checksum", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-scheduled-attachments-"),
    );
    const storageKey = "11111111-1111-4111-8111-111111111111";

    try {
      await writeFile(path.join(rootDir, `${storageKey}.bin`), "HELLO");
      await writeFile(
        path.join(rootDir, `${storageKey}.json`),
        JSON.stringify({
          accountId: "acc_1",
          storageKey,
          byteSize: 5,
          sha256:
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        }),
        "utf8",
      );

      const store = createLocalScheduledAttachmentBlobStore({ rootDir });

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

  it("prunes stale orphaned blob and partial upload files", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-scheduled-attachments-"),
    );
    const staleOrphanKey = "11111111-1111-4111-8111-111111111111";
    const stalePartKey = "22222222-2222-4222-8222-222222222222";
    const freshPartKey = "33333333-3333-4333-8333-333333333333";
    const protectedOrphanKey = "44444444-4444-4444-8444-444444444444";

    try {
      await writeOrphanFile(rootDir, `${staleOrphanKey}.bin`, 10, "2026-06-01T00:00:00.000Z");
      await writeOrphanFile(rootDir, `${stalePartKey}.bin.part`, 20, "2026-06-01T00:00:00.000Z");
      await writeOrphanFile(rootDir, `${freshPartKey}.json.part`, 30, "2026-06-14T23:30:00.000Z");
      await writeOrphanFile(rootDir, `${protectedOrphanKey}.bin`, 40, "2026-06-01T00:00:00.000Z");

      const store = createLocalScheduledAttachmentBlobStore({ rootDir });

      await expect(
        store.pruneUnreferencedUploads({
          now: new Date("2026-06-15T00:00:00.000Z"),
          minAgeMs: 24 * 60 * 60 * 1000,
          protectedStorageKeys: [protectedOrphanKey],
          limit: 10,
        }),
      ).resolves.toEqual({
        scanned: 4,
        deleted: 2,
        retained: 2,
        skippedFresh: 1,
        skippedProtected: 1,
        skippedInvalid: 0,
        bytesDeleted: 30,
      });

      await expect(readFile(path.join(rootDir, `${staleOrphanKey}.bin`))).rejects.toThrow();
      await expect(readFile(path.join(rootDir, `${stalePartKey}.bin.part`))).rejects.toThrow();
      await expect(
        readFile(path.join(rootDir, `${freshPartKey}.json.part`), "utf8"),
      ).resolves.toBe("x".repeat(30));
      await expect(
        readFile(path.join(rootDir, `${protectedOrphanKey}.bin`), "utf8"),
      ).resolves.toBe("x".repeat(40));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("prunes stale invalid metadata when it is not referenced by an active draft", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-scheduled-attachments-"),
    );
    const invalidKey = "11111111-1111-4111-8111-111111111111";
    const invalidMetadata = JSON.stringify({
      accountId: "acc_1",
      storageKey: "22222222-2222-4222-8222-222222222222",
      byteSize: 5,
      createdAt: "2026-06-01T00:00:00.000Z",
    });

    try {
      await writeFile(path.join(rootDir, `${invalidKey}.bin`), "hello");
      await writeFile(
        path.join(rootDir, `${invalidKey}.json`),
        invalidMetadata,
        "utf8",
      );
      await touchUploadFiles(rootDir, invalidKey, "2026-06-01T00:00:00.000Z");

      const store = createLocalScheduledAttachmentBlobStore({ rootDir });

      await expect(
        store.pruneUnreferencedUploads({
          now: new Date("2026-06-15T00:00:00.000Z"),
          minAgeMs: 24 * 60 * 60 * 1000,
          protectedStorageKeys: [],
          limit: 10,
        }),
      ).resolves.toEqual({
        scanned: 1,
        deleted: 1,
        retained: 0,
        skippedFresh: 0,
        skippedProtected: 0,
        skippedInvalid: 0,
        bytesDeleted: Buffer.byteLength("hello") + Buffer.byteLength(invalidMetadata),
      });

      await expect(readFile(path.join(rootDir, `${invalidKey}.bin`))).rejects.toThrow();
      await expect(readFile(path.join(rootDir, `${invalidKey}.json`))).rejects.toThrow();
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

async function writeOrphanFile(
  rootDir: string,
  filename: string,
  byteSize: number,
  modifiedAt: string,
): Promise<void> {
  const filePath = path.join(rootDir, filename);
  await writeFile(filePath, Buffer.alloc(byteSize, "x"));
  const timestamp = new Date(modifiedAt);
  await utimes(filePath, timestamp, timestamp);
}

async function touchUploadFiles(
  rootDir: string,
  storageKey: string,
  modifiedAt: string,
): Promise<void> {
  const timestamp = new Date(modifiedAt);
  await Promise.all(
    [".bin", ".json"].map((suffix) =>
      utimes(path.join(rootDir, `${storageKey}${suffix}`), timestamp, timestamp),
    ),
  );
}
