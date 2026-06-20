import { ApiRequestError } from "../../lib/emailHubApi";

export type OAuthFlow = "onboarding" | "reauthorization";

export function formatOAuthStartError(
  providerTitle: string,
  error: unknown,
): string {
  const profile = oauthErrorProfile(error);
  if (profile.unavailable) {
    return `${providerTitle} 网页登录服务暂时不可用。`;
  }
  if (profile.missingProviderConfig) {
    return `${providerTitle} 网页登录暂时不可用。`;
  }
  if (profile.redirectMismatch) {
    return `${providerTitle} 登录地址不匹配。`;
  }

  return `${providerTitle} 暂时无法开始连接。`;
}

export function formatOAuthCallbackError(input: {
  flow: OAuthFlow;
  error: unknown;
}): string {
  const profile = oauthErrorProfile(input.error);
  if (profile.sessionExpired) {
    return "登录会话已过期。";
  }
  if (profile.codeExpired) {
    return "授权码已失效。";
  }
  if (profile.missingRefreshToken) {
    return "授权没有返回长期同步权限。";
  }
  if (profile.missingProviderConfig) {
    return "网页登录暂时不可用。";
  }
  if (profile.profileLookupFailed) {
    return "Gmail 资料读取被 Google 拒绝。";
  }
  if (profile.emailEngineUnavailable) {
    return "EmailEngine 当前不可用，邮箱没有添加成功。";
  }
  if (profile.redirectMismatch) {
    return "登录地址不匹配。";
  }

  return input.flow === "reauthorization"
    ? "重新登录没有完成。"
    : "添加邮箱没有完成。";
}

export function formatOAuthProviderDeniedError(flow: OAuthFlow): string {
  return flow === "reauthorization" ? "重新登录已取消。" : "登录授权已取消。";
}

function oauthErrorProfile(error: unknown): {
  unavailable: boolean;
  missingProviderConfig: boolean;
  redirectMismatch: boolean;
  missingRefreshToken: boolean;
  sessionExpired: boolean;
  codeExpired: boolean;
  profileLookupFailed: boolean;
  emailEngineUnavailable: boolean;
} {
  const code = error instanceof ApiRequestError ? error.code : "";
  const status = error instanceof ApiRequestError ? error.status : 0;
  const message = errorText(error);

  return {
    unavailable: status === 503 || code === "oauth_onboarding_unavailable",
    missingProviderConfig:
      /oauth client is not configured/i.test(message) ||
      /client id|client secret|oauth2 provider|oauth2 app/i.test(message) ||
      /EMAILENGINE_(GMAIL|OUTLOOK)_OAUTH2_PROVIDER_ID/.test(message),
    redirectMismatch: /redirect/i.test(message),
    missingRefreshToken: /refresh token/i.test(message),
    sessionExpired: /state (was )?not found|session/i.test(message),
    codeExpired: /invalid_grant|expired|authorization code|oauth code/i.test(
      message,
    ),
    profileLookupFailed: /profile lookup failed.*gmail|gmail profile/i.test(
      message,
    ),
    emailEngineUnavailable:
      /emailengine.*(registration failed|internal server error|api internal)/i.test(
        message,
      ),
  };
}

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return [error.code, error.detail, error.payload?.detail]
      .filter((item): item is string => Boolean(item))
      .join(" ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
