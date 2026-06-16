import { describe, expect, it } from "vitest";

import {
  createHermesWorkspaceContextService,
  type HermesWorkspaceMailEngineContext,
} from "../src/hermes/workspace-context";
import { getHermesSkill } from "../src/hermes/skills";
import type { SyncCenterAccount } from "../src/sync-center/sync-center-store";

describe("Hermes workspace context service", () => {
  it("aggregates mailbox environment, rules, skills, and operation boundaries", async () => {
    const calls: unknown[] = [];
    const mailEngine: HermesWorkspaceMailEngineContext = {
      provider: "emailengine",
      ok: false,
      missing: ["EENGINE_PREPARED_TOKEN"],
      warnings: ["EENGINE_PREPARED_TOKEN_MISSING"],
      readiness: {
        status: "degraded",
        summary: "EmailEngine 配置未完全就绪。",
      },
      capabilities: {
        imapSmtpOnboarding: true,
        attachmentDownload: true,
        send: true,
      },
    };
    const service = createHermesWorkspaceContextService({
      syncCenterStore: {
        async listAccounts() {
          calls.push(["accounts"]);
          return {
            items: [
              account("account_1", "lina@example.com", "gmail"),
              account("account_2", "ops@example.com", "imap_smtp"),
            ],
          };
        },
      },
      mailNavigationService: {
        async getSummary() {
          calls.push(["navigation"]);
          return {
            providerGroups: [{ id: "gmail", label: "Gmail", count: 1 }],
            quickCategories: [{ id: "codes", label: "验证码", tone: "blue", count: 4 }],
          };
        },
      },
      labelService: {
        async listLabels(input) {
          calls.push(["labels", input]);
          return {
            items: [
              {
                id: "label_codes",
                accountId: input.accountId,
                name: "验证码",
                color: "blue",
                messageCount: 4,
                createdAt: "2026-06-16T00:00:00.000Z",
              },
            ],
          };
        },
      },
      hermesRuleService: {
        async listRules(input) {
          calls.push(["rules", input]);
          return {
            items: [
              {
                id: "rule_codes",
                accountId: input.accountId,
                candidateId: "candidate_codes",
                title: "启用验证码智能分组",
                ruleType: "content_label",
                condition: { anyKeywords: ["验证码", "otp"] },
                action: {
                  type: "apply_label",
                  labelId: "label_codes",
                  requiresConfirmation: false,
                },
                confidence: 0.9,
                enabled: true,
                createdAt: "2026-06-16T00:00:00.000Z",
                approvedAt: "2026-06-16T00:00:00.000Z",
              },
            ],
          };
        },
        async listRuleCandidates(input) {
          calls.push(["candidates", input]);
          return {
            items: [
              {
                id: "candidate_receipts",
                accountId: input.accountId,
                title: "创建发票智能分组",
                ruleType: "content_label",
                condition: { anyKeywords: ["invoice", "receipt"] },
                action: { type: "apply_label", requiresConfirmation: true },
                confidence: 0.72,
                status: "shadow",
                evidenceMessageIds: [],
                createdAt: "2026-06-16T00:00:00.000Z",
              },
            ],
          };
        },
      },
      getMailEngineContext: async () => mailEngine,
      getSkills: () => [
        hermesSkill("translate_text"),
        hermesSkill("rule_suggest"),
      ],
      now: () => "2026-06-16T01:00:00.000Z",
    });

    const context = await service.getContext({
      accountId: "account_2",
      ruleLimit: 10,
      labelLimit: 20,
    });

    expect(context).toMatchObject({
      generatedAt: "2026-06-16T01:00:00.000Z",
      accountScope: {
        requestedAccountId: "account_2",
        availableAccountIds: ["account_1", "account_2"],
        selectedAccount: { accountId: "account_2", provider: "imap_smtp" },
      },
      labels: [{ id: "label_codes", name: "验证码" }],
      rules: [{ id: "rule_codes", ruleType: "content_label" }],
      pendingRuleCandidates: [{ id: "candidate_receipts", status: "shadow" }],
      mailEngine,
      unavailableModules: [],
    });
    expect(context.skills.map((skill) => skill.id)).toEqual([
      "translate_text",
      "rule_suggest",
    ]);
    expect(context.operationBoundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "create_mailbox_rule",
          mode: "confirmation_required",
        }),
        expect.objectContaining({
          id: "draft_reply",
          mode: "draft_only",
        }),
      ]),
    );
    expect(calls).toEqual([
      ["accounts"],
      ["navigation"],
      ["labels", { accountId: "account_2" }],
      ["rules", { accountId: "account_2", enabled: true, limit: 10 }],
      [
        "candidates",
        { accountId: "account_2", status: "shadow", limit: 10 },
      ],
    ]);
  });

  it("degrades cleanly when optional mailbox modules are unavailable", async () => {
    const service = createHermesWorkspaceContextService({
      getSkills: () => [],
      now: () => "2026-06-16T01:00:00.000Z",
    });

    const context = await service.getContext({});

    expect(context.accounts).toEqual([]);
    expect(context.labels).toEqual([]);
    expect(context.rules).toEqual([]);
    expect(context.pendingRuleCandidates).toEqual([]);
    expect(context.unavailableModules).toEqual([
      "labels_account_scope",
      "mail_engine_readiness",
      "mail_navigation",
      "rule_candidates_account_scope",
      "rules_account_scope",
      "sync_center",
    ]);
    expect(
      context.operationBoundaries.find((item) => item.id === "create_mailbox_rule"),
    ).toMatchObject({
      mode: "confirmation_required",
      description: expect.stringContaining("规则服务未启用"),
    });
  });

  it("returns partial context when configured readers fail", async () => {
    const service = createHermesWorkspaceContextService({
      syncCenterStore: {
        async listAccounts() {
          return {
            items: [account("account_1", "lina@example.com", "gmail")],
          };
        },
      },
      mailNavigationService: {
        async getSummary() {
          throw new Error("navigation offline");
        },
      },
      labelService: {
        async listLabels() {
          throw new Error("labels offline");
        },
      },
      hermesRuleService: {
        async listRules() {
          throw new Error("rules offline");
        },
        async listRuleCandidates() {
          throw new Error("candidates offline");
        },
      },
      getMailEngineContext: async () => {
        throw new Error("health offline");
      },
      getSkills: () => [hermesSkill("translate_text")],
      now: () => "2026-06-16T01:00:00.000Z",
    });

    const context = await service.getContext({ accountId: "account_1" });

    expect(context.accounts).toHaveLength(1);
    expect(context.labels).toEqual([]);
    expect(context.rules).toEqual([]);
    expect(context.pendingRuleCandidates).toEqual([]);
    expect(context.skills.map((skill) => skill.id)).toEqual(["translate_text"]);
    expect(context.unavailableModules).toEqual([
      "hermes_rule_candidates",
      "hermes_rules",
      "labels",
      "mail_engine_readiness",
      "mail_navigation",
    ]);
  });
});

function account(
  accountId: string,
  email: string,
  provider: string,
): SyncCenterAccount {
  return {
    accountId,
    email,
    provider,
    authMethod: "oauth",
    syncState: "syncing",
    engineProvider: "emailengine",
    reauthRequired: false,
    nextAction: "none",
    accountUpdatedAt: "2026-06-16T00:00:00.000Z",
  };
}

function hermesSkill(skillId: string) {
  const skill = getHermesSkill(skillId);
  if (!skill) {
    throw new Error(`missing Hermes skill fixture: ${skillId}`);
  }
  return skill;
}
