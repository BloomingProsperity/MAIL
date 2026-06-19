import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../lib/emailHubApi";
import {
  apiErrorConnectionDiagnostics,
  connectionDiagnosticsFromTestResult,
  formatConnectionDiagnosticAction,
  formatConnectionDiagnosticScope,
  formatConnectionDiagnosticTitle,
} from "./connectionDiagnostics";

describe("connection diagnostics", () => {
  it("formats Tencent Exmail admin and member status", () => {
    const diagnostic = {
      code: "tencent_exmail_client_access_required",
      provider: "tencent_exmail",
      severity: "action_required" as const,
      affected: "account" as const,
      message: "safe backend message",
      recoveryAction: "enable_tencent_exmail_client_access",
    };

    expect(formatConnectionDiagnosticTitle(diagnostic)).toBe(
      "企业邮箱客户端服务",
    );
    expect(formatConnectionDiagnosticAction(diagnostic)).toBe(
      "企业邮箱客户端服务未开启。",
    );
    expect(formatConnectionDiagnosticScope(diagnostic)).toBe("账号");
  });

  it("filters API error diagnostics to narrow safe connection diagnostics", () => {
    const body: Record<string, unknown> = {
      diagnostics: [
        {
          code: "qq_authorization_code_required",
          provider: "qq",
          severity: "action_required",
          affected: "account",
          message: "use app password",
          recoveryAction: "enable_qq_mail_authorization_code",
        },
        {
          code: "raw_backend_detail",
          provider: "qq",
          severity: "debug",
          affected: "account",
          message: "should not render",
          recoveryAction: "show_raw",
        },
      ],
    };
    const diagnostics = apiErrorConnectionDiagnostics(
      new ApiRequestError(400, "reauthorization_failed", body),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("qq_authorization_code_required");
  });

  it("reads connection-test diagnostics with the same guard", () => {
    const diagnostics = connectionDiagnosticsFromTestResult({
      provider: "tencent_exmail",
      ok: false,
      checks: {
        imap: { ok: false },
        smtp: { ok: false },
      },
      diagnostics: [
        {
          code: "tencent_exmail_client_access_required",
          provider: "tencent_exmail",
          severity: "action_required",
          affected: "account",
          message: "safe backend message",
          recoveryAction: "enable_tencent_exmail_client_access",
        },
      ],
    });

    expect(diagnostics).toEqual([
      {
        code: "tencent_exmail_client_access_required",
        provider: "tencent_exmail",
        severity: "action_required",
        affected: "account",
        message: "safe backend message",
        recoveryAction: "enable_tencent_exmail_client_access",
      },
    ]);
  });
});
