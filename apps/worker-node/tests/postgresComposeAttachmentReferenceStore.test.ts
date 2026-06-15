import { describe, expect, it } from "vitest";

import { createPostgresComposeAttachmentReferenceStore } from "../src/postgres-compose-attachment-reference-store";

describe("Postgres compose attachment reference store", () => {
  it("lists active uploaded attachment storage keys from draft manifests", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const store = createPostgresComposeAttachmentReferenceStore({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            { storage_key: "11111111-1111-4111-8111-111111111111" },
            { storage_key: " 22222222-2222-4222-8222-222222222222 " },
            { storage_key: "" },
            { storage_key: null },
          ],
        };
      },
    });

    await expect(store.listActiveStorageKeys()).resolves.toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(queries[0].text).toMatch(/jsonb_array_elements/i);
    expect(queries[0].text).toMatch(
      /status IN \('draft', 'scheduled', 'queued', 'sending', 'failed'\)/i,
    );
    expect(queries[0].text).toMatch(/attachment->>'storageKey'/i);
  });
});
