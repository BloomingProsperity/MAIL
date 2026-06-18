import { describe, expect, it } from "vitest";

import {
  createReauthorizationRecoveryService,
  ReauthorizationFailedError,
} from "../src/accounts/reauthorization-recovery";
import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";
import type { ReauthorizationRecoveryServiceOptions } from "../src/accounts/reauthorization-recovery";

describe("Tencent Exmail reauthorization recovery", () => {
  it("normalizes Exmail aliases when completing IMAP/SMTP reauthorization", async () => {
    const registeredAccounts: unknown[] = [];
    const completedTasks: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      ...baseOptions(),
      createId: () => "acc_1",
      reauthorizationTasks: {
        async getTask() {
          return {
            id: "task_exmail",
            email: "support@example.com",
            provider: "exmail",
            authMethod: "password",
            status: "pending",
            payload: {
              source: "account_transfer_import",
              reauthRequired: true,
              displayName: "Support",
              providerPreset: "exmail",
              username: "support@example.com",
            },
          };
        },
        async updateOAuthSession() {
          throw new Error("not used");
        },
      },
      accountStore: {
        async completeTask(input) {
          completedTasks.push(input);
          return {
            task: {
              id: "task_exmail",
              email: "support@example.com",
              provider: "tencent_exmail",
              authMethod: "password",
              status: "completed",
            },
            account: input.account,
          };
        },
        async failTask() {
          throw new Error("not used");
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount(input) {
          registeredAccounts.push(input);
        },
        async registerOAuthAccount() {
          throw new Error("not used");
        },
      },
    });

    const result = await service.completeImapSmtp({
      taskId: "task_exmail",
      username: "support@example.com",
      secret: "exmail-auth-code",
    });

    expect(registeredAccounts).toEqual([
      {
        accountId: "acc_1",
        email: "support@example.com",
        displayName: "Support",
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
    expect(completedTasks).toMatchObject([
      {
        account: {
          provider: "tencent_exmail",
          engineProvider: "emailengine",
        },
      },
    ]);
    expect(result.account?.provider).toBe("tencent_exmail");
  });

  it("returns Tencent Exmail diagnostics for alias authentication failures", async () => {
    const failedTasks: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      ...baseOptions(),
      reauthorizationTasks: {
        async getTask() {
          return {
            id: "task_exmail",
            email: "support@example.com",
            provider: "wechat_work_mail",
            authMethod: "password",
            status: "failed",
            payload: {
              source: "account_transfer_import",
              reauthRequired: true,
              providerPreset: "wechat_work_mail",
            },
          };
        },
        async updateOAuthSession() {
          throw new Error("not used");
        },
      },
      accountStore: {
        async completeTask() {
          throw new Error("not used");
        },
        async failTask(input) {
          failedTasks.push(input);
          return {
            id: input.taskId,
            email: "support@example.com",
            provider: "wechat_work_mail",
            authMethod: "password",
            status: "failed",
            errorMessage: input.errorMessage,
          };
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          const error = new Error("EAUTH invalid password wrong-auth-code");
          (error as Error & { code: string }).code = "EAUTH";
          throw error;
        },
        async registerOAuthAccount() {
          throw new Error("not used");
        },
      },
    });

    await expect(
      service.completeImapSmtp({
        taskId: "task_exmail",
        secret: "wrong-auth-code",
      }),
    ).rejects.toMatchObject({
      code: "reauthorization_failed",
      provider: "tencent_exmail",
      diagnostics: [
        {
          code: "tencent_exmail_client_access_required",
          provider: "tencent_exmail",
          severity: "action_required",
          affected: "account",
          recoveryAction: "enable_tencent_exmail_client_access",
        },
      ],
    } satisfies Partial<ReauthorizationFailedError>);
    expect(JSON.stringify(failedTasks)).not.toContain("wrong-auth-code");
  });
});

function baseOptions(): Omit<
  ReauthorizationRecoveryServiceOptions,
  "reauthorizationTasks" | "accountStore" | "emailEngineAccounts"
> {
  return {
    createId: () => "unused",
    providers: createOAuthProviderRegistry({
      googleClientId: "google-client-id",
    }),
    oauthStore: {
      async getSessionByState() {
        throw new Error("not used");
      },
      async reserveAccountIdForEmailProvider() {
        throw new Error("not used");
      },
      async completeOAuthAccount() {
        throw new Error("not used");
      },
      async failTask() {
        throw new Error("not used");
      },
    },
    tokenClient: {
      async exchangeCode() {
        throw new Error("not used");
      },
    },
    profileClient: {
      async getProfile() {
        throw new Error("not used");
      },
    },
  };
}
