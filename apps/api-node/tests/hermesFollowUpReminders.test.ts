import { describe, expect, it } from "vitest";

import {
  createHermesFollowUpReminderService,
  InvalidHermesFollowUpReminderRequestError,
} from "../src/hermes/followup-reminders";
import type { FollowUpService } from "../src/follow-ups/follow-ups";

describe("Hermes follow-up reminder confirmation", () => {
  it("creates a durable follow-up reminder from an approved Hermes suggestion", async () => {
    const calls: unknown[] = [];
    const service = createHermesFollowUpReminderService({
      followUpService: createFollowUpService({
        async createFollowUp(input) {
          calls.push(input);
          return {
            id: "fu_1",
            accountId: input.accountId,
            messageId: input.messageId,
            kind: input.kind ?? "manual",
            status: "open",
            dueAt: input.dueAt,
            title: input.title,
            note: input.note,
            source: "hermes_followup",
            hermesSkillRunId: input.hermesSkillRunId,
            createdAt: "2026-06-13T09:00:00.000Z",
            updatedAt: "2026-06-13T09:00:00.000Z",
          };
        },
      }),
    });

    const result = await service.confirmFollowUpSuggestion({
      accountId: "acc_1",
      messageId: "msg_1",
      skillRunId: "run_followup_1",
      status: "waiting_on_them",
      dueAt: "2026-06-14T09:00:00.000Z",
      nextAction: "Check whether Lina replied",
      reasons: ["we asked for confirmation and no reply yet"],
      sourceQuote: "Please confirm the launch schedule.",
    });

    expect(calls).toEqual([
      {
        accountId: "acc_1",
        messageId: "msg_1",
        dueAt: "2026-06-14T09:00:00.000Z",
        kind: "waiting_on_them",
        title: "Check whether Lina replied",
        note:
          "Hermes suggested this follow-up.\nReasons: we asked for confirmation and no reply yet\nSource: Please confirm the launch schedule.",
        source: "hermes_followup",
        hermesSkillRunId: "run_followup_1",
      },
    ]);
    expect(result).toMatchObject({
      id: "fu_1",
      source: "hermes_followup",
      hermesSkillRunId: "run_followup_1",
    });
  });

  it("rejects no-follow-up suggestions before creating reminders", async () => {
    const service = createHermesFollowUpReminderService({
      followUpService: createFollowUpService({
        async createFollowUp() {
          throw new Error("should not be called");
        },
      }),
    });

    await expect(
      service.confirmFollowUpSuggestion({
        accountId: "acc_1",
        messageId: "msg_1",
        skillRunId: "run_followup_1",
        status: "no_followup",
        dueAt: "2026-06-14T09:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(InvalidHermesFollowUpReminderRequestError);
  });
});

function createFollowUpService(
  overrides: Partial<FollowUpService>,
): FollowUpService {
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
