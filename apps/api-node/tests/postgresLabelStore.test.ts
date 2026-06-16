import { describe, expect, it } from "vitest";

import { createPostgresLabelStore } from "../src/labels/postgres-label-store";

describe("postgres label store", () => {
  it("lists account-scoped labels with visible message counts", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresLabelStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "label_codes",
              account_id: "account_1",
              name: "验证码",
              color: "blue",
              message_count: "4",
              created_at: "2026-06-13T10:00:00.000Z",
            },
          ],
        };
      },
    });

    await expect(store.listLabels({ accountId: "account_1" })).resolves.toEqual({
      items: [
        {
          id: "label_codes",
          accountId: "account_1",
          name: "验证码",
          color: "blue",
          messageCount: 4,
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    });
    expect(queries[0].text).toMatch(/FROM labels/i);
    expect(queries[0].text).toMatch(/LEFT JOIN label_assignments/i);
    expect(queries[0].text).toMatch(/WHERE labels\.account_id = \$1/i);
    expect(queries[0].values).toEqual(["account_1"]);
  });

  it("upserts labels by account and case-insensitive name", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresLabelStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              id: "label_codes",
              account_id: "account_1",
              name: "验证码",
              color: "blue",
              message_count: 0,
              created_at: "2026-06-13T10:00:00.000Z",
            },
          ],
        };
      },
    });

    await store.upsertLabel({
      id: "label_codes",
      accountId: "account_1",
      name: "验证码",
      color: "blue",
    });

    expect(queries[0].text).toMatch(/INSERT INTO labels/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(account_id, lower\(name\)\)/i);
    expect(queries[0].values).toEqual([
      "label_codes",
      "account_1",
      "验证码",
      "blue",
    ]);
  });
});
