import { describe, expect, it } from "vitest";

import {
  createHermesRuleService,
  createInMemoryHermesRuleStore,
} from "../src/hermes/rules";

describe("Hermes rule approval recovery", () => {
  it("disables newly approved rules when saved view upsert fails", async () => {
    const store = createInMemoryHermesRuleStore({
      candidates: [
        {
          id: "candidate_invoices",
          accountId: "account_1",
          title: "创建 Invoices 智能分组",
          ruleType: "content_label",
          condition: { anyKeywords: ["invoice", "receipt"] },
          action: {
            type: "apply_label",
            labelName: "Invoices",
            labelColor: "green",
            providerWriteback: false,
            requiresConfirmation: true,
          },
          confidence: 0.78,
          status: "shadow",
          evidenceMessageIds: [],
          createdAt: "2026-06-13T10:00:00.000Z",
        },
      ],
    });
    const failingStore = {
      ...store,
      async upsertSavedView() {
        throw new Error("saved_view_unavailable");
      },
    };
    const service = createHermesRuleService({
      store: failingStore,
      labelService: {
        async upsertLabel(input) {
          return {
            id: "label_invoices",
            accountId: input.accountId,
            name: input.name,
            color: input.color ?? "blue",
            messageCount: 0,
            createdAt: "2026-06-13T10:09:00.000Z",
          };
        },
      },
      createId: nextId(["rule_invoices"]),
      now: () => "2026-06-13T10:10:00.000Z",
    });

    await expect(
      service.approveRule({
        accountId: "account_1",
        candidateId: "candidate_invoices",
      }),
    ).rejects.toThrow("saved_view_unavailable");
    await expect(
      store.listRules({ accountId: "account_1", enabled: false, limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: "rule_invoices", enabled: false }],
    });
  });
});

function nextId(ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `id_${index}`;
}
