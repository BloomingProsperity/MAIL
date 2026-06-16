import type {
  BootstrapSyncJob,
  BootstrapSyncJobStore,
} from "./bootstrap-sync-job-store.js";
import type {
  OAuthProfileClient,
  OAuthAccountProfile,
} from "./oauth-profile-client.js";
import type {
  OAuthProvider,
  OAuthProviderName,
  OAuthProviderRegistry,
} from "./oauth-providers.js";
import type { OAuthTokenClient, OAuthTokenSet } from "./oauth-token-client.js";
import type { EmailEngineAccountsClient } from "../mail-engine/email-engine-accounts-client.js";

export interface OAuthOnboardingTask {
  id: string;
  email: string;
  provider: OAuthProviderName;
  authMethod: "oauth";
  status: "pending" | "completed" | "failed";
  errorMessage?: string;
  payload?: Record<string, unknown>;
}

export interface OAuthConnectedAccount {
  id: string;
  email: string;
  provider: OAuthProviderName;
  authMethod: "oauth";
  displayName?: string;
  syncState: "syncing" | "reauth_required";
  engineProvider: "emailengine" | "native";
}

export interface OAuthAccountCredential {
  accountId: string;
  credentialKind: string;
  secretRef: string;
}

export interface OAuthProviderSettings {
  accountId: string;
  provider: OAuthProviderName;
  nativeProvider: OAuthProvider["nativeProvider"];
  capabilities: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface StoredSecret {
  secretRef: string;
  secretValue: string;
}

export interface OAuthOnboardingResult {
  task: OAuthOnboardingTask;
  account?: OAuthConnectedAccount;
  syncJob?: BootstrapSyncJob;
}

export interface OAuthAuthSessionResult {
  task: OAuthOnboardingTask;
  provider: OAuthProviderName;
  authorizationUrl: string;
  state: string;
}

export interface CreateOAuthAuthSessionInput {
  provider: OAuthProviderName;
  redirectUri: string;
  loginHint?: string;
}

export interface CompleteOAuthCallbackInput {
  state: string;
  code: string;
}

export interface OAuthSession {
  taskId: string;
  provider: OAuthProviderName;
  state: string;
  redirectUri: string;
  loginHint?: string;
}

export interface CompleteOAuthAccountInput {
  taskId: string;
  taskEmail: string;
  account: OAuthConnectedAccount;
  credential: OAuthAccountCredential;
  providerSettings: OAuthProviderSettings;
  secret: StoredSecret;
}

export interface OAuthOnboardingStore {
  createSession(input: {
    task: OAuthOnboardingTask;
    session: OAuthSession;
  }): Promise<OAuthOnboardingTask>;
  getSessionByState(state: string): Promise<OAuthSession | undefined>;
  completeOAuthAccount(
    input: CompleteOAuthAccountInput,
  ): Promise<OAuthOnboardingResult>;
  failTask(input: {
    taskId: string;
    errorMessage: string;
  }): Promise<OAuthOnboardingTask>;
}

export interface InMemoryOAuthOnboardingStore extends OAuthOnboardingStore {
  listTasks(): OAuthOnboardingTask[];
  listAccounts(): OAuthConnectedAccount[];
  listCredentials(): OAuthAccountCredential[];
  listProviderSettings(): OAuthProviderSettings[];
  listStoredSecrets(): StoredSecret[];
}

export interface OAuthOnboardingServiceOptions {
  store: OAuthOnboardingStore;
  providers: OAuthProviderRegistry;
  tokenClient: OAuthTokenClient;
  profileClient: OAuthProfileClient;
  emailEngineAccounts: Pick<EmailEngineAccountsClient, "registerOAuthAccount">;
  bootstrapSyncJobs?: BootstrapSyncJobStore;
  createId: () => string;
}

export interface OAuthOnboardingService {
  createAuthSession(
    input: CreateOAuthAuthSessionInput,
  ): Promise<OAuthAuthSessionResult>;
  completeAuthCallback(
    input: CompleteOAuthCallbackInput,
  ): Promise<OAuthOnboardingResult>;
}

export function createOAuthOnboardingService(
  options: OAuthOnboardingServiceOptions,
): OAuthOnboardingService {
  return {
    async createAuthSession(input) {
      const provider = options.providers.get(input.provider);
      const taskId = options.createId();
      const state = options.createId();
      const task: OAuthOnboardingTask = {
        id: taskId,
        email: `pending@${input.provider}.oauth`,
        provider: input.provider,
        authMethod: "oauth",
        status: "pending",
        payload: {
          state,
          redirectUri: input.redirectUri,
          ...(input.loginHint ? { loginHint: input.loginHint } : {}),
        },
      };

      const storedTask = await options.store.createSession({
        task,
        session: {
          taskId,
          provider: input.provider,
          state,
          redirectUri: input.redirectUri,
          ...(input.loginHint ? { loginHint: input.loginHint } : {}),
        },
      });

      return {
        task: publicTask(storedTask),
        provider: input.provider,
        state,
        authorizationUrl: provider.buildAuthorizationUrl({
          redirectUri: input.redirectUri,
          state,
          loginHint: input.loginHint,
        }),
      };
    },

    async completeAuthCallback(input) {
      const session = await options.store.getSessionByState(input.state);
      if (!session) {
        throw new Error("OAuth state was not found");
      }

      const provider = options.providers.get(session.provider);
      let result: OAuthOnboardingResult;
      let refreshTokenForRedaction: string | undefined;
      try {
        const token = await options.tokenClient.exchangeCode({
          provider,
          code: input.code,
          redirectUri: session.redirectUri,
        });
        if (!token.refreshToken) {
          throw new Error("OAuth callback did not return a refresh token");
        }
        refreshTokenForRedaction = token.refreshToken;

        const profile = await options.profileClient.getProfile({
          provider,
          accessToken: token.accessToken,
        });
        const accountId = options.createId();
        const secretId = options.createId();
        const account = accountFromProfile({
          accountId,
          provider,
          profile,
        });

        await options.emailEngineAccounts.registerOAuthAccount({
          accountId,
          email: profile.email,
          displayName: profile.displayName,
          provider: provider.provider,
        });

        result = await options.store.completeOAuthAccount({
          taskId: session.taskId,
          taskEmail: profile.email,
          account,
          credential: {
            accountId,
            credentialKind: provider.refreshCredentialKind,
            secretRef: `db:${secretId}`,
          },
          providerSettings: {
            accountId,
            provider: provider.provider,
            nativeProvider: provider.nativeProvider,
            capabilities: {
              read: true,
              send: true,
              engineProvider: "emailengine",
            },
            settings: {
              scopes: token.scope ?? provider.scopes.join(" "),
              emailEngineOAuthProvider: provider.provider,
              tokenSource: "emailengine_auth_server",
            },
          },
          secret: {
            secretRef: `db:${secretId}`,
            secretValue: token.refreshToken,
          },
        });
      } catch (error) {
        const message = sanitizedError(
          error,
          input.code,
          provider.clientSecret,
          refreshTokenForRedaction,
        );
        await options.store.failTask({
          taskId: session.taskId,
          errorMessage: message,
        });
        throw new Error(message);
      }

      if (!result.account) {
        return result;
      }

      const syncJob = await options.bootstrapSyncJobs?.enqueueInitialSync({
        accountId: result.account.id,
        provider: result.account.provider,
        engineProvider: result.account.engineProvider,
        sourceTaskId: session.taskId,
      });

      return {
        ...result,
        ...(syncJob ? { syncJob } : {}),
      };
    },
  };
}

export function createInMemoryOAuthOnboardingStore(): InMemoryOAuthOnboardingStore {
  const tasks: OAuthOnboardingTask[] = [];
  const sessions: OAuthSession[] = [];
  const accounts: OAuthConnectedAccount[] = [];
  const credentials: OAuthAccountCredential[] = [];
  const providerSettings: OAuthProviderSettings[] = [];
  const storedSecrets: StoredSecret[] = [];

  return {
    async createSession(input) {
      tasks.push({ ...input.task });
      sessions.push({ ...input.session });
      return { ...input.task };
    },
    async getSessionByState(state) {
      const session = sessions.find((item) => item.state === state);
      return session ? { ...session } : undefined;
    },
    async completeOAuthAccount(input) {
      const task = findTask(tasks, input.taskId);
      task.status = "completed";
      task.email = input.taskEmail;
      task.errorMessage = undefined;
      accounts.push({ ...input.account });
      credentials.push({ ...input.credential });
      providerSettings.push({ ...input.providerSettings });
      storedSecrets.push({ ...input.secret });
      return {
        task: publicTask(task),
        account: { ...input.account },
      };
    },
    async failTask(input) {
      const task = findTask(tasks, input.taskId);
      task.status = "failed";
      task.errorMessage = input.errorMessage;
      return { ...task };
    },
    listTasks() {
      return tasks.map((task) => ({ ...task }));
    },
    listAccounts() {
      return accounts.map((account) => ({ ...account }));
    },
    listCredentials() {
      return credentials.map((credential) => ({ ...credential }));
    },
    listProviderSettings() {
      return providerSettings.map((settings) => ({ ...settings }));
    },
    listStoredSecrets() {
      return storedSecrets.map((secret) => ({ ...secret }));
    },
  };
}

function accountFromProfile(input: {
  accountId: string;
  provider: OAuthProvider;
  profile: OAuthAccountProfile;
}): OAuthConnectedAccount {
  return {
    id: input.accountId,
    email: input.profile.email,
    provider: input.provider.provider,
    authMethod: "oauth",
    displayName: input.profile.displayName,
    syncState: "syncing",
    engineProvider: "emailengine",
  };
}

function findTask(
  tasks: OAuthOnboardingTask[],
  taskId: string,
): OAuthOnboardingTask {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`onboarding task not found: ${taskId}`);
  }

  return task;
}

function publicTask(task: OAuthOnboardingTask): OAuthOnboardingTask {
  return {
    id: task.id,
    email: task.email,
    provider: task.provider,
    authMethod: "oauth",
    status: task.status,
    errorMessage: task.errorMessage,
  };
}

function sanitizedError(
  error: unknown,
  code: string,
  clientSecret?: string,
  refreshToken?: string,
): string {
  let message = error instanceof Error ? error.message : "unknown OAuth error";
  for (const secret of [code, clientSecret, refreshToken]) {
    if (secret) {
      message = message.split(secret).join("[redacted]");
    }
  }
  return message;
}
