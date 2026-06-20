import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  normalizeEmailEngineWebhook,
  verifyEmailEngineWebhookFreshness,
  verifyEmailEngineSignature,
} from "../src/mail-engine/webhook";

function signature(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

describe("EmailEngine webhook contract", () => {
  it("verifies base64url HMAC signatures with and without a sha256 prefix", () => {
    const body = JSON.stringify({
      event: "messageNew",
      account: "acc_1",
      data: { id: "msg_1" },
    });
    const signed = signature("webhook-secret", body);

    expect(
      verifyEmailEngineSignature({
        secret: "webhook-secret",
        body,
        signature: signed,
      }),
    ).toBe(true);
    expect(
      verifyEmailEngineSignature({
        secret: "webhook-secret",
        body,
        signature: `sha256=${signed}`,
      }),
    ).toBe(true);
    expect(
      verifyEmailEngineSignature({
        secret: "webhook-secret",
        body,
        signature: signature("wrong-secret", body),
      }),
    ).toBe(false);
  });

  it("normalizes EmailEngine message events into provider-neutral sync events", () => {
    const events = normalizeEmailEngineWebhook({
      event: "messageNew",
      account: "acc_1",
      path: "INBOX",
      data: {
        id: "msg_1",
        threadId: "thread_1",
      },
    });

    expect(events[0]).toMatchObject({
      source: "emailengine_webhook",
      kind: "message_upserted",
      accountId: "acc_1",
      mailboxId: "INBOX",
      providerMessageId: "msg_1",
      providerThreadId: "thread_1",
    });
    expect(events[0].idempotencyKey).toMatch(
      /^emailengine:acc_1:messageNew:msg_1:/,
    );
  });

  it("does not collapse messageNew and messageUpdated for the same provider message", () => {
    const [messageNew] = normalizeEmailEngineWebhook({
      event: "messageNew",
      account: "acc_1",
      path: "INBOX",
      data: { id: "msg_1" },
    });
    const [messageUpdated] = normalizeEmailEngineWebhook({
      event: "messageUpdated",
      account: "acc_1",
      path: "INBOX",
      data: {
        id: "msg_1",
        changes: { flags: { added: ["\\Seen"], value: ["\\Seen"] } },
      },
    });

    expect(messageNew.kind).toBe("message_upserted");
    expect(messageUpdated.kind).toBe("message_upserted");
    expect(messageNew.idempotencyKey).not.toBe(messageUpdated.idempotencyKey);
    expect(messageNew.idempotencyKey).toMatch(
      /^emailengine:acc_1:messageNew:msg_1:/,
    );
    expect(messageUpdated.idempotencyKey).toMatch(
      /^emailengine:acc_1:messageUpdated:msg_1:/,
    );
  });

  it("keeps different flag and label updates for the same message as separate webhook events", () => {
    const [readEvent] = normalizeEmailEngineWebhook({
      event: "messageUpdated",
      account: "acc_1",
      path: "INBOX",
      data: {
        id: "msg_1",
        changes: { flags: { added: ["\\Seen"], value: ["\\Seen"] } },
      },
    });
    const [starEvent] = normalizeEmailEngineWebhook({
      event: "messageUpdated",
      account: "acc_1",
      path: "INBOX",
      data: {
        id: "msg_1",
        changes: {
          flags: { added: ["\\Flagged"], value: ["\\Seen", "\\Flagged"] },
        },
      },
    });
    const [labelEvent] = normalizeEmailEngineWebhook({
      event: "messageUpdated",
      account: "acc_1",
      path: "INBOX",
      data: {
        id: "msg_1",
        changes: {
          labels: { added: ["IMPORTANT"], value: ["INBOX", "IMPORTANT"] },
        },
      },
    });

    expect(
      new Set([
        readEvent.idempotencyKey,
        starEvent.idempotencyKey,
        labelEvent.idempotencyKey,
      ]).size,
    ).toBe(3);
  });

  it("ignores unsigned delivery event ids when building idempotency keys", () => {
    const payload = {
      event: "messageNew",
      account: "acc_1",
      data: { id: "msg_1" },
    };
    const [first] = normalizeEmailEngineWebhook(payload, {
      deliveryEventId: "evt_123",
    });
    const [replayedWithChangedHeader] = normalizeEmailEngineWebhook(payload, {
      deliveryEventId: "evt_456",
    });

    expect(first.idempotencyKey).toBe(replayedWithChangedHeader.idempotencyKey);
    expect(first.idempotencyKey).toMatch(
      /^emailengine:acc_1:messageNew:msg_1:/,
    );
  });

  it("uses signed payload event ids as stable delivery idempotency keys", () => {
    const [rootEventId] = normalizeEmailEngineWebhook({
      event: "messageNew",
      eventId: "evt_signed_root",
      account: "acc_1",
      data: { id: "msg_1" },
    });
    const [dataEventId] = normalizeEmailEngineWebhook({
      event: "messageUpdated",
      account: "acc_1",
      data: {
        id: "msg_1",
        eventId: "evt_signed_data",
      },
    });

    expect(rootEventId.idempotencyKey).toBe(
      "emailengine:acc_1:event-id:evt_signed_root",
    );
    expect(dataEventId.idempotencyKey).toBe(
      "emailengine:acc_1:event-id:evt_signed_data",
    );
  });

  it("separates stable message resource identity from webhook delivery identity", () => {
    const [event] = normalizeEmailEngineWebhook({
      event: "messageNew",
      account: "acc_1",
      path: "INBOX",
      data: {
        id: "ee_msg_1",
        emailId: "stable_email_1",
        messageId: "<rfc-message@example.com>",
        uid: 12345,
        threadId: "thread_1",
      },
    });

    expect(event).toMatchObject({
      providerMessageId: "ee_msg_1",
      providerEmailId: "stable_email_1",
      rfcMessageId: "<rfc-message@example.com>",
      providerUid: "12345",
      providerPath: "INBOX",
      resourceKey: "emailengine:acc_1:emailId:stable_email_1",
      resourceIdentity: {
        emailengineMessageId: "ee_msg_1",
        emailengineEmailId: "stable_email_1",
        internetMessageId: "<rfc-message@example.com>",
        imapUid: "12345",
        mailboxPath: "INBOX",
        threadId: "thread_1",
        resourceKey: "emailengine:acc_1:emailId:stable_email_1",
      },
      idempotencyKey: expect.stringMatching(
        /^emailengine:acc_1:messageNew:ee_msg_1:/,
      ),
    });
  });

  it("accepts fresh signed webhook dates and rejects stale or malformed dates", () => {
    const now = new Date("2026-06-17T10:00:00.000Z");

    expect(
      verifyEmailEngineWebhookFreshness({
        payload: { event: "messageNew", date: "2026-06-17T09:55:01.000Z" },
        now,
        maxSkewMs: 5 * 60 * 1000,
      }),
    ).toEqual({ ok: true, date: "2026-06-17T09:55:01.000Z" });
    expect(
      verifyEmailEngineWebhookFreshness({
        payload: { event: "messageNew", date: "2026-06-17T09:54:59.000Z" },
        now,
        maxSkewMs: 5 * 60 * 1000,
      }),
    ).toEqual({ ok: false, reason: "outside_window" });
    expect(
      verifyEmailEngineWebhookFreshness({
        payload: { event: "messageNew", date: "not-a-date" },
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_date" });
    expect(
      verifyEmailEngineWebhookFreshness({
        payload: { event: "messageNew" },
        now,
      }),
    ).toEqual({ ok: false, reason: "missing_date" });
  });

  it("falls back through RFC Message-ID, EmailEngine id, and uid/path for resource keys", () => {
    const [rfcOnly] = normalizeEmailEngineWebhook({
      event: "messageNew",
      account: "acc_1",
      data: { messageId: "<only-rfc@example.com>" },
    });
    const [idOnly] = normalizeEmailEngineWebhook({
      event: "messageNew",
      account: "acc_1",
      data: { id: "ee_msg_2" },
    });
    const [uidOnly] = normalizeEmailEngineWebhook({
      event: "messageNew",
      account: "acc_1",
      path: "INBOX",
      data: { uid: 777 },
    });

    expect(rfcOnly).toMatchObject({
      rfcMessageId: "<only-rfc@example.com>",
      resourceKey: "emailengine:acc_1:messageId:<only-rfc@example.com>",
    });
    expect(rfcOnly).not.toHaveProperty("providerMessageId");
    expect(idOnly).toMatchObject({
      providerMessageId: "ee_msg_2",
      resourceKey: "emailengine:acc_1:id:ee_msg_2",
    });
    expect(uidOnly).toMatchObject({
      providerUid: "777",
      providerPath: "INBOX",
      resourceKey: "emailengine:acc_1:uid:INBOX:777",
    });
  });

  it("preserves auth failures as sync events without pretending a message changed", () => {
    const events = normalizeEmailEngineWebhook({
      event: "authenticationError",
      account: "acc_2",
    });

    expect(events[0]).toMatchObject({
      source: "emailengine_webhook",
      kind: "auth_failed",
      accountId: "acc_2",
    });
    expect(events[0].idempotencyKey).toMatch(
      /^emailengine:acc_2:authenticationError:authenticationError:/,
    );
    expect(events[0]).not.toHaveProperty("providerMessageId");
  });

  it("preserves auth success as an account-state event", () => {
    const events = normalizeEmailEngineWebhook({
      event: "authenticationSuccess",
      account: "acc_2",
      eventId: "evt_auth_success",
    });

    expect(events[0]).toMatchObject({
      source: "emailengine_webhook",
      kind: "auth_succeeded",
      accountId: "acc_2",
      idempotencyKey: "emailengine:acc_2:event-id:evt_auth_success",
    });
    expect(events[0]).not.toHaveProperty("providerMessageId");
  });

  it("normalizes EmailEngine account deletion as an account-state event", () => {
    const events = normalizeEmailEngineWebhook({
      event: "accountDeleted",
      account: "acc_deleted",
      eventId: "evt_account_deleted",
    });

    expect(events[0]).toMatchObject({
      source: "emailengine_webhook",
      kind: "account_deleted",
      accountId: "acc_deleted",
      idempotencyKey: "emailengine:acc_deleted:event-id:evt_account_deleted",
    });
    expect(events[0]).not.toHaveProperty("providerMessageId");
    expect(events[0]).not.toHaveProperty("mailboxId");
  });

  it("treats missing provider messages as delete events so the mirror can converge", () => {
    const events = normalizeEmailEngineWebhook({
      event: "messageMissing",
      account: "acc_1",
      path: "INBOX",
      data: { id: "msg_missing_1" },
    });

    expect(events[0]).toMatchObject({
      source: "emailengine_webhook",
      kind: "message_deleted",
      accountId: "acc_1",
      mailboxId: "INBOX",
      providerMessageId: "msg_missing_1",
    });
    expect(events[0]).not.toHaveProperty("providerEventName");
    expect(events[0].idempotencyKey).toMatch(
      /^emailengine:acc_1:messageMissing:msg_missing_1:/,
    );
  });

  it("keeps unknown provider notifications out of normal sync buckets", () => {
    const events = normalizeEmailEngineWebhook({
      event: "futureProviderEvent",
      account: "acc_3",
    });

    expect(events).toEqual([
      {
        source: "emailengine_webhook",
        kind: "unknown_notification",
        accountId: "acc_3",
        providerEventName: "futureProviderEvent",
        idempotencyKey: expect.stringMatching(
          /^emailengine:acc_3:futureProviderEvent:futureProviderEvent:/,
        ),
      },
    ]);
  });
});
