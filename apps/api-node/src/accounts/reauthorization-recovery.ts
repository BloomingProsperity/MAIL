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
  resolveImapSmtpSettings,
} from "./imap-smtp-onboarding.js";
import type {
  OAuthAuthSessionResult,
  OAuthOnboardingTask,
} from "./oauth-onboarding.js";
import type {
  OAuthProviderName,
  OAuthProviderRegistry,
} from "./oauth-providers.js";
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
  accountStore: Pick<AccountOnboardingStore, "completeTask" | "failTask">;
  emailEngineAccounts: Pick<
    EmailEngineAccountsClient,
    "registerImapSmtpAccount"
  >;
  providers: OAuthProviderRegistry;
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

    async completeImapSmtp(input) {
      const task = await loadRecoveryTask(options, input.taskId);
      if (task.authMethod !== "password") {
        throw new InvalidReauthorizationRequestError();
      }

      const payload = task.payload ?? {};
      const accountId = readString(payload.accountId) ?? options.createId();
      const displayName = readString(payload.displayName);
      let settings;
      try {
        settings = resolveImapSmtpSettings(
          {
            email: task.email,
            provider: task.provider,
            username: input.username ?? readString(payload.username),
            secret: input.secret,
            ...(input.imap && input.smtp
              ? {
                  imap: input.imap,
                  smtp: input.smtp,
                }
              : {}),
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
        const message = sanitizedError(error, input.secret);
        const diagnostics = diagnosticsForRegistrationFailure(
          task.provider,
          error,
        );
        await options.accountStore.failTask({
          taskId: task.id,
          errorMessage: message,
        });
        throw new ReauthorizationFailedError({
          provider: task.provider,
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

function sanitizedError(error: unknown, secret: string): string {
  const message =
    error instanceof Error ? error.message : "unknown reauthorization error";
  return message.split(secret).join("[redacted]");
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
