import { describe, expect, it } from "vitest";

import { createPostgresMailReadStore } from "../src/mail-read/postgres-mail-read-store";

describe("postgres mail read store", () => {
  it("lists mailboxes with message and unread counts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "mailbox_1",
              account_id: "account_1",
              provider_mailbox_id: "INBOX",
              name: "Inbox",
              role: "inbox",
              message_count: "3",
              unread_count: "2",
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.listMailboxes({ accountId: "account_1" });

    expect(queries[0].text).toMatch(/FROM mailboxes/i);
    expect(queries[0].text).toMatch(/LEFT JOIN message_locations/i);
    expect(queries[0].text).toMatch(/LEFT JOIN message_state/i);
    expect(queries[0].text).toMatch(/message_state.deleted_at IS NULL/i);
    expect(queries[0].text).toMatch(/message_state\.message_id IS NOT NULL/i);
    expect(queries[0].values).toEqual(["account_1"]);
    expect(result.items).toEqual([
      {
        id: "mailbox_1",
        accountId: "account_1",
        name: "Inbox",
        role: "inbox",
        messageCount: 3,
        unreadCount: 2,
      },
    ]);
  });

  it("lists non-deleted messages in one mailbox without provider-specific fields", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "message_1",
              account_id: "account_1",
              subject: "Hello",
              from_email: "a@example.com",
              from_name: "Alice",
              received_at: "2026-06-12T09:00:00.000Z",
              snippet: "Body",
              unread: true,
              starred: false,
              mailbox_ids: ["mailbox_1"],
              attachment_count: "1",
              bucket: "P2 Important",
              priority_score: 82,
              reasons: ["直接发给你", "来自项目标签"],
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.listMessages({
      accountId: "account_1",
      mailboxId: "mailbox_1",
      limit: 25,
    });

    expect(queries[0].text).toMatch(/FROM messages/i);
    expect(queries[0].text).toMatch(/JOIN message_locations/i);
    expect(queries[0].text).toMatch(/JOIN mailboxes/i);
    expect(queries[0].text).toMatch(/LEFT JOIN message_classification/i);
    expect(queries[0].text).toMatch(/message_state.deleted_at IS NULL/i);
    expect(queries[0].text).not.toMatch(/provider_message_id/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "mailbox_1",
      null,
      null,
      null,
      26,
    ]);
    expect(result.items).toEqual([
      {
        id: "message_1",
        accountId: "account_1",
        subject: "Hello",
        from: { email: "a@example.com", name: "Alice" },
        receivedAt: "2026-06-12T09:00:00.000Z",
        snippet: "Body",
        unread: true,
        starred: false,
        mailboxIds: ["mailbox_1"],
        attachmentCount: 1,
        classification: {
          bucket: "P2 Important",
          priorityScore: 82,
          reasons: ["直接发给你", "来自项目标签"],
        },
      },
    ]);
  });

  it("uses keyset pagination and returns an opaque next cursor", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            messageRow("message_3", "2026-06-12T11:00:00.000Z"),
            messageRow("message_2", "2026-06-12T10:00:00.000Z"),
            messageRow("message_1", "2026-06-12T09:00:00.000Z"),
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.listMessages({
      accountId: "account_1",
      limit: 2,
    });

    expect(queries[0].text).toMatch(
      /ORDER BY messages.received_at DESC, messages.id DESC/i,
    );
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      null,
      null,
      null,
      3,
    ]);
    expect(result.items.map((item) => item.id)).toEqual([
      "message_3",
      "message_2",
    ]);
    expect(decodeCursorPayload(result.nextCursor)).toEqual({
      v: 1,
      receivedAt: "2026-06-12T10:00:00.000Z",
      id: "message_2",
    });
  });

  it("sorts messages by Smart Inbox priority when requested", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...messageRow("message_urgent", "2026-06-12T09:00:00.000Z"),
              bucket: "P1 Urgent",
              priority_score: 95,
              reasons: ["今天 17:00 截止"],
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.listMessages({
      accountId: "account_1",
      limit: 10,
      sort: "smart",
    });

    expect(queries[0].text).toMatch(/LEFT JOIN message_classification/i);
    expect(queries[0].text).toMatch(
      /ORDER BY\s+COALESCE\(message_classification\.priority_score, 0\) DESC,\s+messages\.received_at DESC,\s+messages\.id DESC/i,
    );
    expect(result.items[0].classification).toEqual({
      bucket: "P1 Urgent",
      priorityScore: 95,
      reasons: ["今天 17:00 截止"],
    });
  });

  it("lists Smart Inbox messages across all accounts when account id is omitted", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...messageRow("message_gmail", "2026-06-12T09:00:00.000Z"),
              account_id: "11111111-1111-4111-8111-111111111111",
              priority_score: 95,
            },
            {
              ...messageRow("message_outlook", "2026-06-12T08:00:00.000Z"),
              account_id: "22222222-2222-4222-8222-222222222222",
              priority_score: 40,
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.listMessages({
      limit: 10,
      sort: "smart",
    } as any);

    expect(queries[0].text).toMatch(
      /\(\$1::text IS NULL OR messages\.account_id::text = \$1::text\)/i,
    );
    expect(queries[0].values).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      11,
    ]);
    expect(result.items.map((item) => item.accountId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("includes priority score in the Smart Inbox pagination cursor", async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              ...messageRow("message_urgent", "2026-06-12T11:00:00.000Z"),
              priority_score: 95,
            },
            {
              ...messageRow("message_important", "2026-06-12T10:00:00.000Z"),
              priority_score: 80,
            },
            {
              ...messageRow("message_later", "2026-06-12T09:00:00.000Z"),
              priority_score: 20,
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.listMessages({
      accountId: "account_1",
      limit: 2,
      sort: "smart",
    });

    expect(result.items.map((item) => item.id)).toEqual([
      "message_urgent",
      "message_important",
    ]);
    expect(decodeCursorPayload(result.nextCursor)).toEqual({
      v: 1,
      receivedAt: "2026-06-12T10:00:00.000Z",
      id: "message_important",
      priorityScore: 80,
    });
  });

  it("applies Smart Inbox cursor using priority score before received time", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_later", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const cursor = encodeCursorPayload({
      v: 1,
      receivedAt: "2026-06-12T10:00:00.000Z",
      id: "message_important",
      priorityScore: 80,
    });
    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      cursor,
      sort: "smart",
    });

    expect(queries[0].text).toMatch(
      /\(COALESCE\(message_classification\.priority_score, 0\),\s+messages\.received_at,\s+messages\.id::text\) < \(\$4::int, \$5::timestamptz, \$6::text\)/i,
    );
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      null,
      80,
      "2026-06-12T10:00:00.000Z",
      "message_important",
      11,
    ]);
  });

  it("rejects Smart Inbox cursors that do not include a priority score", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const cursor = encodeCursorPayload({
      v: 1,
      receivedAt: "2026-06-12T10:00:00.000Z",
      id: "message_important",
    });
    const store = createPostgresMailReadStore(client);

    await expect(
      store.listMessages({
        accountId: "account_1",
        limit: 10,
        cursor,
        sort: "smart",
      }),
    ).rejects.toThrow(/invalid mail read cursor/i);
    expect(queries).toEqual([]);
  });

  it("applies cursor and q search without provider-specific fields", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_1", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const cursor = encodeCursorPayload({
      v: 1,
      receivedAt: "2026-06-12T10:00:00.000Z",
      id: "message_2",
    });
    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      mailboxId: "mailbox_1",
      limit: 10,
      cursor,
      q: "alice",
    });

    expect(queries[0].text).toMatch(/messages.subject ILIKE/i);
    expect(queries[0].text).toMatch(/messages.from_email ILIKE/i);
    expect(queries[0].text).toMatch(/messages.from_name, ''\) ILIKE/i);
    expect(queries[0].text).toMatch(/messages.snippet, ''\) ILIKE/i);
    expect(queries[0].text).toMatch(/LEFT JOIN search_documents/i);
    expect(queries[0].text).toMatch(/search_documents\.document @@ plainto_tsquery/i);
    expect(queries[0].text).toMatch(/search_documents\.raw_text/i);
    expect(queries[0].text).toMatch(
      /\(messages.received_at, messages.id::text\) < \(\$4::timestamptz, \$5::text\)/i,
    );
    expect(queries[0].text).not.toMatch(/provider_message_id/i);
    expect(queries[0].text).not.toMatch(/body_html/i);
    expect(queries[0].values).toEqual([
      "account_1",
      "mailbox_1",
      "alice",
      "2026-06-12T10:00:00.000Z",
      "message_2",
      11,
    ]);
  });

  it("searches local body and attachment text through search_documents", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_contract", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      q: "signed contract",
    });

    expect(queries[0].text).toMatch(/LEFT JOIN search_documents/i);
    expect(queries[0].text).toMatch(
      /search_documents\.message_id = messages\.id/i,
    );
    expect(queries[0].text).toMatch(
      /search_documents\.document @@ plainto_tsquery\('simple', \$3\)/i,
    );
    expect(queries[0].text).toMatch(
      /COALESCE\(search_documents\.raw_text, ''\) ILIKE '%' \|\| \$3 \|\| '%'/i,
    );
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      "signed contract",
      null,
      null,
      11,
    ]);
  });

  it("returns a local search preview when indexed body or attachment text matches", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...messageRow("message_contract", "2026-06-12T09:00:00.000Z"),
              search_preview:
                "signed contract payment terms from the attached PDF",
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    const result = await store.listMessages({
      accountId: "account_1",
      limit: 10,
      q: "signed contract",
    });

    expect(queries[0].text).toMatch(/ts_headline\s*\(\s*'simple'/i);
    expect(queries[0].text).toMatch(/AS search_preview/i);
    expect(result.items[0].searchPreview).toEqual({
      source: "indexed_text",
      text: "signed contract payment terms from the attached PDF",
    });
  });

  it("applies unread, starred, and attachment quick filters before pagination", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_filtered", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      quickFilters: ["unread", "starred", "attachments"],
    });

    expect(queries[0].text).toMatch(
      /COALESCE\(message_state\.unread, TRUE\) = TRUE/i,
    );
    expect(queries[0].text).toMatch(
      /COALESCE\(message_state\.starred, FALSE\) = TRUE/i,
    );
    expect(queries[0].text).toMatch(
      /HAVING COUNT\(DISTINCT attachments\.id\) > 0/i,
    );
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      null,
      null,
      null,
      11,
    ]);
  });

  it("filters list messages by all selected labels without joining provider payloads", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_labeled", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const labelIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      quickFilters: ["labels"],
      labelIds,
      tagMode: "all",
    });

    expect(queries[0].text).toMatch(/FROM label_assignments/i);
    expect(queries[0].text).toMatch(/COUNT\(DISTINCT selected_labels\.label_id\)/i);
    expect(queries[0].text).toMatch(/cardinality\(\$4::uuid\[\]\)/i);
    expect(queries[0].text).not.toMatch(/provider_message_id/i);
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      null,
      labelIds,
      null,
      null,
      11,
    ]);
  });

  it("limits q search to selected sender and subject scopes", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_scoped", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      q: "lina",
      qScopes: ["sender", "subject"],
    });

    expect(queries[0].text).toMatch(/messages\.subject ILIKE/i);
    expect(queries[0].text).toMatch(/messages\.from_email ILIKE/i);
    expect(queries[0].text).not.toMatch(/messages\.to_emails::text/i);
    expect(queries[0].text).not.toMatch(/search_documents\.document @@ plainto_tsquery/i);
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      "lina",
      null,
      null,
      11,
    ]);
  });

  it("filters list messages by keyword-backed saved views using local indexed text", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [messageRow("message_code", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      savedViewId: "codes",
    });

    expect(queries[0].text).toMatch(/unnest\(\$4::text\[\]\)/i);
    expect(queries[0].text).toMatch(/messages\.subject ILIKE/i);
    expect(queries[0].text).toMatch(/messages\.from_email ILIKE/i);
    expect(queries[0].text).toMatch(/search_documents\.raw_text/i);
    expect(queries[0].text).toMatch(/message_classification\.reasons::text/i);
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      null,
      expect.arrayContaining(["验证码", "verification", "otp"]),
      null,
      null,
      11,
    ]);
  });

  it("filters list messages by attachment-backed saved views with a grouped HAVING clause", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              ...messageRow("message_attachment", "2026-06-12T09:00:00.000Z"),
              attachment_count: "2",
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      savedViewId: "large_attachments",
    });

    expect(queries[0].text).toMatch(
      /HAVING COUNT\(DISTINCT attachments\.id\) >= \$4::int/i,
    );
    expect(queries[0].values).toEqual([
      "account_1",
      null,
      null,
      1,
      null,
      null,
      11,
    ]);
  });

  it("filters list messages by dynamic Hermes saved views", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM saved_views")) {
          return {
            rows: [
              {
                id: "hermes_contract",
                label: "合同",
                tone: "blue",
                kind: "keyword",
                keywords: ["合同", "contract"],
                match_config: {},
              },
            ],
          };
        }
        return {
          rows: [messageRow("message_contract", "2026-06-12T09:00:00.000Z")],
        };
      },
    };

    const store = createPostgresMailReadStore(client);

    await store.listMessages({
      accountId: "account_1",
      limit: 10,
      savedViewId: "hermes_contract",
    });

    expect(queries[0].text).toMatch(/FROM saved_views/i);
    expect(queries[0].values).toEqual(["hermes_contract"]);
    expect(queries[1].text).toMatch(/unnest\(\$4::text\[\]\)/i);
    expect(queries[1].values).toEqual([
      "account_1",
      null,
      null,
      ["合同", "contract"],
      null,
      null,
      11,
    ]);
  });

  it("rejects unknown saved view ids before querying", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresMailReadStore(client);

    await expect(
      store.listMessages({
        accountId: "account_1",
        limit: 10,
        savedViewId: "unknown",
      }),
    ).rejects.toThrow(/invalid mail saved view/i);
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/FROM saved_views/i);
    expect(queries[0].values).toEqual(["unknown"]);
  });

  it("rejects malformed list cursors before querying", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresMailReadStore(client);

    await expect(
      store.listMessages({
        accountId: "account_1",
        limit: 10,
        cursor: "not-a-cursor",
      }),
    ).rejects.toThrow(/invalid mail read cursor/i);
    expect(queries).toEqual([]);
  });

  it("loads message detail with bodies and mailbox ids", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
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
              body_text: "Plain body",
              body_html: "<p>Body</p>",
              unread: false,
              starred: true,
              mailbox_ids: ["mailbox_1"],
              attachment_count: "0",
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.getMessage({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(queries[0].text).toMatch(/LEFT JOIN message_locations/i);
    expect(queries[0].text).toMatch(/WHERE messages.account_id = \$1/i);
    expect(queries[0].text).toMatch(/AND messages.id = \$2/i);
    expect(queries[0].text).toMatch(/message_state.deleted_at IS NULL/i);
    expect(queries[0].values).toEqual(["account_1", "message_1"]);
    expect(result).toMatchObject({
      id: "message_1",
      accountId: "account_1",
      bodyText: "Plain body",
      bodyHtml: "<p>Body</p>",
      mailboxIds: ["mailbox_1"],
    });
  });

  it("loads message detail attachments without provider attachment ids", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
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
              body_text: "Plain body",
              body_html: "<p>Body</p>",
              unread: false,
              starred: true,
              mailbox_ids: ["mailbox_1"],
              attachment_count: "2",
              attachments: [
                {
                  id: "attachment_1",
                  filename: "invoice.pdf",
                  contentType: "application/pdf",
                  byteSize: 45000,
                  contentId: null,
                  embedded: false,
                  inline: false,
                },
                {
                  id: "attachment_2",
                  filename: "logo.png",
                  contentType: "image/png",
                  byteSize: 3200,
                  contentId: "<logo@example.com>",
                  embedded: true,
                  inline: true,
                },
              ],
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.getMessage({
      accountId: "account_1",
      messageId: "message_1",
    });

    expect(queries[0].text).toMatch(/jsonb_agg/i);
    expect(queries[0].text).toMatch(/attachments\.filename/i);
    expect(queries[0].text).not.toMatch(/provider_attachment_id/i);
    expect(result?.attachments).toEqual([
      {
        id: "attachment_1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        byteSize: 45000,
        embedded: false,
        inline: false,
      },
      {
        id: "attachment_2",
        filename: "logo.png",
        contentType: "image/png",
        byteSize: 3200,
        contentId: "<logo@example.com>",
        embedded: true,
        inline: true,
      },
    ]);
  });

  it("loads an internal attachment download reference for visible account messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "attachment_1",
              account_id: "account_1",
              provider_attachment_id: "ee_attachment_1",
              filename: "invoice.pdf",
              content_type: "application/pdf",
              byte_size: "45000",
            },
          ],
        };
      },
    };

    const store = createPostgresMailReadStore(client);
    const result = await store.getAttachmentDownload({
      accountId: "account_1",
      attachmentId: "attachment_1",
    });

    expect(queries[0].text).toMatch(/FROM attachments/i);
    expect(queries[0].text).toMatch(/JOIN messages/i);
    expect(queries[0].text).toMatch(/JOIN message_state/i);
    expect(queries[0].text).toMatch(/message_state.deleted_at IS NULL/i);
    expect(queries[0].text).toMatch(/EXISTS/i);
    expect(queries[0].text).toMatch(/FROM message_locations/i);
    expect(queries[0].values).toEqual(["account_1", "attachment_1"]);
    expect(result).toEqual({
      id: "attachment_1",
      accountId: "account_1",
      providerAttachmentId: "ee_attachment_1",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      byteSize: 45000,
    });
  });
});

function messageRow(id: string, receivedAt: string) {
  return {
    id,
    account_id: "account_1",
    subject: "Hello",
    from_email: "a@example.com",
    from_name: "Alice",
    received_at: receivedAt,
    snippet: "Body",
    unread: true,
    starred: false,
    mailbox_ids: ["mailbox_1"],
    attachment_count: "0",
  };
}

function encodeCursorPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursorPayload(cursor: string | undefined): unknown {
  if (!cursor) {
    return undefined;
  }

  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}
