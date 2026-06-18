import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionDiagnosticList } from "./ConnectionDiagnosticList";

describe("ConnectionDiagnosticList", () => {
  it("renders safe provider recovery guidance without raw diagnostic codes", () => {
    render(
      <ConnectionDiagnosticList
        ariaLabel="添加邮箱恢复建议"
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
        title="恢复建议"
      />,
    );

    expect(screen.getByRole("heading", { name: "恢复建议" })).toBeTruthy();
    expect(screen.getByText("需要 163 邮箱授权码")).toBeTruthy();
    expect(screen.getByText("163 邮箱 · 账号")).toBeTruthy();
    expect(
      screen.getByText("请在 163 邮箱设置里开启客户端授权并使用生成的授权码。"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "netease_163_authorization_code_required",
    );
    expect(document.body.textContent).not.toContain("auth-code-123");
  });

  it("renders inline status diagnostics for reauthorization", () => {
    render(
      <ConnectionDiagnosticList
        ariaLabel="Reauthorization diagnostics for user@qq.com"
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
        name: "Reauthorization diagnostics for user@qq.com",
      }),
    ).toBeTruthy();
    expect(screen.getByText("QQ 邮箱 · 账号")).toBeTruthy();
  });
});
