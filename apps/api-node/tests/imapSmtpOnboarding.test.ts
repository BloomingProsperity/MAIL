import { describe, expect, it } from "vitest";

import {
  createImapSmtpOnboardingService,
  createInMemoryAccountOnboardingStore,
  ImapSmtpOnboardingFailedError,
} from "../src/accounts/imap-smtp-onboarding";

describe("IMAP/SMTP onboarding service", () => {
  it("tests IMAP/SMTP settings through EmailEngine without creating onboarding state", async () => {
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
            smtp: { success: false, code: "EAUTH", error: "Invalid login" },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "support@qq.com",
      provider: "qq",
      secret: "qq-auth-code",
    });

    expect(verifications).toEqual([
      {
        email: "support@qq.com",
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
    expect(result).toEqual({
      provider: "qq",
      ok: false,
      checks: {
        imap: { ok: true },
        smtp: { ok: false, code: "EAUTH", error: "Invalid login" },
      },
      diagnostics: [
        {
          code: "qq_authorization_code_required",
          provider: "qq",
          severity: "action_required",
          affected: "account",
          message:
            "Use the authorization code generated in QQ Mail settings, not your normal account password.",
          recoveryAction: "enable_qq_mail_authorization_code",
        },
      ],
    });
    expect(store.listTasks()).toHaveLength(0);
    expect(store.listAccounts()).toHaveLength(0);
  });

  it("returns iCloud app-specific password recovery diagnostics for authentication failures", async () => {
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
            imap: { success: false, code: "EAUTH", error: "Invalid password" },
            smtp: { success: false, code: "EAUTH", error: "Invalid password" },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "me@icloud.com",
      provider: "icloud",
      secret: "apple-id-password",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "icloud_app_specific_password_required",
        provider: "icloud",
        severity: "action_required",
        affected: "account",
        message:
          "Use an Apple app-specific password for iCloud Mail. Apple ID passwords will not work.",
        recoveryAction: "create_apple_app_specific_password",
      },
    ]);
  });

  it("returns 163 authorization code diagnostics for authentication failures", async () => {
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
            imap: { success: false, code: "AUTHENTICATIONFAILED" },
            smtp: { success: true },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "archive@163.com",
      provider: "163",
      secret: "wrong-password",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "netease_163_authorization_code_required",
        provider: "163",
        severity: "action_required",
        affected: "account",
        message:
          "Use the authorization code generated in 163 Mail settings, not your normal account password.",
        recoveryAction: "enable_163_mail_authorization_code",
      },
    ]);
  });

  it("returns Proton Bridge recovery diagnostics when local Bridge ports are unreachable", async () => {
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
            imap: { success: false, code: "ECONNREFUSED" },
            smtp: { success: false, code: "ECONNREFUSED" },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "me@proton.me",
      provider: "proton",
      username: "bridge-user",
      secret: "bridge-password",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "proton_bridge_unreachable",
        provider: "proton_bridge",
        severity: "action_required",
        affected: "account",
        message:
          "Start Proton Bridge on this computer, keep it signed in, then test this mailbox again.",
        recoveryAction: "start_proton_bridge",
      },
    ]);
  });

  it("returns Gmail app-password diagnostics for EmailEngine-first fallback", async () => {
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
            imap: { success: false, code: "EAUTH" },
            smtp: { success: false, code: "EAUTH" },
          };
        },
      },
    });

    const result = await service.testImapSmtpConnection({
      email: "owner@gmail.com",
      provider: "gmail",
      secret: "normal-password",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "gmail_app_password_required",
        provider: "gmail",
        severity: "action_required",
        affected: "account",
        message:
          "Use a Google app password generated for this mailbox. Your normal Google password will not work.",
        recoveryAction: "create_google_app_password",
      },
    ]);
  });

  it.each([
    {
      provider: "gmail",
      email: "owner@gmail.com",
      displayName: "Gmail",
      secret: "google-app-password",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
    },
    {
      provider: "outlook",
      email: "owner@outlook.com",
      displayName: "Outlook",
      secret: "microsoft-app-password",
      imapHost: "outlook.office365.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
      smtpSecure: false,
    },
    {
      provider: "163",
      email: "archive@163.com",
      displayName: "NetEase 163",
      secret: "netease-auth-code",
      imapHost: "imap.163.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.163.com",
      smtpPort: 465,
      smtpSecure: true,
    },
    {
      provider: "qq",
      email: "support@qq.com",
      displayName: "QQ Mail",
      secret: "qq-auth-code",
      imapHost: "imap.qq.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.qq.com",
      smtpPort: 465,
      smtpSecure: true,
    },
    {
      provider: "proton_bridge",
      email: "me@proton.me",
      displayName: "Proton Bridge",
      username: "bridge-user",
      secret: "bridge-password",
      imapHost: "127.0.0.1",
      imapPort: 1143,
      imapSecure: false,
      smtpHost: "127.0.0.1",
      smtpPort: 1025,
      smtpSecure: false,
    },
  ])(
    "fills $provider IMAP and SMTP settings from the provider preset",
    async (preset) => {
      const registrations: unknown[] = [];
      const store = createInMemoryAccountOnboardingStore();
      const service = createImapSmtpOnboardingService({
        store,
        createId: (() => {
          const ids = ["task_1", "acc_1"];
          return () => ids.shift() ?? "extra";
        })(),
        emailEngineAccounts: {
          async registerImapSmtpAccount(input) {
            registrations.push(input);
            return { account: input.accountId, state: "syncing" };
          },
        },
      });

      const result = await service.onboardImapSmtp({
        email: preset.email,
        provider: preset.provider,
        displayName: preset.displayName,
        username: preset.username,
        secret: preset.secret,
      });

      const username = preset.username ?? preset.email;
      expect(registrations).toEqual([
        {
          accountId: "acc_1",
          email: preset.email,
          displayName: preset.displayName,
          imap: {
            host: preset.imapHost,
            port: preset.imapPort,
            secure: preset.imapSecure,
            username,
            secret: preset.secret,
          },
          smtp: {
            host: preset.smtpHost,
            port: preset.smtpPort,
            secure: preset.smtpSecure,
            username,
            secret: preset.secret,
          },
        },
      ]);
      expect(result.account).toMatchObject({
        id: "acc_1",
        email: preset.email,
        provider: preset.provider,
        authMethod: "password",
        syncState: "syncing",
        engineProvider: "emailengine",
      });
      expect(store.listTasks()[0]).toMatchObject({
        id: "task_1",
        status: "completed",
        payload: {
          providerPreset: preset.provider,
          imap: {
            host: preset.imapHost,
            port: preset.imapPort,
            secure: preset.imapSecure,
            username,
            secret: "[redacted]",
          },
          smtp: {
            host: preset.smtpHost,
            port: preset.smtpPort,
            secure: preset.smtpSecure,
            username,
            secret: "[redacted]",
          },
        },
      });
    },
  );

  it("uses Apple iCloud's IMAP username format while keeping SMTP as the full email", async () => {
    const registrations: unknown[] = [];
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_1"];
        return () => ids.shift() ?? "extra";
      })(),
      emailEngineAccounts: {
        async registerImapSmtpAccount(input) {
          registrations.push(input);
          return { account: input.accountId, state: "syncing" };
        },
      },
    });

    const result = await service.onboardImapSmtp({
      email: "me@icloud.com",
      provider: "icloud",
      displayName: "iCloud Mail",
      secret: "apple-app-specific-password",
    });

    expect(registrations).toEqual([
      {
        accountId: "acc_1",
        email: "me@icloud.com",
        displayName: "iCloud Mail",
        imap: {
          host: "imap.mail.me.com",
          port: 993,
          secure: true,
          username: "me",
          secret: "apple-app-specific-password",
        },
        smtp: {
          host: "smtp.mail.me.com",
          port: 587,
          secure: false,
          username: "me@icloud.com",
          secret: "apple-app-specific-password",
        },
      },
    ]);
    expect(result.account).toMatchObject({
      id: "acc_1",
      email: "me@icloud.com",
      provider: "icloud",
      authMethod: "password",
      syncState: "syncing",
      engineProvider: "emailengine",
    });
    expect(store.listTasks()[0]).toMatchObject({
      id: "task_1",
      status: "completed",
      payload: {
        providerPreset: "icloud",
        imap: {
          host: "imap.mail.me.com",
          port: 993,
          secure: true,
          username: "me",
          secret: "[redacted]",
        },
        smtp: {
          host: "smtp.mail.me.com",
          port: 587,
          secure: false,
          username: "me@icloud.com",
          secret: "[redacted]",
        },
      },
    });
  });

  it("wraps registration failures with sanitized provider recovery diagnostics", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_1"];
        return () => ids.shift() ?? "extra";
      })(),
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          const error = new Error(
            "EmailEngine account registration failed: EAUTH qq-auth-code rejected",
          ) as Error & { code: string };
          error.code = "EAUTH";
          throw error;
        },
      },
    });

    await expect(
      service.onboardImapSmtp({
        email: "support@qq.com",
        provider: "qq",
        displayName: "Support",
        secret: "qq-auth-code",
      }),
    ).rejects.toMatchObject({
      code: "imap_smtp_onboarding_failed",
      provider: "qq",
      message: "EmailEngine account registration failed: EAUTH [redacted] rejected",
      diagnostics: [
        {
          code: "qq_authorization_code_required",
          provider: "qq",
          severity: "action_required",
          affected: "account",
          recoveryAction: "enable_qq_mail_authorization_code",
        },
      ],
    } satisfies Partial<ImapSmtpOnboardingFailedError>);

    expect(store.listTasks()).toEqual([
      expect.objectContaining({
        id: "task_1",
        status: "failed",
        errorMessage:
          "EmailEngine account registration failed: EAUTH [redacted] rejected",
      }),
    ]);
    expect(JSON.stringify(store.listTasks())).not.toContain("qq-auth-code");
  });

  it("reuses the existing local account id before updating EmailEngine credentials", async () => {
    const registrations: Array<{ accountId: string; displayName?: string }> = [];
    const syncJobs: Array<{ accountId: string; idempotencyKey: string }> = [];
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_existing", "task_2", "acc_unused"];
        return () => ids.shift() ?? "extra";
      })(),
      bootstrapSyncJobs: {
        async enqueueInitialSync(input) {
          syncJobs.push({
            accountId: input.accountId,
            idempotencyKey: `job:initial-sync:${input.accountId}`,
          });
          return {
            id: `job_${syncJobs.length}`,
            jobType: "sync_account",
            accountId: input.accountId,
            idempotencyKey: `job:initial-sync:${input.accountId}`,
            status: "queued",
            createdAt: "2026-06-16T00:00:00.000Z",
          };
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount(input) {
          registrations.push({
            accountId: input.accountId,
            displayName: input.displayName,
          });
          return { account: input.accountId, state: "syncing" };
        },
      },
    });

    await service.onboardImapSmtp({
      email: "support@qq.com",
      provider: "qq",
      displayName: "Support",
      secret: "first-auth-code",
    });
    const result = await service.onboardImapSmtp({
      email: "support@qq.com",
      provider: "qq",
      displayName: "Support Updated",
      secret: "rotated-auth-code",
    });

    expect(registrations).toEqual([
      { accountId: "acc_existing", displayName: "Support" },
      { accountId: "acc_existing", displayName: "Support Updated" },
    ]);
    expect(syncJobs).toEqual([
      {
        accountId: "acc_existing",
        idempotencyKey: "job:initial-sync:acc_existing",
      },
      {
        accountId: "acc_existing",
        idempotencyKey: "job:initial-sync:acc_existing",
      },
    ]);
    expect(store.listAccounts()).toEqual([
      expect.objectContaining({
        id: "acc_existing",
        email: "support@qq.com",
        provider: "qq",
        displayName: "Support Updated",
      }),
    ]);
    expect(result.account).toMatchObject({
      id: "acc_existing",
      displayName: "Support Updated",
    });
    expect(result.syncJob).toMatchObject({
      accountId: "acc_existing",
      idempotencyKey: "job:initial-sync:acc_existing",
    });
  });

  it("shares the reserved account id across concurrent duplicate onboarding", async () => {
    const registrations: Array<{ accountId: string; displayName?: string }> = [];
    const store = createInMemoryAccountOnboardingStore();
    let releaseFirstRegistration: () => void = () => {};
    let markFirstRegistrationStarted: () => void = () => {};
    const firstRegistrationStarted = new Promise<void>((resolve) => {
      markFirstRegistrationStarted = resolve;
    });
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_canonical", "task_2", "acc_unused"];
        return () => ids.shift() ?? "extra";
      })(),
      emailEngineAccounts: {
        async registerImapSmtpAccount(input) {
          registrations.push({
            accountId: input.accountId,
            displayName: input.displayName,
          });
          if (registrations.length === 1) {
            markFirstRegistrationStarted();
            await new Promise<void>((release) => {
              releaseFirstRegistration = release;
            });
          }
          return { account: input.accountId, state: "syncing" };
        },
      },
    });

    const first = service.onboardImapSmtp({
      email: "support@qq.com",
      provider: "qq",
      displayName: "First",
      secret: "first-auth-code",
    });
    await firstRegistrationStarted;
    const second = service.onboardImapSmtp({
      email: "support@qq.com",
      provider: "qq",
      displayName: "Second",
      secret: "second-auth-code",
    });
    await second;
    releaseFirstRegistration();
    await first;

    expect(registrations).toEqual([
      { accountId: "acc_canonical", displayName: "First" },
      { accountId: "acc_canonical", displayName: "Second" },
    ]);
  });

  it("uses deployment Proton Bridge host overrides for registration and connection tests", async () => {
    const registrations: unknown[] = [];
    const verifications: unknown[] = [];
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_1"];
        return () => ids.shift() ?? "extra";
      })(),
      providerPresetOverrides: {
        proton_bridge: {
          imap: { host: "host.docker.internal", port: 2143, secure: false },
          smtp: { host: "host.docker.internal", port: 2025, secure: false },
        },
      },
      emailEngineAccounts: {
        async registerImapSmtpAccount(input) {
          registrations.push(input);
          return { account: input.accountId, state: "syncing" };
        },
        async verifyImapSmtpAccount(input) {
          verifications.push(input);
          return { imap: { success: true }, smtp: { success: true } };
        },
      },
    });

    await service.testImapSmtpConnection({
      email: "me@proton.me",
      provider: "proton",
      username: "bridge-user",
      secret: "bridge-password",
    });
    const result = await service.onboardImapSmtp({
      email: "me@proton.me",
      provider: "proton",
      username: "bridge-user",
      secret: "bridge-password",
    });

    expect(verifications).toMatchObject([
      {
        imap: { host: "host.docker.internal", port: 2143 },
        smtp: { host: "host.docker.internal", port: 2025 },
      },
    ]);
    expect(registrations).toMatchObject([
      {
        imap: { host: "host.docker.internal", port: 2143 },
        smtp: { host: "host.docker.internal", port: 2025 },
      },
    ]);
    expect(result.account).toMatchObject({
      provider: "proton_bridge",
      engineProvider: "emailengine",
    });
    expect(store.listTasks()[0]).toMatchObject({
      provider: "proton_bridge",
      payload: {
        providerPreset: "proton_bridge",
        imap: { host: "host.docker.internal", port: 2143 },
        smtp: { host: "host.docker.internal", port: 2025 },
      },
    });
  });

  it.each(["iCloud", "Apple Mail", "me.com", "icould"])(
    "normalizes %s as the iCloud provider preset",
    async (provider) => {
      const registrations: unknown[] = [];
      const store = createInMemoryAccountOnboardingStore();
      const service = createImapSmtpOnboardingService({
        store,
        createId: (() => {
          const ids = ["task_1", "acc_1"];
          return () => ids.shift() ?? "extra";
        })(),
        emailEngineAccounts: {
          async registerImapSmtpAccount(input) {
            registrations.push(input);
            return { account: input.accountId, state: "syncing" };
          },
        },
      });

      const result = await service.onboardImapSmtp({
        email: "me@icloud.com",
        provider,
        displayName: "iCloud Mail",
        secret: "apple-app-specific-password",
      });

      expect(result.account).toMatchObject({
        provider: "icloud",
        engineProvider: "emailengine",
      });
      expect(store.listTasks()[0]).toMatchObject({
        provider: "icloud",
        payload: {
          providerPreset: "icloud",
        },
      });
      expect(registrations).toMatchObject([
        {
          imap: { host: "imap.mail.me.com", username: "me" },
          smtp: { host: "smtp.mail.me.com", username: "me@icloud.com" },
        },
      ]);
    },
  );

  it("creates a task, registers the account in EmailEngine, and stores the connected account", async () => {
    const registrations: unknown[] = [];
    const bootstrapJobs: unknown[] = [];
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_1"];
        return () => ids.shift() ?? "extra";
      })(),
      emailEngineAccounts: {
        async registerImapSmtpAccount(input) {
          registrations.push(input);
          return { account: input.accountId, state: "syncing" };
        },
      },
      bootstrapSyncJobs: {
        async enqueueInitialSync(input: unknown) {
          bootstrapJobs.push(input);
          return {
            id: "job_1",
            jobType: "sync_account",
            accountId: "acc_1",
            idempotencyKey: "job:initial-sync:acc_1",
            status: "queued",
          };
        },
      },
    });

    const result = await service.onboardImapSmtp({
      email: "support@qq.com",
      provider: "qq",
      displayName: "Support",
      imap: {
        host: "imap.qq.com",
        port: 993,
        secure: true,
        username: "support@qq.com",
        secret: "imap-auth-code",
      },
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        username: "support@qq.com",
        secret: "smtp-auth-code",
      },
    });

    expect(registrations).toEqual([
      {
        accountId: "acc_1",
        email: "support@qq.com",
        displayName: "Support",
        imap: {
          host: "imap.qq.com",
          port: 993,
          secure: true,
          username: "support@qq.com",
          secret: "imap-auth-code",
        },
        smtp: {
          host: "smtp.qq.com",
          port: 465,
          secure: true,
          username: "support@qq.com",
          secret: "smtp-auth-code",
        },
      },
    ]);
    expect(result).toEqual({
      task: {
        id: "task_1",
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
      },
    });
    expect(bootstrapJobs).toEqual([
      {
        accountId: "acc_1",
        provider: "qq",
        engineProvider: "emailengine",
        sourceTaskId: "task_1",
      },
    ]);
    expect(store.listTasks()[0]).toMatchObject({
      id: "task_1",
      status: "completed",
      payload: {
        accountId: "acc_1",
        imap: { host: "imap.qq.com", secret: "[redacted]" },
        smtp: { host: "smtp.qq.com", secret: "[redacted]" },
      },
    });
    expect(store.listAccounts()).toHaveLength(1);
  });

  it("uses an atomic complete-and-sync store path when available", async () => {
    const calls: string[] = [];
    const service = createImapSmtpOnboardingService({
      store: {
        async createTask(input) {
          calls.push("createTask");
          return input;
        },
        async completeTask() {
          throw new Error("non-atomic completion must not run");
        },
        async completeTaskAndEnqueueInitialSync(input) {
          calls.push("completeTaskAndEnqueueInitialSync");
          return {
            task: {
              id: input.taskId,
              email: input.account.email,
              provider: input.account.provider,
              authMethod: "password",
              status: "completed",
            },
            account: input.account,
            syncJob: {
              id: "job_1",
              jobType: "sync_account",
              accountId: input.account.id,
              idempotencyKey: `job:initial-sync:${input.account.id}`,
              status: "queued",
              createdAt: "2026-06-14T00:00:00.000Z",
            },
          };
        },
        async failTask() {
          throw new Error("failTask must not run");
        },
      },
      createId: (() => {
        const ids = ["task_1", "acc_1"];
        return () => ids.shift() ?? "extra";
      })(),
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          calls.push("registerImapSmtpAccount");
          return { account: "acc_1", state: "syncing" };
        },
      },
      bootstrapSyncJobs: {
        async enqueueInitialSync() {
          throw new Error("separate bootstrap sync queue must not run");
        },
      },
    });

    const result = await service.onboardImapSmtp({
      email: "support@qq.com",
      provider: "qq",
      secret: "qq-auth-code",
    });

    expect(calls).toEqual([
      "createTask",
      "registerImapSmtpAccount",
      "completeTaskAndEnqueueInitialSync",
    ]);
    expect(result.syncJob).toMatchObject({
      jobType: "sync_account",
      accountId: "acc_1",
      status: "queued",
    });
  });

  it("marks the onboarding task failed when EmailEngine rejects registration", async () => {
    const store = createInMemoryAccountOnboardingStore();
    const service = createImapSmtpOnboardingService({
      store,
      createId: (() => {
        const ids = ["task_1", "acc_1"];
        return () => ids.shift() ?? "extra";
      })(),
      emailEngineAccounts: {
        async registerImapSmtpAccount() {
          throw new Error("EmailEngine account registration failed");
        },
      },
    });

    await expect(
      service.onboardImapSmtp({
        email: "support@qq.com",
        provider: "qq",
        imap: {
          host: "imap.qq.com",
          port: 993,
          secure: true,
          username: "support@qq.com",
          secret: "bad-secret",
        },
        smtp: {
          host: "smtp.qq.com",
          port: 465,
          secure: true,
          username: "support@qq.com",
          secret: "bad-secret",
        },
      }),
    ).rejects.toThrow("EmailEngine account registration failed");

    expect(store.listTasks()[0]).toMatchObject({
      id: "task_1",
      status: "failed",
      errorMessage: "EmailEngine account registration failed",
    });
    expect(store.listAccounts()).toHaveLength(0);
  });
});
