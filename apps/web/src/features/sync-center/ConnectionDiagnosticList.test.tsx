import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionDiagnosticList } from "./ConnectionDiagnosticList";

describe("ConnectionDiagnosticList", () => {
  it("renders safe provider status without raw diagnostic codes", () => {
    render(
      <ConnectionDiagnosticList
        ariaLabel="添加邮箱接入状态"
        className="page-panel diagnostic-list connection-diagnostic-list"
        diagnostics={[
          {
            code: "netease_163_authorization_code_required",
            provider: "163",
            severity: "action_required",
            affected: "account",
            message: "Use auth-code-123 from settings",
            recoveryAction: "enable_163_mail_authorization_code",
          },
        ]}
        rowClassName="diagnostic-row connection-diagnostic-row"
        title="接入状态"
      />,
    );

    expect(screen.getByRole("heading", { name: "接入状态" })).toBeTruthy();
    expect(screen.getByText("163 邮箱授权码")).toBeTruthy();
    expect(screen.getByText("163 邮箱 · 账号")).toBeTruthy();
    expect(screen.getByText("163 邮箱授权码不可用。")).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "netease_163_authorization_code_required",
    );
    expect(document.body.textContent).not.toContain("auth-code-123");
  });

  it("renders inline status diagnostics for reauthorization", () => {
    render(
      <ConnectionDiagnosticList
        ariaLabel="重新授权检查 user@qq.com"
        container="div"
        diagnostics={[
          {
            code: "qq_authorization_code_required",
            provider: "qq",
            severity: "action_required",
            affected: "account",
            message: "Use a QQ code",
            recoveryAction: "enable_qq_mail_authorization_code",
          },
        ]}
        role="status"
        rowClassName="reauthorization-diagnostic-card"
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "重新授权检查 user@qq.com",
      }),
    ).toBeTruthy();
    expect(screen.getByText("QQ 邮箱 · 账号")).toBeTruthy();
  });
});
