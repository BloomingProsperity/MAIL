import { describe, expect, it } from "vitest";

import {
  providerCursorKey,
  providerMessageKey,
  type ProviderCursor,
  type ProviderMessageIdentity,
} from "../src/mail-provider/contract";

describe("mail provider contract", () => {
  it("models Gmail, Graph, and IMAP message identities without flattening provider refs", () => {
    const gmail: ProviderMessageIdentity = {
      provider: "gmail",
      messageId: "gm_msg_1",
      threadId: "gm_thread_1",
      historyId: "90071992547409931234",
    };
    const graph: ProviderMessageIdentity = {
      provider: "graph",
      id: "graph_msg_1",
      changeKey: "change_1",
      conversationId: "conv_1",
    };
    const imap: ProviderMessageIdentity = {
      provider: "imap",
      mailbox: {
        provider: "imap",
        path: "INBOX",
        delimiter: "/",
      },
      uidvalidity: "18446744073709551615",
      uid: "42",
      modseq: "18446744073709551614",
    };

    expect(providerMessageKey(gmail)).toBe("gmail:gm_msg_1");
    expect(providerMessageKey(graph)).toBe("graph:graph_msg_1");
    expect(providerMessageKey(imap)).toBe(
      "imap:INBOX:18446744073709551615:42",
    );
  });

  it("keeps provider cursors separate from message identities", () => {
    const gmailCursor: ProviderCursor = {
      provider: "gmail",
      scope: "account",
      historyId: "90071992547409931234",
    };
    const graphCursor: ProviderCursor = {
      provider: "graph",
      scope: "mailbox",
      mailbox: { provider: "graph", folderId: "inbox" },
      deltaLink: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque",
    };
    const imapCursor: ProviderCursor = {
      provider: "imap",
      scope: "mailbox",
      mailbox: { provider: "imap", path: "INBOX" },
      uidvalidity: "777",
      highestUid: "999",
      uidNext: "1000",
      highestModseq: "88888888888888888888",
    };

    expect(providerCursorKey(gmailCursor)).toBe(
      "gmail:account:90071992547409931234",
    );
    expect(providerCursorKey(graphCursor)).toBe("graph:mailbox:inbox");
    expect(providerCursorKey(imapCursor)).toBe("imap:INBOX:777");
  });
});
