import { describe, expect, it } from "vitest";

import { createHermesAuditLogService } from "../src/hermes/audit-log";

describe("Hermes audit log service", () => {
  it("bounds list limits and forwards precise filters to the store", async () => {
    const calls: unknown[] = [];
    const service = createHermesAuditLogService({
      store: {
        async listAuditEvents(input) {
          calls.push(input);
          return {
            items: [
              {
                id: "audit_1",
                eventType: "hermes.skill.email_search_qa",
                skillRunId: "run_1",
                skillId: "email_search_qa",
                skillTitle: "自然语言查邮件",
                readMessageIds: ["message_1"],
                memoryIds: ["memory_1"],
                action: { skillId: "email_search_qa" },
                input: { accountId: "account_1", question: "合同" },
                output: { answerText: "找到 1 封" },
                createdAt: "2026-06-14T08:00:00.000Z",
              },
            ],
          };
        },
      },
    });

    await expect(
      service.listAuditEvents({
        accountId: " account_1 ",
        skillId: " email_search_qa ",
        messageId: " message_1 ",
        memoryId: " memory_1 ",
        limit: 500,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "audit_1",
          skillId: "email_search_qa",
          readMessageIds: ["message_1"],
          memoryIds: ["memory_1"],
        }),
      ],
    });
    expect(calls).toEqual([
      {
        accountId: "account_1",
        skillId: "email_search_qa",
        messageId: "message_1",
        memoryId: "memory_1",
        limit: 100,
      },
    ]);
  });

  it("rejects malformed list filters before hitting the store", async () => {
    const service = createHermesAuditLogService({
      store: {
        async listAuditEvents() {
          throw new Error("store should not be called");
        },
      },
    });

    await expect(
      service.listAuditEvents({ accountId: "", limit: 25 }),
    ).rejects.toMatchObject({ code: "invalid_hermes_audit_log_request" });
    await expect(
      service.listAuditEvents({ accountId: "account_1", limit: 0 }),
    ).rejects.toMatchObject({ code: "invalid_hermes_audit_log_request" });
  });
});
