import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HermesAccountScopePanel } from "./HermesAccountScopePanel";

afterEach(() => {
  cleanup();
});

describe("HermesAccountScopePanel", () => {
  it("shows the active account used by account-scoped Hermes settings", () => {
    render(
      <HermesAccountScopePanel
        accountId="account_1"
        accounts={[
          {
            id: "account_1",
            label: "Work Gmail",
            email: "work@example.com",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Hermes account scope").textContent).toContain(
      "规则、学习记录和审计日志当前绑定到 Work Gmail。",
    );
  });

  it("warns when Hermes settings have no account scope", () => {
    render(<HermesAccountScopePanel />);

    expect(screen.getByLabelText("Hermes account scope").textContent).toContain(
      "请先选择或添加邮箱",
    );
    expect(
      screen.queryByRole("combobox", {
        name: "Select Hermes settings account",
      }),
    ).toBeNull();
  });

  it("routes account selection when account options are provided", () => {
    const onAccountChange = vi.fn();

    render(
      <HermesAccountScopePanel
        accountId="account_1"
        accounts={[
          {
            id: "account_1",
            label: "Work Gmail",
            email: "work@example.com",
          },
          {
            id: "account_2",
            label: "Personal Outlook",
            email: "me@example.com",
          },
        ]}
        onAccountChange={onAccountChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Select Hermes settings account",
      }),
      { target: { value: "account_2" } },
    );

    expect(onAccountChange).toHaveBeenCalledWith("account_2");
  });
});
