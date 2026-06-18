import { describe, expect, it, vi } from "vitest";
import { createEmailHubApi } from "../../lib/emailHubApi";

describe("sync center API latest job summaries", () => {
  it("preserves latest sync job fields from the account list route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            accountId: "acc_1",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            syncState: "syncing",
            engineProvider: "emailengine",
            reauthRequired: false,
            nextAction: "wait_for_sync",
            accountUpdatedAt: "2026-06-13T08:00:00.000Z",
            latestSyncJob: {
              id: "job_1",
              jobType: "sync_account",
              status: "running",
              attempts: 2,
              maxAttempts: 8,
              notBefore: "2026-06-13T08:01:00.000Z",
              leaseExpiresAt: "2026-06-13T08:06:00.000Z",
              updatedAt: "2026-06-13T08:02:00.000Z",
            },
          },
        ],
      }),
    );
    const api = createEmailHubApi({ fetchImpl: fetchMock as any });

    const page = await api.listSyncCenterAccounts();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync-center/accounts",
      expect.objectContaining({ method: "GET" }),
    );
    expect(page.items[0].latestSyncJob).toEqual({
      id: "job_1",
      jobType: "sync_account",
      status: "running",
      attempts: 2,
      maxAttempts: 8,
      notBefore: "2026-06-13T08:01:00.000Z",
      leaseExpiresAt: "2026-06-13T08:06:00.000Z",
      updatedAt: "2026-06-13T08:02:00.000Z",
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
