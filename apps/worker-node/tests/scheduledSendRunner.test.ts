import { describe, expect, it } from "vitest";

import {
  runScheduledSendBatch,
  runScheduledSendOnce,
  type ScheduledSendJob,
  type ScheduledSendStore,
} from "../src/scheduled-send-runner";

describe("scheduled send runner", () => {
  it("submits a claimed scheduled draft and marks it sent", async () => {
    const store = createStore([
      { ...job(), from: { address: "support@demo.site", name: "Support" } },
    ]);
    const submitCalls: unknown[] = [];

    const result = await runScheduledSendOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      transport: {
        async submitMessage(input) {
          submitCalls.push(input);
          return {
            queueId: "queue_1",
            messageId: "<message@example.com>",
            sendAt: "2026-06-13T12:30:01.000Z",
          };
        },
      },
    });

    expect(result).toEqual({
      status: "processed",
      scheduledId: "schedule_1",
    });
    expect(submitCalls).toEqual([
      {
        accountId: "acc_1",
        draftId: "draft_1",
        idempotencyKey: "compose:draft_1:schedule:schedule_1:send",
        from: { address: "support@demo.site", name: "Support" },
        to: [{ address: "lina@example.com", name: "Lina" }],
        cc: [],
        bcc: [],
        subject: "Launch confirmation",
        bodyText: "Looks good.",
      },
    ]);
    expect(store.sent).toEqual([
      {
        accountId: "acc_1",
        scheduledId: "schedule_1",
        draftId: "draft_1",
        providerQueueId: "queue_1",
        providerMessageId: "<message@example.com>",
        sentAt: "2026-06-13T12:30:01.000Z",
      },
    ]);
  });

  it("routes native scheduled sends through the matching native transport", async () => {
    const store = createStore([
      {
        ...job(),
        engineProvider: "native",
        nativeProvider: "gmail",
      },
    ]);
    const emailEngineCalls: unknown[] = [];
    const gmailCalls: unknown[] = [];

    const result = await runScheduledSendOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      transports: {
        emailengine: {
          async submitMessage(input) {
            emailEngineCalls.push(input);
            return {};
          },
        },
        gmail: {
          async submitMessage(input) {
            gmailCalls.push(input);
            return { messageId: "gmail_msg_1" };
          },
        },
      },
    });

    expect(result).toEqual({
      status: "processed",
      scheduledId: "schedule_1",
    });
    expect(emailEngineCalls).toEqual([]);
    expect(gmailCalls).toHaveLength(1);
    expect(store.sent[0]).toMatchObject({
      providerMessageId: "gmail_msg_1",
    });
  });

  it("marks native scheduled sends failed when the provider transport is missing", async () => {
    const store = createStore([
      {
        ...job(),
        engineProvider: "native",
        nativeProvider: "graph",
      },
    ]);

    const result = await runScheduledSendOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      transports: {},
    });

    expect(result).toEqual({
      status: "failed",
      scheduledId: "schedule_1",
      errorMessage: "scheduled send transport is unavailable for graph",
    });
    expect(store.failed[0]).toMatchObject({
      errorMessage: "scheduled send transport is unavailable for graph",
    });
  });

  it("marks a scheduled send failed when the provider rejects submission", async () => {
    const store = createStore([job()]);

    const result = await runScheduledSendOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      transport: {
        async submitMessage() {
          throw new Error("SMTP rejected message");
        },
      },
    });

    expect(result).toEqual({
      status: "failed",
      scheduledId: "schedule_1",
      errorMessage: "SMTP rejected message",
    });
    expect(store.failed).toEqual([
      {
        accountId: "acc_1",
        scheduledId: "schedule_1",
        draftId: "draft_1",
        errorMessage: "SMTP rejected message",
        now: new Date("2026-06-13T12:30:00.000Z"),
      },
    ]);
  });

  it("claims up to concurrency due scheduled sends", async () => {
    const store = createStore([job("schedule_1"), job("schedule_2")]);
    const sentDraftIds: string[] = [];

    const results = await runScheduledSendBatch({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      concurrency: 2,
      transport: {
        async submitMessage(input) {
          sentDraftIds.push(input.draftId);
          return {};
        },
      },
    });

    expect(results.map((item) => item.status)).toEqual([
      "processed",
      "processed",
    ]);
    expect(sentDraftIds).toEqual(["draft_1", "draft_2"]);
  });

  it("returns idle when no scheduled sends are due", async () => {
    const result = await runScheduledSendBatch({
      store: createStore([]),
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      concurrency: 4,
      transport: {
        async submitMessage() {
          throw new Error("should not be called");
        },
      },
    });

    expect(result).toEqual([{ status: "idle" }]);
  });
});

function createStore(jobs: ScheduledSendJob[]) {
  const queue = [...jobs];
  return {
    sent: [] as unknown[],
    failed: [] as unknown[],
    async claimNextScheduledSend() {
      return queue.shift();
    },
    async markScheduledSendSent(input: unknown) {
      this.sent.push(input);
    },
    async markScheduledSendFailed(input: unknown) {
      this.failed.push(input);
    },
  } satisfies ScheduledSendStore & {
    sent: unknown[];
    failed: unknown[];
  };
}

function job(id = "schedule_1"): ScheduledSendJob {
  const draftNumber = id.endsWith("_2") ? "2" : "1";
  return {
    id,
    accountId: "acc_1",
    draftId: `draft_${draftNumber}`,
    engineProvider: "emailengine",
    to: [{ address: "lina@example.com", name: "Lina" }],
    cc: [],
    bcc: [],
    subject: "Launch confirmation",
    bodyText: "Looks good.",
    scheduledAt: "2026-06-13T12:30:00.000Z",
    attempts: 1,
  };
}
