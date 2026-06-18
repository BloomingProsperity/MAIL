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
      setupHints: ["在 QQ 邮箱设置里生成授权码"],
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
          setupHints: ["先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码"],
        }),
      ),
    ).toMatchObject({
      action: "bridge",
      badges: ["本地 Bridge"],
      setupHints: ["先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码"],
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

    expect(option.badges).toEqual([
      "扫码登录",
      "专用密码",
      "别名同步",
      "大附件",
      "共享发件",
    ]);
    expect(JSON.stringify(option)).not.toMatch(/send_on_behalf|large_attachment/);
  });

  it("keeps Gmail and Outlook on official web login even when capabilities are incomplete", () => {
    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "gmail",
          label: "Gmail",
          connectionLabel: "输入 Google 应用专用密码",
          accountGroup: "global",
          supportsWebLogin: false,
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
      ),
    ).toMatchObject({
      action: "oauth",
      subtitle: "使用 Google 官方网页登录授权",
      badges: ["网页登录"],
      setupHints: ["不会要求填写 Gmail 密码"],
    });

    expect(
      providerCapabilityToOption(
        capabilityFixture({
          provider: "outlook",
          label: "Outlook",
          connectionLabel: "输入 Outlook 应用专用密码",
          accountGroup: "global",
          supportsWebLogin: false,
          supportsAppPassword: true,
          supportsMailboxPassword: true,
        }),
      ),
    ).toMatchObject({
      action: "oauth",
      subtitle: "使用 Microsoft 官方网页登录授权",
      badges: ["网页登录"],
      setupHints: ["不会要求填写 Outlook 密码"],
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
