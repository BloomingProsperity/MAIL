import { describe, expect, it } from "vitest";

import { readWorkerRuntimeConfig } from "../src/runtime-config";

describe("worker runtime configuration", () => {
  it("uses stable defaults when runtime limits are not configured", () => {
    expect(readWorkerRuntimeConfig({})).toEqual({
      leaseSeconds: 60,
      concurrency: 4,
      pollMs: 5000,
      composeAttachmentCleanupIntervalMs: 3600000,
      composeAttachmentRetentionMs: 604800000,
      composeAttachmentCleanupLimit: 100,
    });
  });

  it("sanitizes invalid runtime values so Docker workers cannot hot-loop or create invalid leases", () => {
    expect(
      readWorkerRuntimeConfig({
        WORKER_LEASE_SECONDS: "not-a-number",
        WORKER_CONCURRENCY: "0",
        WORKER_POLL_MS: "-10",
        COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS: "999",
        COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS: "0",
        COMPOSE_ATTACHMENT_CLEANUP_LIMIT: "0",
      }),
    ).toEqual({
      leaseSeconds: 60,
      concurrency: 1,
      pollMs: 100,
      composeAttachmentCleanupIntervalMs: 60000,
      composeAttachmentRetentionMs: 3600000,
      composeAttachmentCleanupLimit: 1,
    });
  });

  it("caps oversized runtime values to bounded self-hosted worker limits", () => {
    expect(
      readWorkerRuntimeConfig({
        WORKER_LEASE_SECONDS: "999999",
        WORKER_CONCURRENCY: "999",
        WORKER_POLL_MS: "999999999",
        COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS: "999999999",
        COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS: "999999",
        COMPOSE_ATTACHMENT_CLEANUP_LIMIT: "999999",
      }),
    ).toEqual({
      leaseSeconds: 3600,
      concurrency: 64,
      pollMs: 300000,
      composeAttachmentCleanupIntervalMs: 86400000,
      composeAttachmentRetentionMs: 7776000000,
      composeAttachmentCleanupLimit: 10000,
    });
  });
});
