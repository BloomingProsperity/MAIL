export function formatProviderLabel(provider: string) {
  const labels: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    icloud: "iCloud",
    proton: "Proton",
    proton_bridge: "Proton Mail",
    qq: "QQ 邮箱",
    "163": "163 邮箱",
    tencent_exmail: "腾讯企业邮箱",
    custom: "个人域名",
    custom_domain: "个人域名",
    graph: "Outlook",
  };
  return labels[provider] ?? provider;
}

export function formatSyncStateLabel(state: string) {
  if (state === "paused") {
    return "已暂停";
  }

  const labels: Record<string, string> = {
    preview: "预览",
    syncing: "同步中",
    connected: "已连接",
    reauth_required: "需要重新登录",
    error: "需要处理",
    idle: "等待同步",
  };
  return labels[state] ?? state;
}
