import { describe, expect, it } from "vitest";

import {
  GmailHistoryResetError,
  createGmailReadOnlyAdapter,
} from "../src/mail-provider/gmail-readonly-adapter";

const metadataHeaders = [
  "Message-ID",
  "In-Reply-To",
  "References",
  "Subject",
  "From",
  "To",
  "Cc",
  "Date",
];

describe("Gmail read-only adapter", () => {
  it("discovers Gmail labels as provider mailboxes", async () => {
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listLabels(input) {
          expect(input).toEqual({ accountId: "acc_1" });
          return {
            labels: [
              { id: "INBOX", name: "Inbox", type: "system" },
              { id: "CATEGORY_UPDATES", name: "Updates", type: "system" },
              { id: "Label_42", name: "Clients", type: "user" },
              { name: "No id" },
            ],
          };
        },
        async listMessages() {
          throw new Error("listMessages should not be called during discovery");
        },
        async getMessage() {
          throw new Error("getMessage should not be called during discovery");
        },
        async listHistory() {
          throw new Error("listHistory should not be called during discovery");
        },
      },
    });

    const result = await adapter.listMailboxes!({ accountId: "acc_1" });

    expect(result).toEqual({
      mailboxes: [
        {
          identity: { provider: "gmail", labelId: "INBOX" },
          displayName: "Inbox",
          role: "inbox",
          raw: { id: "INBOX", name: "Inbox", type: "system" },
        },
        {
          identity: { provider: "gmail", labelId: "CATEGORY_UPDATES" },
          displayName: "Updates",
          role: "feed",
          raw: { id: "CATEGORY_UPDATES", name: "Updates", type: "system" },
        },
        {
          identity: { provider: "gmail", labelId: "Label_42" },
          displayName: "Clients",
          role: "label",
          raw: { id: "Label_42", name: "Clients", type: "user" },
        },
      ],
    });
  });

  it("bootstraps recent messages and returns a Gmail history cursor", async () => {
    const calls: unknown[] = [];
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listMessages(input) {
          calls.push({ method: "listMessages", input });
          return {
            messages: [
              { id: "msg_new", threadId: "thr_new" },
              { id: "msg_old", threadId: "thr_old" },
            ],
            nextPageToken: "next-page",
          };
        },
        async getMessage(input) {
          calls.push({ method: "getMessage", input });
          return input.messageId === "msg_new"
            ? { id: "msg_new", threadId: "thr_new", historyId: "900", labelIds: ["INBOX"] }
            : { id: "msg_old", threadId: "thr_old", historyId: "850", labelIds: ["INBOX"] };
        },
        async listHistory() {
          throw new Error("history should not be called without a cursor");
        },
      },
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      limit: 2,
    });

    expect(calls).toEqual([
      {
        method: "listMessages",
        input: { accountId: "acc_1", maxResults: 2 },
      },
      {
        method: "getMessage",
        input: {
          accountId: "acc_1",
          messageId: "msg_new",
          format: "metadata",
          metadataHeaders,
        },
      },
      {
        method: "getMessage",
        input: {
          accountId: "acc_1",
          messageId: "msg_old",
          format: "metadata",
          metadataHeaders,
        },
      },
    ]);
    expect(result).toEqual({
      changes: [
        {
          kind: "message_upserted",
          identity: {
            provider: "gmail",
            messageId: "msg_new",
            threadId: "thr_new",
            historyId: "900",
          },
          raw: { id: "msg_new", threadId: "thr_new", historyId: "900", labelIds: ["INBOX"] },
        },
        {
          kind: "message_upserted",
          identity: {
            provider: "gmail",
            messageId: "msg_old",
            threadId: "thr_old",
            historyId: "850",
          },
          raw: { id: "msg_old", threadId: "thr_old", historyId: "850", labelIds: ["INBOX"] },
        },
      ],
      continuation: {
        provider: "gmail",
        mode: "bootstrap",
        pageToken: "next-page",
        cursorHistoryId: "900",
      },
      hasMore: true,
    });
  });

  it("bootstraps an explicit Gmail label mailbox", async () => {
    const calls: unknown[] = [];
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listMessages(input) {
          calls.push({ method: "listMessages", input });
          return {
            messages: [{ id: "msg_updates", threadId: "thr_updates" }],
          };
        },
        async getMessage(input) {
          calls.push({ method: "getMessage", input });
          return {
            id: "msg_updates",
            threadId: "thr_updates",
            historyId: "910",
            labelIds: ["CATEGORY_UPDATES"],
          };
        },
        async listHistory() {
          throw new Error("history should not be called for label bootstrap");
        },
      },
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      mailbox: {
        provider: "gmail",
        labelId: "CATEGORY_UPDATES",
      },
      limit: 25,
    });

    expect(calls[0]).toEqual({
      method: "listMessages",
      input: {
        accountId: "acc_1",
        maxResults: 25,
        labelIds: ["CATEGORY_UPDATES"],
      },
    });
    expect(calls[1]).toEqual({
      method: "getMessage",
      input: {
        accountId: "acc_1",
        messageId: "msg_updates",
        format: "metadata",
        metadataHeaders,
      },
    });
    expect(result).toEqual({
      changes: [
        {
          kind: "mailbox_changed",
          mailbox: {
            provider: "gmail",
            labelId: "CATEGORY_UPDATES",
          },
          raw: {
            provider: "gmail",
            labelId: "CATEGORY_UPDATES",
          },
        },
        {
          kind: "message_upserted",
          identity: {
            provider: "gmail",
            messageId: "msg_updates",
            threadId: "thr_updates",
            historyId: "910",
          },
          raw: {
            id: "msg_updates",
            threadId: "thr_updates",
            historyId: "910",
            labelIds: ["CATEGORY_UPDATES"],
          },
        },
      ],
      cursor: { provider: "gmail", scope: "account", historyId: "910" },
      hasMore: false,
    });
  });

  it("continues Gmail bootstrap from pageToken and advances cursor only on the final page", async () => {
    const calls: unknown[] = [];
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listMessages(input) {
          calls.push({ method: "listMessages", input });
          return {
            messages: [{ id: "msg_old", threadId: "thr_old" }],
          };
        },
        async getMessage(input) {
          calls.push({ method: "getMessage", input });
          return { id: "msg_old", threadId: "thr_old", historyId: "850" };
        },
        async listHistory() {
          throw new Error("history should not be called for bootstrap continuation");
        },
      },
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      limit: 2,
      continuation: {
        provider: "gmail",
        mode: "bootstrap",
        pageToken: "next-page",
        cursorHistoryId: "900",
      },
    });

    expect(calls[0]).toEqual({
      method: "listMessages",
      input: {
        accountId: "acc_1",
        maxResults: 2,
        pageToken: "next-page",
      },
    });
    expect(calls[1]).toEqual({
      method: "getMessage",
      input: {
        accountId: "acc_1",
        messageId: "msg_old",
        format: "metadata",
        metadataHeaders,
      },
    });
    expect(result).toEqual({
      changes: [
        {
          kind: "message_upserted",
          identity: {
            provider: "gmail",
            messageId: "msg_old",
            threadId: "thr_old",
            historyId: "850",
          },
          raw: { id: "msg_old", threadId: "thr_old", historyId: "850" },
        },
      ],
      cursor: { provider: "gmail", scope: "account", historyId: "900" },
      hasMore: false,
    });
  });

  it("maps Gmail history additions and deletions to provider changes", async () => {
    const calls: unknown[] = [];
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listMessages() {
          throw new Error("listMessages should not be called with a cursor");
        },
        async getMessage(input) {
          calls.push({ method: "getMessage", input });
          return {
            id: "msg_added",
            threadId: "thr_added",
            historyId: "940",
            payload: {
              headers: [
                { name: "Message-ID", value: "<msg-added@example.com>" },
                { name: "References", value: "<root@example.com>" },
              ],
            },
          };
        },
        async listHistory(input) {
          calls.push({ method: "listHistory", input });
          expect(input).toEqual({
            accountId: "acc_1",
            startHistoryId: "900",
            maxResults: 50,
          });
          return {
            historyId: "950",
            history: [
              {
                id: "940",
                messagesAdded: [
                  { message: { id: "msg_added", threadId: "thr_added", historyId: "940" } },
                ],
                messagesDeleted: [
                  { message: { id: "msg_deleted", threadId: "thr_deleted", historyId: "930" } },
                ],
              },
            ],
          };
        },
      },
      now: () => "2026-06-12T10:00:00.000Z",
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      cursor: { provider: "gmail", scope: "account", historyId: "900" },
      limit: 50,
    });

    expect(calls).toEqual([
      {
        method: "listHistory",
        input: {
          accountId: "acc_1",
          startHistoryId: "900",
          maxResults: 50,
        },
      },
      {
        method: "getMessage",
        input: {
          accountId: "acc_1",
          messageId: "msg_added",
          format: "metadata",
          metadataHeaders,
        },
      },
    ]);
    expect(result).toEqual({
      changes: [
        {
          kind: "message_upserted",
          identity: {
            provider: "gmail",
            messageId: "msg_added",
            threadId: "thr_added",
            historyId: "940",
          },
          raw: {
            id: "msg_added",
            threadId: "thr_added",
            historyId: "940",
            payload: {
              headers: [
                { name: "Message-ID", value: "<msg-added@example.com>" },
                { name: "References", value: "<root@example.com>" },
              ],
            },
          },
        },
        {
          kind: "message_deleted",
          identity: {
            provider: "gmail",
            messageId: "msg_deleted",
            threadId: "thr_deleted",
            historyId: "930",
          },
          deletedAt: "2026-06-12T10:00:00.000Z",
          raw: { id: "msg_deleted", threadId: "thr_deleted", historyId: "930" },
        },
      ],
      cursor: { provider: "gmail", scope: "account", historyId: "950" },
      hasMore: false,
    });
  });

  it("continues Gmail history pages without advancing the active cursor until the final page", async () => {
    const calls: unknown[] = [];
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listMessages() {
          throw new Error("listMessages should not be called for history continuation");
        },
        async getMessage(input) {
          calls.push({ method: "getMessage", input });
          return {
            id: "msg_added",
            threadId: "thr_added",
            historyId: "960",
          };
        },
        async listHistory(input) {
          calls.push({ method: "listHistory", input });
          expect(input).toEqual({
            accountId: "acc_1",
            startHistoryId: "900",
            maxResults: 50,
            pageToken: "page-2",
          });
          return {
            historyId: "975",
            nextPageToken: "page-3",
            history: [
              {
                id: "960",
                messagesAdded: [
                  { message: { id: "msg_added", threadId: "thr_added", historyId: "960" } },
                ],
              },
            ],
          };
        },
      },
    });

    const result = await adapter.sync({
      accountId: "acc_1",
      limit: 50,
      continuation: {
        provider: "gmail",
        mode: "history",
        startHistoryId: "900",
        pageToken: "page-2",
      },
    });

    expect(calls).toEqual([
      {
        method: "listHistory",
        input: {
          accountId: "acc_1",
          startHistoryId: "900",
          maxResults: 50,
          pageToken: "page-2",
        },
      },
      {
        method: "getMessage",
        input: {
          accountId: "acc_1",
          messageId: "msg_added",
          format: "metadata",
          metadataHeaders,
        },
      },
    ]);
    expect(result).toEqual({
      changes: [
        {
          kind: "message_upserted",
          identity: {
            provider: "gmail",
            messageId: "msg_added",
            threadId: "thr_added",
            historyId: "960",
          },
          raw: { id: "msg_added", threadId: "thr_added", historyId: "960" },
        },
      ],
      continuation: {
        provider: "gmail",
        mode: "history",
        startHistoryId: "900",
        pageToken: "page-3",
      },
      hasMore: true,
    });
  });

  it("turns expired Gmail history into a reset error", async () => {
    const adapter = createGmailReadOnlyAdapter({
      gmail: {
        async listMessages() {
          throw new Error("listMessages should not be called");
        },
        async getMessage() {
          throw new Error("getMessage should not be called");
        },
        async listHistory() {
          const error = new Error("not found") as Error & { status?: number };
          error.status = 404;
          throw error;
        },
      },
    });

    await expect(
      adapter.sync({
        accountId: "acc_1",
        cursor: { provider: "gmail", scope: "account", historyId: "too-old" },
      }),
    ).rejects.toBeInstanceOf(GmailHistoryResetError);
  });
});
