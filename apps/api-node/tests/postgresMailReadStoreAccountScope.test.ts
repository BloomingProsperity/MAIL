import { describe, expect, it } from "vitest";

import { createPostgresMailReadStore } from "../src/mail-read/postgres-mail-read-store";

describe("postgres mail read store account scoping", () => {
  it("counts mailbox messages only when mailbox and message accounts match", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailReadStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    await store.listMailboxes({ accountId: "account_1" });

    expect(queries[0].text).toMatch(
      /messages\.account_id = mailboxes\.account_id/i,
    );
    expect(queries[0].values).toEqual(["account_1"]);
  });

  it("lists message mailbox ids from same-account locations only", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailReadStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "message_1",
              account_id: "account_1",
              subject: "Hello",
              from_email: "a@example.com",
              received_at: "2026-06-12T09:00:00.000Z",
              unread: true,
              starred: false,
              mailbox_ids: ["mailbox_1"],
              attachment_count: "0",
            },
          ],
        };
      },
    });

    await store.listMessages({
      accountId: "account_1",
      mailboxId: "mailbox_1",
      limit: 10,
    });

    expect(queries[0].text).toMatch(
      /mailboxes\.account_id = messages\.account_id/i,
    );
  });

  it("loads message detail mailbox ids from same-account locations only", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailReadStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "message_1",
              account_id: "account_1",
              subject: "Hello",
              from_email: "a@example.com",
              to_emails: [],
              cc_emails: [],
              received_at: "2026-06-12T09:00:00.000Z",
              unread: true,
              starred: false,
              mailbox_ids: ["mailbox_1"],
              attachment_count: "0",
              attachments: [],
            },
          ],
        };
      },
    });

    await store.getMessage({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(queries[0].text).toMatch(
      /mailboxes\.account_id = messages\.account_id/i,
    );
  });
});
