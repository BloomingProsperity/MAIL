import type { MailProviderCapabilityDto } from "../../lib/emailHubApi";

export interface AddMailProviderOption {
  title: string;
  subtitle: string;
  mark: string;
  provider: string;
  action: "oauth" | "password" | "bridge" | "manual";
  badges: string[];
  setupHints: string[];
}

export const fallbackAddMailProviderOptions: AddMailProviderOption[] = [
  providerOption({
    title: "Gmail",
    subtitle: "使用 Google 官方网页登录授权",
    mark: "G",
    provider: "gmail",
    action: "oauth",
    badges: ["网页登录"],
    setupHints: ["不会要求填写 Gmail 密码"],
  }),
  providerOption({
    title: "Outlook",
    subtitle: "使用 Microsoft 官方网页登录授权",
    mark: "O",
    provider: "outlook",
    action: "oauth",
    badges: ["网页登录"],
    setupHints: ["不会要求填写 Outlook 密码"],
  }),
  providerOption({
    title: "163 邮箱",
    subtitle: "按提示完成邮箱授权",
    mark: "163",
    provider: "163",
    action: "password",
    badges: ["授权码"],
    setupHints: ["在 163 邮箱设置里生成授权码"],
  }),
  providerOption({
    title: "QQ 邮箱",
    subtitle: "按提示完成邮箱授权",
    mark: "QQ",
    provider: "qq",
    action: "password",
    badges: ["授权码"],
    setupHints: ["在 QQ 邮箱设置里生成授权码"],
  }),
  providerOption({
    title: "iCloud Mail",
    subtitle: "连接 iCloud 邮箱",
    mark: "iC",
    provider: "icloud",
    action: "password",
    badges: ["专用密码"],
    setupHints: ["使用 Apple 专用密码，不是 Apple ID 密码"],
  }),
  providerOption({
    title: "Proton Mail",
    subtitle: "连接 Proton 邮箱",
    mark: "P",
    provider: "proton_bridge",
    action: "bridge",
    badges: ["本地 Bridge"],
    setupHints: ["先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码"],
  }),
  providerOption({
    title: "个人域名邮箱",
    subtitle: "连接企业或个人域名邮箱",
    mark: "@",
    provider: "custom_domain",
    action: "manual",
    badges: ["自定义服务器"],
  }),
];

export function providerCapabilityToOption(
  capability: MailProviderCapabilityDto,
): AddMailProviderOption {
  const officialWebLoginCopy =
    officialWebLoginProviderCopy[capability.provider];
  return providerOption({
    title: capability.label,
    subtitle: officialWebLoginCopy?.subtitle ?? capability.connectionLabel,
    mark: providerMark(capability),
    provider: capability.provider,
    action: providerAction(capability),
    badges: providerBadges(capability),
    setupHints: officialWebLoginCopy?.setupHints ?? capability.setupHints,
  });
}

function providerOption(
  option: Omit<AddMailProviderOption, "badges" | "setupHints"> &
    Partial<Pick<AddMailProviderOption, "badges" | "setupHints">>,
): AddMailProviderOption {
  return {
    ...option,
    badges: option.badges ?? [],
    setupHints: option.setupHints ?? [],
  };
}

function providerAction(
  capability: MailProviderCapabilityDto,
): AddMailProviderOption["action"] {
  if (isOfficialWebLoginProvider(capability.provider)) {
    return "oauth";
  }
  if (capability.supportsWebLogin) {
    return "oauth";
  }
  if (capability.requiresLocalBridge) {
    return "bridge";
  }
  if (capability.accountGroup === "domain") {
    return "manual";
  }

  return "password";
}

function providerMark(capability: MailProviderCapabilityDto): string {
  const knownMarks: Record<string, string> = {
    gmail: "G",
    outlook: "O",
    "163": "163",
    qq: "QQ",
    icloud: "iC",
    proton_bridge: "P",
    tencent_exmail: "企",
    custom_domain: "@",
  };

  return knownMarks[capability.provider] ?? capability.label.slice(0, 2);
}

function providerBadges(capability: MailProviderCapabilityDto): string[] {
  const officialWebLogin = isOfficialWebLoginProvider(capability.provider);
  const badges = [
    capability.supportsWebLogin || officialWebLogin ? "网页登录" : undefined,
    capability.supportsScanLogin ? "扫码登录" : undefined,
    capability.requiresLocalBridge ? "本地 Bridge" : undefined,
    !officialWebLogin && capability.supportsAppPassword ? "专用密码" : undefined,
    !officialWebLogin && capability.supportsMailboxPassword ? "授权码" : undefined,
    capability.supportsLabels ? "标签同步" : undefined,
    capability.supportsAliasSync ? "别名同步" : undefined,
    capability.supportsLargeAttachment || capability.supportsCloudAttachment
      ? "大附件"
      : undefined,
    capability.supportsRecall ? "未读撤回" : undefined,
    capability.supportsSendAsGroup || capability.supportsSendOnBehalf
      ? "共享发件"
      : undefined,
  ].filter((badge): badge is string => Boolean(badge));

  return [...new Set(badges)].slice(0, 5);
}

export function isOfficialWebLoginProvider(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    officialWebLoginProviderCopy,
    provider,
  );
}

const officialWebLoginProviderCopy: Record<
  string,
  { subtitle: string; setupHints: string[] }
> = {
  gmail: {
    subtitle: "使用 Google 官方网页登录授权",
    setupHints: ["不会要求填写 Gmail 密码"],
  },
  outlook: {
    subtitle: "使用 Microsoft 官方网页登录授权",
    setupHints: ["不会要求填写 Outlook 密码"],
  },
};
