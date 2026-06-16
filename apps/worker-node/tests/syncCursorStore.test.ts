import { describe, expect, it } from "vitest";

import { createPostgresSyncCursorStore } from "../src/sync-cursor-store";

describe("postgres sync cursor store", () => {
  it("reads the active Gmail account cursor from sync_cursors", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              provider: "gmail",
              cursor_scope: "account",
              gmail_history_id: "12345",
              cursor_json: { provider: "gmail", scope: "account", historyId: "12345" },
              state: "active",
              reset_reason: null,
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    const cursor = await store.getCursor({
      accountId: "11111111-1111-1111-1111-111111111111",
      provider: "gmail",
    });

    expect(queries[0].text).toMatch(/FROM sync_cursors/i);
    expect(queries[0].values).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "gmail",
      "",
      "history",
    ]);
    expect(cursor).toEqual({
      provider: "gmail",
      scope: "account",
      historyId: "12345",
    });
  });

  it("upserts a Gmail history cursor with typed columns", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    await store.upsertCursor({
      accountId: "11111111-1111-1111-1111-111111111111",
      cursor: { provider: "gmail", scope: "account", historyId: "67890" },
    });

    expect(queries[0].text).toMatch(/INSERT INTO sync_cursors/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(account_id, provider, mailbox_key, cursor_type\)/i);
    expect(queries[0].values).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "gmail",
      "",
      "history",
      "67890",
      { provider: "gmail", scope: "account", historyId: "67890" },
      "account",
      null,
      "67890",
      null,
      null,
      null,
      null,
      null,
      expect.any(String),
    ]);
  });

  it("reads the active Graph inbox delta cursor as mailbox-scoped state", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              provider: "graph",
              cursor_scope: "mailbox",
              provider_mailbox_id: "inbox",
              graph_delta_link: "https://graph.example/delta",
              cursor_json: {
                provider: "graph",
                scope: "mailbox",
                mailbox: { provider: "graph", folderId: "inbox" },
                deltaLink: "https://graph.example/delta",
              },
              state: "active",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    const cursor = await store.getCursor({
      accountId: "22222222-2222-2222-2222-222222222222",
      provider: "graph",
    });

    expect(queries[0].values).toEqual([
      "22222222-2222-2222-2222-222222222222",
      "graph",
      "inbox",
      "delta",
    ]);
    expect(cursor).toEqual({
      provider: "graph",
      scope: "mailbox",
      mailbox: { provider: "graph", folderId: "inbox" },
      deltaLink: "https://graph.example/delta",
    });
  });

  it("reads an explicit Graph folder delta cursor by mailbox id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              provider: "graph",
              cursor_scope: "mailbox",
              provider_mailbox_id: "folder_archive",
              graph_delta_link: "https://graph.example/archive-delta",
              cursor_json: {
                provider: "graph",
                scope: "mailbox",
                mailbox: { provider: "graph", folderId: "folder_archive" },
                deltaLink: "https://graph.example/archive-delta",
              },
              state: "active",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    const cursor = await store.getCursor({
      accountId: "22222222-2222-2222-2222-222222222222",
      provider: "graph",
      mailbox: {
        provider: "graph",
        folderId: "folder_archive",
      },
    });

    expect(queries[0].values).toEqual([
      "22222222-2222-2222-2222-222222222222",
      "graph",
      "folder_archive",
      "delta",
    ]);
    expect(cursor).toEqual({
      provider: "graph",
      scope: "mailbox",
      mailbox: { provider: "graph", folderId: "folder_archive" },
      deltaLink: "https://graph.example/archive-delta",
    });
  });

  it("reads an active IMAP mailbox cursor from typed cursor columns", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              provider: "imap",
              cursor_scope: "mailbox",
              provider_mailbox_id: "INBOX",
              imap_uidvalidity: "987654",
              imap_highest_uid: "42",
              imap_uid_next: "43",
              imap_highest_modseq: "123456789",
              cursor_json: {
                provider: "imap",
                scope: "mailbox",
                mailbox: { provider: "imap", path: "INBOX", delimiter: "/" },
                uidvalidity: "987654",
                highestUid: "42",
                uidNext: "43",
                highestModseq: "123456789",
              },
              state: "active",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    const cursor = await store.getCursor({
      accountId: "33333333-3333-3333-3333-333333333333",
      provider: "imap",
      mailbox: {
        provider: "imap",
        path: "INBOX",
        delimiter: "/",
      },
    });

    expect(queries[0].text).toMatch(/imap_uidvalidity/i);
    expect(queries[0].values).toEqual([
      "33333333-3333-3333-3333-333333333333",
      "imap",
      "INBOX",
      "imap",
    ]);
    expect(cursor).toEqual({
      provider: "imap",
      scope: "mailbox",
      mailbox: { provider: "imap", path: "INBOX", delimiter: "/" },
      uidvalidity: "987654",
      highestUid: "42",
      uidNext: "43",
      highestModseq: "123456789",
    });
  });

  it("upserts an IMAP mailbox cursor with resume-safe typed columns", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const cursor = {
      provider: "imap" as const,
      scope: "mailbox" as const,
      mailbox: { provider: "imap" as const, path: "INBOX", delimiter: "/" },
      uidvalidity: "987654",
      highestUid: "42",
      uidNext: "43",
      highestModseq: "123456789",
    };
    const store = createPostgresSyncCursorStore(client);
    await store.upsertCursor({
      accountId: "33333333-3333-3333-3333-333333333333",
      cursor,
    });

    expect(queries[0].text).toMatch(/imap_uidvalidity/i);
    expect(queries[0].text).toMatch(/imap_highest_uid/i);
    expect(queries[0].values).toEqual([
      "33333333-3333-3333-3333-333333333333",
      "imap",
      "INBOX",
      "imap",
      "42",
      cursor,
      "mailbox",
      "INBOX",
      null,
      null,
      "987654",
      "42",
      "43",
      "123456789",
      expect.any(String),
    ]);
  });

  it("round-trips an IMAP mailbox cursor through stored typed columns", async () => {
    const accountId = "33333333-3333-3333-3333-333333333333";
    const cursor = {
      provider: "imap" as const,
      scope: "mailbox" as const,
      mailbox: { provider: "imap" as const, path: "INBOX", delimiter: "/" },
      uidvalidity: "987654",
      highestUid: "42",
      uidNext: "43",
      highestModseq: "123456789",
    };
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    let storedValues: unknown[] | undefined;
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (/INSERT INTO sync_cursors/i.test(text)) {
          storedValues = values;
          return { rows: [] };
        }

        return {
          rows: [
            {
              provider: storedValues?.[1],
              cursor_scope: storedValues?.[6],
              provider_mailbox_id: storedValues?.[7],
              gmail_history_id: storedValues?.[8],
              graph_delta_link: storedValues?.[9],
              imap_uidvalidity: storedValues?.[10],
              imap_highest_uid: storedValues?.[11],
              imap_uid_next: storedValues?.[12],
              imap_highest_modseq: storedValues?.[13],
              cursor_json: storedValues?.[5],
              state: "active",
            },
          ],
        };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    await store.upsertCursor({ accountId, cursor });
    const restored = await store.getCursor({
      accountId,
      provider: "imap",
      mailbox: { provider: "imap", path: "INBOX" },
    });

    expect(queries[1].values).toEqual([accountId, "imap", "INBOX", "imap"]);
    expect(restored).toEqual(cursor);
  });

  it("marks a cursor reset without deleting the last known value", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };

    const store = createPostgresSyncCursorStore(client);
    await store.markCursorReset({
      accountId: "11111111-1111-1111-1111-111111111111",
      provider: "gmail",
      reason: "gmail_history_expired",
    });

    expect(queries[0].text).toMatch(/UPDATE sync_cursors/i);
    expect(queries[0].text).toMatch(/state = 'reset_required'/i);
    expect(queries[0].values).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "gmail",
      "",
      "history",
      "gmail_history_expired",
    ]);
  });
});
