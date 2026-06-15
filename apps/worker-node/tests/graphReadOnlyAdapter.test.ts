import { describe, expect, it } from "vitest";

import { createGraphReadOnlyAdapter } from "../src/mail-provider/graph-readonly-adapter";

describe("Microsoft Graph read-only adapter", () => {
  it("discovers Graph folders as provider mailboxes", async () => {
    const adapter = createGraphReadOnlyAdapter({
      graph: {
        async listMailFolders(input) {
          expect(input).toEqual({ accountId: "acc_1" });
          return {
            folders: [
              { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
              {
                id: "sentitems",
                displayName: "Sent Items",
                wellKnownName: "sentitems",
              },
              { id: "folder_clients", displayName: "Clients" },
              { displayName: "Missing id" },
            ],
          };
        },
        async deltaMessages() {
          throw new Error("deltaMessages should not be called during discovery");
        },
      },
    });

    const result = await adapter.listMailboxes!({ accountId: "acc_1" });

    expect(result).toEqual({
      mailboxes: [
        {
          identity: { provider: "graph", folderId: "inbox" },
          displayName: "Inbox",
          role: "inbox",
          raw: { id: "inbox", displayName: "Inbox", wellKnownName: "inbox" },
        },
        {
          identity: { provider: "graph", folderId: "sentitems" },
          displayName: "Sent Items",
          role: "sent",
          raw: {
            id: "sentitems",
            displayName: "Sent Items",
            wellKnownName: "sentitems",
          },
        },
        {
          identity: { provider: "graph", folderId: "folder_clients" },
          displayName: "Clients",
          role: "label",
          raw: { id: "folder_clients", displayName: "Clients" },
        },
      ],
    });
  });

  it("bootstraps inbox delta and returns a mailbox-scoped Graph cursor", async () => {
    const calls: unknown[] = [];
    const adapter = createGraphReadOnlyAdapter({
      graph: {
        async deltaMessages(input) {
          calls.push(input);
          return {
            messages: [
              {
                id: "msg_1",
                changeKey: "ck_1",
                conversationId: "conv_1",
                subject: "Hello",
              },
            ],
            nextLink: "https://graph.example/next",
          };
        },
      },
    });

    const result = await adapter.sync({ accountId: "acc_1", limit: 25 });

    expect(calls).toEqual([
      { accountId: "acc_1", folderId: "inbox", maxPageSize: 25 },
    ]);
    expect(result).toEqual({
      changes: [
        {
          kind: "message_upserted",
          identity: {
            provider: "graph",
            id: "msg_1",
            changeKey: "ck_1",
            conversationId: "conv_1",
          },
          raw: {
            id: "msg_1",
            changeKey: "ck_1",
            conversationId: "conv_1",
            subject: "Hello",
          },
        },
      ],
      cursor: {
        provider: "graph",
        scope: "mailbox",
        mailbox: { provider: "graph", folderId: "inbox" },
        deltaLink: "https://graph.example/next",
      },
      hasMore: true,
    });
  });

  it("uses an explicit Graph folder mailbox instead of the default inbox", async () => {
    const calls: unknown[] = [];
    const adapter = createGraphReadOnlyAdapter({
      graph: {
        async deltaMessages(input) {
          calls.push(input);
          return {
            messages: [],
            deltaLink: "https://graph.example/archive-delta",
          };
        },
      },
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      mailbox: {
        provider: "graph",
        folderId: "folder_archive",
      },
      limit: 25,
    });

    expect(calls).toEqual([
      { accountId: "acc_1", folderId: "folder_archive", maxPageSize: 25 },
    ]);
    expect(result).toEqual({
      changes: [
        {
          kind: "mailbox_changed",
          mailbox: {
            provider: "graph",
            folderId: "folder_archive",
          },
          raw: {
            provider: "graph",
            folderId: "folder_archive",
          },
        },
      ],
      cursor: {
        provider: "graph",
        scope: "mailbox",
        mailbox: { provider: "graph", folderId: "folder_archive" },
        deltaLink: "https://graph.example/archive-delta",
      },
      hasMore: false,
    });
  });

  it("uses an existing Graph delta link and records deleted messages", async () => {
    const calls: unknown[] = [];
    const adapter = createGraphReadOnlyAdapter({
      graph: {
        async deltaMessages(input) {
          calls.push(input);
          return {
            messages: [
              {
                id: "msg_deleted",
                "@removed": { reason: "deleted" },
              },
            ],
            deltaLink: "https://graph.example/delta",
          };
        },
      },
      now: () => "2026-06-12T11:00:00.000Z",
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      cursor: {
        provider: "graph",
        scope: "mailbox",
        mailbox: { provider: "graph", folderId: "inbox" },
        deltaLink: "https://graph.example/old-delta",
      },
      limit: 10,
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        folderId: "inbox",
        deltaLink: "https://graph.example/old-delta",
        maxPageSize: 10,
      },
    ]);
    expect(result).toEqual({
      changes: [
        {
          kind: "message_deleted",
          identity: { provider: "graph", id: "msg_deleted" },
          deletedAt: "2026-06-12T11:00:00.000Z",
          raw: { id: "msg_deleted", "@removed": { reason: "deleted" } },
        },
      ],
      cursor: {
        provider: "graph",
        scope: "mailbox",
        mailbox: { provider: "graph", folderId: "inbox" },
        deltaLink: "https://graph.example/delta",
      },
      hasMore: false,
    });
  });
});
