import { describe, expect, it } from "vitest";

import {
  createImapSmtpOnboardingService,
  createInMemoryAccountOnboardingStore,
  normalizeImapSmtpProvider,
} from "../src/accounts/imap-smtp-onboarding";

describe("Tencent Exmail IMAP/SMTP onboarding", () => {
  it("normalizes common aliases to the provider preset", () => {
    expect(normalizeImapSmtpProvider("exmail")).toBe("tencent_exmail");
    expect(normalizeImapSmtpProvider("tencent-exmail")).toBe("tencent_exmail");
    expect(normalizeImapSmtpProvider("qqexmail")).toBe("tencent_exmail");
    expect(normalizeImapSmtpProvider("tencent_mail")).toBe("tencent_exmail");
    expect(normalizeImapSmtpProvider("wechat_work_mail")).toBe(
      "tencent_exmail",
    );
    expect(normalizeImapSmtpProvider("wecom")).toBe("tencent_exmail");
  });

  it("uses Tencent Exmail preset settings for connection tests", async () => {
    const verifications: unknown[] = [];
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: () => {
        throw new Error("test connection must not allocate ids");
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          throw new Error("test connection must not register account");
        },
        async verifyImapSmtpAccount(input) {
          verifications.push(input);
          return {
            imap: { success: true },
            smtp: { success: true },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "support@example.com",
      provider: "tencent-mail",
      secret: "exmail-auth-code",
    });

    expect(verifications).toEqual([
      {
        email: "support@example.com",
        imap: {
          host: "imap.exmail.qq.com",
          port: 993,
          secure: true,
          username: "support@example.com",
          secret: "exmail-auth-code",
        },
        smtp: {
          host: "smtp.exmail.qq.com",
          port: 465,
          secure: true,
          username: "support@example.com",
          secret: "exmail-auth-code",
        },
      },
    ]);
    expect(result).toEqual({
      provider: "tencent_exmail",
      ok: true,
      checks: {
        imap: { ok: true },
        smtp: { ok: true },
      },
      diagnostics: [],
    });
  });

  it("returns admin and member recovery diagnostics for authentication failures", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: () => {
        throw new Error("test connection must not allocate ids");
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          throw new Error("test connection must not register account");
        },
        async verifyImapSmtpAccount() {
          return {
            imap: { success: false, code: "EAUTH", error: "Invalid login" },
            smtp: { success: false, code: "EAUTH", error: "Invalid login" },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "support@example.com",
      provider: "wechat_work_mail",
      secret: "wrong-password",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "tencent_exmail_client_access_required",
        provider: "tencent_exmail",
        severity: "action_required",
        affected: "account",
        message:
          "Ask the enterprise mail administrator to enable third-party client access, then enable it in this mailbox and retry with the generated authorization code.",
        recoveryAction: "enable_tencent_exmail_client_access",
      },
    ]);
  });
});
