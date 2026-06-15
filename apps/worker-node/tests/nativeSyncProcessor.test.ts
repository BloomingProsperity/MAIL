import { describe, expect, it } from "vitest";

import { GmailHistoryResetError } from "../src/mail-provider/gmail-readonly-adapter";
import { createNativeSyncProcessor } from "../src/mail-provider/native-sync-processor";

describe("native sync processor", () => {
  it("discovers native mailboxes and persists provider mailbox refs", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        graph: {
          provider: "graph",
          async listMailboxes(input) {
            actions.push({ type: "adapter.listMailboxes", input });
            return {
              mailboxes: [
                {
                  identity: { provider: "graph", folderId: "inbox" },
                  displayName: "Inbox",
                  role: "inbox",
                  raw: { id: "inbox", displayName: "Inbox" },
                },
                {
                  identity: { provider: "graph", folderId: "archive" },
                  displayName: "Archive",
                  role: "archive",
                  raw: { id: "archive", displayName: "Archive" },
                },
              ],
            };
          },
          async sync() {
            throw new Error("sync should not run during discovery");
          },
        },
      },
      cursorStore: {
        async getCursor() {
          throw new Error("cursor should not be read during discovery");
        },
        async upsertCursor() {},
        async markCursorReset() {},
      },
      providerRefStore: {
        async upsertMailboxRef(input) {
          actions.push({ type: "mailbox.upsert", input });
          return {
            id: `mailbox_ref_${actions.length}`,
            provider: input.identity.provider,
            providerMailboxId:
              input.identity.provider === "graph"
                ? input.identity.folderId
                : "unexpected",
            displayName: input.displayName,
            role: input.role,
          };
        },
        async upsertMessageRef() {
          throw new Error("message refs should not be written during discovery");
        },
        async recordTombstone() {
          throw new Error("tombstones should not be written during discovery");
        },
      },
    });

    const result = await processor.discoverMailboxes({
      accountId: "acc_1",
      provider: "graph",
    });

    expect(result).toEqual({
      provider: "graph",
      accountId: "acc_1",
      mailboxCount: 2,
      mailboxes: [
        {
          identity: { provider: "graph", folderId: "inbox" },
          displayName: "Inbox",
          role: "inbox",
          raw: { id: "inbox", displayName: "Inbox" },
        },
        {
          identity: { provider: "graph", folderId: "archive" },
          displayName: "Archive",
          role: "archive",
          raw: { id: "archive", displayName: "Archive" },
        },
      ],
    });
    expect(actions).toEqual([
      {
        type: "adapter.listMailboxes",
        input: { accountId: "acc_1" },
      },
      {
        type: "mailbox.upsert",
        input: {
          accountId: "acc_1",
          identity: { provider: "graph", folderId: "inbox" },
          displayName: "Inbox",
          role: "inbox",
          rawRef: { id: "inbox", displayName: "Inbox" },
        },
      },
      {
        type: "mailbox.upsert",
        input: {
          accountId: "acc_1",
          identity: { provider: "graph", folderId: "archive" },
          displayName: "Archive",
          role: "archive",
          rawRef: { id: "archive", displayName: "Archive" },
        },
      },
    ]);
  });

  it("passes explicit native mailboxes to the adapter", async () => {
    const calls: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        graph: {
          provider: "graph",
          async sync(input) {
            calls.push(input);
            return {
              changes: [],
              hasMore: false,
            };
          },
        },
      },
      cursorStore: {
        async getCursor() {
          return undefined;
        },
        async upsertCursor() {},
        async markCursorReset() {},
      },
      providerRefStore: {
        async upsertMailboxRef() {
          throw new Error("no mailbox changes expected");
        },
        async upsertMessageRef() {
          throw new Error("no message changes expected");
        },
        async recordTombstone() {
          throw new Error("no tombstones expected");
        },
      },
    });

    await processor.syncAccount({
      accountId: "acc_1",
      provider: "graph",
      mailbox: {
        provider: "graph",
        folderId: "folder_archive",
      },
      limit: 25,
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        cursor: undefined,
        mailbox: {
          provider: "graph",
          folderId: "folder_archive",
        },
        limit: 25,
      },
    ]);
  });

  it("uses mailbox-scoped cursors for explicit native mailbox sync", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        graph: {
          provider: "graph",
          async sync(input) {
            actions.push({ type: "adapter.sync", input });
            return {
              changes: [],
              cursor: {
                provider: "graph",
                scope: "mailbox",
                mailbox: { provider: "graph", folderId: "folder_archive" },
                deltaLink: "https://graph.example/new-delta",
              },
              hasMore: false,
            };
          },
        },
      },
      cursorStore: {
        async getCursor(input) {
          actions.push({ type: "cursor.get", input });
          return {
            provider: "graph",
            scope: "mailbox",
            mailbox: { provider: "graph", folderId: "folder_archive" },
            deltaLink: "https://graph.example/old-delta",
          };
        },
        async upsertCursor(input) {
          actions.push({ type: "cursor.upsert", input });
        },
        async markCursorReset(input) {
          actions.push({ type: "cursor.reset", input });
        },
      },
      providerRefStore: {
        async upsertMailboxRef() {
          throw new Error("no mailbox changes expected");
        },
        async upsertMessageRef() {
          throw new Error("no message changes expected");
        },
        async recordTombstone() {
          throw new Error("no tombstones expected");
        },
      },
    });

    await processor.syncAccount({
      accountId: "acc_1",
      provider: "graph",
      mailbox: {
        provider: "graph",
        folderId: "folder_archive",
      },
      limit: 25,
    });

    expect(actions).toEqual([
      {
        type: "cursor.get",
        input: {
          accountId: "acc_1",
          provider: "graph",
          mailbox: {
            provider: "graph",
            folderId: "folder_archive",
          },
        },
      },
      {
        type: "adapter.sync",
        input: {
          accountId: "acc_1",
          cursor: {
            provider: "graph",
            scope: "mailbox",
            mailbox: { provider: "graph", folderId: "folder_archive" },
            deltaLink: "https://graph.example/old-delta",
          },
          mailbox: {
            provider: "graph",
            folderId: "folder_archive",
          },
          limit: 25,
        },
      },
      {
        type: "cursor.upsert",
        input: {
          accountId: "acc_1",
          cursor: {
            provider: "graph",
            scope: "mailbox",
            mailbox: { provider: "graph", folderId: "folder_archive" },
            deltaLink: "https://graph.example/new-delta",
          },
        },
      },
    ]);
  });

  it("persists native mailbox refs before provider message changes", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        graph: {
          provider: "graph",
          async sync(input) {
            actions.push({ type: "adapter.sync", input });
            return {
              changes: [
                {
                  kind: "mailbox_changed",
                  mailbox: {
                    provider: "graph",
                    folderId: "folder_projects",
                  },
                  raw: {
                    id: "folder_projects",
                    displayName: "Projects",
                    role: "inbox",
                  },
                },
                {
                  kind: "message_upserted",
                  identity: {
                    provider: "graph",
                    id: "graph_msg_1",
                    changeKey: "change_1",
                    conversationId: "conv_1",
                  },
                  raw: { id: "graph_msg_1" },
                },
              ],
              hasMore: false,
            };
          },
        },
      },
      cursorStore: {
        async getCursor(input) {
          actions.push({ type: "cursor.get", input });
          return undefined;
        },
        async upsertCursor(input) {
          actions.push({ type: "cursor.upsert", input });
        },
        async markCursorReset(input) {
          actions.push({ type: "cursor.reset", input });
        },
      },
      providerRefStore: {
        async upsertMailboxRef(input) {
          actions.push({ type: "mailbox.upsert", input });
          return {
            id: "mailbox_ref_1",
            provider: "graph",
            providerMailboxId: "folder_projects",
          };
        },
        async upsertMessageRef(input) {
          actions.push({ type: "ref.upsert", input });
          return { id: "ref_1", provider: "graph", graphMessageId: "graph_msg_1" };
        },
        async recordTombstone(input) {
          actions.push({ type: "ref.tombstone", input });
          return { id: "tomb_1", provider: "graph", idempotencyKey: "tombstone" };
        },
      },
    });

    const result = await processor.syncAccount({
      accountId: "acc_1",
      provider: "graph",
      limit: 25,
    });

    expect(result).toEqual({
      provider: "graph",
      accountId: "acc_1",
      changeCount: 2,
      cursorAdvanced: false,
      hasMore: false,
    });
    expect(actions.map((action) => (action as { type: string }).type)).toEqual([
      "cursor.get",
      "adapter.sync",
      "mailbox.upsert",
      "ref.upsert",
    ]);
    expect(actions[2]).toEqual({
      type: "mailbox.upsert",
      input: {
        accountId: "acc_1",
        identity: {
          provider: "graph",
          folderId: "folder_projects",
        },
        rawRef: {
          id: "folder_projects",
          displayName: "Projects",
          role: "inbox",
        },
      },
    });
  });

  it("runs a Gmail native sync and persists refs, tombstones, and cursor", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        gmail: {
          provider: "gmail",
          async sync(input) {
            actions.push({ type: "adapter.sync", input });
            return {
              changes: [
                {
                  kind: "message_upserted",
                  identity: {
                    provider: "gmail",
                    messageId: "msg_added",
                    threadId: "thr_added",
                    historyId: "950",
                  },
                  raw: { id: "msg_added" },
                },
                {
                  kind: "message_deleted",
                  identity: {
                    provider: "gmail",
                    messageId: "msg_deleted",
                    threadId: "thr_deleted",
                    historyId: "940",
                  },
                  deletedAt: "2026-06-12T10:00:00.000Z",
                  raw: { id: "msg_deleted" },
                },
              ],
              cursor: { provider: "gmail", scope: "account", historyId: "960" },
              hasMore: false,
            };
          },
        },
      },
      cursorStore: {
        async getCursor(input) {
          actions.push({ type: "cursor.get", input });
          return { provider: "gmail", scope: "account", historyId: "900" };
        },
        async upsertCursor(input) {
          actions.push({ type: "cursor.upsert", input });
        },
        async markCursorReset(input) {
          actions.push({ type: "cursor.reset", input });
        },
      },
      providerRefStore: {
        async upsertMessageRef(input) {
          actions.push({ type: "ref.upsert", input });
          return { id: "ref_1", provider: "gmail", gmailMessageId: "msg_added" };
        },
        async recordTombstone(input) {
          actions.push({ type: "ref.tombstone", input });
          return { id: "tomb_1", provider: "gmail", idempotencyKey: "tombstone" };
        },
      },
    });

    const result = await processor.syncAccount({
      accountId: "acc_1",
      provider: "gmail",
      limit: 25,
    });

    expect(result).toEqual({
      provider: "gmail",
      accountId: "acc_1",
      changeCount: 2,
      cursorAdvanced: true,
      hasMore: false,
    });
    expect(actions).toEqual([
      {
        type: "cursor.get",
        input: { accountId: "acc_1", provider: "gmail" },
      },
      {
        type: "adapter.sync",
        input: {
          accountId: "acc_1",
          cursor: { provider: "gmail", scope: "account", historyId: "900" },
          limit: 25,
        },
      },
      {
        type: "ref.upsert",
        input: {
          accountId: "acc_1",
          identity: {
            provider: "gmail",
            messageId: "msg_added",
            threadId: "thr_added",
            historyId: "950",
          },
          rawRef: { id: "msg_added" },
        },
      },
      {
        type: "ref.tombstone",
        input: {
          accountId: "acc_1",
          identity: {
            provider: "gmail",
            messageId: "msg_deleted",
            threadId: "thr_deleted",
            historyId: "940",
          },
          deletedAt: "2026-06-12T10:00:00.000Z",
          reason: "provider_deleted",
          rawEvent: { id: "msg_deleted" },
        },
      },
      {
        type: "cursor.upsert",
        input: {
          accountId: "acc_1",
          cursor: { provider: "gmail", scope: "account", historyId: "960" },
        },
      },
    ]);
  });

  it("marks Gmail cursor reset when history is expired", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        gmail: {
          provider: "gmail",
          async sync() {
            throw new GmailHistoryResetError("too old");
          },
        },
      },
      cursorStore: {
        async getCursor(input) {
          actions.push({ type: "cursor.get", input });
          return { provider: "gmail", scope: "account", historyId: "old" };
        },
        async upsertCursor(input) {
          actions.push({ type: "cursor.upsert", input });
        },
        async markCursorReset(input) {
          actions.push({ type: "cursor.reset", input });
        },
      },
      providerRefStore: {
        async upsertMessageRef() {
          throw new Error("should not upsert refs after reset");
        },
        async recordTombstone() {
          throw new Error("should not write tombstones after reset");
        },
      },
    });

    const result = await processor.syncAccount({
      accountId: "acc_1",
      provider: "gmail",
    });

    expect(result).toEqual({
      provider: "gmail",
      accountId: "acc_1",
      changeCount: 0,
      cursorAdvanced: false,
      hasMore: false,
      resetRequired: true,
      resetReason: "gmail_history_expired",
    });
    expect(actions).toEqual([
      {
        type: "cursor.get",
        input: { accountId: "acc_1", provider: "gmail" },
      },
      {
        type: "cursor.reset",
        input: {
          accountId: "acc_1",
          provider: "gmail",
          reason: "gmail_history_expired",
        },
      },
    ]);
  });

  it("returns native continuations without advancing the active cursor", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        gmail: {
          provider: "gmail",
          async sync(input) {
            actions.push({ type: "adapter.sync", input });
            return {
              changes: [
                {
                  kind: "message_upserted",
                  identity: {
                    provider: "gmail",
                    messageId: "msg_1",
                    historyId: "950",
                  },
                  raw: { id: "msg_1" },
                },
              ],
              continuation: {
                provider: "gmail",
                mode: "history",
                startHistoryId: "900",
                pageToken: "page-2",
              },
              hasMore: true,
            };
          },
        },
      },
      cursorStore: {
        async getCursor(input) {
          actions.push({ type: "cursor.get", input });
          return { provider: "gmail", scope: "account", historyId: "900" };
        },
        async upsertCursor(input) {
          actions.push({ type: "cursor.upsert", input });
        },
        async markCursorReset(input) {
          actions.push({ type: "cursor.reset", input });
        },
      },
      providerRefStore: {
        async upsertMessageRef(input) {
          actions.push({ type: "ref.upsert", input });
          return { id: "ref_1", provider: "gmail", gmailMessageId: "msg_1" };
        },
        async recordTombstone(input) {
          actions.push({ type: "ref.tombstone", input });
          return { id: "tomb_1", provider: "gmail", idempotencyKey: "tombstone" };
        },
      },
    });

    const result = await processor.syncAccount({
      accountId: "acc_1",
      provider: "gmail",
      limit: 25,
    });

    expect(result).toEqual({
      provider: "gmail",
      accountId: "acc_1",
      changeCount: 1,
      cursorAdvanced: false,
      hasMore: true,
      continuation: {
        provider: "gmail",
        mode: "history",
        startHistoryId: "900",
        pageToken: "page-2",
      },
    });
    expect(actions.map((action) => (action as { type: string }).type)).toEqual([
      "cursor.get",
      "adapter.sync",
      "ref.upsert",
    ]);
  });

  it("mirrors native message changes into the unified read model with provider identities", async () => {
    const actions: unknown[] = [];
    const processor = createNativeSyncProcessor({
      adapters: {
        graph: {
          provider: "graph",
          async sync(input) {
            actions.push({ type: "adapter.sync", input });
            return {
              changes: [
                {
                  kind: "mailbox_changed",
                  mailbox: { provider: "graph", folderId: "folder_inbox" },
                  raw: { id: "folder_inbox", displayName: "Inbox" },
                },
                {
                  kind: "message_upserted",
                  identity: {
                    provider: "graph",
                    id: "graph_msg_1",
                    changeKey: "change_1",
                    conversationId: "conv_1",
                  },
                  raw: {
                    id: "graph_msg_1",
                    subject: "Partnership update",
                    parentFolderId: "folder_inbox",
                  },
                },
                {
                  kind: "message_deleted",
                  identity: {
                    provider: "graph",
                    id: "graph_msg_deleted",
                    conversationId: "conv_deleted",
                  },
                  deletedAt: "2026-06-12T10:00:00.000Z",
                  raw: { id: "graph_msg_deleted", "@removed": { reason: "deleted" } },
                },
              ],
              hasMore: false,
            };
          },
        },
      },
      cursorStore: {
        async getCursor(input) {
          actions.push({ type: "cursor.get", input });
          return undefined;
        },
        async upsertCursor(input) {
          actions.push({ type: "cursor.upsert", input });
        },
        async markCursorReset(input) {
          actions.push({ type: "cursor.reset", input });
        },
      },
      providerRefStore: {
        async upsertMailboxRef(input) {
          actions.push({ type: "mailbox.ref.upsert", input });
          return {
            id: "mailbox_ref_1",
            provider: "graph",
            providerMailboxId: "folder_inbox",
          };
        },
        async upsertMessageRef(input) {
          actions.push({ type: "message.ref.upsert", input });
          return {
            id: "message_ref_1",
            provider: "graph",
            graphMessageId: "graph_msg_1",
          };
        },
        async recordTombstone(input) {
          actions.push({ type: "message.ref.tombstone", input });
          return {
            id: "tombstone_1",
            provider: "graph",
            idempotencyKey: "tombstone",
          };
        },
      },
      mirrorStore: {
        async upsertMailboxes(input) {
          actions.push({ type: "mirror.mailboxes", input });
        },
        async upsertMessage(input) {
          actions.push({ type: "mirror.message", input });
        },
        async recordMessageDeleted(input) {
          actions.push({ type: "mirror.deleted", input });
        },
      },
    });

    await processor.syncAccount({
      accountId: "acc_1",
      provider: "graph",
      mailbox: { provider: "graph", folderId: "folder_inbox" },
      limit: 25,
    });

    expect(actions.map((action) => (action as { type: string }).type)).toEqual([
      "cursor.get",
      "adapter.sync",
      "mailbox.ref.upsert",
      "mirror.mailboxes",
      "message.ref.upsert",
      "mirror.message",
      "message.ref.tombstone",
      "mirror.deleted",
    ]);
    expect(actions[5]).toEqual({
      type: "mirror.message",
      input: {
        engineAccountId: "acc_1",
        provider: "graph",
        message: {
          id: "graph_msg_1",
          subject: "Partnership update",
          parentFolderId: "folder_inbox",
        },
        providerIdentity: {
          provider: "graph",
          id: "graph_msg_1",
          changeKey: "change_1",
          conversationId: "conv_1",
        },
        mailboxIdentity: { provider: "graph", folderId: "folder_inbox" },
      },
    });
    expect(actions[7]).toEqual({
      type: "mirror.deleted",
      input: {
        engineAccountId: "acc_1",
        provider: "graph",
        providerMessageId: "graph_msg_deleted",
        providerIdentity: {
          provider: "graph",
          id: "graph_msg_deleted",
          conversationId: "conv_deleted",
        },
        mailboxIdentity: { provider: "graph", folderId: "folder_inbox" },
        deletedAt: "2026-06-12T10:00:00.000Z",
        idempotencyKey: "delete:acc_1:graph:graph_msg_deleted",
      },
    });
  });
});
