import { describe, expect, it } from "vitest";
import type { MailProviderCapabilityDto } from "../../lib/emailHubApi";
import {
  fallbackAddMailProviderOptions,
  providerCapabilityToOption,
} from "./providerCapabilities";

describe("providerCapabilityToOption", () => {
  it("maps domestic authorization-code providers into user-facing badges", () => {
    const option = providerCapabilityToOption(
      capabilityFixture({
        provider: "qq",
        label: "QQ 邮箱",
        connectionLabel: "输入 QQ 邮箱授权码",
        accountGroup: "domestic",
        supportsAppPassword: true,
        supportsMailboxPassword: true,
        supportsRecall: true,
        setupHints: ["在 QQ 邮箱设置里生成授权码"],
        providerSpecificActions: ["recall_unread_internal"],
      }),
    );

    expect(option).toMatchObject({
      title: "QQ 邮箱",
      subtitle: "输入 QQ 邮箱授权码",
      mark: "QQ",
      provider: "qq",
      action: "password",
      setupHints: [],
    });
    expect(option.badges).toEqual(["专用密码", "授权码", "未读撤回"]);
    expect(JSON.stringify(option)).not.toContain("recall_unread_internal");
  });

  it("marks Proton Bridge and custom-domain providers with the right flow", () => {
    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "proton_bridge",
          label: "Proton Mail",
          connectionLabel: "通过 Proton Bridge 连接",
          accountGroup: "private",
          requiresLocalBridge: true,
          setupHints: [],
        }),
      ),
    ).toMatchObject({
      action: "bridge",
      badges: ["本地 Bridge"],
      setupHints: [],
    });

    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "custom_domain",
          label: "个人域名邮箱",
          connectionLabel: "连接企业或个人域名邮箱",
          accountGroup: "domain",
          supportsMailboxPassword: true,
        }),
      ),
    ).toMatchObject({
      action: "manual",
      badges: ["授权码"],
      mark: "@",
    });
  });

  it("surfaces enterprise mailbox work features without raw enums", () => {
    const option = providerCapabilityToOption(
      capabilityFixture({
        provider: "tencent_exmail",
        label: "腾讯企业邮箱",
        connectionLabel: "扫码或专用密码连接",
        accountGroup: "domestic",
        supportsScanLogin: true,
        supportsAppPassword: true,
        supportsAliasSync: true,
        supportsLargeAttachment: true,
        supportsSendAsGroup: true,
        providerSpecificActions: ["send_on_behalf", "large_attachment"],
      }),
    );

    expect(option.subtitle).toBe("输入企业邮箱授权码或专用密码");
    expect(option.badges).toEqual([
      "专用密码",
      "别名同步",
      "大附件",
      "共享发件",
    ]);
    expect(option.setupHints).toEqual([]);
    expect(JSON.stringify(option)).not.toMatch(/send_on_behalf|large_attachment/);
  });

  it("keeps Gmail and Outlook on official web login without falling back", () => {
    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "gmail",
          label: "Gmail",
          connectionLabel: "旧的错误连接方式",
          accountGroup: "global",
          supportsWebLogin: false,
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
      ),
    ).toMatchObject({
      action: "oauth",
      subtitle: "Google 账号",
      badges: ["网页登录"],
      setupHints: [],
      disabled: true,
    });

    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "outlook",
          label: "Outlook",
          connectionLabel: "旧的错误连接方式",
          accountGroup: "global",
          supportsWebLogin: false,
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
      ),
    ).toMatchObject({
      action: "oauth",
      subtitle: "Microsoft 账号",
      badges: ["网页登录"],
      setupHints: [],
      disabled: true,
    });
  });

  it("uses official web login for configured provider capabilities", () => {
    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "gmail",
          label: "Gmail",
          connectionLabel: "登录 Google 账号",
          accountGroup: "global",
          supportsWebLogin: true,
          supportsAppPassword: false,
          supportsMailboxPassword: false,
          setupHints: ["登录后自动同步邮件"],
        }),
      ),
    ).toMatchObject({
      action: "oauth",
      subtitle: "Google 账号",
      badges: ["网页登录"],
      setupHints: [],
      disabled: false,
    });
  });

  it("keeps fallback custom-domain provider ids aligned with backend capabilities", () => {
    expect(
      fallbackAddMailProviderOptions.find(
        (provider) => provider.title === "个人域名邮箱",
      ),
    ).toMatchObject({
      action: "manual",
      provider: "custom_domain",
    });
  });
});

function capabilityFixture(
  input: Partial<MailProviderCapabilityDto> &
    Pick<
      MailProviderCapabilityDto,
      "provider" | "label" | "connectionLabel" | "accountGroup"
    >,
): MailProviderCapabilityDto {
  return {
    supportsLogin: true,
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
    requiresLocalBridge: false,
    setupHints: [],
    providerSpecificActions: [],
    ...input,
  };
}
