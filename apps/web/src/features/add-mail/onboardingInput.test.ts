import { describe, expect, it } from "vitest";

import {
  buildManualOnboardingInput,
  buildPresetOnboardingInput,
  defaultCustomServerFields,
} from "./onboardingInput";
import { defaultProtonBridgeServerFields } from "./protonBridgeOnboarding";

const customProvider = {
  title: "个人域名邮箱",
  subtitle: "连接企业或个人域名邮箱",
  mark: "@",
  provider: "custom_domain",
  action: "manual" as const,
  badges: [],
  setupHints: [],
};

const protonProvider = {
  title: "Proton Mail",
  subtitle: "连接 Proton 邮箱",
  mark: "P",
  provider: "proton_bridge",
  action: "bridge" as const,
  badges: [],
  setupHints: [],
};

describe("Add Mail onboarding input", () => {
  it("builds custom domain IMAP and SMTP endpoints", () => {
    expect(
      buildManualOnboardingInput(customProvider, {
        email: " support@example.com ",
        fields: {
          ...defaultCustomServerFields,
          username: "",
          secret: " custom-secret ",
          receiveHost: " mail.example.com ",
          receivePort: "993",
          sendHost: " smtp.example.com ",
          sendPort: "465",
        },
      }),
    ).toEqual({
      ok: true,
      input: {
        email: "support@example.com",
        provider: "custom_domain",
        imap: {
          host: "mail.example.com",
          port: 993,
          secure: true,
          username: "support@example.com",
          secret: "custom-secret",
        },
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          username: "support@example.com",
          secret: "custom-secret",
        },
      },
    });
  });

  it("reports the exact custom domain endpoint field that blocks testing", () => {
    expect(
      buildManualOnboardingInput(customProvider, {
        email: "support@example.com",
        fields: {
          ...defaultCustomServerFields,
          secret: "custom-secret",
          receiveHost: "mail.example.com",
          receivePort: "70000",
          sendHost: "smtp.example.com",
        },
      }),
    ).toEqual({
      ok: false,
      notice: "个人域名邮箱的收信端口需要是 1 到 65535 的数字。",
    });
  });

  it("keeps custom domain secure toggles and defaults username to the email", () => {
    expect(
      buildManualOnboardingInput(customProvider, {
        email: "support@example.com",
        fields: {
          ...defaultCustomServerFields,
          secret: "custom-secret",
          receiveHost: "imap.example.com",
          receiveSecure: false,
          sendHost: "smtp.example.com",
          sendSecure: false,
        },
      }),
    ).toEqual({
      ok: true,
      input: {
        email: "support@example.com",
        provider: "custom_domain",
        imap: {
          host: "imap.example.com",
          port: 993,
          secure: false,
          username: "support@example.com",
          secret: "custom-secret",
        },
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: false,
          username: "support@example.com",
          secret: "custom-secret",
        },
      },
    });
  });

  it("reports incomplete Proton Bridge host overrides before calling the API", () => {
    expect(
      buildPresetOnboardingInput(protonProvider, {
        email: "me@proton.me",
        username: "bridge-user",
        secret: "bridge-secret",
        bridgeFields: {
          ...defaultProtonBridgeServerFields,
          receiveHost: "host.docker.internal",
        },
      }),
    ).toEqual({
      ok: false,
      notice: "Proton Mail Bridge 地址不完整。",
    });
  });
});
