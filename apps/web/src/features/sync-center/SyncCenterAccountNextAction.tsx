import type { SyncCenterAccountDto } from "../../lib/emailHubApi";

const nextActionCopy: Record<string, string> = {
  none: "",
  wait_for_sync: "等待本轮同步完成",
  fix_sync_error: "打开诊断并处理同步失败",
  reauthorize: "重新授权这个邮箱",
  resume_sync: "恢复同步后继续收信",
  connect_backend: "连接后端服务",
};

const providerRecoveryCopy: Record<string, string> = {
  proton_bridge: "启动 Proton Bridge 后重试",
  proton: "启动 Proton Bridge 后重试",
  qq: "使用 QQ 邮箱授权码重新授权",
  "163": "使用 163 邮箱授权码重新授权",
  icloud: "使用 Apple 专用密码重新授权",
  custom: "检查自定义收发信服务并重新授权",
  custom_domain: "检查自定义收发信服务并重新授权",
};

export function syncCenterNextActionLabel(
  account: Pick<SyncCenterAccountDto, "nextAction" | "provider" | "syncState">,
): string {
  const nextAction = account.nextAction ?? "";

  if (nextAction === "reauthorize") {
    return providerRecoveryCopy[account.provider] ?? nextActionCopy.reauthorize;
  }

  if (!nextAction && account.syncState === "reauth_required") {
    return providerRecoveryCopy[account.provider] ?? nextActionCopy.reauthorize;
  }

  if (!nextAction && account.syncState === "paused") {
    return nextActionCopy.resume_sync;
  }

  return nextActionCopy[nextAction] ?? "查看诊断并按提示处理";
}

export function SyncCenterAccountNextAction(props: {
  account: Pick<SyncCenterAccountDto, "nextAction" | "provider" | "syncState">;
}) {
  const label = syncCenterNextActionLabel(props.account);

  if (!label) {
    return null;
  }

  return <span>下一步：{label}</span>;
}
