import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertSmokeResponse,
  buildSmokeWebhookRequest,
  DEFAULT_EMAILENGINE_WEBHOOK_SMOKE_ACCOUNT_ID,
} from "../src/mail-engine/webhook-smoke";

describe("EmailEngine webhook smoke helpers", () => {
  it("builds a no-op signed webhook probe by default so workers do not retry fake accounts", () => {
    const request = buildSmokeWebhookRequest({
      apiBaseUrl: "http://127.0.0.1:8080/",
      secret: "webhook-secret",
      messageId: "smoke_message",
      eventId: "smoke_event",
      date: "2026-06-17T10:00:00.000Z",
    });

    expect(request.accountId).toBe(DEFAULT_EMAILENGINE_WEBHOOK_SMOKE_ACCOUNT_ID);
    expect(request.accountId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(JSON.parse(request.body)).toMatchObject({
      date: "2026-06-17T10:00:00.000Z",
      event: "emailhubSmokeProbe",
      account: DEFAULT_EMAILENGINE_WEBHOOK_SMOKE_ACCOUNT_ID,
      path: "INBOX",
      data: {
        id: "smoke_message",
      },
    });
  });

  it("builds an EmailEngine-compatible signed webhook request", () => {
    const request = buildSmokeWebhookRequest({
      apiBaseUrl: "http://127.0.0.1:8080/",
      secret: "webhook-secret",
      accountId: "smoke_account",
      eventName: "messageNew",
      messageId: "smoke_message",
      eventId: "smoke_event",
      date: "2026-06-17T10:00:00.000Z",
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
      date: "2026-06-17T10:00:00.000Z",
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
              idempotencyKey:
                "emailengine:smoke_account:messageNew:smoke_message:abc123",
            },
          ],
          syncJobs: [
            {
              accountId: "smoke_account",
              status: "queued",
              idempotencyKey:
                "job:emailengine:smoke_account:messageNew:smoke_message:abc123",
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
              idempotencyKey:
                "emailengine:smoke_account:messageNew:smoke_message:abc123",
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
              idempotencyKey:
                "emailengine:smoke_account:messageNew:smoke_message:abc123",
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
              idempotencyKey:
                "emailengine:smoke_account:messageNew:smoke_message:abc123",
            },
          ],
          syncJobs: [
            {
              accountId: "smoke_account",
              status: "queued",
              idempotencyKey:
                "job:emailengine:smoke_account:messageNew:smoke_message:abc123",
            },
          ],
        },
        accountId: "smoke_account",
        eventId: "smoke_event",
      }),
    ).toThrow("was not idempotent");
  });
});
