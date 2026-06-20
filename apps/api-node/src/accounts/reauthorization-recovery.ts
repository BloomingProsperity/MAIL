import type { BootstrapSyncJobStore } from "./bootstrap-sync-job-store.js";
import type {
  AccountOnboardingResult,
  AccountOnboardingStore,
  ImapSmtpEndpointSettings,
  ImapSmtpConnectionDiagnostic,
  ImapSmtpProviderPresetOverrides,
  OnboardingTask,
} from "./imap-smtp-onboarding.js";
import {
  buildImapSmtpConnectionDiagnostics,
  normalizeImapSmtpProvider,
  resolveImapSmtpSettings,
} from "./imap-smtp-onboarding.js";
import type {
  OAuthAuthSessionResult,
  OAuthConnectedAccount,
  OAuthOnboardingResult,
  OAuthOnboardingStore,
  OAuthOnboardingTask,
} from "./oauth-onboarding.js";
import type {
  OAuthProfileClient,
  OAuthAccountProfile,
} from "./oauth-profile-client.js";
import { profileFromIdToken } from "./oauth-id-token-profile.js";
import type {
  OAuthProvider,
  OAuthProviderName,
  OAuthProviderRegistry,
} from "./oauth-providers.js";
import type { OAuthTokenClient } from "./oauth-token-client.js";
import type { EmailEngineAccountsClient } from "../mail-engine/email-engine-accounts-client.js";

export class InvalidReauthorizationRequestError extends Error {
  readonly code = "invalid_reauthorization_request";

  constructor(message = "invalid reauthorization request") {
    super(message);
  }
}

export class ReauthorizationFailedError extends Error {
  readonly code = "reauthorization_failed";
  readonly provider: string;
  readonly diagnostics: ImapSmtpConnectionDiagnostic[];

  constructor(input: {
    provider: string;
    message: string;
    diagnostics?: ImapSmtpConnectionDiagnostic[];
  }) {
    super(input.message);
    this.provider = input.provider;
    this.diagnostics = input.diagnostics ?? [];
  }
}

export interface ReauthorizationTaskStore {
  getTask(taskId: string): Promise<OnboardingTask | undefined>;
  updateOAuthSession(input: {
    taskId: string;
    session: {
      state: string;
      redirectUri: string;
      loginHint?: string;
    };
  }): Promise<OnboardingTask>;
}

export interface ReauthorizationRecoveryService {
  startOAuth(input: {
    taskId: string;
    redirectUri: string;
  }): Promise<OAuthAuthSessionResult>;
  completeOAuthCallback(input: {
    state: string;
    code: string;
  }): Promise<OAuthOnboardingResult>;
  completeImapSmtp(input: {
    taskId: string;
    username?: string;
    secret: string;
    imap?: ImapSmtpEndpointSettings;
    smtp?: ImapSmtpEndpointSettings;
  }): Promise<AccountOnboardingResult>;
}

export interface ReauthorizationRecoveryServiceOptions {
  reauthorizationTasks: ReauthorizationTaskStore;
  oauthStore: Pick<
    OAuthOnboardingStore,
    | "getSessionByState"
    | "reserveAccountIdForEmailProvider"
    | "completeOAuthAccount"
    | "failTask"
  >;
  accountStore: Pick<AccountOnboardingStore, "completeTask" | "failTask">;
  emailEngineAccounts: Pick<
    EmailEngineAccountsClient,
    "registerImapSmtpAccount" | "registerOAuthAccount"
  >;
  providers: OAuthProviderRegistry;
  tokenClient: OAuthTokenClient;
  profileClient: OAuthProfileClient;
  bootstrapSyncJobs?: BootstrapSyncJobStore;
  createId: () => string;
  providerPresetOverrides?: ImapSmtpProviderPresetOverrides;
}

