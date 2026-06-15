import { describe, expect, it } from "vitest";

import {
  createComposeAttachmentCleanupLane,
  runComposeAttachmentCleanupOnce,
} from "../src/compose-attachment-cleanup-runner";

describe("compose attachment cleanup runner", () => {
  it("prunes only after loading active draft storage references", async () => {
    const calls: unknown[] = [];

    const result = await runComposeAttachmentCleanupOnce({
      referenceStore: {
        async listActiveStorageKeys() {
          calls.push(["list"]);
          return ["active_key"];
        },
      },
      blobStore: {
        async pruneUnreferencedUploads(input) {
          calls.push(["prune", input]);
          return {
            scanned: 2,
            deleted: 1,
            retained: 1,
            skippedFresh: 0,
            skippedProtected: 1,
            skippedInvalid: 0,
            bytesDeleted: 5,
          };
        },
      },
      now: new Date("2026-06-15T00:00:00.000Z"),
      minAgeMs: 604800000,
      limit: 100,
    });

    expect(result).toEqual({
      status: "processed",
      scanned: 2,
      deleted: 1,
      retained: 1,
      skippedFresh: 0,
      skippedProtected: 1,
      skippedInvalid: 0,
      bytesDeleted: 5,
    });
    expect(calls).toEqual([
      ["list"],
      [
        "prune",
        {
          now: new Date("2026-06-15T00:00:00.000Z"),
          minAgeMs: 604800000,
          protectedStorageKeys: ["active_key"],
          limit: 100,
        },
      ],
    ]);
  });

  it("keeps idle cleanup ticks quiet when nothing was deleted", async () => {
    const result = await runComposeAttachmentCleanupOnce({
      referenceStore: {
        async listActiveStorageKeys() {
          return [];
        },
      },
      blobStore: {
        async pruneUnreferencedUploads() {
          return {
            scanned: 1,
            deleted: 0,
            retained: 1,
            skippedFresh: 1,
            skippedProtected: 0,
            skippedInvalid: 0,
            bytesDeleted: 0,
          };
        },
      },
      now: new Date("2026-06-15T00:00:00.000Z"),
      minAgeMs: 604800000,
      limit: 100,
    });

    expect(result).toEqual({ status: "idle" });
  });

  it("throttles cleanup scans between configured intervals", async () => {
    let now = new Date("2026-06-15T00:00:00.000Z");
    let pruneCalls = 0;
    const lane = createComposeAttachmentCleanupLane({
      referenceStore: {
        async listActiveStorageKeys() {
          return [];
        },
      },
      blobStore: {
        async pruneUnreferencedUploads() {
          pruneCalls += 1;
          return {
            scanned: 1,
            deleted: pruneCalls,
            retained: 0,
            skippedFresh: 0,
            skippedProtected: 0,
            skippedInvalid: 0,
            bytesDeleted: 5,
          };
        },
      },
      clock: () => now,
      intervalMs: 60_000,
      minAgeMs: 604800000,
      limit: 100,
    });

    await expect(lane()).resolves.toEqual([
      expect.objectContaining({ status: "processed", deleted: 1 }),
    ]);
    await expect(lane()).resolves.toEqual([{ status: "idle" }]);

    now = new Date("2026-06-15T00:01:00.000Z");
    await expect(lane()).resolves.toEqual([
      expect.objectContaining({ status: "processed", deleted: 2 }),
    ]);
  });
});
