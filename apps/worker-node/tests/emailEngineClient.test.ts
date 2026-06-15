import { describe, expect, it } from "vitest";

import {
  createEmailEngineClient,
  EmailEngineRequestError,
} from "../src/mail-engine/email-engine-client";

describe("EmailEngine client", () => {
  it("calls EmailEngine with bearer auth and v1 account paths", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json([{ path: "INBOX", name: "Inbox" }]);
      },
    });

    const mailboxes = await client.listMailboxes("acc_1");

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/mailboxes",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
    expect(mailboxes).toEqual([{ path: "INBOX", name: "Inbox" }]);
  });

  it("gets message details with textType all without marking seen", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000/v1/",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "msg_1", subject: "Hello" });
      },
    });

    await client.getMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      textType: "*",
      markAsSeen: false,
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/message/msg_1?textType=*&markAsSeen=false",
    );
  });

  it("lists messages in a folder with page size and cursor", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ messages: [], nextPageCursor: "next" });
      },
    });

    await client.listMessages({
      accountId: "acc_1",
      path: "INBOX",
      cursor: "cursor_1",
      pageSize: 50,
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/messages?path=INBOX&pageSize=50&cursor=cursor_1",
    );
  });

  it("throws a structured error when EmailEngine rejects a request", async () => {
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async () =>
        Response.json(
          { code: "MessageNotFound", error: "missing" },
          { status: 404 },
        ),
    });

    const rejected = client.getMessage({
      accountId: "acc_1",
      messageId: "missing",
      textType: "*",
      markAsSeen: false,
    });

    await expect(rejected).rejects.toBeInstanceOf(EmailEngineRequestError);
    await expect(rejected).rejects.toMatchObject({
      status: 404,
      code: "MessageNotFound",
      detail: "missing",
    });
    await expect(rejected).rejects.toThrow(
      "EmailEngine request failed: 404 MessageNotFound missing",
    );
  });

  it("updates message flags and labels through the Message API", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ updated: true });
      },
    });

    await client.updateMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      flags: { add: ["\\Seen"], delete: ["\\Flagged"] },
      labels: { add: ["Label_123"] },
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/message/msg_1",
    );
    expect(calls[0].init?.method).toBe("PUT");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      flags: { add: ["\\Seen"], delete: ["\\Flagged"] },
      labels: { add: ["Label_123"] },
    });
  });

  it("moves a message to a target mailbox path", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "msg_2" });
      },
    });

    await client.moveMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      path: "Projects/Acme",
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/message/msg_1/move",
    );
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      path: "Projects/Acme",
    });
  });

  it("moves a message to trash without force deletion by default", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ deleted: true });
      },
    });

    await client.deleteMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      force: false,
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/message/msg_1?force=false",
    );
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("submits scheduled compose payloads through EmailEngine", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ queueId: "queue_1", messageId: "msg_1" });
      },
    });

    const result = await client.submitMessage({
      accountId: "acc_1",
      draftId: "draft_1",
      idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/submit",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "compose:draft_1:schedule:schedule_1:send",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      from: { address: "support@demo.site", name: "Support" },
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [],
      subject: "Launch confirmation",
      text: "Looks good.",
    });
    expect(result).toEqual({ queueId: "queue_1", messageId: "msg_1" });
  });

  it("submits scheduled replies with EmailEngine reference metadata", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
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
      idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Re: Launch confirmation",
      bodyText: "Thanks.",
      threading: {
        action: "reply",
        emailEngineMessageId: "emailengine_msg_1",
      },
    });

    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      reference: {
        message: "emailengine_msg_1",
        action: "reply",
        inline: false,
      },
    });
  });

  it("submits scheduled attachment references through EmailEngine", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
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
      idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
      to: [{ address: "lina@example.com" }],
      cc: [],
      bcc: [],
      subject: "Fwd: Launch confirmation",
      bodyText: "Forwarding the proposal.",
      attachments: [
        {
          filename: "proposal.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
          inline: false,
          providerAttachmentId: "ee_attachment_1",
        },
      ],
    });

    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      attachments: [
        {
          filename: "proposal.pdf",
          contentType: "application/pdf",
          reference: "ee_attachment_1",
        },
      ],
    });
  });

  it("downloads attachment bytes through the EmailEngine attachment endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
        });
      },
    });

    const attachment = await client.downloadAttachment({
      accountId: "acc_1",
      providerAttachmentId: "att_pdf",
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/attachment/att_pdf",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
    expect(attachment).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
    });
  });
});
