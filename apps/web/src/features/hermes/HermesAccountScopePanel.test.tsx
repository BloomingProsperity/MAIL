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

    expect(screen.getByLabelText("Hermes 当前邮箱").textContent).toContain(
      "Hermes 会根据 Work Gmail 的邮件上下文工作。",
    );
  });

  it("warns when Hermes settings have no account scope", () => {
    render(<HermesAccountScopePanel />);

    expect(screen.getByLabelText("Hermes 当前邮箱").textContent).toContain(
      "请选择或添加邮箱",
    );
    expect(
      screen.queryByRole("combobox", {
        name: "选择 Hermes 当前邮箱",
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
        name: "选择 Hermes 当前邮箱",
      }),
      { target: { value: "account_2" } },
    );

    expect(onAccountChange).toHaveBeenCalledWith("account_2");
  });
});
