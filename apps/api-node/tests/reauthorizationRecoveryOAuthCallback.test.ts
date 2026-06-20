import { describe, expect, it, vi } from "vitest";

import { createReauthorizationRecoveryService } from "../src/accounts/reauthorization-recovery";
import { createOAuthProviderRegistry } from "../src/accounts/oauth-providers";

describe("reauthorization recovery OAuth callback", () => {
  it("uses the Microsoft id token profile during Outlook OAuth reauthorization", async () => {
    const registeredAccounts: unknown[] = [];
    const completedTasks: unknown[] = [];
    const service = createReauthorizationRecoveryService({
      createId: () => "secret_1",
      providers: createOAuthProviderRegistry({
        microsoftClientId: "microsoft-client-id",
        microsoftClientSecret: "microsoft-client-secret",
      }),
      reauthorizationTasks: {
        async getTask(taskId) {
          expect(taskId).toBe("task_outlook");
          return {
            id: "task_outlook",
            email: "me@outlook.com",
            provider: "outlook",
            authMethod: "oauth",
            status: "pending",
            payload: {
              reauthRequired: true,
              accountId: "acc_outlook",
              displayName: "Outlook User",
            },
          };
        },
        async updateOAuthSession() {
          throw new Error("not used");
        },
      },
      oauthStore: {
        async getSessionByState(state) {
          expect(state).toBe("state_outlook");
          return {
            taskId: "task_outlook",
            provider: "outlook",
            state: "state_outlook",
            redirectUri: "https://app.example.com/oauth/callback",
          };
        },
        async reserveAccountIdForEmailProvider(input) {
          expect(input).toMatchObject({
            email: "me@outlook.com",
            provider: "outlook",
            proposedAccountId: "acc_outlook",
          });
          return "acc_outlook";
        },
        async completeOAuthAccount(input) {
          completedTasks.push(input);
          return {
            task: {
              id: input.taskId,
              email: input.taskEmail,
              provider: "outlook",
              authMethod: "oauth",
              status: "completed",
            },
            account: input.account,
          };
        },
        async failTask() {
          throw new Error("not used");
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
        async registerOAuthAccount(input) {
          registeredAccounts.push(input);
        },
      },
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
            scope:
              "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
          };
        },
      },
      profileClient: {
        async getProfile() {
          throw new Error("should not call Graph profile for IMAP/SMTP OAuth");
        },
      },
    });

    const result = await service.completeOAuthCallback({
      state: "state_outlook",
      code: "oauth-code-secret",
    });

    expect(registeredAccounts).toEqual([
      {
        accountId: "acc_outlook",
        email: "me@outlook.com",
        displayName: "Outlook User",
        provider: "outlook",
      },
    ]);
    expect(completedTasks).toMatchObject([
      {
        taskEmail: "me@outlook.com",
        providerSettings: {
          provider: "outlook",
          settings: {
            scopes:
              "openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
            tokenSource: "emailengine_auth_server",
          },
        },
      },
    ]);
    expect(result.account).toMatchObject({
      id: "acc_outlook",
      email: "me@outlook.com",
      provider: "outlook",
      syncState: "syncing",
    });
  });

  it("does not keep OAuth reauthorization callback waiting when initial sync enqueue stalls", async () => {
    vi.useFakeTimers();
    try {
      const service = createReauthorizationRecoveryService({
        createId: () => "secret_1",
        providers: createOAuthProviderRegistry({
          googleClientId: "google-client-id",
          googleClientSecret: "google-client-secret",
        }),
        reauthorizationTasks: {
          async getTask() {
            return {
              id: "task_oauth",
              email: "boss@gmail.com",
              provider: "gmail",
              authMethod: "oauth",
              status: "pending",
              payload: {
                reauthRequired: true,
                accountId: "acc_existing",
                displayName: "Boss",
              },
            };
          },
          async updateOAuthSession() {
            throw new Error("not used");
          },
        },
        oauthStore: {
          async getSessionByState() {
            return {
              taskId: "task_oauth",
              provider: "gmail",
              state: "state_1",
              redirectUri: "https://app.example.com/oauth/callback",
            };
          },
          async reserveAccountIdForEmailProvider() {
            return "acc_existing";
          },
          async completeOAuthAccount(input) {
            return {
              task: {
                id: input.taskId,
                email: input.taskEmail,
                provider: "gmail",
                authMethod: "oauth",
                status: "completed",
              },
              account: input.account,
            };
          },
          async failTask() {
            throw new Error("not used");
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
          async registerOAuthAccount() {
            return { account: "acc_existing", state: "syncing" };
          },
        },
        tokenClient: {
          async exchangeCode() {
            return {
              accessToken: "access-token",
              refreshToken: "refresh-token-secret",
            };
          },
        },
        profileClient: {
          async getProfile() {
            return {
              email: "boss@gmail.com",
              displayName: "Boss",
            };
          },
        },
        bootstrapSyncJobs: {
          enqueueInitialSync() {
            return new Promise<never>(() => {
              // Simulates a queue/backend stall; callback must still finish.
            });
          },
        },
      });

      const completion = service.completeOAuthCallback({
        state: "state_1",
        code: "oauth-code-secret",
      });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(completion).resolves.toMatchObject({
        account: {
          id: "acc_existing",
          email: "boss@gmail.com",
          syncState: "syncing",
        },
      });
      await expect(completion).resolves.not.toHaveProperty("syncJob");
    } finally {
      vi.useRealTimers();
    }
  });
});

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
