import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  EmailHubApi,
  HermesActionPlanConfirmationDto,
  HermesActionPlanDto,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleExecutionDto,
  HermesRuleSimulationDto,
} from "../../lib/emailHubApi";
import { HermesRuleManagerPanel } from "./HermesRuleManagerPanel";

describe("HermesRuleManagerPanel", () => {
  it("does not query account-scoped Hermes rules without an account", async () => {
    const api = createRuleApiFixture();

    render(<HermesRuleManagerPanel api={api} />);

    expect(
      await screen.findByText("请先添加邮箱并完成同步，再查看 Hermes 规则。"),
    ).toBeTruthy();
    expect(api.listHermesRules).not.toHaveBeenCalled();
    expect(api.listHermesRuleCandidates).not.toHaveBeenCalled();
  });

  it("ignores stale Hermes rule loads after switching accounts", async () => {
    let resolveAccountOneRules:
      | ((value: { items: HermesRuleDto[] }) => void)
      | undefined;
    const api = createRuleApiFixture({
      listHermesRules: vi.fn((input) => {
        if (input.accountId === "account_1") {
          return new Promise((resolve) => {
            resolveAccountOneRules = resolve;
          });
        }

        return Promise.resolve({
          items: [
            ruleFixture({
              id: "rule_account_2",
              accountId: "account_2",
              title: "启用合同智能分组",
            }),
          ],
        });
      }),
      listHermesRuleExecutions: vi.fn(async () => ({ items: [] })),
      listHermesRuleCandidates: vi.fn(async () => ({ items: [] })),
    });

    const { rerender } = render(
      <HermesRuleManagerPanel api={api} accountId="account_1" />,
    );
    await waitFor(() => {
      expect(api.listHermesRules).toHaveBeenCalledWith({
        accountId: "account_1",
        limit: 50,
      });
    });

    rerender(<HermesRuleManagerPanel api={api} accountId="account_2" />);
    const panel = await screen.findByLabelText("Hermes 规则管理");
    expect(await within(panel).findByText("启用合同智能分组")).toBeTruthy();

    await act(async () => {
      resolveAccountOneRules?.({
        items: [
          ruleFixture({
            id: "rule_account_1",
            accountId: "account_1",
            title: "旧账号验证码规则",
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(within(panel).queryByText("旧账号验证码规则")).toBeNull();
    });
    expect(within(panel).getByText("启用合同智能分组")).toBeTruthy();
  });

  it("ignores stale Hermes rule drafts after switching accounts", async () => {
    let resolveAccountOneDraft:
      | ((value: { candidates: HermesRuleCandidateDto[] }) => void)
      | undefined;
    const api = createRuleApiFixture({
      listHermesRules: vi.fn(async (input) => ({
        items: [
          ruleFixture({
            id: `rule_${input.accountId}`,
            accountId: input.accountId,
            title:
              input.accountId === "account_2"
                ? "启用合同智能分组"
                : "启用验证码智能分组",
          }),
        ],
      })),
      draftHermesRule: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAccountOneDraft = resolve;
          }),
      ),
    });

    const { rerender } = render(
      <HermesRuleManagerPanel api={api} accountId="account_1" />,
    );
    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.click(within(panel).getByRole("button", { name: "生成规则草案" }));
    await waitFor(() => {
      expect(api.draftHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        command:
          "帮我创建一个规则，左侧加一个验证码分组，账号里的所有验证码邮件都进这个分组",
      });
    });

    rerender(<HermesRuleManagerPanel api={api} accountId="account_2" />);
    expect(await within(panel).findByText("启用合同智能分组")).toBeTruthy();

    await act(async () => {
      resolveAccountOneDraft?.({
        candidates: [
          candidateFixture({
            id: "candidate_account_1",
            accountId: "account_1",
            title: "旧账号规则草案",
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(within(panel).queryByText("旧账号规则草案")).toBeNull();
    });
    expect(within(panel).getByText("启用合同智能分组")).toBeTruthy();
  });

  it("suggests Hermes rule candidates from recent behavior", async () => {
    const api = createRuleApiFixture({
      suggestHermesRules: vi.fn(async () => ({
        candidates: [
          candidateFixture({
            id: "candidate_client_priority",
            title: "启用客户优先级",
            ruleType: "sender_priority",
            condition: { senderEmail: "client@example.com" },
            action: {
              type: "classify_sender",
              bucket: "P2 Important",
            },
            evidenceMessageIds: ["message_1", "message_2"],
          }),
        ],
      })),
    });

    render(<HermesRuleManagerPanel api={api} accountId="account_1" />);

    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "从最近行为生成候选规则",
      }),
    );

    await waitFor(() => {
      expect(api.suggestHermesRules).toHaveBeenCalledWith({
        accountId: "account_1",
        behaviorWindowDays: 30,
        minEvidenceCount: 2,
      });
    });
    expect(await within(panel).findByText("启用客户优先级")).toBeTruthy();
    expect(
      within(panel).queryByLabelText("Hermes rule label 启用客户优先级"),
    ).toBeNull();
    expect(
      within(panel).queryByLabelText("Hermes rule keywords 启用客户优先级"),
    ).toBeNull();
    expect(
      within(panel).queryByRole("button", {
        name: "Save Hermes rule candidate 启用客户优先级",
      }),
    ).toBeNull();
    expect(
      within(panel).getByRole("button", {
        name: "Simulate Hermes rule 启用客户优先级",
      }),
    ).toBeTruthy();
    expect(
      within(panel).getByText(
        "Hermes 已生成 1 条行为候选规则，请先模拟再确认。",
      ),
    ).toBeTruthy();
  });

  it("runs and reorders approved Hermes rules", async () => {
    const api = createRuleApiFixture({
      listHermesRules: vi.fn(async () => ({
        items: [
          ruleFixture({ id: "rule_codes", title: "启用验证码智能分组", sortOrder: 1000 }),
          ruleFixture({
            id: "rule_receipts",
            title: "启用票据智能分组",
            sortOrder: 2000,
          }),
        ],
      })),
      listHermesRuleExecutions: vi.fn(async () => ({
        items: [
          executionFixture({ ruleId: "rule_codes", matchedCount: 8, appliedCount: 3 }),
        ],
      })),
    });

    render(<HermesRuleManagerPanel api={api} accountId="account_1" />);

    const panel = await screen.findByLabelText("Hermes 规则管理");
    expect(await within(panel).findByText(/最近运行：命中 8 封，新增 3 个标签关联/)).toBeTruthy();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Run Hermes rule 启用验证码智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.runHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        ruleId: "rule_codes",
        limit: 5000,
      });
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Move Hermes rule up 启用票据智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.updateHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        ruleId: "rule_receipts",
        sortOrder: 1000,
      });
      expect(api.updateHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        ruleId: "rule_codes",
        sortOrder: 2000,
      });
    });
  });

  it("drafts, simulates, and confirms a Hermes rule action plan", async () => {
    const api = createRuleApiFixture();
    const onRuleApproved = vi.fn();

    render(
      <HermesRuleManagerPanel
        api={api}
        accountId="account_1"
        onRuleApproved={onRuleApproved}
      />,
    );

    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.change(within(panel).getByLabelText("Hermes rule command"), {
      target: { value: "帮我创建一个验证码分组规则" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "生成规则草案" }));

    await waitFor(() => {
      expect(api.draftHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        command: "帮我创建一个验证码分组规则",
      });
    });
    expect(within(panel).getByText(/关键词 验证码、verification、otp/)).toBeTruthy();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Simulate Hermes rule 启用验证码智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.simulateHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 25,
      });
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Confirm Hermes action plan 启用验证码智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.createHermesActionPlan).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 25,
      });
      expect(api.confirmHermesActionPlan).toHaveBeenCalledWith({
        planId: "plan_1",
        accountId: "account_1",
        candidateId: "candidate_codes",
      });
      expect(onRuleApproved).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rule_codes" }),
      );
    });
    await waitFor(() => {
      expect(
        within(panel).queryByRole("button", {
          name: "Confirm Hermes action plan 启用验证码智能分组",
        }),
      ).toBeNull();
    });
    expect(
      within(panel).queryByRole("button", {
        name: "Dismiss Hermes rule candidate 启用验证码智能分组",
      }),
    ).toBeNull();
    expect(
      within(panel).queryByLabelText("Hermes rule label 启用验证码智能分组"),
    ).toBeNull();
  });

  it("ignores stale Hermes action-plan confirmation after switching accounts", async () => {
    let resolveAccountOnePlan:
      | ((value: HermesActionPlanDto) => void)
      | undefined;
    const onRuleApproved = vi.fn();
    const api = createRuleApiFixture({
      createHermesActionPlan: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAccountOnePlan = resolve;
          }),
      ),
    });

    const { rerender } = render(
      <HermesRuleManagerPanel
        api={api}
        accountId="account_1"
        onRuleApproved={onRuleApproved}
      />,
    );
    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.click(within(panel).getByRole("button", { name: "生成规则草案" }));
    expect(await within(panel).findByText(/确认前必须先试运行/)).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Simulate Hermes rule 启用验证码智能分组",
      }),
    );
    expect(await within(panel).findByText(/试运行：命中 4 封邮件/)).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Confirm Hermes action plan 启用验证码智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.createHermesActionPlan).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 25,
      });
    });

    rerender(<HermesRuleManagerPanel api={api} accountId="account_2" />);
    await act(async () => {
      resolveAccountOnePlan?.(actionPlanFixture());
    });

    await waitFor(() => {
      expect(api.confirmHermesActionPlan).not.toHaveBeenCalled();
    });
    expect(onRuleApproved).not.toHaveBeenCalled();
    expect(
      within(panel).queryByText(/Hermes 执行计划已完成：启用验证码智能分组/),
    ).toBeNull();
  });

  it("requires a fresh simulation after editing a rule candidate", async () => {
    const api = createRuleApiFixture();

    render(<HermesRuleManagerPanel api={api} accountId="account_1" />);

    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.click(within(panel).getByRole("button", { name: "生成规则草案" }));
    expect(await within(panel).findByText(/确认前必须先试运行/)).toBeTruthy();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Simulate Hermes rule 启用验证码智能分组",
      }),
    );
    expect(await within(panel).findByText(/试运行：命中 4 封邮件/)).toBeTruthy();

    fireEvent.change(
      within(panel).getByLabelText("Hermes rule label 启用验证码智能分组"),
      {
        target: { value: "票据" },
      },
    );
    fireEvent.change(
      within(panel).getByLabelText("Hermes rule keywords 启用验证码智能分组"),
      {
        target: { value: "receipt, invoice, 发票" },
      },
    );
    fireEvent.click(
      within(panel).getByLabelText(
        "Apply Hermes rule to history 启用验证码智能分组",
      ),
    );
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Save Hermes rule candidate 启用验证码智能分组",
      }),
    );

    await waitFor(() => {
      expect(api.updateHermesRuleCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        labelName: "票据",
        keywords: ["receipt", "invoice", "发票"],
        applyToHistory: true,
      });
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Confirm Hermes action plan 创建票据智能分组",
      }),
    );
    expect(
      await within(panel).findByText("请先试运行，再确认启用规则。"),
    ).toBeTruthy();
    expect(api.createHermesActionPlan).not.toHaveBeenCalled();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Simulate Hermes rule 创建票据智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.simulateHermesRule).toHaveBeenLastCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 25,
      });
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Confirm Hermes action plan 创建票据智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.createHermesActionPlan).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 25,
      });
    });
  });

  it("requires saving rule candidate edits before simulation", async () => {
    const api = createRuleApiFixture();

    render(<HermesRuleManagerPanel api={api} accountId="account_1" />);

    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.click(within(panel).getByRole("button", { name: "生成规则草案" }));
    expect(await within(panel).findByText(/确认前必须先试运行/)).toBeTruthy();

    const simulateButton = within(panel).getByRole("button", {
      name: "Simulate Hermes rule 启用验证码智能分组",
    }) as HTMLButtonElement;
    const confirmButton = within(panel).getByRole("button", {
      name: "Confirm Hermes action plan 启用验证码智能分组",
    }) as HTMLButtonElement;
    const saveButton = within(panel).getByRole("button", {
      name: "Save Hermes rule candidate 启用验证码智能分组",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(simulateButton.disabled).toBe(false);
    expect(confirmButton.disabled).toBe(false);

    fireEvent.change(
      within(panel).getByLabelText("Hermes rule label 启用验证码智能分组"),
      {
        target: { value: "票据" },
      },
    );

    expect(
      await within(panel).findByText("草案有未保存修改，请先保存后再模拟/确认。"),
    ).toBeTruthy();
    expect(saveButton.disabled).toBe(false);
    expect(simulateButton.disabled).toBe(true);
    expect(confirmButton.disabled).toBe(true);
    fireEvent.click(simulateButton);
    expect(api.simulateHermesRule).not.toHaveBeenCalled();

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(api.updateHermesRuleCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        labelName: "票据",
        keywords: ["验证码", "verification", "otp"],
        applyToHistory: false,
      });
    });

    expect(
      within(panel).queryByText("草案有未保存修改，请先保存后再模拟/确认。"),
    ).toBeNull();
    expect(
      (
        within(panel).getByRole("button", {
          name: "Save Hermes rule candidate 创建票据智能分组",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Simulate Hermes rule 创建票据智能分组",
      }),
    );
    await waitFor(() => {
      expect(api.simulateHermesRule).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
        sampleLimit: 25,
      });
    });
  });

  it("dismisses a shadow Hermes rule candidate from the workbench", async () => {
    const api = createRuleApiFixture();

    render(<HermesRuleManagerPanel api={api} accountId="account_1" />);

    const panel = await screen.findByLabelText("Hermes 规则管理");
    fireEvent.click(within(panel).getByRole("button", { name: "生成规则草案" }));
    const dismissButton = await within(panel).findByRole("button", {
      name: "Dismiss Hermes rule candidate 启用验证码智能分组",
    });

    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(api.dismissHermesRuleCandidate).toHaveBeenCalledWith({
        accountId: "account_1",
        candidateId: "candidate_codes",
      });
    });
    expect(
      await within(panel).findByText(
        "Hermes 规则草案已驳回：启用验证码智能分组。",
      ),
    ).toBeTruthy();
    expect(
      within(panel).queryByRole("button", {
        name: "Dismiss Hermes rule candidate 启用验证码智能分组",
      }),
    ).toBeNull();
  });
});

