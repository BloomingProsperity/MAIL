import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  createMailComposeService,
  InvalidMailComposeRequestError,
  MAX_DRAFT_ATTACHMENT_BYTES,
  type MailComposeStore,
} from "../src/mail-compose/mail-compose";

describe("mail compose scheduled service", () => {
  it("schedules a draft without calling the provider", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getDraftWithAccount(input) {
        calls.push(["get", input]);
        return {
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: draft(),
        };
      },
      async createScheduledSend(input) {
        calls.push(["schedule", input]);
        return scheduledSend({
          id: input.id,
          accountId: input.accountId,
          draftId: input.draftId,
          scheduledAt: input.scheduledAt,
          notBefore: input.notBefore,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const result = await service.scheduleDraft({
      accountId: "acc_1",
      draftId: "draft_1",
      scheduledAt: "2026-06-13T12:30:00.000Z",
    });

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
      [
        "schedule",
        {
          id: "schedule_1",
          accountId: "acc_1",
          draftId: "draft_1",
          scheduledAt: "2026-06-13T12:30:00.000Z",
          notBefore: "2026-06-13T12:30:00.000Z",
          status: "scheduled",
          idempotencyKey: "compose:draft_1:schedule:2026-06-13T12:30:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      accountId: "acc_1",
      draftId: "draft_1",
      status: "scheduled",
      canSendNow: true,
    });
  });

  it("rejects scheduling drafts when the saved send-as identity was revoked", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getDraftWithAccount(input) {
          calls.push(["get", input]);
          return {
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
            draft: {
              ...draft(),
              from: { address: "support@demo.site", name: "Support" },
            },
          };
        },
        async createScheduledSend(input) {
          calls.push(["schedule", input]);
          throw new Error("not expected");
        },
      }),
      createId: () => "schedule_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({ address: "me@example.com" }),
      transports: {},
    });

    await expect(
      service.scheduleDraft({
        accountId: "acc_1",
        draftId: "draft_1",
        scheduledAt: "2026-06-13T12:30:00.000Z",
      }),
    ).rejects.toThrow("from address is not allowed");
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
    ]);
  });

  it("loads an editable scheduled draft with its current content", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(input);
          return {
            scheduledSend: scheduledSend({
              scheduledAt: "2026-06-13T12:30:00.000Z",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              subject: "Scheduled launch",
              bodyText: "Send later body.",
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 12,
                  inline: false,
                },
              ],
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    const detail = await service.getScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(calls).toEqual([{ accountId: "acc_1", scheduledId: "schedule_1" }]);
    expect(detail).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        draftId: "draft_1",
        canEdit: true,
      },
      draft: {
        id: "draft_1",
        status: "scheduled",
        subject: "Scheduled launch",
        bodyText: "Send later body.",
      },
    });
  });

  it("updates scheduled draft content without creating a replacement", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend({ id: input.scheduledId }),
            draft: {
              ...draft(),
              status: "scheduled",
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                },
              ],
            },
            transportAttachments: [
              {
                id: "upload_1",
                source: "uploaded_file",
                attachmentId: "upload_1",
                filename: "plan.pdf",
                contentType: "application/pdf",
                byteSize: 4,
                inline: false,
                contentBase64: "cGxhbg==",
              },
            ],
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft(input) {
          calls.push(["update", input]);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              subject: input.subject,
              to: input.to,
              cc: input.cc,
              bcc: input.bcc,
              bodyText: input.bodyText,
              attachments: input.attachments?.map((attachment) => ({
                id: attachment.id,
                source: attachment.source,
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                contentType: attachment.contentType,
                byteSize: attachment.byteSize,
                inline: attachment.inline,
              })),
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused_new_draft_id",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const detail = await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "Lina@Example.com", name: "Lina" }],
      subject: " Updated scheduled launch ",
      bodyText: "Edited send-later body.",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          attachmentId: "upload_1",
          filename: "plan.pdf",
          contentType: "application/pdf",
          byteSize: 8,
        },
      ],
    });

    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
      [
        "update",
        expect.objectContaining({
          accountId: "acc_1",
          scheduledId: "schedule_1",
          to: [{ address: "lina@example.com", name: "Lina" }],
          cc: [],
          bcc: [],
          subject: "Updated scheduled launch",
          bodyText: "Edited send-later body.",
          source: "manual",
          attachments: [
            expect.objectContaining({
              id: "upload_1",
              source: "uploaded_file",
              filename: "plan.pdf",
              contentBase64: "cGxhbg==",
            }),
          ],
          now: "2026-06-13T08:30:00.000Z",
        }),
      ],
    ]);
    expect(detail).toMatchObject({
      scheduledSend: {
        id: "schedule_1",
        status: "scheduled",
      },
      draft: {
        id: "draft_1",
        status: "scheduled",
        bodyText: "Edited send-later body.",
      },
    });
  });

  it("preserves scheduled draft object-storage attachments during edits", async () => {
    const storageKey = "11111111-1111-4111-8111-111111111111";
    const calls: unknown[] = [];
    const blobCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend({ id: input.scheduledId }),
            draft: {
              ...draft(),
              status: "scheduled",
              attachments: [
                {
                  id: `upload_${storageKey}`,
                  source: "uploaded_file" as const,
                  attachmentId: `upload_${storageKey}`,
                  storageKey,
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 5242880,
                  inline: false,
                },
              ],
            },
            transportAttachments: [
              {
                id: `upload_${storageKey}`,
                source: "uploaded_file" as const,
                attachmentId: `upload_${storageKey}`,
                storageKey,
                filename: "plan.pdf",
                contentType: "application/pdf",
                byteSize: 5242880,
                inline: false,
              },
            ],
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft(input) {
          calls.push(["update", input]);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              subject: input.subject,
              to: input.to,
              cc: input.cc,
              bcc: input.bcc,
              bodyText: input.bodyText,
              attachments: input.attachments?.map((attachment) => ({
                id: attachment.id,
                source: attachment.source,
                attachmentId: attachment.attachmentId,
                storageKey: attachment.storageKey,
                filename: attachment.filename,
                contentType: attachment.contentType,
                byteSize: attachment.byteSize,
                inline: attachment.inline,
              })),
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused_new_draft_id",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
      attachmentBlobStore: {
        async getUploadedAttachment(input) {
          blobCalls.push(input);
          return {
            id: `upload_${storageKey}`,
            source: "uploaded_file",
            attachmentId: `upload_${storageKey}`,
            storageKey,
            filename: "plan.pdf",
            contentType: "application/pdf",
            byteSize: 5242880,
            inline: false,
          };
        },
        async loadUploadedAttachmentContent() {
          throw new Error("not used");
        },
      },
    });

    await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      subject: "Scheduled launch",
      bodyText: "Edited body.",
      attachments: [
        {
          source: "uploaded_file",
          attachmentId: `upload_${storageKey}`,
          filename: "plan.pdf",
          contentType: "application/pdf",
        },
      ],
    });

    expect(blobCalls).toEqual([
      {
        accountId: "acc_1",
        storageKey,
        attachmentId: `upload_${storageKey}`,
      },
    ]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
      [
        "update",
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: `upload_${storageKey}`,
              source: "uploaded_file",
              storageKey,
              filename: "plan.pdf",
            }),
          ],
        }),
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain("contentBase64");
  });

  it("keeps scheduled draft attachments when body-only edits omit attachments", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async updateScheduledDraft(input) {
          calls.push(input);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              bodyText: input.bodyText,
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                },
              ],
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const detail = await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      subject: "Scheduled launch",
      bodyText: "Body-only edit.",
    });

    expect(calls).toEqual([
      expect.not.objectContaining({
        attachments: expect.anything(),
      }),
    ]);
    expect(detail.draft).toMatchObject({
      bodyText: "Body-only edit.",
      attachments: [
        {
          id: "upload_1",
          source: "uploaded_file",
          filename: "plan.pdf",
        },
      ],
    });
  });

  it("clears scheduled draft attachments when edits pass an explicit empty list", async () => {
    const calls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend({ id: input.scheduledId }),
            draft: {
              ...draft(),
              status: "scheduled",
              attachments: [
                {
                  id: "upload_1",
                  source: "uploaded_file" as const,
                  attachmentId: "upload_1",
                  filename: "plan.pdf",
                  contentType: "application/pdf",
                  byteSize: 4,
                  inline: false,
                },
              ],
            },
            transportAttachments: [
              {
                id: "upload_1",
                source: "uploaded_file" as const,
                attachmentId: "upload_1",
                filename: "plan.pdf",
                contentType: "application/pdf",
                byteSize: 4,
                inline: false,
                contentBase64: "cGxhbg==",
              },
            ],
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft(input) {
          calls.push(["update", input]);
          return {
            scheduledSend: scheduledSend({
              id: input.scheduledId,
              status: "scheduled",
            }),
            draft: {
              ...draft(),
              status: "scheduled",
              bodyText: input.bodyText,
              attachments: input.attachments ?? [],
              updatedAt: input.now,
            },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:30:00.000Z"),
      transports: {},
    });

    const detail = await service.updateScheduledDraft({
      accountId: "acc_1",
      scheduledId: "schedule_1",
      to: [{ address: "lina@example.com" }],
      subject: "Scheduled launch",
      bodyText: "Clear attachment edit.",
      attachments: [],
    });

    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
      [
        "update",
        expect.objectContaining({
          accountId: "acc_1",
          scheduledId: "schedule_1",
          attachments: [],
        }),
      ],
    ]);
    expect(detail.draft).toMatchObject({
      bodyText: "Clear attachment edit.",
      attachments: [],
    });
  });

  it("rejects scheduled attachment edits when existing uploaded bytes are unavailable", async () => {
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft() {
          return {
            scheduledSend: scheduledSend(),
            draft: { ...draft(), status: "scheduled" },
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
          };
        },
        async updateScheduledDraft() {
          throw new Error("not expected");
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    await expect(
      service.updateScheduledDraft({
        accountId: "acc_1",
        scheduledId: "schedule_1",
        to: [{ address: "lina@example.com" }],
        subject: "Scheduled launch",
        bodyText: "Missing bytes.",
        attachments: [
          {
            source: "uploaded_file",
            attachmentId: "upload_1",
            filename: "plan.pdf",
            contentType: "application/pdf",
            byteSize: 4,
          },
        ],
      }),
    ).rejects.toThrow("attachment content is required");
  });

  it("rejects updating missing or claimed scheduled draft rows", async () => {
    const service = createMailComposeService({
      store: createStore({
        async updateScheduledDraft() {
          return undefined;
        },
      }),
      createId: () => "unused",
      transports: {},
    });

    await expect(
      service.updateScheduledDraft({
        accountId: "acc_1",
        scheduledId: "schedule_claimed",
        to: [{ address: "lina@example.com" }],
        subject: "Too late",
        bodyText: "Worker already claimed this.",
      }),
    ).rejects.toThrow("scheduled draft was not found");
  });

  it("queues a scheduled draft for immediate worker send without calling the provider", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getScheduledDraft(input) {
        calls.push(["get", input]);
        return {
          scheduledSend: scheduledSend(),
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: {
            ...draft(),
            from: { address: "support@demo.site" },
            status: "scheduled",
            threading: {
              action: "reply_all" as const,
              inReplyTo: "<source@example.com>",
              references: ["<root@example.com>", "<source@example.com>"],
              emailEngineMessageId: "emailengine_msg_1",
            },
          },
        };
      },
      async queueScheduledSendNow(input) {
        calls.push(["queue-now", input]);
        return scheduledSend({
          id: input.scheduledId,
          scheduledAt: input.scheduledAt,
          status: "queued",
          notBefore: input.notBefore,
          canEdit: false,
          canSendNow: false,
          canDelete: false,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
      }),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    const result = await service.sendScheduledNow({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      [
        "get",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
        },
      ],
      [
        "queue-now",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
          scheduledAt: "2026-06-13T08:00:00.000Z",
          notBefore: "2026-06-13T08:00:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      status: "queued",
      notBefore: "2026-06-13T08:00:00.000Z",
      canSendNow: false,
    });
  });

  it("rejects scheduled send-now before queueing when the transport is missing", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async getScheduledDraft(input) {
        calls.push(["get", input]);
        return {
          scheduledSend: scheduledSend(),
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: {
            ...draft(),
            from: { address: "support@demo.site" },
            status: "scheduled",
          },
        };
      },
      async queueScheduledSendNow(input) {
        calls.push(["queue-now", input]);
        throw new Error("should not queue without a transport");
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({
        address: "support@demo.site",
      }),
      transports: {},
    });

    await expect(
      service.sendScheduledNow({
        accountId: "acc_1",
        scheduledId: "schedule_1",
      }),
    ).rejects.toThrow("emailengine send transport is not configured");
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", scheduledId: "schedule_1" }],
    ]);
  });

  it("rejects send-now before queueing when the saved send-as identity was revoked", async () => {
    const calls: unknown[] = [];
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getScheduledDraft(input) {
          calls.push(["get", input]);
          return {
            scheduledSend: scheduledSend(),
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "syncing",
              engineProvider: "emailengine",
            },
            draft: {
              ...draft(),
              from: { address: "support@demo.site" },
              status: "scheduled",
            },
          };
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      sendIdentityStore: sendIdentityStoreFor({ address: "me@example.com" }),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            throw new Error("not expected");
          },
        },
      },
    });

    await expect(
      service.sendScheduledNow({
        accountId: "acc_1",
        scheduledId: "schedule_1",
      }),
    ).rejects.toThrow("from address is not allowed");

    expect(providerCalls).toEqual([]);
    expect(calls).toEqual([
      [
        "get",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
        },
      ],
    ]);
  });
});

