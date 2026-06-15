import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertSmokeResponse,
  buildSmokeWebhookRequest,
} from "../src/mail-engine/webhook-smoke";

describe("EmailEngine webhook smoke helpers", () => {
  it("builds an EmailEngine-compatible signed webhook request", () => {
    const request = buildSmokeWebhookRequest({
      apiBaseUrl: "http://127.0.0.1:8080/",
      secret: "webhook-secret",
      accountId: "smoke_account",
      messageId: "smoke_message",
      eventId: "smoke_event",
    });

    const expectedSignature = createHmac("sha256", "webhook-secret")
      .update(request.body)
      .digest("base64url");

    expect(request.url).toBe(
      "http://127.0.0.1:8080/api/webhooks/emailengine",
    );
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      "content-type": "application/json",
      "x-ee-wh-event-id": "smoke_event",
      "x-ee-wh-signature": expectedSignature,
    });
    expect(JSON.parse(request.body)).toEqual({
      event: "messageNew",
      account: "smoke_account",
      path: "INBOX",
      data: {
        id: "smoke_message",
        threadId: "thread_smoke_message",
        messageId: "<smoke_message@emailhub-smoke.local>",
      },
    });
  });

  it("requires the first smoke delivery to enqueue a sync job", () => {
    expect(() =>
      assertSmokeResponse({
        phase: "first",
        status: 202,
        body: {
          duplicateCount: 0,
          events: [
            {
              accountId: "smoke_account",
              idempotencyKey: "emailengine:smoke_account:event-id:smoke_event",
            },
          ],
          syncJobs: [
            {
              accountId: "smoke_account",
              status: "queued",
              idempotencyKey:
                "job:emailengine:smoke_account:event-id:smoke_event",
            },
          ],
        },
        accountId: "smoke_account",
        eventId: "smoke_event",
      }),
    ).not.toThrow();

    expect(() =>
      assertSmokeResponse({
        phase: "first",
        status: 202,
        body: {
          duplicateCount: 0,
          events: [
            {
              accountId: "smoke_account",
              idempotencyKey: "emailengine:smoke_account:event-id:smoke_event",
            },
          ],
          syncJobs: [],
        },
        accountId: "smoke_account",
        eventId: "smoke_event",
      }),
    ).toThrow("did not enqueue a sync job");
  });

  it("requires repeated smoke delivery to be idempotent", () => {
    expect(() =>
      assertSmokeResponse({
        phase: "duplicate",
        status: 202,
        body: {
          duplicateCount: 1,
          events: [
            {
              accountId: "smoke_account",
              idempotencyKey: "emailengine:smoke_account:event-id:smoke_event",
            },
          ],
          syncJobs: [],
        },
        accountId: "smoke_account",
        eventId: "smoke_event",
      }),
    ).not.toThrow();

    expect(() =>
      assertSmokeResponse({
        phase: "duplicate",
        status: 202,
        body: {
          duplicateCount: 0,
          events: [
            {
              accountId: "smoke_account",
              idempotencyKey: "emailengine:smoke_account:event-id:smoke_event",
            },
          ],
          syncJobs: [
            {
              accountId: "smoke_account",
              status: "queued",
              idempotencyKey:
                "job:emailengine:smoke_account:event-id:smoke_event",
            },
          ],
        },
        accountId: "smoke_account",
        eventId: "smoke_event",
      }),
    ).toThrow("was not idempotent");
  });
});
