export interface MailProviderCapability {
  provider: string;
  label: string;
  connectionLabel: string;
  accountGroup: "global" | "domestic" | "private" | "domain";
  supportsLogin: boolean;
  supportsWebLogin: boolean;
  supportsScanLogin: boolean;
  supportsAppPassword: boolean;
  supportsMailboxPassword: boolean;
  supportsServerSearch: boolean;
  supportsCalendar: boolean;
  supportsContacts: boolean;
  supportsAliasSync: boolean;
  supportsRecall: boolean;
  supportsReadReceipts: boolean;
  supportsLargeAttachment: boolean;
  supportsCloudAttachment: boolean;
  supportsOnlineArchive: boolean;
  supportsJunkFiltering: boolean;
  supportsSendAsGroup: boolean;
  supportsSendOnBehalf: boolean;
  supportsLabels: boolean;
  requiresLocalBridge: boolean;
  setupHints: string[];
  providerSpecificActions: string[];
}

export interface MailProviderCapabilityOptions {
  oauthProvidersConfigured?: Partial<Record<"gmail" | "outlook", boolean>>;
}

interface InternalMailProviderCapability extends MailProviderCapability {
  aliases: string[];
}

const PROVIDER_CAPABILITIES: InternalMailProviderCapability[] = [
  {
    provider: "gmail",
    label: "Gmail",
    connectionLabel: "登录 Google 账号",
    accountGroup: "global",
    supportsLogin: true,
    supportsWebLogin: true,
    supportsScanLogin: false,
    supportsAppPassword: false,
    supportsMailboxPassword: false,
    supportsServerSearch: true,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: true,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: true,
    requiresLocalBridge: false,
    setupHints: ["登录后自动同步邮件"],
    providerSpecificActions: [],
    aliases: ["google", "google_mail"],
  },
  {
    provider: "outlook",
    label: "Outlook",
    connectionLabel: "登录 Microsoft 账号",
    accountGroup: "global",
    supportsLogin: true,
    supportsWebLogin: true,
    supportsScanLogin: false,
    supportsAppPassword: false,
    supportsMailboxPassword: false,
    supportsServerSearch: true,
    supportsCalendar: true,
    supportsContacts: true,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: true,
    supportsJunkFiltering: true,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: true,
    supportsLabels: false,
    requiresLocalBridge: false,
    setupHints: ["登录后自动同步邮件"],
    providerSpecificActions: ["send_on_behalf", "online_archive"],
    aliases: ["microsoft", "office365", "m365", "hotmail"],
  },
  {
    provider: "icloud",
    label: "iCloud Mail",
    connectionLabel: "输入专用密码",
    accountGroup: "global",
    supportsLogin: false,
    supportsWebLogin: false,
    supportsScanLogin: false,
    supportsAppPassword: true,
    supportsMailboxPassword: true,
    supportsServerSearch: false,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: false,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: false,
    requiresLocalBridge: false,
    setupHints: ["使用 Apple 专用密码，不是 Apple ID 密码"],
    providerSpecificActions: [],
    aliases: ["apple", "icloud_mail"],
  },
  {
    provider: "163",
    label: "163 邮箱",
    connectionLabel: "输入授权码",
    accountGroup: "domestic",
    supportsLogin: false,
    supportsWebLogin: false,
    supportsScanLogin: false,
    supportsAppPassword: true,
    supportsMailboxPassword: true,
    supportsServerSearch: false,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: false,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: false,
    requiresLocalBridge: false,
    setupHints: ["在 163 邮箱设置里生成授权码"],
    providerSpecificActions: [],
    aliases: ["netease", "163_mail"],
  },
  {
    provider: "qq",
    label: "QQ 邮箱",
    connectionLabel: "输入 QQ 邮箱授权码",
    accountGroup: "domestic",
    supportsLogin: true,
    supportsWebLogin: false,
    supportsScanLogin: false,
    supportsAppPassword: true,
    supportsMailboxPassword: true,
    supportsServerSearch: false,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: true,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: true,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: false,
    requiresLocalBridge: false,
    setupHints: ["在 QQ 邮箱设置里生成授权码"],
    providerSpecificActions: ["recall_unread_internal"],
    aliases: ["qqmail", "qq_mail"],
  },
  {
    provider: "tencent_exmail",
    label: "腾讯企业邮箱",
    connectionLabel: "扫码或企业账号登录",
    accountGroup: "domestic",
    supportsLogin: true,
    supportsWebLogin: true,
    supportsScanLogin: true,
    supportsAppPassword: true,
    supportsMailboxPassword: true,
    supportsServerSearch: false,
    supportsCalendar: true,
    supportsContacts: true,
    supportsAliasSync: true,
    supportsRecall: true,
    supportsReadReceipts: true,
    supportsLargeAttachment: true,
    supportsCloudAttachment: true,
    supportsOnlineArchive: false,
    supportsJunkFiltering: true,
    supportsSendAsGroup: true,
    supportsSendOnBehalf: true,
    supportsLabels: true,
    requiresLocalBridge: false,
    setupHints: ["扫码或使用企业账号登录"],
    providerSpecificActions: [
      "recall_unread_internal",
      "send_as_group_member",
      "send_on_behalf",
      "we_drive_attachment",
    ],
    aliases: ["exmail", "tencent_mail", "wechat_work_mail"],
  },
  {
    provider: "proton_bridge",
    label: "Proton Mail",
    connectionLabel: "通过 Proton Bridge 连接",
    accountGroup: "private",
    supportsLogin: false,
    supportsWebLogin: false,
    supportsScanLogin: false,
    supportsAppPassword: false,
    supportsMailboxPassword: false,
    supportsServerSearch: false,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: false,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: false,
    requiresLocalBridge: true,
    setupHints: ["先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码"],
    providerSpecificActions: [],
    aliases: ["proton", "protonmail", "proton_mail"],
  },
  {
    provider: "custom_domain",
    label: "个人域名",
    connectionLabel: "填写邮箱服务信息",
    accountGroup: "domain",
    supportsLogin: false,
    supportsWebLogin: false,
    supportsScanLogin: false,
    supportsAppPassword: true,
    supportsMailboxPassword: true,
    supportsServerSearch: false,
    supportsCalendar: false,
    supportsContacts: false,
    supportsAliasSync: false,
    supportsRecall: false,
    supportsReadReceipts: false,
    supportsLargeAttachment: false,
    supportsCloudAttachment: false,
    supportsOnlineArchive: false,
    supportsJunkFiltering: false,
    supportsSendAsGroup: false,
    supportsSendOnBehalf: false,
    supportsLabels: false,
    requiresLocalBridge: false,
    setupHints: ["填写邮箱服务商提供的收发信息"],
    providerSpecificActions: [],
    aliases: ["custom", "domain", "personal_domain", "imap", "imap_smtp"],
  },
];

export function listProviderCapabilities(
  options: MailProviderCapabilityOptions = {},
): MailProviderCapability[] {
  return PROVIDER_CAPABILITIES.map((capability) =>
    publicCapability(capability, options),
  );
}

export function findProviderCapability(
  provider: string,
  options: MailProviderCapabilityOptions = {},
): MailProviderCapability | undefined {
  const normalized = normalizeProvider(provider);
  const capability = PROVIDER_CAPABILITIES.find(
    (item) =>
      item.provider === normalized ||
      item.aliases.some((alias) => normalizeProvider(alias) === normalized),
  );

  return capability ? publicCapability(capability, options) : undefined;
}

function publicCapability(
  capability: InternalMailProviderCapability,
  options: MailProviderCapabilityOptions = {},
): MailProviderCapability {
  const { aliases: _aliases, ...publicFields } = capability;
  if (capability.provider === "gmail" || capability.provider === "outlook") {
    const configured = options.oauthProvidersConfigured?.[capability.provider];
    if (configured === false) {
      return {
        ...publicFields,
        supportsLogin: false,
        supportsWebLogin: false,
      };
    }
  }

  return { ...publicFields };
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/[\s.-]/g, "_");
}
