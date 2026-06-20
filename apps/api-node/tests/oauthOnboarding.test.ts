import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryOAuthOnboardingStore,
  InvalidOAuthCallbackError,
  createOAuthOnboardingService,
} from "../src/accounts/oauth-onboarding";
import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";

describe("OAuth onboarding service", () => {
  it("creates an OAuth task and returns an authorization URL", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const service = createOAuthOnboardingService({
      store,
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      }),
      tokenClient: {
        async exchangeCode() {
          throw new Error("should not exchange code while creating session");
        },
      },
      profileClient: {
        async getProfile() {
          throw new Error("should not read profile while creating session");
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount() {
          throw new Error("should not register EmailEngine account while creating session");
        },
      },
      createId: (() => {
        const ids = ["task_1", "state_1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    const result = await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
      loginHint: "me@gmail.com",
    });

    expect(result.task).toEqual({
      id: "task_1",
      email: "pending@gmail.oauth",
      provider: "gmail",
      authMethod: "oauth",
      status: "pending",
    });
    expect(result.state).toBe("state_1");
    expect(result.authorizationUrl).toContain("state=state_1");
    expect(store.listTasks()[0].payload).toMatchObject({
      state: "state_1",
      redirectUri: "https://app.example.com/oauth/callback",
      loginHint: "me@gmail.com",
    });
  });

  it("exchanges a callback, stores the account, provider settings, and a secret ref", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const bootstrapJobs: unknown[] = [];
    const emailEngineRegistrations: unknown[] = [];
    const callbackEvents: string[] = [];
    const completeOAuthAccount = store.completeOAuthAccount.bind(store);
    store.completeOAuthAccount = async (input) => {
      callbackEvents.push("store-token");
      return completeOAuthAccount(input);
    };
    const providers = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
    const service = createOAuthOnboardingService({
      store,
      providers,
      tokenClient: {
        async exchangeCode(input) {
          expect(input.provider.provider).toBe("gmail");
          expect(input.code).toBe("code_1");
          return {
            accessToken: "access-token",
            refreshToken: "refresh-token-secret",
            expiresIn: 3600,
            scope: "openid email profile https://mail.google.com/",
            tokenType: "Bearer",
          };
        },
      },
      profileClient: {
        async getProfile(input) {
          expect(input.accessToken).toBe("access-token");
          return { email: "me@gmail.com", displayName: "Me" };
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount(input: unknown) {
          callbackEvents.push("register-emailengine");
          emailEngineRegistrations.push(input);
          return { account: "acc_1", state: "syncing" };
        },
      },
      createId: (() => {
        const ids = ["task_1", "state_1", "acc_1", "secret_1"];
        return () => ids.shift() ?? "extra";
      })(),
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

    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });
    const result = await service.completeAuthCallback({
      state: "state_1",
      code: "code_1",
    });

    expect(result).toEqual({
      task: {
        id: "task_1",
        email: "me@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        status: "completed",
      },
      account: {
        id: "acc_1",
        email: "me@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        displayName: "Me",
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
        provider: "gmail",
        engineProvider: "emailengine",
        sourceTaskId: "task_1",
      },
    ]);
    expect(emailEngineRegistrations).toEqual([
      {
        accountId: "acc_1",
        email: "me@gmail.com",
        displayName: "Me",
        provider: "gmail",
      },
    ]);
    expect(store.listStoredSecrets()).toEqual([
      {
        secretRef: "db:secret_1",
        secretValue: "refresh-token-secret",
      },
    ]);
    expect(callbackEvents).toEqual(["store-token", "register-emailengine"]);
    expect(store.listCredentials()).toEqual([
      {
        accountId: "acc_1",
        credentialKind: "google_oauth_refresh_token",
        secretRef: "db:secret_1",
      },
    ]);
    expect(store.listProviderSettings()).toEqual([
      {
        accountId: "acc_1",
        provider: "gmail",
        nativeProvider: "gmail",
        capabilities: { read: true, send: true, engineProvider: "emailengine" },
        settings: {
          scopes: "openid email profile https://mail.google.com/",
          emailEngineOAuthProvider: "gmail",
          tokenSource: "emailengine_auth_server",
        },
      },
    ]);
  });

  it("does not keep the OAuth callback waiting when initial sync enqueue stalls", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryOAuthOnboardingStore();
      const service = createOAuthOnboardingService({
        store,
        providers: createOAuthProviderRegistry({
          googleClientId: "google-client-id",
          googleClientSecret: "google-client-secret",
        }),
        tokenClient: {
          async exchangeCode() {
            return {
              accessToken: "access-token",
              refreshToken: "refresh-token-secret",
              expiresIn: 3600,
              tokenType: "Bearer",
            };
          },
        },
        profileClient: {
          async getProfile() {
            return { email: "me@gmail.com", displayName: "Me" };
          },
        },
        emailEngineAccounts: {
          async registerOAuthAccount() {
            return { account: "acc_1", state: "syncing" };
          },
        },
        createId: (() => {
          const ids = ["task_1", "state_1", "acc_1", "secret_1"];
          return () => ids.shift() ?? "extra";
        })(),
        bootstrapSyncJobs: {
          enqueueInitialSync() {
            return new Promise<never>(() => {
              // Simulates a queue/backend stall; callback must still finish.
            });
          },
        },
      });

      await service.createAuthSession({
        provider: "gmail",
        redirectUri: "https://app.example.com/oauth/callback",
      });
      const completion = service.completeAuthCallback({
        state: "state_1",
        code: "code_1",
      });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(completion).resolves.toMatchObject({
        account: {
          id: "acc_1",
          email: "me@gmail.com",
          syncState: "syncing",
        },
      });
      await expect(completion).resolves.not.toHaveProperty("syncJob");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the Google id token profile when Gmail profile lookup is unavailable", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const emailEngineRegistrations: unknown[] = [];
    const providers = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
    const service = createOAuthOnboardingService({
      store,
      providers,
      tokenClient: {
        async exchangeCode() {
          return {
            accessToken: "access-token",
            refreshToken: "refresh-token-secret",
            idToken: googleIdToken({
              aud: "google-client-id",
              email: "id-token@gmail.com",
              name: "ID Token User",
            }),
            expiresIn: 3600,
            tokenType: "Bearer",
          };
        },
      },
      profileClient: {
        async getProfile() {
          throw new Error("OAuth profile lookup failed: 403 gmail");
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount(input: unknown) {
          emailEngineRegistrations.push(input);
          return { account: "acc_1", state: "syncing" };
        },
      },
      createId: (() => {
        const ids = ["task_1", "state_1", "acc_1", "secret_1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });
    const result = await service.completeAuthCallback({
      state: "state_1",
      code: "code_1",
    });

    expect(result.account).toMatchObject({
      id: "acc_1",
      email: "id-token@gmail.com",
      displayName: "ID Token User",
      provider: "gmail",
    });
    expect(emailEngineRegistrations).toEqual([
      {
        accountId: "acc_1",
        email: "id-token@gmail.com",
        displayName: "ID Token User",
        provider: "gmail",
      },
    ]);
  });

  it("uses the Microsoft id token profile for Outlook IMAP/SMTP OAuth", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const emailEngineRegistrations: unknown[] = [];
    const providers = createOAuthProviderRegistry({
      microsoftClientId: "microsoft-client-id",
      microsoftClientSecret: "microsoft-client-secret",
    });
    const service = createOAuthOnboardingService({
      store,
      providers,
      tokenClient: {
        async exchangeCode() {
          return {
            accessToken: "outlook-access-token",
            refreshToken: "outlook-refresh-token-secret",
            idToken: microsoftIdToken({
              aud: "microsoft-client-id",
              preferred_username: "me@outlook.com",
              name: "Outlook User",
            }),
            expiresIn: 3600,
            scope:
              "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
            tokenType: "Bearer",
          };
        },
      },
      profileClient: {
        async getProfile() {
          throw new Error("should not call Graph profile for IMAP/SMTP OAuth");
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount(input: unknown) {
          emailEngineRegistrations.push(input);
          return { account: "acc_outlook", state: "syncing" };
        },
      },
      createId: (() => {
        const ids = ["task_outlook", "state_outlook", "acc_outlook", "secret_1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    await service.createAuthSession({
      provider: "outlook",
      redirectUri: "https://app.example.com/oauth/callback",
    });
    const result = await service.completeAuthCallback({
      state: "state_outlook",
      code: "code_outlook",
    });

    expect(result.account).toMatchObject({
      id: "acc_outlook",
      email: "me@outlook.com",
      displayName: "Outlook User",
      provider: "outlook",
    });
    expect(emailEngineRegistrations).toEqual([
      {
        accountId: "acc_outlook",
        email: "me@outlook.com",
        displayName: "Outlook User",
        provider: "outlook",
      },
    ]);
    expect(store.listProviderSettings()[0]).toMatchObject({
      provider: "outlook",
      settings: {
        scopes:
          "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
        tokenSource: "emailengine_auth_server",
      },
    });
  });

  it("rejects callbacks whose route provider does not match the OAuth state", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const service = createOAuthOnboardingService({
      store,
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
        microsoftClientId: "microsoft-client-id",
        microsoftClientSecret: "microsoft-client-secret",
      }),
      tokenClient: {
        async exchangeCode() {
          throw new Error("should not exchange a mismatched provider callback");
        },
      },
      profileClient: {
        async getProfile() {
          throw new Error("should not read profile for a mismatched callback");
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount() {
          throw new Error("should not register a mismatched callback");
        },
      },
      createId: (() => {
        const ids = ["task_1", "state_1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });

    await expect(
      service.completeAuthCallback({
        state: "state_1",
        code: "code_1",
        expectedProvider: "outlook",
      }),
    ).rejects.toBeInstanceOf(InvalidOAuthCallbackError);
    expect(store.listTasks()[0]).toMatchObject({
      status: "pending",
      provider: "gmail",
    });
    expect(store.listAccounts()).toEqual([]);
  });

  it("reuses the canonical account id when the same OAuth mailbox is connected again", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const bootstrapJobs: unknown[] = [];
    const emailEngineRegistrations: unknown[] = [];
    const providers = createOAuthProviderRegistry({
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
    });
    const service = createOAuthOnboardingService({
      store,
      providers,
      tokenClient: {
        async exchangeCode(input) {
          return {
            accessToken: `access-token-${input.code}`,
            refreshToken: `refresh-token-${input.code}`,
            expiresIn: 3600,
            tokenType: "Bearer",
          };
        },
      },
      profileClient: {
        async getProfile() {
          return { email: "me@gmail.com", displayName: "Me" };
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount(input: unknown) {
          emailEngineRegistrations.push(input);
          return { account: (input as { accountId: string }).accountId, state: "syncing" };
        },
      },
      createId: (() => {
        const ids = [
          "task_1",
          "state_1",
          "acc_canonical",
          "secret_1",
          "task_2",
          "state_2",
          "acc_unused",
          "secret_2",
        ];
        return () => ids.shift() ?? "extra";
      })(),
      bootstrapSyncJobs: {
        async enqueueInitialSync(input: unknown) {
          bootstrapJobs.push(input);
          return {
            id: `job_${bootstrapJobs.length}`,
            jobType: "sync_account",
            accountId: (input as { accountId: string }).accountId,
            idempotencyKey: `job:initial-sync:${(input as { accountId: string }).accountId}`,
            status: "queued",
          };
        },
      },
    });

    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });
    const first = await service.completeAuthCallback({
      state: "state_1",
      code: "code_1",
    });
    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });
    const second = await service.completeAuthCallback({
      state: "state_2",
      code: "code_2",
    });

    expect(first.account?.id).toBe("acc_canonical");
    expect(second.account?.id).toBe("acc_canonical");
    expect(emailEngineRegistrations).toEqual([
      {
        accountId: "acc_canonical",
        email: "me@gmail.com",
        displayName: "Me",
        provider: "gmail",
      },
      {
        accountId: "acc_canonical",
        email: "me@gmail.com",
        displayName: "Me",
        provider: "gmail",
      },
    ]);
    expect(bootstrapJobs).toEqual([
      {
        accountId: "acc_canonical",
        provider: "gmail",
        engineProvider: "emailengine",
        sourceTaskId: "task_1",
      },
      {
        accountId: "acc_canonical",
        provider: "gmail",
        engineProvider: "emailengine",
        sourceTaskId: "task_2",
      },
    ]);
    expect(store.listAccounts()).toEqual([
      expect.objectContaining({
        id: "acc_canonical",
        email: "me@gmail.com",
        provider: "gmail",
        engineProvider: "emailengine",
      }),
    ]);
    expect(store.listCredentials()).toEqual([
      {
        accountId: "acc_canonical",
        credentialKind: "google_oauth_refresh_token",
        secretRef: "db:secret_2",
      },
    ]);
    expect(JSON.stringify(store.listCredentials())).not.toContain("refresh-token");
  });

  it("fails the task when the token response has no refresh token", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const service = createOAuthOnboardingService({
      store,
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      }),
      tokenClient: {
        async exchangeCode() {
          return {
            accessToken: "access-token",
            expiresIn: 3600,
            tokenType: "Bearer",
          };
        },
      },
      profileClient: {
        async getProfile() {
          return { email: "me@gmail.com" };
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount() {
          throw new Error("should not register without a refresh token");
        },
      },
      createId: (() => {
        const ids = ["task_1", "state_1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });

    await expect(
      service.completeAuthCallback({
        state: "state_1",
        code: "code_1",
      }),
    ).rejects.toThrow("OAuth callback did not return a refresh token");
    expect(store.listTasks()[0]).toMatchObject({
      status: "failed",
      errorMessage: "OAuth callback did not return a refresh token",
    });
  });

  it("fails the task when EmailEngine rejects OAuth account registration", async () => {
    const store = createInMemoryOAuthOnboardingStore();
    const service = createOAuthOnboardingService({
      store,
      providers: createOAuthProviderRegistry({
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      }),
      tokenClient: {
        async exchangeCode() {
          return {
            accessToken: "access-token",
            refreshToken: "refresh-token-secret",
            expiresIn: 3600,
            tokenType: "Bearer",
          };
        },
      },
      profileClient: {
        async getProfile() {
          return { email: "me@gmail.com" };
        },
      },
      emailEngineAccounts: {
        async registerOAuthAccount() {
          throw new Error("EmailEngine rejected refresh-token-secret");
        },
      },
      createId: (() => {
        const ids = ["task_1", "state_1", "acc_1", "secret_1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    await service.createAuthSession({
      provider: "gmail",
      redirectUri: "https://app.example.com/oauth/callback",
    });

    await expect(
      service.completeAuthCallback({
        state: "state_1",
        code: "code_1",
      }),
    ).rejects.toThrow("EmailEngine rejected [redacted]");
    expect(store.listTasks()[0]).toMatchObject({
      status: "failed",
      errorMessage: "EmailEngine rejected [redacted]",
    });
    expect(store.listAccounts()).toMatchObject([
      {
        id: "acc_1",
        email: "me@gmail.com",
        provider: "gmail",
        authMethod: "oauth",
        syncState: "syncing",
        engineProvider: "emailengine",
      },
    ]);
  });
});

function googleIdToken(payload: Record<string, unknown>): string {
  return [
    encodeJwtPart({ alg: "none", typ: "JWT" }),
    encodeJwtPart({
      iss: "https://accounts.google.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    }),
    "signature",
  ].join(".");
}

function microsoftIdToken(payload: Record<string, unknown>): string {
  return [
    encodeJwtPart({ alg: "none", typ: "JWT" }),
    encodeJwtPart({
      iss: "https://login.microsoftonline.com/common/v2.0",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    }),
    "signature",
  ].join(".");
}

function encodeJwtPart(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
