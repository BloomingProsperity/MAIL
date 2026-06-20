import { describe, expect, it } from "vitest";

import { ApiRequestError } from "../../lib/emailHubApi";
import {
  formatOAuthCallbackError,
  formatOAuthProviderDeniedError,
  formatOAuthStartError,
} from "./oauthDiagnostics";

describe("OAuth diagnostics", () => {
  it("maps missing provider configuration to a recoverable start message", () => {
    expect(
      formatOAuthStartError(
        "Gmail",
        new ApiRequestError(400, "bad_request", {
          detail: "gmail OAuth client is not configured",
        }),
      ),
    ).toBe("Gmail 网页登录暂时不可用。");
  });

  it("maps redirect mismatch to a domain callback message", () => {
    expect(
      formatOAuthStartError(
        "Outlook",
        new ApiRequestError(400, "bad_request", {
          detail: "OAuth provider rejected redirect",
        }),
      ),
    ).toBe("Outlook 登录地址不匹配。");
  });

  it("maps callback token failures without exposing raw OAuth details", () => {
    expect(
      formatOAuthCallbackError({
        flow: "onboarding",
        error: new ApiRequestError(400, "bad_request", {
          detail: "OAuth callback did not return a refresh token",
        }),
      }),
    ).toBe("授权没有返回长期同步权限。");
  });

  it("maps EmailEngine callback failures to a direct recoverable message", () => {
    expect(
      formatOAuthCallbackError({
        flow: "onboarding",
        error: new ApiRequestError(400, "oauth_callback_failed", {
          detail:
            "EmailEngine OAuth account registration failed: 500 UnknownError Internal Server Error",
        }),
      }),
    ).toBe("EmailEngine 当前不可用，邮箱没有添加成功。");
  });

  it("uses the correct retry surface when the provider denies authorization", () => {
    expect(formatOAuthProviderDeniedError("reauthorization")).toBe(
      "重新登录已取消。",
    );
  });
});
