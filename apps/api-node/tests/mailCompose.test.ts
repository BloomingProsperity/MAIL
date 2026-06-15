import { describe, expect, it } from "vitest";

import {
  createMailComposeService,
  InvalidMailComposeRequestError,
  type MailComposeStore,
} from "../src/mail-compose/mail-compose";

describe("mail compose service", () => {
  it("creates an app-owned draft without calling a provider", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async createDraft(input) {
        calls.push(input);
        return {
          id: input.id,
          accountId: input.accountId,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          createdAt: input.now,
          updatedAt: input.now,
        };
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "draft_1",
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

    const draft = await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      cc: [],
      bcc: [],
      subject: "Launch confirmation",
      bodyText: "Looks good.",
      source: "hermes_reply",
      hermesSkillRunId: "run_1",
    });

    expect(calls).toEqual([
      {
        id: "draft_1",
        accountId: "acc_1",
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
        source: "hermes_reply",
        hermesSkillRunId: "run_1",
        now: "2026-06-13T08:00:00.000Z",
      },
    ]);
    expect(providerCalls).toEqual([]);
    expect(draft).toMatchObject({
      id: "draft_1",
      accountId: "acc_1",
      status: "draft",
      source: "hermes_reply",
    });
  });

  it("records Hermes reply draft edits when saving the composed draft", async () => {
    const feedbackCalls: unknown[] = [];
    const store = createStore({
      async createDraft(input) {
        return {
          id: input.id,
          accountId: input.accountId,
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          bodyText: input.bodyText,
          status: "draft",
          source: input.source,
          hermesSkillRunId: input.hermesSkillRunId,
          hermesDraftText: input.hermesDraftText,
          createdAt: input.now,
          updatedAt: input.now,
        };
      },
    });
    const service = createMailComposeService({
      store,
      createId: () => "draft_1",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {},
      hermesDraftFeedbackStore: {
        async recordDraftFeedback(input) {
          feedbackCalls.push(input);
          return {
            feedbackId: "feedback_1",
            skillRunId: input.skillRunId,
            learned: true,
            memoryId: "memory_1",
          };
        },
      },
    });

    await service.createDraft({
      accountId: "acc_1",
      to: [{ address: "lina@example.com", name: "Lina" }],
      subject: "Re: Launch confirmation",
      bodyText: "Hi Lina,\n\nConfirmed for Thursday.",
      source: "hermes_reply",
      hermesSkillRunId: "run_reply_1",
      hermesDraftText:
        "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
    });

    expect(feedbackCalls).toEqual([
      {
        skillRunId: "run_reply_1",
        draftText:
          "Hi Lina,\n\nThanks for the update. I can confirm Thursday works well for us.\n\nBest,\nHua",
        finalText: "Hi Lina,\n\nConfirmed for Thursday.",
        subject: "Re: Launch confirmation",
        recipientEmail: "lina@example.com",
      },
    ]);
  });

  it("claims a draft, submits it through the account engine, and marks it sent", async () => {
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
      async claimDraftForSend(input) {
        calls.push(["claim", input]);
        return {
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: { ...draft(), status: "sending" },
        };
      },
      async markDraftSent(input) {
        calls.push(["sent", input]);
        return {
          ...draft(),
          status: "sent",
          providerQueueId: input.providerQueueId,
          providerMessageId: input.providerMessageId,
          sentAt: input.sentAt,
        };
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            return {
              queueId: "queue_1",
              messageId: "<message@example.com>",
              sendAt: "2026-06-13T08:00:00.000Z",
            };
          },
        },
      },
    });

    const result = await service.sendDraft({
      accountId: "acc_1",
      draftId: "draft_1",
    });

    expect(providerCalls).toEqual([
      {
        accountId: "acc_1",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:send",
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
      },
    ]);
    expect(calls).toEqual([
      ["get", { accountId: "acc_1", draftId: "draft_1" }],
      [
        "claim",
        {
          accountId: "acc_1",
          draftId: "draft_1",
          leaseOwner: "api-send-draft",
          leaseExpiresAt: "2026-06-13T08:01:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
      [
        "sent",
        {
          accountId: "acc_1",
          draftId: "draft_1",
          providerQueueId: "queue_1",
          providerMessageId: "<message@example.com>",
          sentAt: "2026-06-13T08:00:00.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      accountId: "acc_1",
      draftId: "draft_1",
      action: "draft_send_queued",
      draft: {
        status: "sent",
        providerQueueId: "queue_1",
        providerMessageId: "<message@example.com>",
      },
    });
  });

  it("rejects sending paused or already sent drafts before provider calls", async () => {
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store: createStore({
        async getDraftWithAccount() {
          return {
            account: {
              accountId: "acc_1",
              email: "me@example.com",
              syncState: "paused",
              engineProvider: "emailengine",
            },
            draft: { ...draft(), status: "sent" },
          };
        },
      }),
      createId: () => "unused",
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
      service.sendDraft({ accountId: "acc_1", draftId: "draft_1" }),
    ).rejects.toBeInstanceOf(InvalidMailComposeRequestError);
    expect(providerCalls).toEqual([]);
  });

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

  it("sends a scheduled draft now through the account engine", async () => {
    const calls: unknown[] = [];
    const store = createStore({
      async claimScheduledSendForSubmit(input) {
        calls.push(["claim", input]);
        return {
          scheduledSend: scheduledSend(),
          account: {
            accountId: "acc_1",
            email: "me@example.com",
            syncState: "syncing",
            engineProvider: "emailengine",
          },
          draft: { ...draft(), status: "sending" },
        };
      },
      async markScheduledSendSent(input) {
        calls.push(["sent", input]);
        return scheduledSend({
          status: "sent",
          providerQueueId: input.providerQueueId,
          providerMessageId: input.providerMessageId,
          sentAt: input.sentAt,
        });
      },
    });
    const providerCalls: unknown[] = [];
    const service = createMailComposeService({
      store,
      createId: () => "unused",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
      transports: {
        emailengine: {
          async submitMessage(input) {
            providerCalls.push(input);
            return {
              queueId: "queue_1",
              messageId: "<message@example.com>",
              sendAt: "2026-06-13T08:00:01.000Z",
            };
          },
        },
      },
    });

    const result = await service.sendScheduledNow({
      accountId: "acc_1",
      scheduledId: "schedule_1",
    });

    expect(providerCalls).toEqual([
      {
        accountId: "acc_1",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
      },
    ]);
    expect(calls).toEqual([
      [
        "claim",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
          leaseOwner: "api-send-now",
          leaseExpiresAt: "2026-06-13T08:01:00.000Z",
          now: "2026-06-13T08:00:00.000Z",
        },
      ],
      [
        "sent",
        {
          accountId: "acc_1",
          scheduledId: "schedule_1",
          draftId: "draft_1",
          providerQueueId: "queue_1",
          providerMessageId: "<message@example.com>",
          sentAt: "2026-06-13T08:00:01.000Z",
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: "schedule_1",
      status: "sent",
      providerQueueId: "queue_1",
      providerMessageId: "<message@example.com>",
    });
  });
});

function createStore(overrides: Partial<MailComposeStore>): MailComposeStore {
  return {
    async createDraft() {
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
    async rescheduleScheduledSend() {
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
