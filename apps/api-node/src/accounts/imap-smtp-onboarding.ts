import type {
  BootstrapSyncJob,
  BootstrapSyncJobStore,
  EnqueueInitialSyncInput,
} from "./bootstrap-sync-job-store.js";
import type {
  EmailEngineAccountsClient,
  EmailEngineConnectionCheck,
  RegisterImapSmtpAccountInput,
} from "../mail-engine/email-engine-accounts-client.js";

export interface ImapSmtpEndpointSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  secret: string;
}

export interface ImapSmtpProviderPreset {
  imap: Pick<ImapSmtpEndpointSettings, "host" | "port" | "secure">;
  smtp: Pick<ImapSmtpEndpointSettings, "host" | "port" | "secure">;
}

export type ImapSmtpProviderPresetOverrides = Partial<
  Record<string, ImapSmtpProviderPreset>
>;

export interface ImapSmtpOnboardingInput {
  email: string;
  provider: string;
  displayName?: string;
  username?: string;
  secret?: string;
  imap?: ImapSmtpEndpointSettings;
  smtp?: ImapSmtpEndpointSettings;
}

export interface OnboardingTask {
  id: string;
  email: string;
  provider: string;
  authMethod: "password" | "oauth";
  status: "pending" | "completed" | "failed";
  errorMessage?: string;
  payload?: Record<string, unknown>;
}

export interface ConnectedAccount {
  id: string;
  email: string;
  provider: string;
  authMethod: "password";
  displayName?: string;
  syncState: "syncing" | "reauth_required";
  engineProvider: "emailengine";
}

export interface AccountOnboardingResult {
  task: OnboardingTask;
  account?: ConnectedAccount;
  syncJob?: BootstrapSyncJob;
}

