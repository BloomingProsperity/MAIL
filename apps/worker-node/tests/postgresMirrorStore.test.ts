import { describe, expect, it } from "vitest";

import { createPostgresMirrorStore } from "../src/mail-engine/postgres-mirror-store";

describe("postgres mirror store", () => {
  it("upserts mailboxes and provider_mailbox_refs idempotently", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.upsertMailboxes({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      mailboxes: [{ path: "INBOX", name: "Inbox", specialUse: "\\Inbox" }],
    });

    expect(queries[0].text).toMatch(/INSERT INTO mailboxes/i);
    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider_mailbox_id\) DO UPDATE/i,
    );
    expect(queries[1].text).toMatch(/INSERT INTO provider_mailbox_refs/i);
    expect(queries[1].text).toMatch(
      /ON CONFLICT \(account_id, provider, provider_mailbox_id\) DO UPDATE/i,
    );
  });

  it("upserts messages via account and provider_message_id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Hello",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "a@example.com", name: "A" },
        to: [{ address: "b@example.com" }],
        text: { plain: "Body" },
      },
    });

    expect(queries[0].text).toMatch(/INSERT INTO messages/i);
    expect(queries[0].text).toMatch(
      /ON CONFLICT \(account_id, provider_message_id\) DO UPDATE/i,
    );
    expect(queries[1].text).toMatch(/INSERT INTO message_state/i);
    const providerRefQuery = queries.find((query) =>
      query.text.includes("INSERT INTO provider_message_refs"),
    );
    expect(providerRefQuery?.text).toMatch(/INSERT INTO provider_message_refs/i);
    expect(providerRefQuery?.values).toContain("ee_msg_1");
  });

  it("persists EmailEngine RFC reply header chains on mirrored messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        messageId: "<source@example.com>",
        subject: "Re: Hello",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "a@example.com", name: "A" },
        to: [{ address: "b@example.com" }],
        headers: [
          { name: "In-Reply-To", value: "<parent@example.com>" },
          {
            name: "References",
            value:
              "<root@example.com>\r\n <parent@example.com> <parent@example.com>",
          },
        ],
      },
    });

    const insertMessageQuery = queries.find((query) =>
      query.text.includes("INSERT INTO messages"),
    );
    expect(insertMessageQuery?.text).toMatch(/rfc_in_reply_to_message_id/i);
    expect(insertMessageQuery?.text).toMatch(/rfc_references_message_ids/i);
    expect(insertMessageQuery?.values?.[3]).toBe("<source@example.com>");
    expect(insertMessageQuery?.values?.[4]).toBe("<parent@example.com>");
    expect(insertMessageQuery?.values?.[5]).toEqual([
      "<root@example.com>",
      "<parent@example.com>",
    ]);
  });

  it("writes Smart Inbox classification after mirroring a message", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "请今天 17:00 前确认合作方案",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "client@example.com", name: "客户成功" },
        to: [{ address: "me@example.com" }],
        text: { plain: "请确认是否继续推进，并在今天 17:00 前回复。" },
      },
    });

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.text).toMatch(/ON CONFLICT \(message_id\)/i);
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P1 Urgent",
      100,
      ["直接发给你", "疑似重要联系人", "识别为需要回复", "包含紧急时间信号"],
      "rules",
    ]);
  });

  it("applies Smart Inbox sender rules when classifying mirrored messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("FROM smart_inbox_sender_rules")) {
          return { rows: [{ rule_type: "always_important" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Weekly product newsletter and promo",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "NEWS@MARKETING.EXAMPLE.COM" },
        text: { plain: "Sale, discount, unsubscribe, newsletter." },
      },
    });

    const senderRulesQuery = queries.find((query) =>
      query.text.includes("FROM smart_inbox_sender_rules"),
    );
    expect(senderRulesQuery?.text).toMatch(/lower\(sender_email\) = lower\(\$2\)/i);
    expect(senderRulesQuery?.values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "NEWS@MARKETING.EXAMPLE.COM",
    ]);

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values?.[1]).toBe("P2 Important");
    expect(classificationQuery?.values?.[2]).toBe(90);
    expect(classificationQuery?.values?.[3]).toEqual(
      expect.arrayContaining(["发件人总是重要"]),
    );
  });

  it("applies Smart Inbox feed sender rules when classifying mirrored messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("FROM smart_inbox_sender_rules")) {
          return { rows: [{ rule_type: "feed" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Product update",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "UPDATES@EXAMPLE.COM" },
        to: [{ address: "me@example.com" }],
        text: { plain: "Here is this week's product context." },
      },
    });

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P6 Feed",
      15,
      ["Sender rule: Feed"],
      "rules",
    ]);
  });

  it("applies Gatekeeper screening decisions when classifying mirrored messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("FROM sender_screening_rules")) {
          return { rows: [{ status: "unknown", scope: "email" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Intro from a new vendor",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "new.vendor@example.com" },
        to: [{ address: "me@example.com" }],
        text: { plain: "Could we discuss a partnership?" },
      },
    });

    const screeningQuery = queries.find((query) =>
      query.text.includes("FROM sender_screening_rules"),
    );
    expect(screeningQuery?.text).toMatch(/scope = 'email'/i);
    expect(screeningQuery?.text).toMatch(/scope = 'domain'/i);
    expect(screeningQuery?.values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "new.vendor@example.com",
      "example.com",
    ]);

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P7 Screen",
      0,
      ["New sender needs approval"],
      "rules",
    ]);
  });

  it("materializes a first-time sender into Gatekeeper when the account mode screens before inbox", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("FROM gatekeeper_settings")) {
          return { rows: [{ mode: "before_inbox" }] };
        }
        if (text.includes("FROM sender_screening_rules")) {
          return { rows: [{ status: "unknown", scope: "email" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Intro from a new contractor",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "first.timer@vendor.example.com" },
        to: [{ address: "me@example.com" }],
        text: { plain: "Can we introduce our service?" },
      },
    });

    const settingsQuery = queries.find((query) =>
      query.text.includes("FROM gatekeeper_settings"),
    );
    expect(settingsQuery?.values).toEqual([
      "00000000-0000-0000-0000-000000000001",
    ]);

    const materializeQuery = queries.find(
      (query) =>
        query.text.includes("INSERT INTO sender_screening_rules") &&
        query.text.includes("created_from_message_id"),
    );
    expect(materializeQuery?.text).toMatch(/ON CONFLICT/i);
    expect(materializeQuery?.text).toMatch(/NOT EXISTS/i);
    expect(materializeQuery?.values).toEqual([
      expect.any(String),
      "00000000-0000-0000-0000-000000000001",
      "first.timer@vendor.example.com",
      "vendor.example.com",
      "message_1",
    ]);

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P7 Screen",
      0,
      ["New sender needs approval"],
      "rules",
    ]);
  });

  it("applies approved Hermes sender rules when classifying mirrored messages", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("FROM hermes_rules")) {
          return {
            rows: [
              {
                action: {
                  type: "classify_sender",
                  bucket: "P6 Feed",
                  priorityScore: 15,
                  reason: "Hermes learned you move this sender to Feed.",
                },
              },
            ],
          };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Weekly product newsletter and promo",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "NEWS@MARKETING.EXAMPLE.COM" },
        text: { plain: "Sale, discount, unsubscribe, newsletter." },
      },
    });

    const hermesRulesQuery = queries.find((query) =>
      query.text.includes("FROM hermes_rules"),
    );
    expect(hermesRulesQuery?.text).toMatch(/enabled = TRUE/i);
    expect(hermesRulesQuery?.text).toMatch(
      /lower\(condition->>'senderEmail'\) = lower\(\$2\)/i,
    );
    expect(hermesRulesQuery?.text).toMatch(
      /action->>'type' = 'classify_sender'/i,
    );
    expect(hermesRulesQuery?.values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "NEWS@MARKETING.EXAMPLE.COM",
    ]);

    const classificationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_classification"),
    );
    expect(classificationQuery?.values).toEqual([
      "message_1",
      "P6 Feed",
      15,
      expect.arrayContaining([
        "Hermes learned you move this sender to Feed.",
        "Hermes approved rule",
      ]),
      "hermes_rules",
    ]);
  });

  it("mirrors attachment metadata and removes stale attachments for the message", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Invoice",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "billing@example.com" },
        attachments: [
          {
            id: "att_pdf",
            filename: "invoice.pdf",
            contentType: "application/pdf",
            encodedSize: 45000,
            embedded: false,
            inline: false,
          },
          {
            id: "att_logo",
            filename: "logo.png",
            contentType: "image/png",
            encodedSize: 3200,
            embedded: true,
            inline: true,
            contentId: "<logo@example.com>",
            encodedInMessage: true,
          },
        ],
      },
    });

    const deleteAttachmentsQuery = queries.find((query) =>
      query.text.includes("DELETE FROM attachments"),
    );
    expect(deleteAttachmentsQuery?.values).toEqual(["message_1"]);

    const insertAttachmentQueries = queries.filter((query) =>
      query.text.includes("INSERT INTO attachments"),
    );
    expect(insertAttachmentQueries).toHaveLength(2);
    expect(insertAttachmentQueries[0].text).toMatch(
      /ON CONFLICT \(message_id, provider_attachment_id\) DO UPDATE/i,
    );
    expect(insertAttachmentQueries[0].values?.slice(1)).toEqual([
      "message_1",
      "att_pdf",
      "invoice.pdf",
      "application/pdf",
      45000,
      null,
      false,
      false,
      false,
    ]);
    expect(insertAttachmentQueries[1].values?.slice(1)).toEqual([
      "message_1",
      "att_logo",
      "logo.png",
      "image/png",
      3200,
      "<logo@example.com>",
      true,
      true,
      true,
    ]);
  });

  it("updates the local search document with headers, body text, and attachment names", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Q2 partnership confirmation",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "client@example.com", name: "Client Success" },
        to: [{ address: "me@example.com" }],
        cc: [{ address: "finance@example.com" }],
        preview: "Please review the terms.",
        text: { plain: "The signed contract is attached for review." },
        attachments: [
          {
            id: "att_pdf",
            filename: "signed-contract.pdf",
            contentType: "application/pdf",
            encodedSize: 45000,
          },
        ],
      },
    });

    const searchQuery = queries.find((query) =>
      query.text.includes("INSERT INTO search_documents"),
    );
    expect(searchQuery?.text).toMatch(/to_tsvector\('simple', \$2\)/i);
    expect(searchQuery?.text).toMatch(/ON CONFLICT \(message_id\) DO UPDATE/i);
    expect(searchQuery?.values?.[0]).toBe("message_1");
    expect(searchQuery?.values?.[1]).toContain("Q2 partnership confirmation");
    expect(searchQuery?.values?.[1]).toContain("client@example.com");
    expect(searchQuery?.values?.[1]).toContain("Client Success");
    expect(searchQuery?.values?.[1]).toContain("me@example.com");
    expect(searchQuery?.values?.[1]).toContain("finance@example.com");
    expect(searchQuery?.values?.[1]).toContain(
      "The signed contract is attached for review.",
    );
    expect(searchQuery?.values?.[1]).toContain("signed-contract.pdf");
  });

  it("queues idempotent attachment text extraction jobs for searchable document attachments", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        subject: "Q2 partnership confirmation",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "client@example.com" },
        to: [{ address: "me@example.com" }],
        attachments: [
          {
            id: "att_pdf",
            filename: "signed-contract.pdf",
            contentType: "application/pdf",
            encodedSize: 45000,
          },
          {
            id: "att_docx",
            filename: "proposal.docx",
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            encodedSize: 120000,
          },
          {
            id: "att_logo",
            filename: "logo.png",
            contentType: "image/png",
            encodedSize: 3200,
            contentId: "<logo@example.com>",
            inline: true,
          },
          {
            id: "att_huge_pdf",
            filename: "archive.pdf",
            contentType: "application/pdf",
            encodedSize: 30_000_000,
          },
        ],
      },
    });

    const jobQueries = queries.filter((query) =>
      query.text.includes("INSERT INTO attachment_text_extraction_jobs"),
    );
    expect(jobQueries).toHaveLength(2);
    expect(jobQueries[0].text).toMatch(/ON CONFLICT \(idempotency_key\) DO UPDATE/i);
    expect(jobQueries[0].values?.slice(1)).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "message_1",
      "emailengine",
      "att_pdf",
      "signed-contract.pdf",
      "application/pdf",
      45000,
      "attachment-text:00000000-0000-0000-0000-000000000001:message_1:att_pdf",
    ]);
    expect(jobQueries[1].values?.slice(1)).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "message_1",
      "emailengine",
      "att_docx",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      120000,
      "attachment-text:00000000-0000-0000-0000-000000000001:message_1:att_docx",
    ]);
  });

  it("records the mailbox location when a message is seen in a folder", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_1",
                provider: "emailengine",
                provider_message_id: "ee_msg_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_1",
        path: "INBOX",
        subject: "Hello",
        date: "2026-06-12T09:00:00.000Z",
        from: { address: "a@example.com" },
      },
    });

    const locationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_locations"),
    );
    expect(locationQuery?.text).toMatch(/SELECT \$1, id/i);
    expect(locationQuery?.text).toMatch(/provider_mailbox_id = \$3/i);
    expect(locationQuery?.values).toEqual([
      "message_1",
      "00000000-0000-0000-0000-000000000001",
      "INBOX",
    ]);
  });

  it("clears deleted_at when a moved message is seen again", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM provider_message_refs")) {
          return { rows: [{ id: "message_existing" }] };
        }
        if (text.includes("UPDATE messages")) {
          return { rows: [{ id: "message_existing" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_archived",
                provider: "emailengine",
                provider_message_id: "ee_msg_archived",
                emailengine_email_id: "stable_email_1",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_archived",
        emailId: "stable_email_1",
        subject: "Moved",
        date: "2026-06-12T10:00:00.000Z",
        from: { address: "a@example.com" },
      },
    });

    const stateQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_state"),
    );
    expect(stateQuery?.text).toMatch(/deleted_at = NULL/i);
  });

  it("updates an existing local message when EmailEngine changes id after a move", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("FROM provider_message_refs")) {
          return { rows: [{ id: "message_existing" }] };
        }
        if (text.includes("UPDATE messages")) {
          return { rows: [{ id: "message_existing" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_archived",
                provider: "emailengine",
                provider_message_id: "ee_msg_archived",
                emailengine_email_id: "stable_email_1",
                internet_message_id: "<message-1@example.com>",
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
      provider: "emailengine",
      message: {
        id: "ee_msg_archived",
        emailId: "stable_email_1",
        messageId: "<message-1@example.com>",
        threadId: "thread_1",
        subject: "Moved",
        date: "2026-06-12T10:00:00.000Z",
        from: { address: "a@example.com" },
        text: { plain: "Moved body" },
      },
    });

    expect(queries[0].text).toMatch(/FROM provider_message_refs/i);
    expect(queries[0].text).toMatch(/emailengine_email_id/i);
    expect(queries[0].values).toContain("stable_email_1");
    expect(queries.some((query) => query.text.includes("INSERT INTO messages"))).toBe(
      false,
    );
    expect(queries[1].text).toMatch(/UPDATE messages/i);
    expect(queries[1].text).toMatch(/rfc_in_reply_to_message_id = COALESCE/i);
    expect(queries[1].text).toMatch(/rfc_references_message_ids = CASE/i);
    expect(queries[1].text).toMatch(/ELSE rfc_references_message_ids/i);
    expect(queries[1].values).toContain("message_existing");
    expect(queries[1].values?.[3]).toBe("<message-1@example.com>");
    expect(queries[1].values?.[4]).toBeUndefined();
    expect(queries[1].values?.[5]).toEqual([]);
    expect(queries[2].text).toMatch(/INSERT INTO message_state/i);
    const providerRefQuery = queries.find((query) =>
      query.text.includes("INSERT INTO provider_message_refs"),
    );
    expect(providerRefQuery?.text).toMatch(/INSERT INTO provider_message_refs/i);
    expect(providerRefQuery?.values).toContain("ee_msg_archived");
    expect(providerRefQuery?.values).toContain("stable_email_1");
    expect(providerRefQuery?.values).toContain("<message-1@example.com>");
  });

  it("records provider_message_tombstones by idempotency_key", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      providerMessageId: "ee_msg_1",
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:ee_msg_1",
    });

    expect(queries[0].text).toMatch(/INSERT INTO provider_message_tombstones/i);
    expect(queries[0].text).toMatch(/ON CONFLICT \(idempotency_key\) DO UPDATE/i);
    expect(queries[1].text).toMatch(/DELETE FROM message_locations/i);
    expect(queries[2].text).toMatch(/UPDATE message_state/i);
  });

  it("removes all local locations and marks deleted when provider deletion has no mailbox path", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      providerMessageId: "ee_msg_deleted",
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:ee_msg_deleted",
    });

    expect(queries[1].text).toMatch(/DELETE FROM message_locations/i);
    expect(queries[1].text).toMatch(/provider_message_id = \$3/i);
    expect(queries[1].text).not.toMatch(/provider_mailbox_id/i);
    expect(queries[1].values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "emailengine",
      "ee_msg_deleted",
    ]);
    expect(queries[2].text).toMatch(/UPDATE message_state/i);
    expect(queries[2].text).toMatch(/provider_message_id = \$4/i);
    expect(queries[2].text).not.toMatch(/NOT EXISTS/i);
  });

  it("removes only the deleted mailbox location before considering canonical deletion", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      providerMessageId: "ee_msg_old",
      mailboxPath: "INBOX",
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:ee_msg_old",
    });

    expect(queries[1].text).toMatch(/DELETE FROM message_locations/i);
    expect(queries[1].text).toMatch(/provider_mailbox_id = \$4/i);
    expect(queries[1].values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "emailengine",
      "ee_msg_old",
      "INBOX",
    ]);
    expect(queries[2].text).toMatch(/UPDATE message_state/i);
    expect(queries[2].text).toMatch(/NOT EXISTS/i);
  });

  it("removes deleted mailbox locations through historical provider message id aliases", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      providerMessageId: "ee_msg_old",
      mailboxPath: "INBOX",
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:ee_msg_old",
    });

    expect(queries[1].text).toMatch(/DELETE FROM message_locations/i);
    expect(queries[1].text).toMatch(/provider_message_id = \$3/i);
    expect(queries[1].text).toMatch(/provider_message_id_aliases \? \$3/i);
    expect(queries[2].text).toMatch(/UPDATE message_state/i);
    expect(queries[2].text).toMatch(/provider_message_id = \$4/i);
    expect(queries[2].text).toMatch(/provider_message_id_aliases \? \$4/i);
  });

  it("marks deleted only through the deleted provider locator", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "emailengine",
      providerMessageId: "ee_msg_old",
      mailboxPath: "INBOX",
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:ee_msg_old",
    });

    expect(queries[2].text).toMatch(/provider_message_id = \$4/i);
    expect(queries[2].text).not.toMatch(/emailengine_email_id/i);
    expect(queries[2].text).not.toMatch(/internet_message_id/i);
  });

  it("mirrors Gmail native messages into the unified read model and provider refs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_gmail_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_gmail_1",
                provider: "gmail",
                provider_message_id: "gm_msg_1",
                gmail_message_id: "gm_msg_1",
                gmail_thread_id: "thr_1",
                gmail_history_id: "950",
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
      provider: "gmail",
      providerIdentity: {
        provider: "gmail",
        messageId: "gm_msg_1",
        threadId: "thr_1",
        historyId: "950",
      },
      mailboxIdentity: { provider: "gmail", labelId: "INBOX" },
      message: {
        id: "gm_msg_1",
        threadId: "thr_1",
        historyId: "950",
        labelIds: ["INBOX", "UNREAD", "STARRED"],
        internalDate: "1781206800000",
        snippet: "Please review the launch brief.",
        payload: {
          headers: [
            { name: "Message-ID", value: "<gm-msg-1@example.com>" },
            { name: "In-Reply-To", value: "<gm-parent@example.com>" },
            {
              name: "References",
              value: "<gm-root@example.com> <gm-parent@example.com>",
            },
            { name: "Subject", value: "Launch brief" },
            { name: "From", value: "Alice Example <alice@example.com>" },
            { name: "To", value: "Me <me@example.com>" },
          ],
        },
        attachments: [
          {
            id: "gmail_att_1",
            filename: "launch-brief.pdf",
            mimeType: "application/pdf",
            size: 120000,
          },
        ],
      },
    });

    const insertMessageQuery = queries.find((query) =>
      query.text.includes("INSERT INTO messages"),
    );
    expect(insertMessageQuery?.values).toEqual([
      expect.any(String),
      "00000000-0000-0000-0000-000000000001",
      "gm_msg_1",
      "<gm-msg-1@example.com>",
      "<gm-parent@example.com>",
      ["<gm-root@example.com>", "<gm-parent@example.com>"],
      "Launch brief",
      "alice@example.com",
      "Alice Example",
      ["me@example.com"],
      [],
      "2026-06-11T19:40:00.000Z",
      "Please review the launch brief.",
      undefined,
      undefined,
    ]);

    const stateQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_state"),
    );
    expect(stateQuery?.values).toEqual(["message_gmail_1", true, true]);

    const locationQuery = queries.find((query) =>
      query.text.includes("INSERT INTO message_locations"),
    );
    expect(locationQuery?.values).toEqual([
      "message_gmail_1",
      "00000000-0000-0000-0000-000000000001",
      "INBOX",
    ]);

    const providerRefQuery = queries.find((query) =>
      query.text.includes("INSERT INTO provider_message_refs"),
    );
    expect(providerRefQuery?.text).toMatch(
      /ON CONFLICT \(account_id, provider, gmail_message_id\) DO UPDATE/i,
    );
    expect(providerRefQuery?.values).toContain("gmail");
    expect(providerRefQuery?.values).toContain("message_gmail_1");
    expect(providerRefQuery?.values).toContain("gm_msg_1");
    expect(providerRefQuery?.values).toContain("thr_1");
    expect(providerRefQuery?.values).toContain("950");

    const jobQuery = queries.find((query) =>
      query.text.includes("INSERT INTO attachment_text_extraction_jobs"),
    );
    expect(jobQuery?.values).toEqual([
      expect.any(String),
      "00000000-0000-0000-0000-000000000001",
      "message_gmail_1",
      "gmail",
      "gmail_att_1",
      "launch-brief.pdf",
      "application/pdf",
      120000,
      "attachment-text:00000000-0000-0000-0000-000000000001:message_gmail_1:gmail_att_1",
    ]);
  });

  it("removes Graph native mailbox locations through provider refs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    };
    const store = createPostgresMirrorStore(client);

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "graph",
      providerMessageId: "graph_msg_deleted",
      providerIdentity: {
        provider: "graph",
        id: "graph_msg_deleted",
        conversationId: "conv_deleted",
      },
      mailboxIdentity: { provider: "graph", folderId: "folder_inbox" },
      deletedAt: "2026-06-12T09:00:00.000Z",
      idempotencyKey: "delete:account:graph:graph_msg_deleted",
    });

    expect(queries[0].values).toEqual([
      expect.any(String),
      "00000000-0000-0000-0000-000000000001",
      "graph",
      {
        provider: "graph",
        id: "graph_msg_deleted",
        conversationId: "conv_deleted",
      },
      "graph_msg_deleted",
      "folder_inbox",
      "2026-06-12T09:00:00.000Z",
      "delete:account:graph:graph_msg_deleted",
      {},
    ]);
    expect(queries[1].text).toMatch(/DELETE FROM message_locations/i);
    expect(queries[1].values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "graph",
      "graph_msg_deleted",
      "folder_inbox",
    ]);
    expect(queries[2].text).toMatch(/UPDATE message_state/i);
    expect(queries[2].values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "graph",
      "2026-06-12T09:00:00.000Z",
      "graph_msg_deleted",
    ]);
  });

  it("mirrors Graph native messages through graph_message_id provider refs", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
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
                graph_change_key: "change_2",
                graph_conversation_id: "conv_1",
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
        changeKey: "change_2",
        conversationId: "conv_1",
      },
      mailboxIdentity: { provider: "graph", folderId: "folder_inbox" },
      message: {
        id: "graph_msg_1",
        changeKey: "change_2",
        conversationId: "conv_1",
        parentFolderId: "folder_inbox",
        internetMessageId: "<graph-msg-1@example.com>",
        internetMessageHeaders: [
          { name: "In-Reply-To", value: "<graph-parent@example.com>" },
          {
            name: "References",
            value: "<graph-root@example.com> <graph-parent@example.com>",
          },
        ],
        subject: "Graph launch update",
        from: {
          emailAddress: {
            address: "lead@example.com",
            name: "Project Lead",
          },
        },
        toRecipients: [
          { emailAddress: { address: "me@example.com", name: "Me" } },
        ],
        receivedDateTime: "2026-06-12T09:00:00.000Z",
        bodyPreview: "The Outlook account synced through Graph.",
        isRead: true,
        flag: { flagStatus: "flagged" },
        body: { contentType: "text", content: "Native Graph body" },
      },
    });

    const insertMessageQuery = queries.find((query) =>
      query.text.includes("INSERT INTO messages"),
    );
    expect(insertMessageQuery?.values).toEqual([
      expect.any(String),
      "00000000-0000-0000-0000-000000000001",
      "graph_msg_1",
      "<graph-msg-1@example.com>",
      "<graph-parent@example.com>",
      ["<graph-root@example.com>", "<graph-parent@example.com>"],
      "Graph launch update",
      "lead@example.com",
      "Project Lead",
      ["me@example.com"],
      [],
      "2026-06-12T09:00:00.000Z",
      "The Outlook account synced through Graph.",
      "Native Graph body",
      undefined,
    ]);

    const providerRefQuery = queries.find((query) =>
      query.text.includes("INSERT INTO provider_message_refs"),
    );
    expect(providerRefQuery?.text).toMatch(
      /ON CONFLICT \(account_id, provider, graph_message_id\) DO UPDATE/i,
    );
    expect(providerRefQuery?.values).toContain("message_graph_1");
    expect(providerRefQuery?.values).toContain("graph_msg_1");
    expect(providerRefQuery?.values).toContain("change_2");
    expect(providerRefQuery?.values).toContain("conv_1");
  });

  it("uses an IMAP composite local id and provider ref locator for same UID safety", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("INSERT INTO messages")) {
          return { rows: [{ id: "message_imap_1" }] };
        }
        if (text.includes("INSERT INTO provider_message_refs")) {
          return {
            rows: [
              {
                id: "ref_imap_1",
                provider: "imap",
                provider_message_id: "42",
                imap_mailbox_id: "Archive",
                imap_uidvalidity: "777",
                imap_uid: "42",
                imap_modseq: "900",
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
      provider: "imap",
      providerIdentity: {
        provider: "imap",
        mailbox: { provider: "imap", path: "Archive" },
        uidvalidity: "777",
        uid: "42",
        modseq: "900",
      },
      mailboxIdentity: { provider: "imap", path: "Archive" },
      message: {
        uid: "42",
        uidvalidity: "777",
        modseq: "900",
        mailboxPath: "Archive",
        messageId: "<imap-msg@example.com>",
        envelope: {
          inReplyTo: "<imap-parent@example.com>",
          references: "<imap-root@example.com> <imap-parent@example.com>",
        },
        subject: "IMAP mirror safety",
        from: "Sender <sender@example.com>",
        to: [{ address: "me@example.com" }],
        date: "2026-06-12T09:00:00.000Z",
        text: "Same UID in another mailbox must not collide.",
        flags: ["\\Seen"],
      },
    });

    const insertMessageQuery = queries.find((query) =>
      query.text.includes("INSERT INTO messages"),
    );
    expect(insertMessageQuery?.values?.[2]).toBe("imap:Archive:777:42");
    expect(insertMessageQuery?.values?.[3]).toBe("<imap-msg@example.com>");
    expect(insertMessageQuery?.values?.[4]).toBe("<imap-parent@example.com>");
    expect(insertMessageQuery?.values?.[5]).toEqual([
      "<imap-root@example.com>",
      "<imap-parent@example.com>",
    ]);

    const providerRefQuery = queries.find((query) =>
      query.text.includes("INSERT INTO provider_message_refs"),
    );
    expect(providerRefQuery?.text).toMatch(
      /ON CONFLICT \(account_id, provider, imap_mailbox_id, imap_uidvalidity, imap_uid\) DO UPDATE/i,
    );
    expect(providerRefQuery?.values).toContain("message_imap_1");
    expect(providerRefQuery?.values).toContain("Archive");
    expect(providerRefQuery?.values).toContain("777");
    expect(providerRefQuery?.values).toContain("42");

    await store.recordMessageDeleted({
      engineAccountId: "00000000-0000-0000-0000-000000000001",
      provider: "imap",
      providerMessageId: "42",
      providerIdentity: {
        provider: "imap",
        mailbox: { provider: "imap", path: "Archive" },
        uidvalidity: "777",
        uid: "42",
      },
      deletedAt: "2026-06-12T10:00:00.000Z",
      idempotencyKey: "delete:imap:Archive:777:42",
    });

    const deleteLocationQuery = queries.find((query) =>
      query.text.includes("DELETE FROM message_locations"),
    );
    expect(deleteLocationQuery?.text).toMatch(/imap_mailbox_id = \$4/i);
    expect(deleteLocationQuery?.text).toMatch(/imap_uidvalidity = \$5/i);
    expect(deleteLocationQuery?.text).toMatch(/imap_uid = \$3/i);
    expect(deleteLocationQuery?.values).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "imap",
      "42",
      "Archive",
      "777",
    ]);
  });
});
