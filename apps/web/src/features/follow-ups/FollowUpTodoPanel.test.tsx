import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmailHubApi, FollowUpDto } from "../../lib/emailHubApi";
import { FollowUpTodoPanel } from "./FollowUpTodoPanel";

function followUpFixture(overrides: Partial<FollowUpDto> = {}): FollowUpDto {
  return {
    id: "fu_1",
    accountId: "account_1",
    messageId: "message_1",
    kind: "waiting_on_them",
    status: "open",
    dueAt: "2026-06-14T09:00:00.000Z",
    title: "Check whether Lina replied",
    note: "From Hermes follow-up suggestion",
    source: "hermes_followup",
    hermesSkillRunId: "run_1",
    createdAt: "2026-06-13T09:00:00.000Z",
    updatedAt: "2026-06-13T09:00:00.000Z",
    ...overrides,
  };
}

function createFollowUpApiFixture() {
  return {
    listFollowUps: vi.fn(async () => ({
      accountId: "account_1",
      status: "open" as const,
      items: [followUpFixture()],
    })),
    updateFollowUp: vi.fn(async (input: { id: string; status: "done" }) =>
      followUpFixture({
        id: input.id,
        status: input.status,
        completedAt: "2026-06-14T09:30:00.000Z",
      }),
    ),
  };
}

describe("FollowUpTodoPanel", () => {
  it("loads follow-up reminders and marks one done through the backend", async () => {
    const api = createFollowUpApiFixture();

    render(
      <FollowUpTodoPanel
        api={api as unknown as EmailHubApi}
        accountId="account_1"
        embedded
      />,
    );

    expect(await screen.findByText("Check whether Lina replied")).toBeTruthy();
    expect(api.listFollowUps).toHaveBeenCalledWith({
      accountId: "account_1",
      status: "open",
      limit: 50,
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark follow-up done" }));

    await waitFor(() => {
      expect(api.updateFollowUp).toHaveBeenCalledWith({
        id: "fu_1",
        status: "done",
      });
    });
    expect(await screen.findByText(/marked done/)).toBeTruthy();
  });

  it("shows a local preview when no backend api is attached", async () => {
    render(<FollowUpTodoPanel accountId="account_1" embedded />);

    expect(await screen.findByText("今天 17:00 前确认 Q2 合作方案")).toBeTruthy();
    expect(
      screen.getByText("连接服务后会显示同步后的待办。"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark follow-up done" }));
    expect(screen.queryByText("今天 17:00 前确认 Q2 合作方案")).toBeNull();
  });
});