function createRuleApiFixture(
  overrides: Partial<{
    listHermesRules: ReturnType<typeof vi.fn>;
    listHermesRuleExecutions: ReturnType<typeof vi.fn>;
    listHermesRuleCandidates: ReturnType<typeof vi.fn>;
    updateHermesRule: ReturnType<typeof vi.fn>;
    runHermesRule: ReturnType<typeof vi.fn>;
    draftHermesRule: ReturnType<typeof vi.fn>;
    suggestHermesRules: ReturnType<typeof vi.fn>;
    simulateHermesRule: ReturnType<typeof vi.fn>;
    updateHermesRuleCandidate: ReturnType<typeof vi.fn>;
    dismissHermesRuleCandidate: ReturnType<typeof vi.fn>;
    createHermesActionPlan: ReturnType<typeof vi.fn>;
    confirmHermesActionPlan: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const api = {
    listHermesRules: vi.fn(async () => ({ items: [ruleFixture()] })),
    listHermesRuleExecutions: vi.fn(async () => ({ items: [] })),
    listHermesRuleCandidates: vi.fn(async () => ({ items: [] })),
    updateHermesRule: vi.fn(async (input) =>
      ruleFixture({
        id: input.ruleId,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 1000,
      }),
    ),
    runHermesRule: vi.fn(async (input) =>
      executionFixture({
        ruleId: input.ruleId,
        matchedCount: 7,
        appliedCount: 3,
      }),
    ),
    draftHermesRule: vi.fn(async () => ({
      candidates: [candidateFixture()],
    })),
    suggestHermesRules: vi.fn(async () => ({
      candidates: [candidateFixture()],
    })),
    simulateHermesRule: vi.fn(async (input) =>
      simulationFixture({ candidateId: input.candidateId }),
    ),
    updateHermesRuleCandidate: vi.fn(async (input) =>
      candidateFixture({
        id: input.candidateId,
        title: `创建${input.labelName ?? "验证码"}智能分组`,
        condition: {
          anyKeywords: input.keywords ?? ["验证码", "verification", "otp"],
        },
        action: {
          type: "apply_label",
          labelName: input.labelName ?? "验证码",
          labelColor: "blue",
          providerWriteback: false,
          applyToHistory: input.applyToHistory ?? false,
          requiresConfirmation: true,
        },
      }),
    ),
    dismissHermesRuleCandidate: vi.fn(async (input) =>
      candidateFixture({ id: input.candidateId, status: "dismissed" }),
    ),
    createHermesActionPlan: vi.fn(async () => actionPlanFixture()),
    confirmHermesActionPlan: vi.fn(async () => confirmationFixture()),
    ...overrides,
  };
  return api as typeof api & EmailHubApi;
}

function ruleFixture(overrides: Partial<HermesRuleDto> = {}): HermesRuleDto {
  return {
    id: "rule_codes",
    accountId: "account_1",
    candidateId: "candidate_codes",
    title: "启用验证码智能分组",
    ruleType: "content_label",
    condition: { anyKeywords: ["验证码", "verification", "otp"] },
    action: {
      type: "apply_label",
      labelId: "label_code",
      labelName: "验证码",
      labelColor: "blue",
      providerWriteback: false,
      requiresConfirmation: false,
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
    condition: { anyKeywords: ["验证码", "verification", "otp"] },
    action: {
      type: "apply_label",
      labelName: "验证码",
      labelColor: "blue",
      providerWriteback: false,
      applyToHistory: false,
      requiresConfirmation: true,
    },
    confidence: 0.9,
    status: "shadow",
    evidenceMessageIds: [],
    createdAt: "2026-06-13T10:00:00.000Z",
    ...overrides,
  };
}

function executionFixture(
  overrides: Partial<HermesRuleExecutionDto> = {},
): HermesRuleExecutionDto {
  return {
    id: "run_active_1",
    accountId: "account_1",
    ruleId: "rule_codes",
    mode: "active",
    matchedCount: 4,
    appliedCount: 2,
    sampleMessageIds: ["message_1", "message_2"],
    actionPreview: { type: "apply_label", labelName: "验证码" },
    createdAt: "2026-06-13T10:30:00.000Z",
    ...overrides,
  };
}

function simulationFixture(
  overrides: Partial<HermesRuleSimulationDto> = {},
): HermesRuleSimulationDto {
  return {
    id: "run_rule_1",
    accountId: "account_1",
    candidateId: "candidate_codes",
    mode: "shadow",
    matchedCount: 4,
    sampleMessageIds: ["message_1", "message_2"],
    actionPreview: { type: "apply_label", labelName: "验证码" },
    createdAt: "2026-06-13T10:01:00.000Z",
    ...overrides,
  };
}

function actionPlanFixture(): HermesActionPlanDto {
  const candidate = candidateFixture();
  return {
    id: "plan_1",
    auditEventId: "audit_plan_1",
    accountId: "account_1",
    command: "帮我创建一个验证码分组规则",
    intent: "create_mailbox_rule",
    status: "requires_confirmation",
    createdAt: "2026-06-13T10:00:00.000Z",
    candidate,
    simulation: simulationFixture(),
    workspace: {
      accountCount: 1,
      selectedAccountId: "account_1",
      provider: "gmail",
      quickCategoryCount: 2,
      labelCount: 1,
      ruleCount: 1,
      pendingRuleCandidateCount: 0,
      unavailableModules: [],
    },
    safety: {
      requiresUserConfirmation: true,
      providerWriteback: false,
      appliesToHistory: true,
      destructive: false,
    },
    steps: [],
  };
}

function confirmationFixture(): HermesActionPlanConfirmationDto {
  return {
    id: "confirmation_1",
    auditEventId: "audit_confirm_1",
    planId: "plan_1",
    accountId: "account_1",
    candidateId: "candidate_codes",
    status: "completed",
    confirmedAt: "2026-06-13T10:02:00.000Z",
    rule: ruleFixture(),
    historyBackfill: {
      accountId: "account_1",
      ruleId: "rule_codes",
      matchedCount: 4,
      appliedCount: 4,
      sampleMessageIds: ["message_1", "message_2"],
    },
    safety: {
      requiresUserConfirmation: false,
      providerWriteback: false,
      appliesToHistory: true,
      destructive: false,
    },
    steps: [],
  };
}
