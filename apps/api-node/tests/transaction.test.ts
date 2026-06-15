import { describe, expect, it } from "vitest";

import { withTransaction } from "../src/db/transaction";

describe("withTransaction", () => {
  it("uses one checked-out pool client for every statement in a transaction", async () => {
    const poolQueries: string[] = [];
    const clientQueries: string[] = [];
    let released = false;
    const pool = {
      async query(text: string) {
        poolQueries.push(text);
        return { rows: [] };
      },
      async connect() {
        return {
          async query(text: string) {
            clientQueries.push(text);
            return { rows: [] };
          },
          release() {
            released = true;
          },
        };
      },
    };

    await withTransaction(pool, async (tx) => {
      await tx.query("SELECT 1");
    });

    expect(poolQueries).toEqual([]);
    expect(clientQueries).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(released).toBe(true);
  });

  it("rolls back on failure before releasing a checked-out pool client", async () => {
    const clientQueries: string[] = [];
    let released = false;
    const pool = {
      async query() {
        throw new Error("pool.query should not run inside transactions");
      },
      async connect() {
        return {
          async query(text: string) {
            clientQueries.push(text);
            return { rows: [] };
          },
          release() {
            released = true;
          },
        };
      },
    };

    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query("SELECT 1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(clientQueries).toEqual(["BEGIN", "SELECT 1", "ROLLBACK"]);
    expect(released).toBe(true);
  });
});
