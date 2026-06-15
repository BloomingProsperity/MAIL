import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";

import { createGmailApiClient } from "../src/google/gmail-api-client";

describe("Gmail API client", () => {
  it("lists messages with Bearer auth and capped maxResults", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken(accountId) {
          expect(accountId).toBe("acc_1");
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          messages: [{ id: "msg_1", threadId: "thr_1" }],
          nextPageToken: "next",
        });
      },
    });

    const result = await client.listMessages({
      accountId: "acc_1",
      maxResults: 999,
      pageToken: "page-1",
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=500&pageToken=page-1",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(result).toEqual({
      messages: [{ id: "msg_1", threadId: "thr_1" }],
      nextPageToken: "next",
    });
  });

  it("limits Gmail message listing to explicit label ids", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          messages: [{ id: "msg_updates" }],
        });
      },
    });

    await client.listMessages({
      accountId: "acc_1",
      maxResults: 50,
      labelIds: ["CATEGORY_UPDATES", "INBOX"],
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=CATEGORY_UPDATES&labelIds=INBOX",
    );
    expect(calls[0].url).not.toContain("access-token");
  });

  it("lists Gmail labels with Bearer auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken(accountId) {
          expect(accountId).toBe("acc_1");
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          labels: [
            { id: "INBOX", name: "Inbox", type: "system" },
            { id: "CATEGORY_UPDATES", name: "Updates", type: "system" },
          ],
        });
      },
    });

    const result = await client.listLabels({ accountId: "acc_1" });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(result.labels?.map((label) => label.id)).toEqual([
      "INBOX",
      "CATEGORY_UPDATES",
    ]);
  });

  it("lists Gmail send-as identities for provider-native From discovery", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken(accountId) {
          expect(accountId).toBe("acc_1");
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          sendAs: [
            {
              sendAsEmail: "me@gmail.com",
              displayName: "Me",
              isDefault: true,
              isPrimary: true,
              verificationStatus: "accepted",
            },
            {
              sendAsEmail: "support@example.com",
              displayName: "Support",
              isDefault: false,
              isPrimary: false,
              verificationStatus: "accepted",
            },
          ],
        });
      },
    });

    const result = await client.listSendAs({ accountId: "acc_1" });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(result.sendAs?.map((identity) => identity.sendAsEmail)).toEqual([
      "me@gmail.com",
      "support@example.com",
    ]);
  });

  it("gets message metadata without putting the token in the URL", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          id: "msg_1",
          threadId: "thr_1",
          historyId: "900",
          labelIds: ["INBOX"],
        });
      },
    });

    const result = await client.getMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      format: "metadata",
      metadataHeaders: ["Message-ID", "In-Reply-To", "References"],
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_1?format=metadata&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References",
    );
    expect(calls[0].url).not.toContain("access-token");
    expect(result).toEqual({
      id: "msg_1",
      threadId: "thr_1",
      historyId: "900",
      labelIds: ["INBOX"],
    });
  });

  it("lists history changes with startHistoryId and pageToken", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          historyId: "950",
          history: [
            {
              id: "940",
              messagesAdded: [{ message: { id: "msg_1", threadId: "thr_1" } }],
            },
          ],
        });
      },
    });

    const result = await client.listHistory({
      accountId: "acc_1",
      startHistoryId: "900",
      maxResults: 50,
      pageToken: "page-2",
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=900&maxResults=50&pageToken=page-2",
    );
    expect(result.historyId).toBe("950");
    expect(result.history?.[0].messagesAdded?.[0].message?.id).toBe("msg_1");
  });

  it("throws a 404 status error for expired Gmail history cursors", async () => {
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async () =>
        Response.json(
          { error: { status: "NOT_FOUND", message: "History expired" } },
          { status: 404 },
        ),
    });

    await expect(
      client.listHistory({
        accountId: "acc_1",
        startHistoryId: "too-old",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("sanitizes Gmail API errors so access tokens are not leaked", async () => {
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "very-secret-access-token";
        },
      },
      fetchImpl: async () =>
        Response.json(
          { error: { status: "PERMISSION_DENIED", message: "token bad" } },
          { status: 403 },
        ),
    });

    await expect(
      client.getMessage({
        accountId: "acc_1",
        messageId: "msg_1",
        format: "metadata",
      }),
    ).rejects.toThrow(
      "Gmail API request failed: 403 PERMISSION_DENIED token bad",
    );

    await expect(
      client.getMessage({
        accountId: "acc_1",
        messageId: "msg_1",
        format: "metadata",
      }),
    ).rejects.not.toThrow(/very-secret-access-token/);
  });

  it("modifies message labels with Gmail modify", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          id: "msg_1",
          labelIds: ["STARRED"],
        });
      },
    });

    await client.modifyMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_1/modify",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });
  });

  it("moves a Gmail message to trash with an empty body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "msg_1", labelIds: ["TRASH"] });
      },
    });

    await client.trashMessage({
      accountId: "acc_1",
      messageId: "msg_1",
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_1/trash",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("sends a raw RFC 2822 message through Gmail messages.send", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGmailApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "gmail_sent_1", threadId: "thr_sent_1" });
      },
    });

    const raw = Buffer.from("To: a@example.com\r\n\r\nHello", "utf8")
      .toString("base64")
      .replace(/=/g, "");
    const result = await client.sendMessage({
      accountId: "acc_1",
      raw,
      threadId: "thr_sent_1",
    });

    expect(calls[0].url).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    expect(calls[0].url).not.toContain("access-token");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      raw,
      threadId: "thr_sent_1",
    });
    expect(result).toEqual({ id: "gmail_sent_1", threadId: "thr_sent_1" });
  });
});
