import { ApiRequestError } from "../../lib/emailHubApi";
import type {
  ImapSmtpConnectionDiagnostic,
  ImapSmtpConnectionTestResult,
} from "../../lib/emailHubApi";

export function apiErrorConnectionDiagnostics(
  error: unknown,
): ImapSmtpConnectionDiagnostic[] {
  if (!(error instanceof ApiRequestError)) {
    return [];
  }

  return error.diagnostics?.filter(isImapSmtpConnectionDiagnostic) ?? [];
}

export function connectionDiagnosticsFromTestResult(
  result: ImapSmtpConnectionTestResult,
): ImapSmtpConnectionDiagnostic[] {
  return result.diagnostics?.filter(isImapSmtpConnectionDiagnostic) ?? [];
}

export function formatConnectionDiagnosticTitle(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<string, string> = {
    proton_bridge_unreachable: "Proton Bridge 未连接",
    mail_server_unreachable: "邮箱服务连接不上",
    mail_credentials_rejected: "授权信息被拒绝",
    gmail_app_password_required: "需要 Google 应用专用密码",
    outlook_app_password_or_web_login_required: "需要 Outlook 专用密码或网页登录",
    icloud_app_specific_password_required: "需要 Apple 专用密码",
    qq_authorization_code_required: "需要 QQ 邮箱授权码",
    netease_163_authorization_code_required: "需要 163 邮箱授权码",
    tencent_exmail_client_access_required: "需要开启企业邮箱客户端服务",
  };

  return labels[diagnostic.code] ?? "连接设置需要处理";
}

export function formatConnectionDiagnosticAction(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<string, string> = {
    start_proton_bridge: "请启动 Proton Bridge 并保持登录后重试。",
    check_mail_server_connection: "请检查收信/发信服务器、端口和网络后重试。",
    check_mailbox_credentials: "请确认邮箱地址、用户名和授权码或专用密码。",
    create_google_app_password: "请为 Gmail 创建应用专用密码，普通 Google 密码不能用于这里。",
    create_microsoft_app_password_or_enable_web_login:
      "请使用 Outlook 应用专用密码，或改用网页登录授权后重试。",
    create_apple_app_specific_password: "请在 Apple ID 中创建 App 专用密码后重试。",
    enable_qq_mail_authorization_code:
      "请在 QQ 邮箱设置里开启服务并使用生成的授权码。",
    enable_163_mail_authorization_code:
      "请在 163 邮箱设置里开启客户端授权并使用生成的授权码。",
    enable_tencent_exmail_client_access:
      "请先让管理员在企业后台开启第三方客户端服务，再在成员邮箱中开启服务并使用授权码。",
  };

  return labels[diagnostic.recoveryAction] ?? "请按邮箱服务商的授权要求处理后重试。";
}

export function formatConnectionDiagnosticScope(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<ImapSmtpConnectionDiagnostic["affected"], string> = {
    account: "账号",
    imap: "收信",
    smtp: "发信",
  };

  return labels[diagnostic.affected];
}

export function formatConnectionDiagnosticProviderLabel(provider: string): string {
  const labels: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    proton: "Proton",
    proton_bridge: "Proton Mail",
    qq: "QQ 邮箱",
    "163": "163 邮箱",
    icloud: "iCloud Mail",
    tencent_exmail: "腾讯企业邮箱",
    custom: "个人域名邮箱",
    custom_domain: "个人域名邮箱",
  };

  return labels[provider] ?? provider;
}

function isImapSmtpConnectionDiagnostic(
  value: unknown,
): value is ImapSmtpConnectionDiagnostic {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.code === "string" &&
    typeof value.provider === "string" &&
    value.severity === "action_required" &&
    (value.affected === "account" ||
      value.affected === "imap" ||
      value.affected === "smtp") &&
    typeof value.message === "string" &&
    typeof value.recoveryAction === "string"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
