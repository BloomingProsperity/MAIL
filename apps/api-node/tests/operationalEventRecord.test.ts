import { describe, expect, it } from "vitest";

import { createOperationalEventLogService } from "../src/logging/operational-events";

describe("operational event recording service", () => {
  it("sanitizes and persists user-triggered backend diagnostic events", async () => {
    const records: unknown[] = [];
    const service = createOperationalEventLogService({
      store: {
        async list() {
          throw new Error("not used");
        },
        async record(input) {
          records.push(input);
          return {
            id: "event_1",
            occurredAt: "2026-06-14T04:00:00.000Z",
            ...input,
          };
        },
      },
      createId: () => "event_1",
      now: () => "2026-06-14T04:00:00.000Z",
    });

    await expect(
      service.recordEvent({
        service: "email-hub-api",
        level: "info",
        event: "sync_control_retry_failed",
        accountId: "acc_1",
        message: "Requeued failed sync jobs",
        context: {
          callbackUrl: "/oauth/callback?code=raw-code&state=state_1",
          refreshToken: "raw-refresh-token",
        },
      }),
    ).resolves.toMatchObject({
      id: "event_1",
      service: "email-hub-api",
      event: "sync_control_retry_failed",
    });

    expect(records).toEqual([
      {
        id: "event_1",
        occurredAt: "2026-06-14T04:00:00.000Z",
        service: "email-hub-api",
        level: "info",
        event: "sync_control_retry_failed",
        accountId: "acc_1",
        message: "Requeued failed sync jobs",
        context: {
          callbackUrl: "/oauth/callback?code=%5Bredacted%5D&state=state_1",
          refreshToken: "[redacted]",
        },
      },
    ]);
  });
});
