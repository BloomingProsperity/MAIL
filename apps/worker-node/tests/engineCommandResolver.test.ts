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

  it("resolves Gmail label targets through account-scoped provider label refs", async () => {
    const labelId = "11111111-1111-4111-8111-111111111111";
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: labelId,
              target: "Label_123",
            },
          ],
        };
      },
    };

    const resolver = createPostgresEngineCommandTargetResolver(client);
    const targets = await resolver.resolveLabelTargets?.({
      accountId: "account_1",
      provider: "gmail",
      labelIds: [labelId],
    });

    expect(queries[0].text).toMatch(/FROM labels/i);
    expect(queries[0].text).toMatch(/LEFT JOIN provider_mailbox_refs/i);
    expect(queries[0].text).toMatch(/provider_mailbox_refs\.account_id = labels\.account_id/i);
    expect(queries[0].text).toMatch(/provider_mailbox_refs\.provider = 'gmail'/i);
    expect(queries[0].text).toMatch(/provider_mailbox_refs\.role = 'label'/i);
    expect(queries[0].text).toMatch(/lower\(provider_mailbox_refs\.display_name\) = lower\(labels\.name\)/i);
    expect(queries[0].text).toMatch(/COUNT\(DISTINCT COALESCE/i);
    expect(queries[0].text).toMatch(/GROUP BY labels\.id/i);
    expect(queries[0].text).toMatch(/labels\.account_id = \$1/i);
    expect(queries[0].values).toEqual(["account_1", [labelId]]);
    expect(targets).toEqual(["Label_123"]);
  });

  it("resolves non-Gmail label targets from account-scoped local label names", async () => {
    const firstLabelId = "11111111-1111-4111-8111-111111111111";
    const secondLabelId = "22222222-2222-4222-8222-222222222222";
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            { id: secondLabelId, target: "客户" },
            { id: firstLabelId, target: "验证码" },
          ],
        };
      },
    };

    const resolver = createPostgresEngineCommandTargetResolver(client);
    const targets = await resolver.resolveLabelTargets?.({
      accountId: "account_1",
      provider: "graph",
      labelIds: [firstLabelId, secondLabelId],
    });

    expect(queries[0].text).toMatch(/SELECT id, name AS target/i);
    expect(queries[0].text).toMatch(/WHERE account_id = \$1/i);
    expect(queries[0].values).toEqual([
      "account_1",
      [firstLabelId, secondLabelId],
    ]);
    expect(targets).toEqual(["验证码", "客户"]);
  });
});
