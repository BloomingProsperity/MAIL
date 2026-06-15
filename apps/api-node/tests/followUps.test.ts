import { describe, expect, it } from "vitest";

import {
  createFollowUpService,
  InvalidFollowUpRequestError,
  type FollowUpStore,
} from "../src/follow-ups/follow-ups";

describe("follow-up service", () => {
  it("creates a future reminder from a Hermes follow-up preview", async () => {
    const calls: unknown[] = [];
    const service = createFollowUpService({
      store: createStore({
        async createFollowUp(input) {
          calls.push(input);
          return followUp({
            id: input.id,
            accountId: input.accountId,
            messageId: input.messageId,
            dueAt: input.dueAt,
            kind: input.kind,
            source: input.source,
            hermesSkillRunId: input.hermesSkillRunId,
          });
        },
      }),
      createId: () => "fu_1",
      now: () => new Date("2026-06-13T09:00:00.000Z"),
    });

    const result = await service.createFollowUp({
      accountId: "acc_1",
      messageId: "msg_1",
      dueAt: "2026-06-14T09:00:00.000Z",
      kind: "waiting_on_them",
      title: "Check whether Lina replied",
      note: "From Hermes follow-up suggestion",
      source: "hermes_followup",
      hermesSkillRunId: "run_1",
    });

    expect(calls).toEqual([
      {
        id: "fu_1",
        accountId: "acc_1",
        messageId: "msg_1",
        dueAt: "2026-06-14T09:00:00.000Z",
        kind: "waiting_on_them",
        title: "Check whether Lina replied",
        note: "From Hermes follow-up suggestion",
        source: "hermes_followup",
        hermesSkillRunId: "run_1",
        now: "2026-06-13T09:00:00.000Z",
      },
    ]);
    expect(result).toMatchObject({
      id: "fu_1",
      status: "open",
      kind: "waiting_on_them",
    });
  });

  it("rejects reminders in the past before writing", async () => {
    const service = createFollowUpService({
      store: createStore({
        async createFollowUp() {
          throw new Error("should not be called");
        },
      }),
      createId: () => "fu_1",
      now: () => new Date("2026-06-13T09:00:00.000Z"),
    });

    await expect(
      service.createFollowUp({
        accountId: "acc_1",
        messageId: "msg_1",
        dueAt: "2026-06-13T08:59:59.000Z",
      }),
    ).rejects.toBeInstanceOf(InvalidFollowUpRequestError);
  });

  it("lists open follow-ups with a bounded limit", async () => {
    const calls: unknown[] = [];
    const service = createFollowUpService({
      store: createStore({
        async listFollowUps(input) {
          calls.push(input);
          return [followUp()];
        },
      }),
      createId: () => "unused",
    });

    const result = await service.listFollowUps({
      accountId: "acc_1",
      status: "open",
      limit: 25,
    });

    expect(calls).toEqual([{ accountId: "acc_1", status: "open", limit: 25 }]);
    expect(result).toEqual({
      accountId: "acc_1",
      status: "open",
      items: [followUp()],
    });
  });

  it("updates and cancels existing follow-ups by local id", async () => {
    const calls: unknown[] = [];
    const service = createFollowUpService({
      store: createStore({
        async updateFollowUp(input) {
          calls.push(["update", input]);
          return followUp({ status: "done", completedAt: input.now });
        },
        async cancelFollowUp(input) {
          calls.push(["cancel", input]);
          return followUp({ status: "cancelled", cancelledAt: input.now });
        },
      }),
      createId: () => "unused",
      now: () => new Date("2026-06-14T10:00:00.000Z"),
    });

    await service.updateFollowUp({ id: "fu_1", status: "done", note: "Handled" });
    await service.cancelFollowUp({ id: "fu_1" });

    expect(calls).toEqual([
      [
        "update",
        {
          id: "fu_1",
          status: "done",
          note: "Handled",
          now: "2026-06-14T10:00:00.000Z",
        },
      ],
      ["cancel", { id: "fu_1", now: "2026-06-14T10:00:00.000Z" }],
    ]);
  });
});

function createStore(overrides: Partial<FollowUpStore>): FollowUpStore {
  return {
    async createFollowUp() {
      throw new Error("not used");
    },
    async listFollowUps() {
      throw new Error("not used");
    },
    async updateFollowUp() {
      throw new Error("not used");
    },
    async cancelFollowUp() {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function followUp(overrides = {}) {
  return {
    id: "fu_1",
    accountId: "acc_1",
    messageId: "msg_1",
    kind: "waiting_on_them" as const,
    status: "open" as const,
    dueAt: "2026-06-14T09:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
    source: "hermes_followup" as const,
    hermesSkillRunId: "run_1",
    createdAt: "2026-06-13T09:00:00.000Z",
    updatedAt: "2026-06-13T09:00:00.000Z",
    ...overrides,
  };
}
