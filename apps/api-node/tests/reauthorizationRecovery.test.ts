import { describe, expect, it } from "vitest";

import { createReauthorizationRecoveryService } from "../src/accounts/reauthorization-recovery";
import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";

describe("reauthorization recovery service", () => {
  it("starts OAuth reauthorization from an existing task without creating a new task", async () => {
    const updates: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      createId: () => "state_1",
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
      }),
      reauthorizationTasks: {
        async getTask(taskId) {
          expect(taskId).toBe("task_oauth");
          return {
            id: "task_oauth",
            email: "boss@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
            payload: {
              source: "account_transfer_import",
              reauthRequired: true,
              displayName: "Boss",
              loginHint: "boss@gmail.com",
            },
          };
        },
        async updateOAuthSession(input) {
          updates.push(input);
          return {
            id: "task_oauth",
            email: "boss@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
          };
        },
      },
      accountStore: {
        async completeTask() {
          throw new Error("not used");
        },
        async failTask() {
          throw new Error("not used");
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          throw new Error("not used");
        },
      },
    });

    const result = await service.startOAuth({
      taskId: "task_oauth",
      redirectUri: "https://app.example.com/oauth/callback",
    });

    expect(result).toEqual({
      task: {
        id: "task_oauth",
        email: "boss@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        status: "pending",
      },
      provider: "gmail",
      state: "state_1",
      authorizationUrl: expect.stringContaining("state=state_1"),
    });
    expect(result.authorizationUrl).toContain("login_hint=boss%40gmail.com");
    expect(result.authorizationUrl).toContain(
      "https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.settings.basic",
    );
    expect(updates).toEqual([
      {
        taskId: "task_oauth",
        session: {
          state: "state_1",
          redirectUri: "https://app.example.com/oauth/callback",
          loginHint: "boss@gmail.com",
        },
      },
    ]);
  });

  it("completes IMAP/SMTP reauthorization with a fresh authorization code", async () => {
    const registeredAccounts: unknown[] = [];
    const completedTasks: unknown[] = [];
    const syncJobs: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      createId: () => "acc_1",
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
      }),
      reauthorizationTasks: {
        async getTask(taskId) {
          expect(taskId).toBe("task_password");
          return {
            id: "task_password",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "pending",
            payload: {
              source: "account_transfer_import",
              reauthRequired: true,
              displayName: "Support",
              providerPreset: "qq",
              username: "support@qq.com",
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
              id: "task_password",
              email: "support@qq.com",
              provider: "qq",
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
      },
      bootstrapSyncJobs: {
        async enqueueInitialSync(input) {
          syncJobs.push(input);
          return {
            id: "job_1",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:initial-sync:acc_1",
            status: "queued",
            createdAt: "2026-06-13T08:00:00.000Z",
          };
        },
      },
    });

    const result = await service.completeImapSmtp({
      taskId: "task_password",
      username: "support@qq.com",
      secret: "qq-auth-code",
    });

    expect(registeredAccounts).toEqual([
      {
        accountId: "acc_1",
        email: "support@qq.com",
        displayName: "Support",
        imap: {
          host: "imap.qq.com",
          port: 993,
          secure: true,
          username: "support@qq.com",
          secret: "qq-auth-code",
        },
        smtp: {
          host: "smtp.qq.com",
          port: 465,
          secure: true,
          username: "support@qq.com",
          secret: "qq-auth-code",
        },
      },
    ]);
    expect(completedTasks).toEqual([
      {
        taskId: "task_password",
        account: {
          id: "acc_1",
          email: "support@qq.com",
          provider: "qq",
          authMethod: "password",
          displayName: "Support",
          syncState: "syncing",
          engineProvider: "emailengine",
        },
      },
    ]);
    expect(syncJobs).toEqual([
      {
        accountId: "acc_1",
        provider: "qq",
        engineProvider: "emailengine",
        sourceTaskId: "task_password",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("qq-auth-code");
    expect(result).toEqual({
      task: {
        id: "task_password",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        status: "completed",
      },
      account: {
        id: "acc_1",
        email: "support@qq.com",
        provider: "qq",
        authMethod: "password",
        displayName: "Support",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
      syncJob: {
        id: "job_1",
        jobType: "sync_account",
        accountId: "acc_1",
        idempotencyKey: "job:initial-sync:acc_1",
        status: "queued",
        createdAt: "2026-06-13T08:00:00.000Z",
      },
    });
  });

  it("uses Proton Bridge deployment overrides during IMAP/SMTP reauthorization", async () => {
    const registeredAccounts: unknown[] = [];
    const completedTasks: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      createId: () => "acc_1",
      providerPresetOverrides: {
        proton_bridge: {
          imap: { host: "host.docker.internal", port: 2143, secure: false },
          smtp: { host: "host.docker.internal", port: 2025, secure: false },
        },
      },
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
      }),
      reauthorizationTasks: {
        async getTask() {
          return {
            id: "task_proton",
            email: "me@proton.me",
            provider: "proton_bridge",
            authMethod: "password",
            status: "pending",
            payload: {
              source: "account_transfer_import",
              reauthRequired: true,
              displayName: "Proton",
              providerPreset: "proton_bridge",
              username: "bridge-user",
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
              id: "task_proton",
              email: "me@proton.me",
              provider: "proton_bridge",
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
      },
    });

    await service.completeImapSmtp({
      taskId: "task_proton",
      username: "bridge-user",
      secret: "bridge-password",
    });

    expect(registeredAccounts).toMatchObject([
      {
        imap: { host: "host.docker.internal", port: 2143 },
        smtp: { host: "host.docker.internal", port: 2025 },
      },
    ]);
    expect(completedTasks).toMatchObject([
      {
        account: {
          provider: "proton_bridge",
          engineProvider: "emailengine",
        },
      },
    ]);
  });

  it("uses sanitized endpoint payloads during IMAP/SMTP reauthorization", async () => {
    const registeredAccounts: unknown[] = [];
    const completedTasks: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      createId: () => "generated_account",
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
      }),
      reauthorizationTasks: {
        async getTask() {
          return {
            id: "task_native_smtp",
            email: "ops@example.com",
            provider: "custom",
            authMethod: "password",
            status: "pending",
            payload: {
              source: "native_smtp_send",
              reauthRequired: true,
              accountId: "acc_existing",
              displayName: "Ops",
              username: "smtp-user",
              imap: {
                host: "imap.example.com",
                port: "993",
                secure: "true",
                username: "imap-user",
                secret: "must-not-leak",
              },
              smtp: {
                host: "smtp.example.com",
                port: "587",
                secure: "false",
                username: "smtp-user",
                password: "must-not-leak",
              },
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
              id: "task_native_smtp",
              email: "ops@example.com",
              provider: "custom",
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
      },
    });

    const result = await service.completeImapSmtp({
      taskId: "task_native_smtp",
      secret: "new-app-password",
    });

    expect(registeredAccounts).toEqual([
      {
        accountId: "acc_existing",
        email: "ops@example.com",
        displayName: "Ops",
        imap: {
          host: "imap.example.com",
          port: 993,
          secure: true,
          username: "imap-user",
          secret: "new-app-password",
        },
        smtp: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "smtp-user",
          secret: "new-app-password",
        },
      },
    ]);
    expect(completedTasks).toMatchObject([
      {
        taskId: "task_native_smtp",
        account: {
          id: "acc_existing",
          provider: "custom",
          engineProvider: "emailengine",
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("new-app-password");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("fails IMAP/SMTP reauthorization with provider diagnostics and redacted secrets", async () => {
    const failedTasks: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      createId: () => "acc_1",
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
      }),
      reauthorizationTasks: {
        async getTask() {
          return {
            id: "task_password",
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "failed",
            payload: {
              source: "account_transfer_import",
              reauthRequired: true,
              displayName: "Support",
              username: "support@qq.com",
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
            email: "support@qq.com",
            provider: "qq",
            authMethod: "password",
            status: "failed",
            errorMessage: input.errorMessage,
          };
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          throw Object.assign(
            new Error("EAUTH invalid qq-auth-code for support@qq.com"),
            { code: "EAUTH" },
          );
        },
      },
    });

    let caught: unknown;
    try {
      await service.completeImapSmtp({
        taskId: "task_password",
        username: "support@qq.com",
        secret: "qq-auth-code",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "reauthorization_failed",
      provider: "qq",
      diagnostics: [
        expect.objectContaining({
          code: "qq_authorization_code_required",
          recoveryAction: "enable_qq_mail_authorization_code",
        }),
      ],
    });
    expect(caught instanceof Error ? caught.message : String(caught)).not.toContain(
      "qq-auth-code",
    );
    expect(JSON.stringify(failedTasks)).not.toContain("qq-auth-code");
    expect(failedTasks).toEqual([
      {
        taskId: "task_password",
        errorMessage: "EAUTH invalid [redacted] for support@qq.com",
      },
    ]);
  });

  it("rejects non-reauthorization tasks", async () => {
    const service = createReauthorizationRecoveryService({
      createId: () => "state_1",
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
      }),
      reauthorizationTasks: {
        async getTask() {
          return {
            id: "task_normal",
            email: "me@gmail.com",
            provider: "gmail",
            authMethod: "oauth",
            status: "pending",
            payload: { source: "new_account" },
          };
        },
        async updateOAuthSession() {
          throw new Error("should not update task");
        },
      },
      accountStore: {
        async completeTask() {
          throw new Error("not used");
        },
        async failTask() {
          throw new Error("not used");
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          throw new Error("not used");
        },
      },
    });

    await expect(
      service.startOAuth({
        taskId: "task_normal",
        redirectUri: "https://app.example.com/oauth/callback",
      }),
    ).rejects.toThrow("reauthorization task was not found");
  });
});
