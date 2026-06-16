import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createComposeAttachmentMaintenanceService,
  createLocalComposeAttachmentMaintenanceBlobStore,
  createPostgresComposeAttachmentReferenceStore,
} from "../src/maintenance/compose-attachment-maintenance";

describe("compose attachment maintenance", () => {
  it("reports protected, fresh, stale, and invalid uploaded blobs", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-maintenance-"),
    );
    try {
      await writeUpload(rootDir, {
        storageKey: "11111111-1111-4111-8111-111111111111",
        byteSize: 10,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await writeUpload(rootDir, {
        storageKey: "22222222-2222-4222-8222-222222222222",
        byteSize: 20,
        createdAt: "2026-06-15T23:00:00.000Z",
      });
      await writeUpload(rootDir, {
        storageKey: "33333333-3333-4333-8333-333333333333",
        byteSize: 30,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await writeFile(
        path.join(rootDir, "44444444-4444-4444-8444-444444444444.json"),
        JSON.stringify({ broken: true }),
        "utf8",
      );

      const service = createComposeAttachmentMaintenanceService({
        referenceStore: {
          async listActiveStorageKeys() {
            return ["11111111-1111-4111-8111-111111111111"];
          },
        },
        blobStore: createLocalComposeAttachmentMaintenanceBlobStore({ rootDir }),
        now: () => new Date("2026-06-16T00:00:00.000Z"),
        retentionMs: 24 * 60 * 60 * 1000,
        cleanupLimit: 100,
      });

      await expect(service.getStatus()).resolves.toMatchObject({
        generatedAt: "2026-06-16T00:00:00.000Z",
        storage: "local",
        retentionMs: 86400000,
        cleanupLimit: 100,
        protectedStorageKeyCount: 1,
        scanned: 4,
        uploads: 3,
        totalBytes: 60,
        protected: 1,
        fresh: 1,
        staleUnreferenced: 1,
        staleUnreferencedBytes: 30,
        invalid: 1,
        oldestCreatedAt: "2026-06-01T00:00:00.000Z",
        newestCreatedAt: "2026-06-15T23:00:00.000Z",
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("prunes only stale unreferenced uploads and keeps active references", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "email-hub-compose-maintenance-"),
    );
    const protectedKey = "11111111-1111-4111-8111-111111111111";
    const staleKey = "22222222-2222-4222-8222-222222222222";
    const freshKey = "33333333-3333-4333-8333-333333333333";
    try {
      await writeUpload(rootDir, {
        storageKey: protectedKey,
        byteSize: 10,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await writeUpload(rootDir, {
        storageKey: staleKey,
        byteSize: 20,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      await writeUpload(rootDir, {
        storageKey: freshKey,
        byteSize: 30,
        createdAt: "2026-06-15T23:00:00.000Z",
      });
      const service = createComposeAttachmentMaintenanceService({
        referenceStore: {
          async listActiveStorageKeys() {
            return [protectedKey];
          },
        },
        blobStore: createLocalComposeAttachmentMaintenanceBlobStore({ rootDir }),
        now: () => new Date("2026-06-16T00:00:00.000Z"),
        retentionMs: 24 * 60 * 60 * 1000,
        cleanupLimit: 100,
      });

      const result = await service.cleanup();

      expect(result.cleanup).toEqual({
        scanned: 3,
        deleted: 1,
        retained: 2,
        skippedFresh: 1,
        skippedProtected: 1,
        skippedInvalid: 0,
        bytesDeleted: 20,
      });
      await expect(readFile(path.join(rootDir, `${staleKey}.json`))).rejects.toThrow();
      await expect(readFile(path.join(rootDir, `${protectedKey}.json`))).resolves.toBeTruthy();
      await expect(readFile(path.join(rootDir, `${freshKey}.json`))).resolves.toBeTruthy();
      expect(result.after.staleUnreferenced).toBe(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("queries active uploaded attachment storage keys from draft manifests", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresComposeAttachmentReferenceStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            { storage_key: "11111111-1111-4111-8111-111111111111" },
            { storage_key: " " },
            { storage_key: null },
          ],
        };
      },
    });

    await expect(store.listActiveStorageKeys()).resolves.toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(queries[0].text).toMatch(/FROM email_drafts/i);
    expect(queries[0].text).toMatch(/status IN \('draft', 'scheduled', 'queued', 'sending', 'failed'\)/i);
  });
});

async function writeUpload(
  rootDir: string,
  input: {
    storageKey: string;
    byteSize: number;
    createdAt: string;
  },
) {
  await writeFile(
    path.join(rootDir, `${input.storageKey}.bin`),
    Buffer.alloc(input.byteSize, "x"),
  );
  await writeFile(
    path.join(rootDir, `${input.storageKey}.json`),
    JSON.stringify({
      accountId: "account_1",
      storageKey: input.storageKey,
      byteSize: input.byteSize,
      createdAt: input.createdAt,
    }),
    "utf8",
  );
}
