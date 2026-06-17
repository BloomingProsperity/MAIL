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
          workerId: "worker_1",
          endpointUrl: "/oauth/callback?code=raw-code&state=state_1",
          inputMode: "preset",
          message: "subject should not be logged",
          subject: "Reset your password",
          bodyText: "Private body",
          providerPayload: { id: "provider-message" },
          prompt: "Summarize this mailbox",
          output: "Private model output",
          error: new Error("cookie raw-cookie leaked"),
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
          workerId: "worker_1",
          endpointUrl: "/oauth/callback?code=%5Bredacted%5D&state=state_1",
          inputMode: "preset",
          message: "[redacted]",
          error: {
            name: "Error",
            message: "[redacted]",
          },
        },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("raw-");
    expect(JSON.stringify(records)).not.toContain("Private body");
    expect(JSON.stringify(records)).not.toContain("provider-message");
    expect(JSON.stringify(records)).not.toContain("Summarize this mailbox");
  });

  it("sanitizes historical operational event rows before returning diagnostics", async () => {
    const service = createOperationalEventLogService({
      store: {
        async list() {
          return {
            items: [
              {
                id: "event_1",
                occurredAt: "2026-06-14T04:00:00.000Z",
                service: "email-hub-worker",
                level: "error",
                event: "worker_result",
                message: "Authorization token leaked",
                context: {
                  workerId: "worker_1",
                  endpointUrl: "/oauth/callback?code=raw-code&state=state_1",
                  inputMode: "preset",
                  result: {
                    status: "failed",
                    accountId: "acc_1",
                    providerPayload: { id: "provider-message" },
                  },
                  errorMessage: "body raw-body leaked",
                },
              },
            ],
          };
        },
        async record() {
          throw new Error("not used");
        },
      },
    });

    await expect(service.listEvents()).resolves.toEqual({
      items: [
        {
          id: "event_1",
          occurredAt: "2026-06-14T04:00:00.000Z",
          service: "email-hub-worker",
          level: "error",
          event: "worker_result",
          message: "[redacted]",
          context: {
            workerId: "worker_1",
            endpointUrl: "/oauth/callback?code=%5Bredacted%5D&state=state_1",
            inputMode: "preset",
            result: {
              status: "failed",
              accountId: "acc_1",
            },
            errorMessage: "[redacted]",
          },
        },
      ],
    });
  });
});
