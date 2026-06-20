import { describe, expect, it } from "vitest";

import {
  findProviderCapability,
  listProviderCapabilities,
} from "../src/mail-provider/provider-capabilities";

describe("mail provider capability catalog", () => {
  it("lists first-class mailbox providers with user-facing connection labels", () => {
    const capabilities = listProviderCapabilities();

    expect(capabilities.map((item) => item.provider)).toEqual([
      "gmail",
      "outlook",
      "icloud",
      "163",
      "qq",
      "tencent_exmail",
      "proton_bridge",
      "custom_domain",
    ]);
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "gmail",
          label: "Gmail",
          connectionLabel: "登录 Google 账号",
          supportsWebLogin: true,
          supportsAppPassword: false,
          supportsMailboxPassword: false,
          supportsScanLogin: false,
          supportsServerSearch: true,
          supportsLabels: true,
          supportsRecall: false,
          setupHints: ["登录后自动同步邮件"],
        }),
        expect.objectContaining({
          provider: "proton_bridge",
          label: "Proton Mail",
          connectionLabel: "通过 Proton Bridge 连接",
          requiresLocalBridge: true,
          supportsServerSearch: false,
          setupHints: ["先启动 Proton Bridge 并使用 Bridge 用户名和 Bridge 密码"],
        }),
      ]),
    );
    expect(JSON.stringify(capabilities)).not.toMatch(
      /OAuth|Graph|IMAP|SMTP|API/i,
    );
  });

  it("keeps official web-login capabilities even before OAuth env is configured", () => {
    expect(
      findProviderCapability("gmail", {
        oauthProvidersConfigured: { gmail: false },
      }),
    ).toMatchObject({
      provider: "gmail",
      connectionLabel: "登录 Google 账号",
      supportsWebLogin: true,
      supportsServerSearch: true,
      supportsLabels: true,
      setupHints: ["登录后自动同步邮件"],
    });
    expect(
      findProviderCapability("outlook", {
        oauthProvidersConfigured: { outlook: false },
      }),
    ).toMatchObject({
      provider: "outlook",
      connectionLabel: "登录 Microsoft 账号",
      supportsWebLogin: true,
      supportsServerSearch: true,
      supportsCalendar: true,
      supportsContacts: true,
      supportsOnlineArchive: true,
    });
  });

  it("keeps Tencent-specific actions out of generic mailbox providers", () => {
    expect(findProviderCapability("qqmail")).toMatchObject({
      provider: "qq",
      label: "QQ 邮箱",
      connectionLabel: "输入 QQ 邮箱授权码",
      supportsScanLogin: false,
      supportsAppPassword: true,
      supportsMailboxPassword: true,
      supportsRecall: true,
      supportsReadReceipts: false,
      supportsSendAsGroup: false,
      supportsSendOnBehalf: false,
      providerSpecificActions: ["recall_unread_internal"],
      setupHints: ["在 QQ 邮箱设置里生成授权码"],
    });
    expect(findProviderCapability("exmail")).toMatchObject({
      provider: "tencent_exmail",
      supportsContacts: true,
      supportsAliasSync: true,
      supportsRecall: true,
      supportsReadReceipts: true,
      supportsLargeAttachment: true,
      supportsCloudAttachment: true,
      supportsScanLogin: true,
      supportsSendAsGroup: true,
      supportsSendOnBehalf: true,
      supportsJunkFiltering: true,
    });
    expect(findProviderCapability("personal_domain")).toMatchObject({
      provider: "custom_domain",
      supportsRecall: false,
      supportsReadReceipts: false,
      supportsAliasSync: false,
    });
  });

  it("captures provider-specific setup and work features at Foxmail-level granularity", () => {
    expect(findProviderCapability("icloud")).toMatchObject({
      provider: "icloud",
      supportsMailboxPassword: true,
      setupHints: ["使用 Apple 专用密码，不是 Apple ID 密码"],
    });
    expect(findProviderCapability("outlook")).toMatchObject({
      provider: "outlook",
      supportsWebLogin: true,
      supportsAppPassword: false,
      setupHints: ["登录后自动同步邮件"],
    });
    expect(findProviderCapability("163")).toMatchObject({
      provider: "163",
      supportsMailboxPassword: true,
      setupHints: ["在 163 邮箱设置里生成授权码"],
    });
  });

  it("returns undefined for unknown providers instead of inventing capabilities", () => {
    expect(findProviderCapability("unknown-mail")).toBeUndefined();
  });
});
