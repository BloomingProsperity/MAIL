import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  createGmailNativeSendTransport,
  createGraphNativeSendTransport,
} from "../src/mail-provider/native-send-transport";

describe("native send transports", () => {
  it("submits Gmail messages as base64url encoded MIME", async () => {
    const calls: unknown[] = [];
    const transport = createGmailNativeSendTransport({
      gmail: {
        async sendMessage(input) {
          calls.push(input);
          return { id: "gmail_msg_1", threadId: "thread_1" };
        },
      },
      createBoundary: () => "boundary_1",
    });

    const result = await transport.submitMessage({
      accountId: "acc_1",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [{ address: "team@example.com" }],
      bcc: [{ address: "audit@example.com" }],
      subject: "确认 Launch",
      bodyText: "Looks good.",
      bodyHtml: "<p>Looks <strong>good</strong>.</p>",
    });

    expect(result).toEqual({ messageId: "gmail_msg_1" });
    expect(calls).toHaveLength(1);
    const raw = (calls[0] as { raw: string }).raw;
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
    expect(raw).not.toContain("=");
    const decoded = Buffer.from(toBase64(raw), "base64").toString("utf8");
    expect(decoded).toContain('To: "Lina" <lina@example.com>');
    expect(decoded).toContain("Cc: team@example.com");
    expect(decoded).toContain("Bcc: audit@example.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain('Content-Type: multipart/alternative; boundary="boundary_1"');
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Looks good.");
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8");
    expect(decoded).toContain("<p>Looks <strong>good</strong>.</p>");
  });

  it("submits Graph sendMail payloads with recipient buckets", async () => {
    const calls: unknown[] = [];
    const transport = createGraphNativeSendTransport({
      graph: {
        async sendMail(input) {
          calls.push(input);
          return {};
        },
      },
    });

    await transport.submitMessage({
      accountId: "acc_1",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [{ address: "team@example.com" }],
      bcc: [{ address: "audit@example.com" }],
      subject: "Launch confirmation",
      bodyHtml: "<p>Looks good.</p>",
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        message: {
          subject: "Launch confirmation",
          body: { contentType: "HTML", content: "<p>Looks good.</p>" },
          toRecipients: [
            { emailAddress: { address: "lina@example.com", name: "Lina" } },
          ],
          ccRecipients: [{ emailAddress: { address: "team@example.com" } }],
          bccRecipients: [{ emailAddress: { address: "audit@example.com" } }],
        },
        saveToSentItems: true,
      },
    ]);
  });
});

function toBase64(value: string): string {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}
