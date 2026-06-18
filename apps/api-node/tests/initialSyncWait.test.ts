import { describe, expect, it } from "vitest";

import { waitForInitialSyncReady } from "../src/mail-engine/initial-sync-wait";

describe("initial sync wait", () => {
  it("waits against the worker retry schedule instead of burning fast polls", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({
        items: [
          {
            accountId: "acc_1",
            latestSyncJob:
              calls === 1
                ? {
                    id: "job_1",
                    status: "queued",
                    attempts: 4,
                    maxAttempts: 8,
                    notBefore: "2026-06-18T04:00:00.000Z",
                    errorMessage: "EmailEngine request failed: NotYetConnected",
                  }
                : {
                    id: "job_1",
                    status: "done",
                    attempts: 5,
                    maxAttempts: 8,
                    notBefore: "2026-06-18T04:00:00.000Z",
                  },
          },
        ],
      });
    };

    await waitForInitialSyncReady({
      apiBaseUrl: "http://127.0.0.1:8080",
      fetchImpl: fetchImpl as typeof fetch,
      accountId: "acc_1",
      syncJobId: "job_1",
      attempts: 3,
      pollMs: 2000,
      retryAwareDelayMaxMs: 10_000,
      now: () => new Date("2026-06-18T03:58:00.000Z"),
      delayMs: async (ms) => {
        delays.push(ms);
      },
      errorPrefix: "EmailEngine smoke",
    });

    expect(delays).toEqual([10_000]);
    expect(calls).toBe(2);
  });

  it("reports retry state without leaking sensitive error details", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        items: [
          {
            accountId: "acc_1",
            latestSyncJob: {
              id: "job_1",
              status: "queued",
              attempts: 4,
              maxAttempts: 8,
              notBefore: "2026-06-18T04:00:00.000Z",
              errorMessage:
                "EmailEngine request failed password=hunter2 http://127.0.0.1:3000/path?token=abc",
            },
          },
        ],
      });

    await expect(
      waitForInitialSyncReady({
        apiBaseUrl: "http://127.0.0.1:8080",
        fetchImpl: fetchImpl as typeof fetch,
        accountId: "acc_1",
        syncJobId: "job_1",
        attempts: 1,
        pollMs: 2000,
        delayMs: async () => {},
        errorPrefix: "EmailEngine smoke",
      }),
    ).rejects.toThrow(
      "latest status queued; attempts 4/8; next retry 2026-06-18T04:00:00.000Z",
    );

    await expect(
      waitForInitialSyncReady({
        apiBaseUrl: "http://127.0.0.1:8080",
        fetchImpl: fetchImpl as typeof fetch,
        accountId: "acc_1",
        syncJobId: "job_1",
        attempts: 1,
        pollMs: 2000,
        delayMs: async () => {},
        errorPrefix: "EmailEngine smoke",
      }),
    ).rejects.not.toThrow(/hunter2|127\.0\.0\.1|token=abc/);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
