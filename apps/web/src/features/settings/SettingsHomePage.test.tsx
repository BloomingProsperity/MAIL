import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsHomePage } from "./SettingsHomePage";

afterEach(() => {
  cleanup();
});

describe("SettingsHomePage", () => {
  it("opens on mailbox accounts and keeps maintenance collapsed", () => {
    renderSettingsHome();

    const nav = screen.getByLabelText("设置分类");
    expect(
      within(nav).getByRole("button", { name: /邮箱账号/ }).className,
    ).toContain("active");
    expect(screen.getByLabelText("邮箱账号设置")).toBeTruthy();
    expect(screen.getByText("已连接邮箱")).toBeTruthy();
    expect(screen.getByText("36 个")).toBeTruthy();
    expect(screen.queryByLabelText("维护项目")).toBeNull();
    expect(screen.queryByText("存储维护")).toBeNull();
  });

  it("routes ordinary settings actions", () => {
    const handlers = renderSettingsHome();

    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(handlers.onOpenAddMail).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /连接/ }));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(handlers.onOpenHermes).toHaveBeenCalledTimes(1);
  });

  it("loads maintenance panels only after opening maintenance", () => {
    renderSettingsHome();

    fireEvent.click(screen.getByRole("button", { name: /状态与维护/ }));
    expect(screen.getByText("运行状态")).toBeTruthy();
    expect(screen.queryByText("暂时不可用。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /维护项目/ }));
    expect(screen.getByLabelText("运行状态")).toBeTruthy();
    expect(screen.getByLabelText("存储维护面板")).toBeTruthy();
  });
});

function renderSettingsHome() {
  const handlers = {
    onOpenAddMail: vi.fn(),
    onOpenDomains: vi.fn(),
    onOpenHermes: vi.fn(),
  };

  render(
    <SettingsHomePage
      connectedAccountCount={36}
      onOpenAddMail={handlers.onOpenAddMail}
      onOpenDomains={handlers.onOpenDomains}
      onOpenHermes={handlers.onOpenHermes}
    />,
  );

  return handlers;
}