function createStore(overrides: Partial<MailComposeStore>): MailComposeStore {
  return {
    async createDraft() {
      throw new Error("not used");
    },
    async listDrafts() {
      throw new Error("not used");
    },
    async updateDraft() {
      throw new Error("not used");
    },
    async getDraftWithAccount() {
      throw new Error("not used");
    },
    async claimDraftForSend() {
      throw new Error("not used");
    },
    async markDraftSent() {
      throw new Error("not used");
    },
    async markDraftFailed() {
      throw new Error("not used");
    },
    async createScheduledSend() {
      throw new Error("not used");
    },
    async listScheduledSends() {
      throw new Error("not used");
    },
    async getScheduledDraft() {
      throw new Error("not used");
    },
    async updateScheduledDraft() {
      throw new Error("not used");
    },
    async rescheduleScheduledSend() {
      throw new Error("not used");
    },
    async queueScheduledSendNow() {
      throw new Error("not used");
    },
    async cancelScheduledSend() {
      throw new Error("not used");
    },
    async claimScheduledSendForSubmit() {
      throw new Error("not used");
    },
    async markScheduledSendSent() {
      throw new Error("not used");
    },
    async markScheduledSendFailed() {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function draft() {
  return {
    id: "draft_1",
    accountId: "acc_1",
    to: [{ address: "lina@example.com", name: "Lina" }],
    cc: [],
    bcc: [],
    subject: "Launch confirmation",
    bodyText: "Looks good.",
    status: "draft" as const,
    source: "manual" as const,
    createdAt: "2026-06-13T07:00:00.000Z",
    updatedAt: "2026-06-13T07:00:00.000Z",
  };
}

function scheduledSend(overrides = {}) {
  return {
    id: "schedule_1",
    accountId: "acc_1",
    draftId: "draft_1",
    scheduledAt: "2026-06-13T12:30:00.000Z",
    status: "scheduled" as const,
    attempts: 0,
    maxAttempts: 5,
    notBefore: "2026-06-13T12:30:00.000Z",
    canEdit: true,
    canSendNow: true,
    canDelete: true,
    createdAt: "2026-06-13T08:00:00.000Z",
    updatedAt: "2026-06-13T08:00:00.000Z",
    ...overrides,
  };
}

function sendIdentityStoreFor(input: { address: string; name?: string }) {
  return {
    async listSendIdentities() {
      return [
        {
          id: `identity:${input.address}`,
          accountId: "acc_1",
          from: {
            address: input.address,
            ...(input.name ? { name: input.name } : {}),
          },
          source: "provider_native" as const,
          isDefault: false,
          verified: true,
          provider: "graph",
          providerIdentityId: input.address,
          identityType: "shared_mailbox" as const,
        },
      ];
    },
  };
}

function sendIdentityCandidate(overrides = {}) {
  return {
    id: "provider:identity_1",
    accountId: "acc_1",
    from: { address: "team@example.com", name: "Team Inbox" },
    source: "provider_native" as const,
    isDefault: false,
    verified: false,
    provider: "graph",
    providerIdentityId: "team@example.com",
    identityType: "shared_mailbox" as const,
    verificationState: "pending" as const,
    enabled: false,
    verificationRecipient: { address: "me@example.com" },
    ...overrides,
  };
}

function messageDetail(overrides = {}) {
  return {
    id: "message_1",
    accountId: "acc_1",
    subject: "Launch confirmation",
    from: {
      email: "lina@example.com",
      name: "Lina",
    },
    receivedAt: "2026-06-13T07:30:00.000Z",
    snippet: "Looks good.",
    unread: true,
    starred: false,
    mailboxIds: ["inbox"],
    attachmentCount: 0,
    classification: {
      bucket: "P3 Needs Action",
      priorityScore: 80,
      reasons: ["direct"],
    },
    to: ["me@example.com"],
    cc: [],
    bodyText: "Looks good.",
    attachments: [],
    ...overrides,
  };
}
