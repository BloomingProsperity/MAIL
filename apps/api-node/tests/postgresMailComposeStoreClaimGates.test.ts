import { describe, expect, it } from "vitest";

import { createPostgresMailComposeStore } from "../src/mail-compose/postgres-mail-compose-store";

describe("Postgres mail compose claim gates", () => {
  it("claims draft sends only for actively syncing accounts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    const result = await store.claimDraftForSend({
      accountId: "acc_1",
      draftId: "draft_1",
      leaseOwner: "api-send-draft",
      leaseExpiresAt: "2026-06-13T08:03:00.000Z",
      now: "2026-06-13T08:02:00.000Z",
    });

    expect(result).toBeUndefined();
    expect(queries[0].text).toMatch(/UPDATE email_drafts/i);
    expect(queries[0].text).toMatch(/connected_accounts\.sync_state = 'syncing'/i);
  });

  it("claims scheduled sends only for actively syncing accounts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    const result = await store.claimScheduledSendForSubmit({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      leaseOwner: "api-send-now",
      leaseExpiresAt: "2026-06-13T08:02:30.000Z",
      now: "2026-06-13T08:01:00.000Z",
    });

    expect(result).toBeUndefined();
    expect(queries[0].text).toMatch(/UPDATE scheduled_sends/i);
    expect(queries[0].text).toMatch(/connected_accounts\.sync_state = 'syncing'/i);
  });
});
