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
    const queries: string[] = [];
    const store = createPostgresMailNavigationStore({
      async query(text: string) {
        queries.push(text);
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
    expect(queries[0]).toMatch(/FROM messages/i);
    expect(queries[0]).toMatch(/verification|验证码|otp/i);
    expect(queries[0]).toMatch(/invoice|发票|账单|receipt/i);
    expect(queries[0]).toMatch(/needs_reply|待回复|reply/i);
    expect(queries[0]).toMatch(/large_attachments|attachment_count/i);
  });
});
