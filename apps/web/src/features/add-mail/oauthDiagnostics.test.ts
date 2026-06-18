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
    ).toBe(
      "Gmail 网页登录配置还没完成，请让管理员配置服务端登录凭据和 EmailEngine OAuth 应用后再试。",
    );
  });

  it("maps redirect mismatch to a domain callback message", () => {
    expect(
      formatOAuthStartError(
        "Outlook",
        new ApiRequestError(400, "bad_request", {
          detail: "OAuth provider rejected redirect",
        }),
      ),
    ).toBe(
      "Outlook 登录回调地址不匹配，请确认当前访问域名已加入服务商登录回调地址。",
    );
  });

  it("maps callback token failures without exposing raw OAuth details", () => {
    expect(
      formatOAuthCallbackError({
        flow: "onboarding",
        error: new ApiRequestError(400, "bad_request", {
          detail: "OAuth callback did not return a refresh token",
        }),
      }),
    ).toBe("授权没有返回长期同步权限，请重新登录并同意离线访问。");
  });

  it("uses the correct retry surface when the provider denies authorization", () => {
    expect(formatOAuthProviderDeniedError("reauthorization")).toBe(
      "登录授权被取消，请回到同步中心重新登录。",
    );
  });
});
