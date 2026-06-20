import { describe, expect, it } from "vitest";

import { createPostgresMailReadStore } from "../src/mail-read/postgres-mail-read-store";

describe("postgres mail read store body hydration", () => {
  it("hydrates an empty message body before returning detail", async () => {
    const hydratedInputs: unknown[] = [];
    let detailReads = 0;
    const client = {
      async query() {
        detailReads += 1;
        return {
          rows: [
            {
              id: "message_1",
              account_id: "account_1",
              subject: "Hello",
              from_email: "a@example.com",
              from_name: null,
              to_emails: ["b@example.com"],
              cc_emails: [],
              received_at: "2026-06-12T09:00:00.000Z",
              snippet: "Body",
              body_text: detailReads === 1 ? null : "Fetched body",
              body_html: null,
              unread: false,
              starred: true,
              mailbox_ids: ["mailbox_1"],
              attachment_count: "0",
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client, {
      bodyHydrator: {
        async hydrateMessageBody(input) {
          hydratedInputs.push(input);
        },
      },
    });
    const result = await store.getMessage({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(hydratedInputs).toEqual([
      { accountId: "account_1", messageId: "message_1" },
    ]);
    expect(detailReads).toBe(2);
    expect(result?.bodyText).toBe("Fetched body");
  });
});
