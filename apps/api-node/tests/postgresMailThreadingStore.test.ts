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
    expect(queries[0].values).toEqual(["acc_1", "message_1"]);
    expect(threading).toEqual({
      action: "reply_all",
      inReplyTo: "<source@example.com>",
      references: ["<source@example.com>"],
      emailEngineMessageId: "emailengine_msg_1",
      gmailThreadId: "gmail_thread_1",
      graphMessageId: "graph_msg_1",
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
