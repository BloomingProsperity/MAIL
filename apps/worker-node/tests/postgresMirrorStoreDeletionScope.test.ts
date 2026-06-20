import { describe, expect, it } from "vitest";

import { createPostgresMirrorStore } from "../src/mail-engine/postgres-mirror-store";

describe("postgres mirror store deletion account scoping", () => {
  it("checks same-account locations before marking a mailbox deletion canonical", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMirrorStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      providerMessageId: "ee_msg_old",
      mailboxPath: "INBOX",
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:ee_msg_old",
    });

    expect(queries[2].text).toMatch(/UPDATE message_state/i);
    expect(queries[2].text).toMatch(/NOT EXISTS/i);
    expect(queries[2].text).toMatch(/JOIN mailboxes/i);
    expect(queries[2].text).toMatch(/mailboxes\.account_id = \$1/i);
  });
});