export function createReauthorizationRecoveryService(
  options: ReauthorizationRecoveryServiceOptions,
): ReauthorizationRecoveryService {
  return {
    async startOAuth(input) {
      const task = await loadRecoveryTask(options, input.taskId);
      if (task.authMethod !== "oauth") {
        throw new InvalidReauthorizationRequestError();
      }

      const providerName = oauthProvider(task.provider);
      const provider = options.providers.get(providerName);
      const state = options.createId();
      const payload = task.payload ?? {};
      const loginHint = readString(payload.loginHint) ?? task.email;
      const session = {
        state,
        redirectUri: input.redirectUri,
        ...(loginHint ? { loginHint } : {}),
      };
      const storedTask = await options.reauthorizationTasks.updateOAuthSession({
        taskId: task.id,
        session,
      });

      return {
        task: publicOAuthTask(storedTask, providerName),
        provider: providerName,
        state,
        authorizationUrl: provider.buildAuthorizationUrl(session),
      };
    },

    async completeOAuthCallback(input) {
      const session = await options.oauthStore.getSessionByState(input.state);
      if (!session) {
        throw new InvalidReauthorizationRequestError("OAuth state was not found");
      }

      const task = await loadRecoveryTask(options, session.taskId);
      if (task.authMethod !== "oauth" || task.provider !== session.provider) {
        throw new InvalidReauthorizationRequestError();
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

        const profile =
          profileFromIdToken(provider, token.idToken) ??
          (await options.profileClient.getProfile({
            provider,
            accessToken: token.accessToken,
          }));
        assertReauthorizationProfileMatchesTask(task, profile);

        const payload = task.payload ?? {};
        const accountId =
          (await options.oauthStore.reserveAccountIdForEmailProvider?.({
            email: profile.email,
            provider: provider.provider,
            proposedAccountId: readString(payload.accountId) ?? options.createId(),
          })) ??
          readString(payload.accountId) ??
          options.createId();
        const secretId = options.createId();
        const account = oauthAccountFromProfile({
          accountId,
          provider,
          profile,
          displayName: readString(payload.displayName),
        });

        result = await options.oauthStore.completeOAuthAccount({
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

        await options.emailEngineAccounts.registerOAuthAccount({
          accountId: result.account?.id ?? accountId,
          email: profile.email,
          displayName: result.account?.displayName ?? account.displayName,
          provider: provider.provider,
        });
      } catch (error) {
        const message = sanitizedOAuthError(
          error,
          input.code,
          provider.clientSecret,
          refreshTokenForRedaction,
        );
        await options.oauthStore.failTask({
          taskId: session.taskId,
          errorMessage: message,
        });
        throw new Error(message);
      }

      if (!result.account) {
        return result;
      }

      const syncJob = await enqueueInitialSyncForCallback(
        options.bootstrapSyncJobs,
        {
          accountId: result.account.id,
          provider: result.account.provider,
          engineProvider: result.account.engineProvider,
          sourceTaskId: session.taskId,
        },
      );

      return {
        ...result,
        ...(syncJob ? { syncJob } : {}),
      };
    },

    async completeImapSmtp(input) {
      const task = await loadRecoveryTask(options, input.taskId);
      if (task.authMethod !== "password") {
        throw new InvalidReauthorizationRequestError();
      }

      const payload = task.payload ?? {};
      const accountId = readString(payload.accountId) ?? options.createId();
      const displayName = readString(payload.displayName);
      const payloadEndpoints = endpointOverridesFromPayload(payload, {
        username: input.username,
        secret: input.secret,
      });
      const endpointOverrides =
        input.imap && input.smtp
          ? { imap: input.imap, smtp: input.smtp }
          : payloadEndpoints;
      let settings;
      try {
        settings = resolveImapSmtpSettings(
          {
            email: task.email,
            provider: task.provider,
            username: input.username ?? readString(payload.username),
            secret: input.secret,
            ...(endpointOverrides ? endpointOverrides : {}),
          },
          {
            providerPresetOverrides: options.providerPresetOverrides,
          },
        );

        await options.emailEngineAccounts.registerImapSmtpAccount({
          accountId,
          email: task.email,
          displayName,
          imap: settings.imap,
          smtp: settings.smtp,
        });
      } catch (error) {
        const provider =
          settings?.provider ?? normalizeImapSmtpProvider(task.provider);
        const message = sanitizedError(error, input.secret);
        const diagnostics = diagnosticsForRegistrationFailure(
          provider,
          error,
        );
        await options.accountStore.failTask({
          taskId: task.id,
          errorMessage: message,
        });
        throw new ReauthorizationFailedError({
          provider,
          message,
          diagnostics,
        });
      }

      const result = await options.accountStore.completeTask({
        taskId: task.id,
        account: {
          id: accountId,
          email: task.email,
          provider: settings.provider,
          authMethod: "password",
          displayName,
          syncState: "syncing",
          engineProvider: "emailengine",
        },
      });

      const syncJob = await options.bootstrapSyncJobs?.enqueueInitialSync({
        accountId,
        provider: settings.provider,
        engineProvider: "emailengine",
        sourceTaskId: task.id,
      });

      return {
        ...result,
        ...(syncJob ? { syncJob } : {}),
      };
    },
  };
}

async function loadRecoveryTask(
  options: ReauthorizationRecoveryServiceOptions,
  taskId: string,
): Promise<OnboardingTask> {
  const task = await options.reauthorizationTasks.getTask(taskId);
  if (!task || !isRecoverableTask(task)) {
    throw new InvalidReauthorizationRequestError(
      "reauthorization task was not found",
    );
  }

  return task;
}

function isRecoverableTask(task: OnboardingTask): boolean {
  if (task.status !== "pending" && task.status !== "failed") {
    return false;
  }

  const payload = task.payload ?? {};
  return (
    payload.reauthRequired === true ||
    payload.source === "csv_import" ||
    payload.source === "account_transfer_import"
  );
}

function oauthProvider(provider: string): OAuthProviderName {
  if (provider === "gmail" || provider === "outlook") {
    return provider;
  }

  throw new InvalidReauthorizationRequestError();
}

function publicOAuthTask(
  task: OnboardingTask,
  provider: OAuthProviderName,
): OAuthOnboardingTask {
  return {
    id: task.id,
    email: task.email,
    provider,
    authMethod: "oauth",
    status: task.status,
    ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertReauthorizationProfileMatchesTask(
  task: OnboardingTask,
  profile: OAuthAccountProfile,
): void {
  if (profile.email.toLowerCase() !== task.email.toLowerCase()) {
    throw new Error(`OAuth account mismatch: expected ${task.email}`);
  }
}

function oauthAccountFromProfile(input: {
  accountId: string;
  provider: OAuthProvider;
  profile: OAuthAccountProfile;
  displayName?: string;
}): OAuthConnectedAccount {
  return {
    id: input.accountId,
    email: input.profile.email,
    provider: input.provider.provider,
    authMethod: "oauth",
    displayName: input.displayName ?? input.profile.displayName,
    syncState: "syncing",
    engineProvider: "emailengine",
  };
}

function endpointOverridesFromPayload(
  payload: Record<string, unknown>,
  input: { username?: string; secret: string },
):
  | {
      imap: ImapSmtpEndpointSettings;
      smtp: ImapSmtpEndpointSettings;
    }
  | undefined {
  const imap = endpointFromPayload(payload.imap, input);
  const smtp = endpointFromPayload(payload.smtp, input);
  return imap && smtp ? { imap, smtp } : undefined;
}

function endpointFromPayload(
  value: unknown,
  input: { username?: string; secret: string },
): ImapSmtpEndpointSettings | undefined {
  const endpoint = recordValue(value);
  const host = readString(endpoint.host);
  const port = readNumber(endpoint.port);
  const secure = readBoolean(endpoint.secure);
  const username = input.username ?? readString(endpoint.username);
  if (!host || !port || secure === undefined || !username) {
    return undefined;
  }

  return {
    host,
    port,
    secure,
    username,
    secret: input.secret,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return undefined;
}

function sanitizedError(error: unknown, secret: string): string {
  const message =
    error instanceof Error ? error.message : "unknown reauthorization error";
  return message.split(secret).join("[redacted]");
}

function sanitizedOAuthError(
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

function diagnosticsForRegistrationFailure(
  provider: string,
  error: unknown,
): ImapSmtpConnectionDiagnostic[] {
  const check = {
    ok: false,
    ...(errorCode(error) ? { code: errorCode(error) } : {}),
    error: error instanceof Error ? error.message : String(error),
  };

  return buildImapSmtpConnectionDiagnostics(provider, {
    imap: check,
    smtp: check,
  });
}

function errorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return undefined;
}

function enqueueInitialSyncForCallback(
  store: BootstrapSyncJobStore | undefined,
  input: Parameters<BootstrapSyncJobStore["enqueueInitialSync"]>[0],
): Promise<Awaited<ReturnType<BootstrapSyncJobStore["enqueueInitialSync"]>> | undefined> {
  if (!store) {
    return Promise.resolve(undefined);
  }

  const enqueue = store.enqueueInitialSync(input);
  enqueue.catch(() => {
    // OAuth callbacks must not strand the browser on /oauth/callback.
  });

  return Promise.race([
    enqueue,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), 1000);
    }),
  ]);
}
