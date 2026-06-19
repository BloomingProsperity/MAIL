import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddMailProviderCard } from "./AddMailProviderCard";
import type { AddMailProviderOption } from "./providerCapabilities";

describe("AddMailProviderCard", () => {
  it("shows connection badges without setup guidance or raw implementation copy", () => {
    render(
      <AddMailProviderCard
        provider={providerOption({
          title: "Proton Mail",
          subtitle: "通过 Proton Bridge 连接",
          provider: "proton_bridge",
          action: "bridge",
          badges: ["本地 Bridge"],
          setupHints: ["先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码"],
        })}
        onConnect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Proton Mail 图标")).toBeTruthy();
    expect(
      within(screen.getByLabelText("Proton Mail 接入方式")).getByText(
        "本地 Bridge",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Proton Mail 准备事项")).toBeNull();
    expect(screen.queryByText("先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /OAuth|IMAP|SMTP|providerSpecificActions|recall_unread_internal/i,
    );
  });

  it("submits and disables provider connection actions", () => {
    const onConnect = vi.fn();
    render(
      <AddMailProviderCard
        busy
        provider={providerOption({
          title: "QQ 邮箱",
          subtitle: "输入 QQ 邮箱授权码",
          provider: "qq",
          action: "password",
          badges: ["授权码"],
          setupHints: ["在 QQ 邮箱设置里生成授权码"],
        })}
        onConnect={onConnect}
      />,
    );

    const button = screen.getByRole("button", { name: "连接 QQ 邮箱" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe("连接中");
    fireEvent.click(button);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("lets the whole provider card start the connection once", () => {
    const onConnect = vi.fn();
    render(
      <AddMailProviderCard
        provider={providerOption({
          title: "Gmail",
          subtitle: "登录 Google 账号",
          provider: "gmail",
          action: "oauth",
          badges: ["网页登录"],
          setupHints: ["登录后自动同步邮件"],
        })}
        onConnect={onConnect}
      />,
    );

    fireEvent.click(screen.getByLabelText("Gmail 接入卡片"));
    expect(onConnect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "连接 Gmail" }));
    expect(onConnect).toHaveBeenCalledTimes(2);
  });
});

function providerOption(
  input: Omit<AddMailProviderOption, "mark"> & { mark?: string },
): AddMailProviderOption {
  return {
    mark: input.title.slice(0, 2),
    ...input,
  };
}
