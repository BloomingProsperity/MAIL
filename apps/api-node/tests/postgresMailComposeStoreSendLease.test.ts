import { describe, expect, it } from "vitest";

import { createPostgresMailComposeStore } from "../src/mail-compose/postgres-mail-compose-store";

describe("Postgres mail compose send lease completion", () => {
  it("ignores stale draft completion attempts from old lease owners", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    const sent = await store.markDraftSent({
      accountId: "acc_1",
      draftId: "draft_1",
      leaseOwner: "api-send-draft",
      providerQueueId: "queue_1",
      providerMessageId: "<message@example.com>",
      sentAt: "2026-06-13T08:01:00.000Z",
    });
    const failed = await store.markDraftFailed({
      accountId: "acc_1",
      draftId: "draft_1",
      leaseOwner: "api-send-draft",
      errorMessage: "SMTP transient failure",
    });

    expect(sent).toBeUndefined();
    expect(failed).toBeUndefined();
    expect(queries[0].text).toMatch(/AND status = 'sending'/i);
    expect(queries[0].text).toMatch(/AND send_lease_owner = \$6/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "draft_1",
      "queue_1",
      "<message@example.com>",
      "2026-06-13T08:01:00.000Z",
      "api-send-draft",
    ]);
    expect(queries[1].text).toMatch(/AND status = 'sending'/i);
    expect(queries[1].text).toMatch(/AND send_lease_owner = \$4/i);
    expect(queries[1].values).toEqual([
      "acc_1",
      "draft_1",
      "SMTP transient failure",
      "api-send-draft",
    ]);
  });

  it("ignores stale scheduled send completion attempts from old lease owners", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailComposeStore({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    });

    const sent = await store.markScheduledSendSent({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      draftId: "draft_1",
      leaseOwner: "api-send-now",
      providerQueueId: "queue_1",
      providerMessageId: "<message@example.com>",
      sentAt: "2026-06-13T08:01:00.000Z",
    });
    const failed = await store.markScheduledSendFailed({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      draftId: "draft_1",
      leaseOwner: "api-send-now",
      errorMessage: "SMTP transient failure",
      now: "2026-06-13T08:03:00.000Z",
    });

    expect(sent).toBeUndefined();
    expect(failed).toBeUndefined();
    expect(queries[0].text).toMatch(/AND status = 'sending'/i);
    expect(queries[0].text).toMatch(/AND lease_owner = \$7/i);
    expect(queries[0].values).toEqual([
      "acc_1",
      "schedule_1",
      "draft_1",
      "queue_1",
      "<message@example.com>",
      "2026-06-13T08:01:00.000Z",
      "api-send-now",
    ]);
    expect(queries[1].text).toMatch(/AND status = 'sending'/i);
    expect(queries[1].text).toMatch(/AND lease_owner = \$6/i);
    expect(queries[1].values).toEqual([
      "acc_1",
      "schedule_1",
      "draft_1",
      "SMTP transient failure",
      "2026-06-13T08:03:00.000Z",
      "api-send-now",
    ]);
  });
});
