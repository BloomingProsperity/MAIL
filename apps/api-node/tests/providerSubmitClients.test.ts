import { describe, expect, it } from "vitest";

import {
  createGmailSubmitClient,
  createGraphSubmitClient,
} from "../src/native-send/provider-submit-clients";

describe("API provider submit clients", () => {
  it("sends Gmail raw MIME with threadId when supplied", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailSubmitClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      baseUrl: "https://gmail.example/gmail/v1",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "gmail_msg_1", threadId: "gmail_thread_1" });
      },
    });

    const result = await client.sendMessage({
      accountId: "acc_1",
      raw: "base64url-rfc822",
      threadId: "gmail_thread_1",
    });

    expect(calls[0].url).toBe(
      "https://gmail.example/gmail/v1/users/me/messages/send",
    );
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      raw: "base64url-rfc822",
      threadId: "gmail_thread_1",
    });
    expect(result).toEqual({ id: "gmail_msg_1", threadId: "gmail_thread_1" });
  });

  it("sends Graph MIME replies as text/plain base64 payloads", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphSubmitClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      baseUrl: "https://graph.example/v1.0",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      },
    });

    await client.sendMail({
      accountId: "acc_1",
      mime: "base64-rfc822-message",
    });

    expect(calls[0].url).toBe("https://graph.example/v1.0/me/sendMail");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer access-token",
      "content-type": "text/plain",
    });
    expect(calls[0].init?.body).toBe("base64-rfc822-message");
  });
});
