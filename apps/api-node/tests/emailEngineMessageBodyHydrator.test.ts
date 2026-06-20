import { describe, expect, it } from "vitest";

import { createEmailEngineMessageBodyHydrator } from "../src/mail-read/email-engine-message-body-hydrator";

describe("EmailEngine message body hydrator", () => {
  it("fetches missing body text from EmailEngine and stores it locally", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fetchedUrls: string[] = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM provider_message_refs")) {
          return { rows: [{ provider_message_id: "ee_msg_1" }] };
        }

        return { rows: [] };
      },
    };
    const hydrator = createEmailEngineMessageBodyHydrator({
      client,
      baseUrl: "http://emailengine:3000",
      accessToken: "token_1",
      fetchImpl: async (url, init) => {
        fetchedUrls.push(String(url));
        expect(init?.headers).toEqual({
          Authorization: "Bearer token_1",
        });
        return new Response(
          JSON.stringify({
            preview: "Preview from EmailEngine",
            text: {
              plain: "Plain body from EmailEngine",
              html: "<p>Plain body from EmailEngine</p>",
            },
          }),
          { status: 200 },
        );
      },
    });

    await hydrator.hydrateMessageBody({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(fetchedUrls).toEqual([
      "http://emailengine:3000/v1/account/account_1/message/ee_msg_1?textType=*&markAsSeen=false",
    ]);
    expect(queries[0].text).toMatch(/FROM provider_message_refs/i);
    expect(queries[0].values).toEqual(["account_1", "message_1"]);
    expect(queries[1].text).toMatch(/UPDATE messages/i);
    expect(queries[1].values).toEqual([
      "account_1",
      "message_1",
      "Preview from EmailEngine",
      "Plain body from EmailEngine",
      "<p>Plain body from EmailEngine</p>",
    ]);
    expect(queries[2].text).toMatch(/INSERT INTO search_documents/i);
    expect(queries[2].values).toEqual(["account_1", "message_1"]);
  });

  it("falls back to the local message provider id when provider refs are missing", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const fetchedUrls: string[] = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM (")) {
          return { rows: [{ provider_message_id: "ee_msg_from_messages" }] };
        }

        return { rows: [] };
      },
    };
    const hydrator = createEmailEngineMessageBodyHydrator({
      client,
      baseUrl: "http://emailengine:3000",
      accessToken: "token_1",
      fetchImpl: async (url) => {
        fetchedUrls.push(String(url));
        return new Response(
          JSON.stringify({ text: { plain: "Fallback body" } }),
          { status: 200 },
        );
      },
    });

    await hydrator.hydrateMessageBody({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(queries[0].text).toMatch(/UNION ALL/i);
    expect(fetchedUrls).toEqual([
      "http://emailengine:3000/v1/account/account_1/message/ee_msg_from_messages?textType=*&markAsSeen=false",
    ]);
    expect(queries[1].values).toEqual([
      "account_1",
      "message_1",
      null,
      "Fallback body",
      null,
    ]);
  });
});
