import type { MailProviderCapabilityDto } from "../../lib/emailHubApi";

export interface AddMailProviderOption {
  title: string;
  subtitle: string;
  mark: string;
  provider: string;
  action: "oauth" | "password" | "bridge" | "manual";
  badges: string[];
  setupHints: string[];
  disabled?: boolean;
}

export const fallbackAddMailProviderOptions: AddMailProviderOption[] = [
  providerOption({
    title: "Gmail",
    subtitle: "Google 账号",
    mark: "G",
    provider: "gmail",
    action: "oauth",
    badges: ["网页登录"],
  }),
  providerOption({
    title: "Outlook",
    subtitle: "Microsoft 账号",
    mark: "O",
    provider: "outlook",
    action: "oauth",
    badges: ["网页登录"],
  }),
  providerOption({
    title: "163 邮箱",
    subtitle: "邮箱授权",
    mark: "163",
    provider: "163",
    action: "password",
    badges: ["授权码"],
  }),
  providerOption({
    title: "QQ 邮箱",
    subtitle: "邮箱授权",
    mark: "QQ",
    provider: "qq",
    action: "password",
    badges: ["授权码"],
  }),
  providerOption({
    title: "iCloud Mail",
    subtitle: "连接 iCloud 邮箱",
    mark: "iC",
    provider: "icloud",
    action: "password",
    badges: ["专用密码"],
  }),
  providerOption({
    title: "Proton Mail",
    subtitle: "连接 Proton 邮箱",
    mark: "P",
    provider: "proton_bridge",
    action: "bridge",
    badges: ["本地 Bridge"],
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
  const officialWebLoginCopy = officialWebLoginProviderCopy[capability.provider];
  const passwordSetupCopy =
    !officialWebLoginCopy && capability.supportsAppPassword
      ? passwordProviderCopy[capability.provider]
      : undefined;
  return providerOption({
    title: capability.label,
    subtitle:
      officialWebLoginCopy?.subtitle ??
      passwordSetupCopy?.subtitle ??
      capability.connectionLabel,
    mark: providerMark(capability),
    provider: capability.provider,
    action: providerAction(capability),
    badges: providerBadges(capability),
    setupHints: officialWebLoginCopy?.setupHints ?? passwordSetupCopy?.setupHints ?? [],
    disabled:
      Boolean(officialWebLoginCopy) && capability.supportsWebLogin === false,
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
  const officialWebLoginProvider = isOfficialWebLoginProvider(capability.provider);
  const badges = [
    officialWebLoginProvider ? "网页登录" : undefined,
    capability.requiresLocalBridge ? "本地 Bridge" : undefined,
    !officialWebLoginProvider && capability.supportsAppPassword
      ? "专用密码"
      : undefined,
    !officialWebLoginProvider && capability.supportsMailboxPassword
      ? "授权码"
      : undefined,
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
    subtitle: "Google 账号",
    setupHints: [],
  },
  outlook: {
    subtitle: "Microsoft 账号",
    setupHints: [],
  },
};

const passwordProviderCopy: Record<
  string,
  { subtitle: string; setupHints: string[] }
> = {
  tencent_exmail: {
    subtitle: "输入企业邮箱授权码或专用密码",
    setupHints: [],
  },
};
