const knownCsvImportIssues: Record<string, string> = {
  "email is invalid": "邮箱地址格式不正确",
  "provider is required": "需要填写邮箱服务商",
  "auth_method is invalid": "授权方式不支持",
  "secret is required": "需要填写授权码或专用密码",
  "imap_host is required": "需要填写收信服务器",
  "imap_port is invalid": "收信端口格式不正确",
  "imap_security is invalid": "收信加密方式不支持",
  "smtp_host is required": "需要填写发信服务器",
  "smtp_port is invalid": "发信端口格式不正确",
  "smtp_security is invalid": "发信加密方式不支持",
};

const webLoginOnlyProviderLabels: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
};

export function formatAccountCsvImportIssue(issue: string): string {
  const normalized = issue.trim();
  const webLoginOnlyMatch = /^(gmail|outlook) must be added with web login, not CSV import$/.exec(
    normalized,
  );
  if (webLoginOnlyMatch) {
    const provider = webLoginOnlyProviderLabels[webLoginOnlyMatch[1]];
    return `${provider} 请逐个网页登录，不能用 CSV 批量导入。`;
  }

  if (
    normalized ===
    "OAuth CSV import is not supported; add web-login mailboxes individually"
  ) {
    return "网页登录邮箱请逐个添加，不能用 CSV 批量导入。";
  }

  return knownCsvImportIssues[normalized] ?? normalized;
}
