import { describe, expect, it } from "vitest";

import { createPostgresEngineCommandTargetResolver } from "../src/engine-command-resolver";

describe("postgres engine command target resolver", () => {
  it("loads IMAP message refs with mailbox path and UIDVALIDITY for native commands", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              provider_message_id: "42",
              imap_mailbox_id: "INBOX",
              imap_uidvalidity: "987",
              imap_modseq: "1234",
            },
          ],
        };
      },
    };

    const resolver = createPostgresEngineCommandTargetResolver(client);
    const target = await resolver.resolveMessageTarget?.({
      accountId: "account_1",
      messageId: "message_1",
      provider: "imap",
    });

    expect(queries[0].text).toMatch(/imap_mailbox_id/i);
    expect(queries[0].text).toMatch(/imap_uidvalidity/i);
    expect(queries[0].values).toEqual(["account_1", "message_1", "imap"]);
    expect(target).toEqual({
      providerMessageId: "42",
      providerMailboxId: "INBOX",
      providerUidvalidity: "987",
      providerModseq: "1234",
    });
  });
});
