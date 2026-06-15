import { describe, expect, it } from "vitest";

import { createEmailEngineSubmitClient } from "../src/mail-engine/email-engine-submit-client";

describe("EmailEngine submit client", () => {
  it("submits a composed message through POST /v1/account/:account/submit", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineSubmitClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          response: "Queued for delivery",
          queueId: "queue_1",
          messageId: "<message@example.com>",
          sendAt: "2026-06-13T08:00:00.000Z",
        });
      },
    });

    const result = await client.submitMessage({
      accountId: "acc_1",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [{ address: "ops@example.com" }],
      bcc: [],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
      bodyHtml: "<p>Looks good.</p>",
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/submit",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "content-type": "application/json",
      "Idempotency-Key": "compose:draft_1:send",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [{ address: "ops@example.com" }],
      subject: "Launch confirmation",
      text: "Looks good.",
      html: "<p>Looks good.</p>",
    });
    expect(result).toEqual({
      response: "Queued for delivery",
      queueId: "queue_1",
      messageId: "<message@example.com>",
      sendAt: "2026-06-13T08:00:00.000Z",
    });
  });

  it("throws a sanitized error when submit fails", async () => {
    const client = createEmailEngineSubmitClient({
      baseUrl: "http://emailengine:3000/v1/",
      accessToken: "secret-token",
      fetchImpl: async () =>
        Response.json(
          { code: "SubmitFailed", error: "SMTP rejected message" },
          { status: 400 },
        ),
    });

    await expect(
      client.submitMessage({
        accountId: "acc_1",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
      }),
    ).rejects.toThrow(
      "EmailEngine message submit failed: 400 SubmitFailed SMTP rejected message",
    );
  });

  it("submits replies with EmailEngine reference metadata", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineSubmitClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ queueId: "queue_1" });
      },
    });

    await client.submitMessage({
      accountId: "acc_1",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Re: Launch confirmation",
      bodyText: "Thanks.",
      threading: {
        action: "reply_all",
        emailEngineMessageId: "emailengine_msg_1",
      },
    });

    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      reference: {
        message: "emailengine_msg_1",
        action: "reply-all",
        inline: false,
      },
    });
  });
});
