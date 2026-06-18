import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../lib/emailHubApi";
import type { HermesRuleCandidateDto, HermesRuleDto } from "../../lib/emailHubApi";
import {
  hermesActionPlanErrorNotice,
  hermesRuleNavigationTarget,
  hermesRulePreview,
  normalizeHermesRuleSortOrders,
} from "./hermesRules";

describe("hermesRules helpers", () => {
  it("maps action-plan API errors to operator-facing notices", () => {
    expect(
      hermesActionPlanErrorNotice(
        new ApiRequestError(403, "hermes_skill_disabled", {
          error: "hermes_skill_disabled",
          skillId: "action_plan",
          requiredPermission: "memory_write",
        }),
        "create",
      ),
    ).toBe(
      "Hermes 执行计划能力缺少记忆写入权限，请到设置 > Hermes 配置 > 能力选项打开“执行计划”的“写入记忆”开关。",
    );

    expect(
      hermesActionPlanErrorNotice(
        new ApiRequestError(403, "hermes_skill_disabled", {
          error: "hermes_skill_disabled",
          skillId: "action_plan",
          requiredPermission: "body_read",
        }),
        "create",
      ),
    ).toBe(
      "Hermes 执行计划能力缺少正文读取权限，请到设置 > Hermes 配置 > 能力选项打开“执行计划”的“读取正文”开关。",
    );

    expect(
      hermesActionPlanErrorNotice(
        new ApiRequestError(503, "hermes_action_plans_unavailable", {
          error: "hermes_action_plans_unavailable",
        }),
        "confirm",
      ),
    ).toBe("Hermes 执行计划存储暂时不可用，请检查后端配置。");
  });

  it("prefers saved views but falls back to provider labels for rule navigation", () => {
    expect(
      hermesRuleNavigationTarget(
        ruleFixture({
          action: {
            type: "apply_label",
            savedView: {
              id: "codes",
              label: "验证码",
              keywords: ["验证码", "otp"],
            },
          },
        }),
      ),
    ).toEqual({ kind: "savedView", id: "codes", label: "验证码" });

    expect(
      hermesRuleNavigationTarget(
        ruleFixture({
          action: {
            type: "apply_label",
            labelId: "label_code",
            labelName: "验证码",
          },
        }),
      ),
    ).toEqual({ kind: "label", id: "label_code", label: "验证码" });
  });

  it("builds dock previews from saved views or label-backed candidates", () => {
    expect(
      hermesRulePreview(
        candidateFixture({
          action: {
            type: "apply_label",
            savedView: {
              id: "codes",
              label: "验证码",
              keywords: ["验证码", "otp"],
            },
          },
        }),
      ),
    ).toEqual({ label: "验证码", keywords: ["验证码", "otp"] });

    expect(
      hermesRulePreview(
        candidateFixture({
          condition: { anyKeywords: ["receipt", "invoice"] },
          action: { type: "apply_label", labelName: "票据" },
        }),
      ),
    ).toEqual({ label: "票据", keywords: ["receipt", "invoice"] });
  });

  it("normalizes missing sort orders and keeps deterministic rule order", () => {
    const sorted = normalizeHermesRuleSortOrders([
      ruleFixture({
        id: "rule_late",
        sortOrder: Number.NaN,
        createdAt: "2026-06-15T10:00:00.000Z",
      }),
      ruleFixture({
        id: "rule_first",
        sortOrder: 100,
        createdAt: "2026-06-13T10:00:00.000Z",
      }),
      ruleFixture({
        id: "rule_second",
        sortOrder: 200,
        createdAt: "2026-06-14T10:00:00.000Z",
      }),
    ]);

    expect(sorted.map((rule) => rule.id)).toEqual([
      "rule_first",
      "rule_second",
      "rule_late",
    ]);
    expect(sorted[2].sortOrder).toBe(1000);
  });
});

function ruleFixture(overrides: Partial<HermesRuleDto> = {}): HermesRuleDto {
  return {
    id: "rule_codes",
    accountId: "account_1",
    candidateId: "candidate_codes",
    title: "启用验证码智能分组",
    ruleType: "content_label",
    condition: { anyKeywords: ["验证码", "otp"] },
    action: {
      type: "apply_label",
      labelId: "label_code",
      labelName: "验证码",
    },
    confidence: 0.9,
    enabled: true,
    sortOrder: 1000,
    createdAt: "2026-06-13T10:02:00.000Z",
    approvedAt: "2026-06-13T10:02:00.000Z",
    ...overrides,
  };
}

function candidateFixture(
  overrides: Partial<HermesRuleCandidateDto> = {},
): HermesRuleCandidateDto {
  return {
    id: "candidate_codes",
    accountId: "account_1",
    title: "启用验证码智能分组",
    ruleType: "content_label",
    condition: { anyKeywords: ["验证码", "otp"] },
    action: {
      type: "apply_label",
      labelName: "验证码",
      requiresConfirmation: true,
    },
    confidence: 0.9,
    status: "shadow",
    evidenceMessageIds: [],
    createdAt: "2026-06-13T10:00:00.000Z",
    ...overrides,
  };
}
