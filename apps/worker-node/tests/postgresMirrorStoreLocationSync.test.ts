import { describe, expect, it } from "vitest";

import { createPostgresMirrorStore } from "../src/mail-engine/postgres-mirror-store";

describe("postgres mirror store location sync", () => {
  it("replaces stale Graph native mailbox locations when a message moves", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM provider_message_refs")) {
          return { rows: [{ id: "message_graph_1" }] };
        }
        if (text.includes("UPDATE messages")) {
          return { rows: [{ id: "message_graph_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_graph_1",
                provider: "graph",
                provider_message_id: "graph_msg_1",
                graph_message_id: "graph_msg_1",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.upsertMessage({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "graph",
      providerIdentity: {
        provider: "graph",
        id: "graph_msg_1",
        conversationId: "conv_1",
      },
      mailboxIdentity: { provider: "graph", folderId: "folder_archive" },
      message: {
        id: "graph_msg_1",
        conversationId: "conv_1",
        parentFolderId: "folder_archive",
        subject: "Moved Graph message",
        from: {
          emailAddress: {
            address: "sender@example.com",
          },
        },
        receivedDateTime: "2026-06-12T09:00:00.000Z",
      },
    });

    const replaceLocationQuery = queries.find((query) =>
      query.text.includes("DELETE FROM message_locations"),
    );
    expect(replaceLocationQuery?.text).toMatch(/provider_mailbox_id = ANY/i);
    expect(replaceLocationQuery?.values).toEqual([
      "message_graph_1",
      "00000000-0000-0000-0000-000000000001",
      ["folder_archive"],
    ]);

    const insertLocationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_locations"),
    );
    expect(insertLocationQuery?.values).toEqual([
      "message_graph_1",
      "00000000-0000-0000-0000-000000000001",
      "folder_archive",
    ]);
  });
});
