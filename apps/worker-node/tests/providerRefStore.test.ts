import { describe, expect, it } from "vitest";

import { createPostgresProviderRefStore } from "../src/provider-ref-store";

describe("provider ref store", () => {
  it("upserts Gmail mailbox refs by account and label id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "mailbox_ref_1",
              provider: "gmail",
              provider_mailbox_id: "CATEGORY_UPDATES",
              display_name: "Updates",
              role: "feed",
              gmail_label_id: "CATEGORY_UPDATES",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    const ref = await store.upsertMailboxRef({
      accountId: "account_1",
      identity: {
        provider: "gmail",
        labelId: "CATEGORY_UPDATES",
      },
      displayName: "Updates",
      role: "feed",
      rawRef: { id: "CATEGORY_UPDATES", name: "Updates" },
    });

    expect(queries[0].text).toMatch(/INSERT INTO provider_mailbox_refs/i);
    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider, provider_mailbox_id\) DO UPDATE/i,
    );
    expect(queries[0].values).toContain("CATEGORY_UPDATES");
    expect(queries[0].values).toContain("Updates");
    expect(ref).toEqual({
      id: "mailbox_ref_1",
      provider: "gmail",
      providerMailboxId: "CATEGORY_UPDATES",
      displayName: "Updates",
      role: "feed",
      gmailLabelId: "CATEGORY_UPDATES",
    });
  });

  it("upserts Graph mailbox refs by account and folder id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "mailbox_ref_2",
              provider: "graph",
              provider_mailbox_id: "folder_inbox",
              display_name: "Inbox",
              role: "inbox",
              graph_folder_id: "folder_inbox",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    const ref = await store.upsertMailboxRef({
      accountId: "account_1",
      identity: {
        provider: "graph",
        folderId: "folder_inbox",
      },
      displayName: "Inbox",
      role: "inbox",
      rawRef: { id: "folder_inbox", displayName: "Inbox" },
    });

    expect(queries[0].text).toMatch(/graph_folder_id/i);
    expect(queries[0].values).toContain("folder_inbox");
    expect(ref).toMatchObject({
      id: "mailbox_ref_2",
      provider: "graph",
      providerMailboxId: "folder_inbox",
      graphFolderId: "folder_inbox",
    });
  });

  it("upserts Gmail refs by account and Gmail message id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "ref_1",
              provider: "gmail",
              gmail_message_id: "gm_msg_1",
              gmail_thread_id: "gm_thread_1",
              gmail_history_id: "90071992547409931234",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    const ref = await store.upsertMessageRef({
      accountId: "account_1",
      messageId: "message_1",
      identity: {
        provider: "gmail",
        messageId: "gm_msg_1",
        threadId: "gm_thread_1",
        historyId: "90071992547409931234",
      },
      rawRef: { provider: "gmail" },
    });

    expect(queries[0].text).toMatch(/INSERT INTO provider_message_refs/i);
    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider, gmail_message_id\) DO UPDATE/i,
    );
    expect(ref).toMatchObject({
      id: "ref_1",
      provider: "gmail",
      gmailMessageId: "gm_msg_1",
      gmailThreadId: "gm_thread_1",
      gmailHistoryId: "90071992547409931234",
    });
  });

  it("upserts EmailEngine refs with API id and stable message ids", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "ref_ee_1",
              provider: "emailengine",
              provider_message_id: "ee_msg_1",
              emailengine_email_id: "stable_email_1",
              internet_message_id: "<message-1@example.com>",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    const ref = await store.upsertMessageRef({
      accountId: "account_1",
      messageId: "message_1",
      identity: {
        provider: "emailengine",
        messageId: "ee_msg_1",
        emailId: "stable_email_1",
        internetMessageId: "<message-1@example.com>",
      },
      rawRef: {
        id: "ee_msg_1",
        emailId: "stable_email_1",
        messageId: "<message-1@example.com>",
      },
    });

    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider, emailengine_email_id\)[\s\S]*DO UPDATE/i,
    );
    expect(queries[0].text).toMatch(/emailengine_email_id/i);
    expect(queries[0].text).toMatch(/internet_message_id/i);
    expect(queries[0].values).toContain("stable_email_1");
    expect(queries[0].values).toContain("<message-1@example.com>");
    expect(ref).toMatchObject({
      id: "ref_ee_1",
      provider: "emailengine",
      providerMessageId: "ee_msg_1",
      emailengineEmailId: "stable_email_1",
      internetMessageId: "<message-1@example.com>",
    });
  });

  it("keeps old EmailEngine API ids as aliases when stable email id is reused", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "ref_ee_1",
              provider: "emailengine",
              provider_message_id: "ee_msg_new",
              emailengine_email_id: "stable_email_1",
              internet_message_id: "<message-1@example.com>",
              provider_message_id_aliases: ["ee_msg_old", "ee_msg_new"],
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    await store.upsertMessageRef({
      accountId: "account_1",
      messageId: "message_1",
      identity: {
        provider: "emailengine",
        messageId: "ee_msg_new",
        emailId: "stable_email_1",
        internetMessageId: "<message-1@example.com>",
      },
      rawRef: {
        id: "ee_msg_new",
        emailId: "stable_email_1",
        messageId: "<message-1@example.com>",
      },
    });

    expect(queries[0].text).toMatch(/provider_message_id_aliases/i);
    expect(queries[0].text).toMatch(/jsonb_array_elements_text/i);
    expect(queries[0].text).toMatch(/provider_message_refs\.provider_message_id/i);
    expect(queries[0].text).toMatch(/EXCLUDED\.provider_message_id/i);
    expect(queries[0].values).toContain("ee_msg_new");
  });

  it("falls back to provider message id conflict for EmailEngine refs without emailId", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "ref_ee_legacy",
              provider: "emailengine",
              provider_message_id: "ee_msg_legacy",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    await store.upsertMessageRef({
      accountId: "account_1",
      messageId: "message_1",
      identity: {
        provider: "emailengine",
        messageId: "ee_msg_legacy",
      },
      rawRef: { id: "ee_msg_legacy" },
    });

    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider, provider_message_id\) DO UPDATE/i,
    );
  });

  it("upserts Graph refs by account and Graph message id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "ref_2",
              provider: "graph",
              graph_message_id: "graph_msg_1",
              graph_change_key: "change_2",
              graph_conversation_id: "conv_1",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    await store.upsertMessageRef({
      accountId: "account_1",
      identity: {
        provider: "graph",
        id: "graph_msg_1",
        changeKey: "change_2",
        conversationId: "conv_1",
      },
    });

    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider, graph_message_id\) DO UPDATE/i,
    );
    expect(queries[0].values).toContain("graph_msg_1");
    expect(queries[0].values).toContain("change_2");
  });

  it("upserts IMAP refs by mailbox uidvalidity and uid", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "ref_3",
              provider: "imap",
              imap_mailbox_id: "INBOX",
              imap_uidvalidity: "777",
              imap_uid: "42",
              imap_modseq: "888",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    await store.upsertMessageRef({
      accountId: "account_1",
      identity: {
        provider: "imap",
        mailbox: { provider: "imap", path: "INBOX" },
        uidvalidity: "777",
        uid: "42",
        modseq: "888",
      },
    });

    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider, imap_mailbox_id, imap_uidvalidity, imap_uid\) DO UPDATE/i,
    );
    expect(queries[0].values).toContain("INBOX");
    expect(queries[0].values).toContain("777");
    expect(queries[0].values).toContain("42");
  });

  it("records tombstones before the local message exists", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "tombstone_1",
              provider: "imap",
              idempotency_key: "tombstone:account_1:imap:INBOX:777:42",
            },
          ],
        };
      },
    };

    const store = createPostgresProviderRefStore(client);
    const tombstone = await store.recordTombstone({
      accountId: "account_1",
      identity: {
        provider: "imap",
        mailbox: { provider: "imap", path: "INBOX" },
        uidvalidity: "777",
        uid: "42",
      },
      deletedAt: "2026-06-12T09:00:00.000Z",
      rawEvent: { expunged: true },
    });

    expect(queries[0].text).toMatch(/INSERT INTO provider_message_tombstones/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(idempotency_key\) DO UPDATE/i);
    expect(tombstone).toEqual({
      id: "tombstone_1",
      provider: "imap",
      idempotencyKey: "tombstone:account_1:imap:INBOX:777:42",
    });
  });
});
