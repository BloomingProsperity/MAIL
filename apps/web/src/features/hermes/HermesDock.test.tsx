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
  it("shows mail organization progress without raw run, audit, or internal labels", () => {
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
    expect(within(dock).getByText("2 个邮箱")).toBeTruthy();
    expect(within(dock).getByLabelText("Hermes 整理建议")).toBeTruthy();
    expect(within(dock).getByText(/影响预览：命中 4 封邮件/)).toBeTruthy();
    expect(
      within(dock).queryByText(
        /audit_plan_1|EmailEngine ready|邮件同步服务|执行计划|执行步骤|安全边界|用户习惯学习|规则需确认/,
      ),
    ).toBeNull();
  });

  it("keeps degraded sync status out of the ordinary dock", () => {
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
    expect(within(dock).getByText("2 个邮箱")).toBeTruthy();
    expect(within(dock).queryByText(/邮件同步服务|EmailEngine degraded/)).toBeNull();
  });

  it("opens into a dedicated bottom panel body", () => {
    render(
      <HermesDock
        {...dockHandlers()}
        prompt=""
        workspaceContext={workspaceContextFixture("ready")}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));

    const dock = screen.getByLabelText("Hermes 底部输入");
    const body = within(dock).getByLabelText("Hermes 内容");
    expect(body.className).toBe("dock-body");
    expect(within(body).getByLabelText("Hermes 邮箱信息")).toBeTruthy();
    expect(within(body).getByLabelText("Hermes 快捷问题")).toBeTruthy();
    expect(within(body).getByText("总结今天最重要的邮件")).toBeTruthy();
  });

  it("runs a suggested prompt from the expanded dock", () => {
    const handlers = dockHandlers();

    render(
      <HermesDock
        {...handlers}
        prompt=""
        workspaceContext={workspaceContextFixture("ready")}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.click(screen.getByRole("button", { name: "找最近收到的验证码" }));

    expect(handlers.onPromptChange).toHaveBeenCalledWith("找最近收到的验证码");
    expect(handlers.onSubmit).toHaveBeenCalledWith("找最近收到的验证码");
  });

  it("routes a dock recovery action", () => {
    const onNoticeAction = vi.fn();

    render(
      <HermesDock
        {...dockHandlers()}
        prompt=""
        notice="Hermes 尚未配置模型接口。"
        noticeActionLabel="设置 Hermes"
        onNoticeAction={onNoticeAction}
        busy={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes" }));
    fireEvent.click(screen.getByRole("button", { name: "设置 Hermes" }));

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
    accounts: [
      {
        accountId: "account_1",
        email: "lina@example.com",
        provider: "gmail",
        authMethod: "oauth",
        displayName: "Lina",
        syncState: "connected",
      },
      {
        accountId: "account_2",
        email: "ops@example.com",
        provider: "outlook",
        authMethod: "oauth",
        displayName: "Ops",
        syncState: "connected",
      },
    ],
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
