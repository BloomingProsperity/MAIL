import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HermesMessageOrganizationResult,
  HermesMessageSummaryResult,
} from "../../lib/emailHubApi";
import {
  HermesReaderOrganizationPanel,
  HermesReaderSummaryPanel,
  formatHermesActionItemNote,
  hermesActionItemApplyId,
  hermesOrganizationApplyActions,
} from "./HermesReaderOrganizationPanels";

afterEach(() => {
  cleanup();
});

describe("Hermes reader organization panels", () => {
  it("renders summary text from Hermes", () => {
    render(<HermesReaderSummaryPanel summary={summaryFixture()} />);

    expect(screen.getByText("需要确认发布时间，并在今天回复 Lina。")).toBeTruthy();
  });

  it("renders organization suggestions and routes explicit actions", () => {
    const onApplyAction = vi.fn();
    const onCreateActionItemFollowUp = vi.fn();

    render(
      <HermesReaderOrganizationPanel
        organization={organizationFixture()}
        formatDate={() => "2026年6月14日"}
        onApplyAction={onApplyAction}
        onCreateActionItemFollowUp={onCreateActionItemFollowUp}
      />,
    );

    const result = screen.getByLabelText("Hermes 整理建议");
    expect(within(result).getByText(/P1 Urgent · 分数 94/)).toBeTruthy();
    expect(within(result).getByText(/标签： 客户（client thread）/)).toBeTruthy();
    expect(within(result).getByText(/订阅判断：newsletter · 90%/)).toBeTruthy();
    expect(within(result).getByText(/还有 2 条建议/)).toBeTruthy();
    expect(within(result).getByText(/Confirm launch schedule/)).toBeTruthy();

    fireEvent.click(
      within(result).getByRole("button", {
        name: "Apply Hermes organization action 标为重要",
      }),
    );
    expect(onApplyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "smart_inbox:mark_important",
        kind: "smart_inbox",
        action: "mark_important",
      }),
    );

    fireEvent.click(
      within(result).getByRole("button", {
        name: "Create Hermes action item follow-up Confirm launch schedule",
      }),
    );
    expect(onCreateActionItemFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Confirm launch schedule" }),
      0,
    );
  });

  it("deduplicates executable organization actions", () => {
    expect(hermesOrganizationApplyActions(organizationFixture()).map((item) => item.id)).toEqual([
      "smart_inbox:mark_important",
      "label:客户",
      "smart_inbox:move_to_feed",
    ]);
  });

  it("formats follow-up ids and notes for dated Hermes action items", () => {
    const [item] = organizationFixture().actionItems.items;

    expect(hermesActionItemApplyId(item, 0)).toBe(
      "followup:0:Confirm launch schedule:2026-06-14T09:00:00.000Z",
    );
    expect(formatHermesActionItemNote(item)).toContain("Owner: me");
    expect(formatHermesActionItemNote(item)).toContain("Source: please confirm today");
  });

  it("renders untrusted organization fields as inert text", () => {
    render(
      <HermesReaderOrganizationPanel
        organization={organizationFixture({
          priority: {
            ...organizationFixture().priority,
            explanation: '<img src=x onerror="window.__hermesOrgXss=1">Explain',
          },
          labels: {
            ...organizationFixture().labels,
            labels: [
              {
                name: '<svg onload="window.__hermesOrgLabelXss=1"></svg>客户',
                reason: '<script>window.__hermesOrgReasonXss=1</script>',
              },
            ],
          },
          actionItems: {
            ...organizationFixture().actionItems,
            items: [
              {
                title: '<img src=x onerror="window.__hermesOrgActionXss=1">Confirm',
              },
            ],
          },
        })}
        formatDate={() => "2026年6月14日"}
        onApplyAction={vi.fn()}
        onCreateActionItemFollowUp={vi.fn()}
      />,
    );

    expect(
      screen.getByText('<img src=x onerror="window.__hermesOrgXss=1">Explain'),
    ).toBeTruthy();
    expect(document.querySelector(".hermes-organize-result img")).toBeNull();
    expect(document.querySelector(".hermes-organize-result svg[onload]")).toBeNull();
    expect(
      (window as Window & { __hermesOrgXss?: number }).__hermesOrgXss,
    ).toBeUndefined();
  });
});

function summaryFixture(): HermesMessageSummaryResult {
  return {
    skillRunId: "run_summary_1",
    skillId: "thread_summarize",
    accountId: "account_1",
    messageId: "message_1",
    mode: "action_points",
    summaryText: "需要确认发布时间，并在今天回复 Lina。",
    cached: false,
  };
}

function organizationFixture(
  overrides: Partial<HermesMessageOrganizationResult> = {},
): HermesMessageOrganizationResult {
  return {
    accountId: "account_1",
    messageId: "message_1",
    priority: {
      skillRunId: "run_priority_1",
      skillId: "priority_triage",
      priority: "high",
      bucket: "P1 Urgent",
      score: 94,
      reasons: ["deadline today"],
      explanation: "Reply today.",
    },
    labels: {
      skillRunId: "run_labels_1",
      skillId: "label_suggest",
      labels: [{ name: "客户", confidence: 0.92, reason: "client thread" }],
      actions: [
        { type: "mark_important", reason: "deadline today" },
        { type: "apply_label", label: "客户", reason: "high confidence" },
        { type: "apply_label", label: "", reason: "missing label" },
      ],
    },
    newsletter: {
      skillRunId: "run_newsletter_1",
      skillId: "newsletter_cleanup",
      isNewsletter: true,
      confidence: 0.9,
      senderCategory: "newsletter",
      reasons: ["list sender"],
      actions: [
        { type: "move_to_feed", reason: "newsletter sender" },
        { type: "move_to_feed", reason: "duplicate action" },
        { type: "unsubscribe_later", unsubscribeUrl: "https://example.com/off" },
      ],
    },
    actionItems: {
      skillRunId: "run_actions_1",
      skillId: "action_item_extract",
      items: [
        {
          title: "Confirm launch schedule",
          owner: "me",
          dueAt: "2026-06-14T09:00:00.000Z",
          priority: "high",
          status: "open",
          sourceQuote: "please confirm today",
        },
      ],
    },
    ...overrides,
  };
}
