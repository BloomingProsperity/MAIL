import { describe, expect, it } from "vitest";

import { createPostgresMailThreadingStore } from "../src/mail-compose/postgres-threading-store";

describe("Postgres mail threading store", () => {
  it("loads RFC and provider threading metadata for visible source messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailThreadingStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              internet_message_id: "source@example.com",
              rfc_in_reply_to_message_id: "<parent@example.com>",
              rfc_references_message_ids: [
                "<root@example.com>",
                "<parent@example.com>",
              ],
              provider_message_id: "provider_msg_1",
              emailengine_email_id: "emailengine_msg_1",
              emailengine_message_id: "emailengine_provider_msg_1",
              gmail_thread_id: "gmail_thread_1",
              graph_message_id: "graph_msg_1",
            },
          ],
        };
      },
    });

    const threading = await store.getThreadingMetadata({
      accountId: "acc_1",
      messageId: "message_1",
      action: "reply_all",
    });

    expect(queries[0].text).toMatch(/FROM messages/i);
    expect(queries[0].text).toMatch(/JOIN message_state/i);
    expect(queries[0].text).toMatch(/provider = 'emailengine'/i);
    expect(queries[0].text).toMatch(/provider = 'gmail'/i);
    expect(queries[0].text).toMatch(/provider = 'graph'/i);
    expect(queries[0].text).toMatch(/EXISTS \(\s*SELECT 1\s*FROM message_locations/i);
    expect(queries[0].text).toMatch(/JOIN mailboxes/i);
    expect(queries[0].text).toMatch(/mailboxes\.account_id = messages\.account_id/i);
    expect(queries[0].values).toEqual(["acc_1", "message_1"]);
    expect(threading).toEqual({
      action: "reply_all",
      inReplyTo: "<source@example.com>",
      references: [
        "<root@example.com>",
        "<parent@example.com>",
        "<source@example.com>",
      ],
      emailEngineMessageId: "emailengine_msg_1",
      gmailThreadId: "gmail_thread_1",
      graphMessageId: "graph_msg_1",
    });
  });

  it("falls back to In-Reply-To when References is missing", async () => {
    const store = createPostgresMailThreadingStore({
      async query() {
        return {
          rows: [
            {
              internet_message_id: "<source@example.com>",
              rfc_in_reply_to_message_id: "parent@example.com",
              rfc_references_message_ids: [],
              provider_message_id: "provider_msg_1",
              emailengine_email_id: null,
              emailengine_message_id: null,
              gmail_thread_id: null,
              graph_message_id: null,
            },
          ],
        };
      },
    });

    await expect(
      store.getThreadingMetadata({
        accountId: "acc_1",
        messageId: "message_1",
        action: "reply",
      }),
    ).resolves.toMatchObject({
      inReplyTo: "<source@example.com>",
      references: ["<parent@example.com>", "<source@example.com>"],
    });
  });

  it("deduplicates malformed or injected message-id references", async () => {
    const store = createPostgresMailThreadingStore({
      async query() {
        return {
          rows: [
            {
              internet_message_id: "source@example.com",
              rfc_in_reply_to_message_id:
                "<parent@example.com>\r\nBcc: leak@example.com",
              rfc_references_message_ids: [
                "<root@example.com>",
                "<root@example.com>",
                "bad value",
                "parent@example.com",
              ],
              provider_message_id: "provider_msg_1",
              emailengine_email_id: null,
              emailengine_message_id: null,
              gmail_thread_id: null,
              graph_message_id: null,
            },
          ],
        };
      },
    });

    await expect(
      store.getThreadingMetadata({
        accountId: "acc_1",
        messageId: "message_1",
        action: "reply",
      }),
    ).resolves.toMatchObject({
      references: ["<root@example.com>", "<parent@example.com>", "<source@example.com>"],
    });
  });

  it("returns undefined when the source message is not available", async () => {
    const store = createPostgresMailThreadingStore({
      async query() {
        return { rows: [] };
      },
    });

    await expect(
      store.getThreadingMetadata({
        accountId: "acc_1",
        messageId: "missing",
        action: "reply",
      }),
    ).resolves.toBeUndefined();
  });
});
