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
    gmail_app_password_required: "Google 应用专用密码",
    outlook_app_password_or_web_login_required: "Outlook 专用密码或网页登录",
    icloud_app_specific_password_required: "Apple 专用密码",
    qq_authorization_code_required: "QQ 邮箱授权码",
    netease_163_authorization_code_required: "163 邮箱授权码",
    tencent_exmail_client_access_required: "企业邮箱客户端服务",
  };

  return labels[diagnostic.code] ?? "连接设置待处理";
}

export function formatConnectionDiagnosticAction(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<string, string> = {
    start_proton_bridge: "Proton Bridge 未连接。",
    check_mail_server_connection: "邮箱服务器不可达。",
    check_mailbox_credentials: "授权信息不可用。",
    create_google_app_password: "Gmail 专用密码不可用。",
    create_microsoft_app_password_or_enable_web_login:
      "Outlook 授权不可用。",
    create_apple_app_specific_password: "Apple 专用密码不可用。",
    enable_qq_mail_authorization_code: "QQ 邮箱授权码不可用。",
    enable_163_mail_authorization_code: "163 邮箱授权码不可用。",
    enable_tencent_exmail_client_access: "企业邮箱客户端服务未开启。",
  };

  return labels[diagnostic.recoveryAction] ?? "授权状态不可用。";
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
