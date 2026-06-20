import { describe, expect, it } from "vitest";

import { createPostgresMailNavigationStore } from "../src/mail-navigation/postgres-navigation-store";

describe("Postgres mail navigation store", () => {
  it("maps provider count rows from Postgres", async () => {
    const queries: string[] = [];
    const store = createPostgresMailNavigationStore({
      async query(text: string) {
        queries.push(text);
        return {
          rows: [
            { provider: "gmail", count: "2" },
            { provider: "icloud", count: 1 },
          ],
        };
      },
    });

    await expect(store.listProviderCounts()).resolves.toEqual([
      { provider: "gmail", count: 2 },
      { provider: "icloud", count: 1 },
    ]);
    expect(queries[0]).toMatch(/FROM connected_accounts/i);
    expect(queries[0]).toMatch(/GROUP BY provider/i);
  });

  it("counts saved views from searchable text and lightweight message facts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresMailNavigationStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            { id: "codes", count: "2" },
            { id: "receipts", count: "1" },
          ],
        };
      },
    });

    await expect(store.listQuickCategoryCounts()).resolves.toEqual([
      { id: "codes", count: 2 },
      { id: "receipts", count: 1 },
    ]);
    expect(queries[0].text).toMatch(/FROM messages/i);
    expect(queries[0].text).toMatch(/verification|验证码|otp/i);
    expect(queries[0].text).toMatch(/invoice|发票|账单|receipt/i);
    expect(queries[0].text).toMatch(/saved_views/i);
    expect(queries[0].text).toMatch(/needs_reply|待回复|reply/i);
    expect(queries[0].text).toMatch(/large_attachments|attachment_count/i);
    expect(queries[0].values).toEqual([
      [
        "codes",
        "receipts",
        "meetings",
        "travel",
        "shipping",
        "notifications",
        "newsletters",
        "needs_reply",
        "large_attachments",
      ],
    ]);
  });

  it("counts aggregate folder summaries from visible messages", async () => {
    const queries: string[] = [];
    const store = createPostgresMailNavigationStore({
      async query(text: string) {
        queries.push(text);
        return {
          rows: [
            { id: "inbox", count: "36" },
            { id: "all", count: "36" },
            { id: "attachments", count: "5" },
            { id: "flagged", count: "1" },
          ],
        };
      },
    });

    await expect(store.listFolderCounts()).resolves.toEqual([
      { id: "inbox", count: 36 },
      { id: "all", count: 36 },
      { id: "attachments", count: 5 },
      { id: "flagged", count: 1 },
    ]);
    expect(queries[0]).toMatch(/WITH visible_messages AS/i);
    expect(queries[0]).toMatch(/JOIN message_locations/i);
    expect(queries[0]).toMatch(/mailboxes\.role/i);
    expect(queries[0]).toMatch(/mailboxes\.account_id = messages\.account_id/i);
    expect(queries[0]).toMatch(/'all' AS id/i);
    expect(queries[0]).toMatch(/'attachments' AS id/i);
  });

  it("lists dynamic saved views for navigation", async () => {
    const store = createPostgresMailNavigationStore({
      async query() {
        return {
          rows: [{ id: "hermes_contract", label: "合同", tone: "blue" }],
        };
      },
    });

    await expect(store.listQuickCategories?.()).resolves.toEqual([
      { id: "hermes_contract", label: "合同", tone: "blue" },
    ]);
  });
});
