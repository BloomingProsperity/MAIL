import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HermesNotice } from "./HermesNotice";

afterEach(() => {
  cleanup();
});

describe("HermesNotice", () => {
  it("renders a passive Hermes notice without a settings action", () => {
    render(<HermesNotice notice="Hermes 已同步搜索条件。" />);

    const notice = screen.getByRole("status");

    expect(notice.textContent).toBe("Hermes 已同步搜索条件。");
    expect(notice.className).toBe("backend-notice hermes-actionable-notice");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the focused skill setting when the notice is actionable", () => {
    const onOpenSkillSettings = vi.fn();

    render(
      <HermesNotice
        notice="Hermes 搜索问答能力已禁用。"
        skillId="email_search_qa"
        requiredPermission="body_read"
        compact
        onOpenSkillSettings={onOpenSkillSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开能力选项" }));

    expect(screen.getByRole("status").className).toBe(
      "backend-notice compact hermes-actionable-notice",
    );
    expect(onOpenSkillSettings).toHaveBeenCalledWith(
      "email_search_qa",
      "body_read",
    );
  });

  it("renders a general recovery action when provided", () => {
    const onAction = vi.fn();

    render(
      <HermesNotice
        notice="Hermes 尚未配置模型接口。"
        actionLabel="打开 Hermes 配置"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Hermes 配置" }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("preserves a custom class while keeping the actionable marker", () => {
    render(<HermesNotice notice="正在搜索。" className="dock-result-status" />);

    expect(screen.getByRole("status").className).toBe(
      "dock-result-status hermes-actionable-notice",
    );
  });
});
