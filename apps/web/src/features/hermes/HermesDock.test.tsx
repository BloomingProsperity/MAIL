import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HermesActionPlanDto,
  HermesRuleCandidateDto,
  HermesRuleSimulationDto,
  HermesWorkspaceContextDto,
} from "../../lib/emailHubApi";
import { HermesDock } from "./HermesDock";

afterEach(() => {
  cleanup();
});

describe("HermesDock", () => {
  it("shows action-plan progress without raw run or audit identifiers", () => {
    render(
      <HermesDock
        {...dockHandlers()}
        prompt="整理验证码"
        actionPlan={actionPlanFixture()}
        ruleCandidate={ruleCandidateFixture()}
        ruleSimulation={ruleSimulationFixture()}
        workspaceContext={workspaceContextFixture("ready")}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));

    const dock = screen.getByLabelText("Hermes 底部输入");
    expect(within(dock).getByText("邮件同步服务正常")).toBeTruthy();
    expect(within(dock).getByText(/影响预览：命中 4 封邮件/)).toBeTruthy();
    expect(within(dock).queryByText(/audit_plan_1|EmailEngine ready/)).toBeNull();
  });

  it("keeps degraded sync status user-facing", () => {
    render(
      <HermesDock
        {...dockHandlers()}
        prompt=""
        workspaceContext={workspaceContextFixture("degraded")}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));

    const dock = screen.getByLabelText("Hermes 底部输入");
    expect(within(dock).getByText("邮件同步服务需检查")).toBeTruthy();
    expect(within(dock).queryByText(/EmailEngine degraded/)).toBeNull();
  });

  it("routes a dock recovery action", () => {
    const onNoticeAction = vi.fn();

    render(
      <HermesDock
        {...dockHandlers()}
        prompt=""
        notice="Hermes 尚未配置模型接口。"
        noticeActionLabel="打开 Hermes 配置"
        onNoticeAction={onNoticeAction}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes 配置" }));

    expect(onNoticeAction).toHaveBeenCalledTimes(1);
  });
});

function dockHandlers() {
  return {
    formatDate: (value: string) => value,
    onPromptChange: vi.fn(),
    onOpen: vi.fn(),
    onSubmit: vi.fn(),
    onApproveRule: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenHermesSkillSettings: vi.fn(),
  };
}

function ruleCandidateFixture(): HermesRuleCandidateDto {
  return {
    id: "candidate_codes",
    accountId: "account_1",
    title: "启用验证码智能分组",
    ruleType: "content_label",
    condition: { anyKeywords: ["验证码", "verification", "otp"] },
    action: {
      type: "apply_label",
      labelName: "验证码",
      providerWriteback: false,
      applyToHistory: true,
    },
    confidence: 0.9,
    status: "shadow",
    evidenceMessageIds: [],
    createdAt: "2026-06-15T08:00:00.000Z",
  };
}

function ruleSimulationFixture(): HermesRuleSimulationDto {
  return {
    id: "simulation_1",
    accountId: "account_1",
    candidateId: "candidate_codes",
    mode: "shadow",
    matchedCount: 4,
    sampleMessageIds: ["message_1"],
    actionPreview: {},
    createdAt: "2026-06-15T08:01:00.000Z",
  };
}

function actionPlanFixture(): HermesActionPlanDto {
  return {
    id: "plan_1",
    auditEventId: "audit_plan_1",
    accountId: "account_1",
    command: "整理验证码",
    intent: "create_mailbox_rule",
    status: "requires_confirmation",
    createdAt: "2026-06-15T08:02:00.000Z",
    candidate: ruleCandidateFixture(),
    simulation: ruleSimulationFixture(),
    workspace: {
      accountCount: 1,
      selectedAccountId: "account_1",
      provider: "gmail",
      quickCategoryCount: 1,
      labelCount: 1,
      ruleCount: 0,
      pendingRuleCandidateCount: 1,
      unavailableModules: [],
    },
    safety: {
      requiresUserConfirmation: true,
      providerWriteback: false,
      appliesToHistory: true,
      destructive: false,
    },
    steps: [
      {
        id: "simulate",
        title: "试运行",
        mode: "shadow_simulation",
        status: "completed",
        detail: "命中 4 封邮件",
      },
    ],
  };
}

function workspaceContextFixture(
  status: "ready" | "degraded",
): HermesWorkspaceContextDto {
  return {
    generatedAt: "2026-06-15T08:03:00.000Z",
    accountScope: {
      requestedAccountId: "account_1",
      availableAccountIds: ["account_1"],
    },
    accounts: [],
    labels: [],
    rules: [],
    pendingRuleCandidates: [],
    skills: [],
    mailEngine: {
      provider: "emailengine",
      ok: status === "ready",
      missing: [],
      warnings: [],
      readiness: {
        status,
        summary: status,
      },
      capabilities: {
        imapSmtpOnboarding: true,
        attachmentDownload: true,
        send: true,
      },
    },
    operationBoundaries: [
      {
        id: "confirm",
        title: "需要确认",
        mode: "confirmation_required",
        description: "写入邮箱前需要确认",
      },
    ],
    unavailableModules: [],
  };
}
