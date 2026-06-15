import { describe, expect, it } from "vitest";

import { createPostgresSecretStore } from "../src/secrets/postgres-secret-store";

describe("postgres secret store", () => {
  it("reads a db secret ref from stored_secrets", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresSecretStore({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [{ secret_value: "refresh-token-secret" }] };
      },
    });

    await expect(store.getSecret("db:secret_1")).resolves.toBe(
      "refresh-token-secret",
    );
    expect(queries[0].text).toMatch(/FROM stored_secrets/i);
    expect(queries[0].values).toEqual(["db:secret_1"]);
  });

  it("rejects missing db secret refs without leaking other values", async () => {
    const store = createPostgresSecretStore({
      async query() {
        return { rows: [] };
      },
    });

    await expect(store.getSecret("db:missing")).rejects.toThrow(
      "secret ref not found: db:missing",
    );
  });
});
