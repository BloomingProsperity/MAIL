import { describe, expect, it } from "vitest";

import { createGraphApiClient } from "../src/microsoft/graph-api-client";

describe("Microsoft Graph API client", () => {
  it("runs an initial folder message delta request with Bearer auth and selected fields", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken(accountId) {
          expect(accountId).toBe("acc_1");
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          value: [{ id: "msg_1", changeKey: "ck_1", conversationId: "conv_1" }],
          "@odata.nextLink":
            "https://graph.example/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=next",
        });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    const result = await client.deltaMessages({
      accountId: "acc_1",
      folderId: "inbox",
      maxPageSize: 50,
    });

    expect(calls[0].url).toBe(
      "https://graph.example/v1.0/me/mailFolders/inbox/messages/delta?%24select=id%2CchangeKey%2CconversationId%2CinternetMessageId%2CinternetMessageHeaders%2Csubject%2CreceivedDateTime%2Csender%2Cfrom%2CtoRecipients%2CccRecipients%2CbodyPreview%2CisRead%2ChasAttachments",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      Prefer: "odata.maxpagesize=50",
    });
    expect(result.nextLink).toBe(
      "https://graph.example/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=next",
    );
    expect(result.messages[0]).toMatchObject({
      id: "msg_1",
      changeKey: "ck_1",
      conversationId: "conv_1",
    });
  });

  it("follows opaque Graph next or delta links without rebuilding query parameters", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          value: [],
          "@odata.deltaLink": "https://graph.example/delta-token",
        });
      },
    });

    await client.deltaMessages({
      accountId: "acc_1",
      folderId: "inbox",
      deltaLink:
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque",
      maxPageSize: 25,
    });

    expect(calls[0].url).toBe(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      Prefer: "odata.maxpagesize=25",
    });
  });

  it("lists Graph mail folders with stable folder fields", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken(accountId) {
          expect(accountId).toBe("acc_1");
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          value: [
            { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
            {
              id: "archive",
              displayName: "Archive",
              wellKnownName: "archive",
            },
          ],
        });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    const result = await client.listMailFolders({ accountId: "acc_1" });

    expect(calls[0].url).toBe(
      "https://graph.example/v1.0/me/mailFolders?%24select=id%2CdisplayName%2CwellKnownName",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(result.folders).toEqual([
      { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
      { id: "archive", displayName: "Archive", wellKnownName: "archive" },
    ]);
  });

  it("follows Graph mail folder next links so every folder enters discovery", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const pages = [
      {
        value: [{ id: "inbox", displayName: "Inbox", wellKnownName: "inbox" }],
        "@odata.nextLink":
          "https://graph.example/v1.0/me/mailFolders?$skiptoken=opaque-folder-page",
      },
      {
        value: [
          {
            id: "archive",
            displayName: "Archive",
            wellKnownName: "archive",
          },
        ],
      },
    ];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken(accountId) {
          expect(accountId).toBe("acc_1");
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json(pages.shift() ?? { value: [] });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    const result = await client.listMailFolders({ accountId: "acc_1" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://graph.example/v1.0/me/mailFolders?%24select=id%2CdisplayName%2CwellKnownName",
      "https://graph.example/v1.0/me/mailFolders?$skiptoken=opaque-folder-page",
    ]);
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(calls[1].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(result.folders).toEqual([
      { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
      { id: "archive", displayName: "Archive", wellKnownName: "archive" },
    ]);
  });

  it("throws sanitized Graph errors without leaking access tokens", async () => {
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "very-secret-access-token";
        },
      },
      fetchImpl: async () =>
        Response.json(
          { error: { code: "InvalidAuthenticationToken", message: "token bad" } },
          { status: 401 },
        ),
    });

    await expect(
      client.deltaMessages({ accountId: "acc_1", folderId: "inbox" }),
    ).rejects.toThrow(
      "Microsoft Graph request failed: 401 InvalidAuthenticationToken token bad",
    );
    await expect(
      client.deltaMessages({ accountId: "acc_1", folderId: "inbox" }),
    ).rejects.not.toThrow(/very-secret-access-token/);
  });

  it("updates message read state and follow-up flag", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "msg_1", isRead: true });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    await client.updateMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      patch: {
        isRead: true,
        flag: { flagStatus: "flagged" },
      },
    });

    expect(calls[0].url).toBe("https://graph.example/v1.0/me/messages/msg_1");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      isRead: true,
      flag: { flagStatus: "flagged" },
    });
  });

  it("moves a message to a Graph folder id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "msg_2" });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    await client.moveMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      destinationId: "archive",
    });

    expect(calls[0].url).toBe(
      "https://graph.example/v1.0/me/messages/msg_1/move",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      destinationId: "archive",
    });
  });

  it("reads categories before appending Graph categories", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ id: "msg_1", categories: ["Existing"] });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    const result = await client.getMessage({
      accountId: "acc_1",
      messageId: "msg_1",
      select: ["categories"],
    });

    expect(calls[0].url).toBe(
      "https://graph.example/v1.0/me/messages/msg_1?%24select=categories",
    );
    expect(result).toEqual({ id: "msg_1", categories: ["Existing"] });
  });

  it("sends mail through Graph sendMail with recipients and sent item save", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    await client.sendMail({
      accountId: "acc_1",
      message: {
        subject: "Launch confirmation",
        body: { contentType: "Text", content: "Looks good." },
        toRecipients: [
          { emailAddress: { address: "lina@example.com", name: "Lina" } },
        ],
      },
      saveToSentItems: true,
    });

    expect(calls[0].url).toBe("https://graph.example/v1.0/me/sendMail");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      message: {
        subject: "Launch confirmation",
        body: { contentType: "Text", content: "Looks good." },
        toRecipients: [
          { emailAddress: { address: "lina@example.com", name: "Lina" } },
        ],
      },
      saveToSentItems: true,
    });
  });

  it("sends MIME mail through Graph sendMail as text/plain", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphApiClient({
      accessTokenProvider: {
        async getAccessToken() {
          return "access-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      },
      baseUrl: "https://graph.example/v1.0",
    });

    await client.sendMail({
      accountId: "acc_1",
      mime: "base64-rfc822-message",
    });

    expect(calls[0].url).toBe("https://graph.example/v1.0/me/sendMail");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "text/plain",
    });
    expect(calls[0].init?.body).toBe("base64-rfc822-message");
  });
});
