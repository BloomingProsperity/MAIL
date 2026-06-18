import { ApiRequestError } from "../../lib/emailHubApi";

export type OAuthFlow = "onboarding" | "reauthorization";

export function formatOAuthStartError(
  providerTitle: string,
  error: unknown,
): string {
  const profile = oauthErrorProfile(error);
  if (profile.unavailable) {
    return `${providerTitle} 网页登录服务暂时不可用，请稍后重试。`;
  }
  if (profile.missingProviderConfig) {
    return `${providerTitle} 网页登录配置还没完成，请让管理员配置服务商登录凭据后再试。`;
  }
  if (profile.redirectMismatch) {
    return `${providerTitle} 登录回调地址不匹配，请确认当前访问域名已加入服务商登录回调地址。`;
  }

  return `${providerTitle} 暂时无法开始连接，请检查网页登录配置后重试。`;
}

export function formatOAuthCallbackError(input: {
  flow: OAuthFlow;
  error: unknown;
}): string {
  const profile = oauthErrorProfile(input.error);
  if (profile.sessionExpired) {
    return input.flow === "reauthorization"
      ? "登录会话已过期，请回到同步中心重新登录。"
      : "登录会话已过期，请回到添加邮箱重新开始。";
  }
  if (profile.codeExpired) {
    return input.flow === "reauthorization"
      ? "授权码已失效，请回到同步中心重新登录。"
      : "授权码已失效，请回到添加邮箱重新开始。";
  }
  if (profile.missingRefreshToken) {
    return "授权没有返回长期同步权限，请重新登录并同意离线访问。";
  }
  if (profile.missingProviderConfig) {
    return "网页登录配置还没完成，请让管理员配置服务商登录凭据后再试。";
  }
  if (profile.redirectMismatch) {
    return "登录回调地址不匹配，请确认当前访问域名已加入服务商登录回调地址。";
  }

  return input.flow === "reauthorization"
    ? "重新登录没有完成，请回到同步中心重试。"
    : "邮箱连接没有完成，请回到添加邮箱重试。";
}

export function formatOAuthProviderDeniedError(flow: OAuthFlow): string {
  return flow === "reauthorization"
    ? "登录授权被取消，请回到同步中心重新登录。"
    : "登录授权被取消，请回到添加邮箱重新开始。";
}

function oauthErrorProfile(error: unknown): {
  unavailable: boolean;
  missingProviderConfig: boolean;
  redirectMismatch: boolean;
  missingRefreshToken: boolean;
  sessionExpired: boolean;
  codeExpired: boolean;
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