export class ImapSmtpOnboardingFailedError extends Error {
  readonly code = "imap_smtp_onboarding_failed";
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

export interface AccountOnboardingService {
  onboardImapSmtp(
    input: ImapSmtpOnboardingInput,
  ): Promise<AccountOnboardingResult>;
  testImapSmtpConnection(
    input: ImapSmtpOnboardingInput,
  ): Promise<ImapSmtpConnectionTestResult>;
}

export interface AccountOnboardingStore {
  createTask(input: OnboardingTask): Promise<OnboardingTask>;
  reserveAccountIdForEmailProvider?(input: {
    email: string;
    provider: string;
    proposedAccountId: string;
  }): Promise<string>;
  findAccountByEmailProvider?(input: {
    email: string;
    provider: string;
  }): Promise<ConnectedAccount | undefined>;
  completeTask(input: {
    taskId: string;
    account: ConnectedAccount;
  }): Promise<AccountOnboardingResult>;
  completeTaskAndEnqueueInitialSync?(input: {
    taskId: string;
    account: ConnectedAccount;
    initialSync: EnqueueInitialSyncInput;
  }): Promise<AccountOnboardingResult & { syncJob: BootstrapSyncJob }>;
  failTask(input: {
    taskId: string;
    errorMessage: string;
  }): Promise<OnboardingTask>;
}

export interface InMemoryAccountOnboardingStore extends AccountOnboardingStore {
  listTasks(): OnboardingTask[];
  listAccounts(): ConnectedAccount[];
}

export interface ImapSmtpOnboardingServiceOptions {
  store: AccountOnboardingStore;
  emailEngineAccounts: Pick<
    EmailEngineAccountsClient,
    "registerImapSmtpAccount"
  > &
    Partial<Pick<EmailEngineAccountsClient, "verifyImapSmtpAccount">>;
  bootstrapSyncJobs?: BootstrapSyncJobStore;
  createId: () => string;
  providerPresetOverrides?: ImapSmtpProviderPresetOverrides;
}

export interface ImapSmtpConnectionCheckResult {
  ok: boolean;
  code?: string;
  error?: string;
}

export type ImapSmtpConnectionDiagnosticSeverity = "action_required";

export interface ImapSmtpConnectionDiagnostic {
  code: string;
  provider: string;
  severity: ImapSmtpConnectionDiagnosticSeverity;
  affected: "account" | "imap" | "smtp";
  message: string;
  recoveryAction: string;
}

export interface ImapSmtpConnectionTestResult {
  provider: string;
  ok: boolean;
  checks: {
    imap: ImapSmtpConnectionCheckResult;
    smtp: ImapSmtpConnectionCheckResult;
  };
  diagnostics: ImapSmtpConnectionDiagnostic[];
}

export function createImapSmtpOnboardingService(
  options: ImapSmtpOnboardingServiceOptions,
): AccountOnboardingService {
  return {
    async testImapSmtpConnection(input) {
      if (!options.emailEngineAccounts.verifyImapSmtpAccount) {
        throw new Error("EmailEngine account verification is not configured");
      }

      const settings = resolveImapSmtpSettings(input, {
        providerPresetOverrides: options.providerPresetOverrides,
      });
      const result = await options.emailEngineAccounts.verifyImapSmtpAccount({
        email: input.email,
        imap: settings.imap,
        smtp: settings.smtp,
      });
      const imap = normalizeConnectionCheck(result.imap);
      const smtp = normalizeConnectionCheck(result.smtp);

      return {
        provider: settings.provider,
        ok: imap.ok && smtp.ok,
        checks: { imap, smtp },
        diagnostics: buildImapSmtpConnectionDiagnostics(settings.provider, {
          imap,
          smtp,
        }),
      };
    },
    async onboardImapSmtp(input) {
      const settings = resolveImapSmtpSettings(input, {
        providerPresetOverrides: options.providerPresetOverrides,
      });
      const taskId = options.createId();
      const proposedAccountId = options.createId();
      const accountId =
        (await options.store.reserveAccountIdForEmailProvider?.({
          email: input.email,
          provider: settings.provider,
          proposedAccountId,
        })) ??
        (
          await options.store.findAccountByEmailProvider?.({
            email: input.email,
            provider: settings.provider,
          })
        )?.id ??
        proposedAccountId;

      await options.store.createTask({
        id: taskId,
        email: input.email,
        provider: settings.provider,
        authMethod: "password",
        status: "pending",
        payload: redactedPayload(input, accountId, settings),
      });

      let result: AccountOnboardingResult;
      try {
        const registrationInput: RegisterImapSmtpAccountInput = {
          accountId,
          email: input.email,
          displayName: input.displayName,
          imap: settings.imap,
          smtp: settings.smtp,
        };
        await options.emailEngineAccounts.registerImapSmtpAccount(
          registrationInput,
        );

        const account: ConnectedAccount = {
          id: accountId,
          email: input.email,
          provider: settings.provider,
          authMethod: "password",
          displayName: input.displayName,
          syncState: "syncing",
          engineProvider: "emailengine",
        };
        const initialSync: EnqueueInitialSyncInput = {
          accountId,
          provider: settings.provider,
          engineProvider: "emailengine",
          sourceTaskId: taskId,
        };

        if (options.store.completeTaskAndEnqueueInitialSync) {
          result = await options.store.completeTaskAndEnqueueInitialSync({
            taskId,
            account,
            initialSync,
          });
        } else {
          result = await options.store.completeTask({
            taskId,
            account,
          });

          const syncJob = await options.bootstrapSyncJobs?.enqueueInitialSync(
            {
              ...initialSync,
              accountId: result.account?.id ?? initialSync.accountId,
            },
          );
          result = {
            ...result,
            ...(syncJob ? { syncJob } : {}),
          };
        }
      } catch (error) {
        const sensitiveValues = imapSmtpSensitiveValues(input, settings);
        const message = sanitizedRegistrationError(error, sensitiveValues);
        const diagnostics = diagnosticsForImapSmtpRegistrationFailure(
          settings.provider,
          error,
        ).map((diagnostic) =>
          sanitizeImapSmtpConnectionDiagnostic(diagnostic, sensitiveValues),
        );
        await options.store.failTask({
          taskId,
          errorMessage: message,
        });
        throw new ImapSmtpOnboardingFailedError({
          provider: settings.provider,
          message,
          diagnostics,
        });
      }

      return result;
    },
  };
}

function normalizeConnectionCheck(
  check: EmailEngineConnectionCheck | undefined,
): ImapSmtpConnectionCheckResult {
  const ok = check?.success !== false;
  return {
    ok,
    ...(check?.code ? { code: check.code } : {}),
    ...(check?.error ? { error: check.error } : {}),
  };
}

export function buildImapSmtpConnectionDiagnostics(
  provider: string,
  checks: {
    imap: ImapSmtpConnectionCheckResult;
    smtp: ImapSmtpConnectionCheckResult;
  },
): ImapSmtpConnectionDiagnostic[] {
  if (checks.imap.ok && checks.smtp.ok) {
    return [];
  }

  if (
    provider === "proton_bridge" &&
    (isConnectionFailure(checks.imap) || isConnectionFailure(checks.smtp))
  ) {
    return [
      {
        code: "proton_bridge_unreachable",
        provider,
        severity: "action_required",
        affected: "account",
        message:
          "Start Proton Bridge on this computer, keep it signed in, then test this mailbox again.",
        recoveryAction: "start_proton_bridge",
      },
    ];
  }

  if (isAuthenticationFailure(checks.imap) || isAuthenticationFailure(checks.smtp)) {
    const diagnostic = authenticationDiagnostic(provider);
    if (diagnostic) {
      return [diagnostic];
    }
  }

  if (isConnectionFailure(checks.imap) || isConnectionFailure(checks.smtp)) {
    return [
      {
        code: "mail_server_unreachable",
        provider,
        severity: "action_required",
        affected: "account",
        message:
          "Check this mailbox server address, port, and network connection, then test again.",
        recoveryAction: "check_mail_server_connection",
      },
    ];
  }

  return [
    {
      code: "mail_credentials_rejected",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Check this mailbox username and mailbox-specific password, then test again.",
      recoveryAction: "check_mailbox_credentials",
    },
  ];
}

export function diagnosticsForImapSmtpRegistrationFailure(
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

function authenticationDiagnostic(
  provider: string,
): ImapSmtpConnectionDiagnostic | undefined {
  if (provider === "icloud") {
    return {
      code: "icloud_app_specific_password_required",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Use an Apple app-specific password for iCloud Mail. Apple ID passwords will not work.",
      recoveryAction: "create_apple_app_specific_password",
    };
  }

  if (provider === "gmail") {
    return {
      code: "gmail_web_login_required",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Use the official Google web login flow to connect this mailbox.",
      recoveryAction: "start_google_web_login",
    };
  }

  if (provider === "outlook") {
    return {
      code: "outlook_web_login_required",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Use the official Microsoft web login flow to connect this mailbox.",
      recoveryAction: "start_microsoft_web_login",
    };
  }

  if (provider === "qq") {
    return {
      code: "qq_authorization_code_required",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Use the authorization code generated in QQ Mail settings, not your normal account password.",
      recoveryAction: "enable_qq_mail_authorization_code",
    };
  }

  if (provider === "163") {
    return {
      code: "netease_163_authorization_code_required",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Use the authorization code generated in 163 Mail settings, not your normal account password.",
      recoveryAction: "enable_163_mail_authorization_code",
    };
  }

  if (provider === "tencent_exmail") {
    return {
      code: "tencent_exmail_client_access_required",
      provider,
      severity: "action_required",
      affected: "account",
      message:
        "Ask the enterprise mail administrator to enable third-party client access, then enable it in this mailbox and retry with the generated authorization code.",
      recoveryAction: "enable_tencent_exmail_client_access",
    };
  }

  return undefined;
}

function isAuthenticationFailure(check: ImapSmtpConnectionCheckResult): boolean {
  if (check.ok) {
    return false;
  }

  const code = normalizedErrorCode(check.code);
  if (
    [
      "EAUTH",
      "AUTHENTICATIONFAILED",
      "AUTHENTICATION_FAILED",
      "AUTHFAILED",
      "AUTH_FAILED",
      "LOGINFAILED",
      "LOGIN_FAILED",
    ].includes(code)
  ) {
    return true;
  }

  const error = check.error?.toLowerCase() ?? "";
  return (
    error.includes("auth") ||
    error.includes("invalid login") ||
    error.includes("invalid password") ||
    error.includes("login failed")
  );
}

function isConnectionFailure(check: ImapSmtpConnectionCheckResult): boolean {
  if (check.ok) {
    return false;
  }

  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
  ].includes(normalizedErrorCode(check.code));
}

function normalizedErrorCode(code: string | undefined): string {
  return code?.trim().toUpperCase() ?? "";
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

function imapSmtpSensitiveValues(
  input: ImapSmtpOnboardingInput,
  settings: ResolvedImapSmtpSettings,
): string[] {
  return [
    input.secret,
    input.imap?.secret,
    input.smtp?.secret,
    settings.imap.secret,
    settings.smtp.secret,
  ].filter(isNonEmptyString);
}

function sanitizedRegistrationError(
  error: unknown,
  sensitiveValues: string[],
): string {
  const message =
    error instanceof Error ? error.message : "unknown onboarding error";
  return scrubKnownSensitiveText(message, sensitiveValues);
}

function sanitizeImapSmtpConnectionDiagnostic(
  diagnostic: ImapSmtpConnectionDiagnostic,
  sensitiveValues: string[],
): ImapSmtpConnectionDiagnostic {
  return {
    code: diagnostic.code,
    provider: diagnostic.provider,
    severity: diagnostic.severity,
    affected: diagnostic.affected,
    message: scrubKnownSensitiveText(diagnostic.message, sensitiveValues),
    recoveryAction: diagnostic.recoveryAction,
  };
}

function scrubKnownSensitiveText(
  value: string,
  sensitiveValues: string[],
): string {
  return sensitiveValues
    .filter(isNonEmptyString)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (output, secret) => output.split(secret).join("[redacted]"),
      value,
    );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface ResolvedImapSmtpSettings {
  provider: string;
  providerPreset?: string;
  imap: ImapSmtpEndpointSettings;
  smtp: ImapSmtpEndpointSettings;
}

export function hasImapSmtpProviderPreset(provider: string): boolean {
  return normalizeImapSmtpProvider(provider) in IMAP_SMTP_PROVIDER_PRESETS;
}

export function normalizeImapSmtpProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  const compact = normalized.replace(/[\s._-]/g, "");
  if (
    [
      "icloud",
      "icloudmail",
      "icloudcom",
      "apple",
      "applemail",
      "appleicloud",
      "mecom",
      "maccom",
      "icould",
    ].includes(compact)
  ) {
    return "icloud";
  }
  if (normalized === "proton" || normalized === "protonmail") {
    return "proton_bridge";
  }
  if (normalized === "qqmail") {
    return "qq";
  }
  if (normalized === "netease" || normalized === "163mail") {
    return "163";
  }
  if (
    normalized === "exmail" ||
    normalized === "qqexmail" ||
    normalized === "wecom" ||
    compact === "tencentmail" ||
    compact === "tencentexmail" ||
    compact === "tencententerpriseemail" ||
    compact === "wechatworkmail"
  ) {
    return "tencent_exmail";
  }

  return normalized;
}

export function resolveImapSmtpSettings(
  input: ImapSmtpOnboardingInput,
  options: {
    providerPresetOverrides?: ImapSmtpProviderPresetOverrides;
  } = {},
): ResolvedImapSmtpSettings {
  const provider = normalizeImapSmtpProvider(input.provider);
  if (input.imap && input.smtp) {
    return {
      provider,
      imap: input.imap,
      smtp: input.smtp,
    };
  }

  const preset =
    options.providerPresetOverrides?.[provider] ??
    IMAP_SMTP_PROVIDER_PRESETS[provider];
  if (!preset) {
    throw new Error("imap and smtp settings are required");
  }

  if (!input.secret || input.secret.trim().length === 0) {
    throw new Error("secret is required");
  }

  const usernames = resolveEndpointUsernames({
    provider,
    email: input.email,
    username: input.username,
  });
  const secret = input.secret.trim();
  return {
    provider,
    providerPreset: provider,
    imap: {
      host: preset.imap.host,
      port: preset.imap.port,
      secure: preset.imap.secure,
      username: usernames.imap,
      secret,
    },
    smtp: {
      host: preset.smtp.host,
      port: preset.smtp.port,
      secure: preset.smtp.secure,
      username: usernames.smtp,
      secret,
    },
  };
}

function resolveEndpointUsernames(input: {
  provider: string;
  email: string;
  username?: string;
}): { imap: string; smtp: string } {
  const explicitUsername = input.username?.trim();
  const email = input.email.trim();

  if (input.provider === "icloud") {
    return {
      imap: explicitUsername || iCloudImapUsername(email),
      smtp: email,
    };
  }

  const username = explicitUsername || email;
  return { imap: username, smtp: username };
}

function iCloudImapUsername(email: string): string {
  const atIndex = email.indexOf("@");
  return atIndex > 0 ? email.slice(0, atIndex) : email;
}

const IMAP_SMTP_PROVIDER_PRESETS: Record<string, ImapSmtpProviderPreset> = {
  gmail: {
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  outlook: {
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  },
  "163": {
    imap: { host: "imap.163.com", port: 993, secure: true },
    smtp: { host: "smtp.163.com", port: 465, secure: true },
  },
  qq: {
    imap: { host: "imap.qq.com", port: 993, secure: true },
    smtp: { host: "smtp.qq.com", port: 465, secure: true },
  },
  tencent_exmail: {
    imap: { host: "imap.exmail.qq.com", port: 993, secure: true },
    smtp: { host: "smtp.exmail.qq.com", port: 465, secure: true },
  },
  icloud: {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
  proton_bridge: {
    imap: { host: "127.0.0.1", port: 1143, secure: false },
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
  },
};

export function createInMemoryAccountOnboardingStore(): InMemoryAccountOnboardingStore {
  const tasks: OnboardingTask[] = [];
  const accounts: ConnectedAccount[] = [];
  const accountKeys: Array<{
    email: string;
    provider: string;
    accountId: string;
  }> = [];

  return {
    async createTask(input) {
      tasks.push({ ...input });
      return { ...input };
    },
    async findAccountByEmailProvider(input) {
      const account = accounts.find(
        (item) =>
          item.email === input.email && item.provider === input.provider,
      );
      return account ? { ...account } : undefined;
    },
    async reserveAccountIdForEmailProvider(input) {
      const existingKey = accountKeys.find(
        (key) => key.email === input.email && key.provider === input.provider,
      );
      if (existingKey) {
        return existingKey.accountId;
      }

      const existingAccount = accounts.find(
        (account) =>
          account.email === input.email && account.provider === input.provider,
      );
      const accountId = existingAccount?.id ?? input.proposedAccountId;
      accountKeys.push({
        email: input.email,
        provider: input.provider,
        accountId,
      });
      return accountId;
    },
    async completeTask(input) {
      const task = findTask(tasks, input.taskId);
      task.status = "completed";
      const existingAccount = accounts.find(
        (account) =>
          account.email === input.account.email &&
          account.provider === input.account.provider,
      );
      if (existingAccount) {
        existingAccount.displayName = input.account.displayName;
        existingAccount.syncState = input.account.syncState;
        existingAccount.engineProvider = input.account.engineProvider;
      } else {
        accounts.push({ ...input.account });
      }
      const account = existingAccount ?? input.account;
      return {
        task: publicTask(task),
        account: { ...account },
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
  };
}

function redactedPayload(
  input: ImapSmtpOnboardingInput,
  accountId: string,
  settings: ResolvedImapSmtpSettings,
): Record<string, unknown> {
  return {
    accountId,
    ...(settings.providerPreset
      ? { providerPreset: settings.providerPreset }
      : {}),
    displayName: input.displayName,
    imap: redactEndpoint(settings.imap),
    smtp: redactEndpoint(settings.smtp),
  };
}

function redactEndpoint(endpoint: ImapSmtpEndpointSettings) {
  return {
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    username: endpoint.username,
    secret: "[redacted]",
  };
}

function findTask(tasks: OnboardingTask[], taskId: string): OnboardingTask {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`onboarding task not found: ${taskId}`);
  }

  return task;
}

function publicTask(task: OnboardingTask): OnboardingTask {
  return {
    id: task.id,
    email: task.email,
    provider: task.provider,
    authMethod: task.authMethod,
    status: task.status,
    ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
  };
}
