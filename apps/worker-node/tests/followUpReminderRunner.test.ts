import { describe, expect, it } from "vitest";

import {
  runFollowUpReminderBatch,
  runFollowUpReminderOnce,
  type FollowUpReminderJob,
  type FollowUpReminderStore,
} from "../src/follow-up-reminder-runner";

describe("follow-up reminder runner", () => {
  it("promotes a claimed due follow-up into Needs Action", async () => {
    const store = createStore([job()]);

    const result = await runFollowUpReminderOnce({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
    });

    expect(result).toEqual({
      status: "processed",
      followUpId: "fu_1",
      messageId: "msg_1",
    });
    expect(store.promoted).toEqual([
      {
        followUpId: "fu_1",
        messageId: "msg_1",
        now: new Date("2026-06-13T12:30:00.000Z"),
      },
    ]);
  });

  it("claims up to concurrency due follow-ups", async () => {
    const store = createStore([job("fu_1", "msg_1"), job("fu_2", "msg_2")]);

    const results = await runFollowUpReminderBatch({
      store,
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      concurrency: 2,
    });

    expect(results).toEqual([
      { status: "processed", followUpId: "fu_1", messageId: "msg_1" },
      { status: "processed", followUpId: "fu_2", messageId: "msg_2" },
    ]);
    expect(store.promoted).toHaveLength(2);
  });

  it("returns idle when no follow-ups are due", async () => {
    const result = await runFollowUpReminderBatch({
      store: createStore([]),
      workerId: "worker-a",
      now: new Date("2026-06-13T12:30:00.000Z"),
      leaseSeconds: 30,
      concurrency: 4,
    });

    expect(result).toEqual([{ status: "idle" }]);
  });
});

function createStore(jobs: FollowUpReminderJob[]) {
  const queue = [...jobs];
  return {
    promoted: [] as unknown[],
    async claimNextDueFollowUp() {
      return queue.shift();
    },
    async promoteDueFollowUp(input: unknown) {
      this.promoted.push(input);
    },
  } satisfies FollowUpReminderStore & {
    promoted: unknown[];
  };
}

function job(id = "fu_1", messageId = "msg_1"): FollowUpReminderJob {
  return {
    id,
    accountId: "acc_1",
    messageId,
    kind: "waiting_on_them",
    dueAt: "2026-06-13T12:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
  };
}
