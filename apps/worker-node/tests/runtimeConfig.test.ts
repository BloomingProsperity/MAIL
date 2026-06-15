import { describe, expect, it } from "vitest";

import { readWorkerRuntimeConfig } from "../src/runtime-config";

describe("worker runtime configuration", () => {
  it("uses stable defaults when runtime limits are not configured", () => {
    expect(readWorkerRuntimeConfig({})).toEqual({
      leaseSeconds: 60,
      concurrency: 4,
      pollMs: 5000,
    });
  });

  it("sanitizes invalid runtime values so Docker workers cannot hot-loop or create invalid leases", () => {
    expect(
      readWorkerRuntimeConfig({
        WORKER_LEASE_SECONDS: "not-a-number",
        WORKER_CONCURRENCY: "0",
        WORKER_POLL_MS: "-10",
      }),
    ).toEqual({
      leaseSeconds: 60,
      concurrency: 1,
      pollMs: 100,
    });
  });

  it("caps oversized runtime values to bounded self-hosted worker limits", () => {
    expect(
      readWorkerRuntimeConfig({
        WORKER_LEASE_SECONDS: "999999",
        WORKER_CONCURRENCY: "999",
        WORKER_POLL_MS: "999999999",
      }),
    ).toEqual({
      leaseSeconds: 3600,
      concurrency: 64,
      pollMs: 300000,
    });
  });
});
