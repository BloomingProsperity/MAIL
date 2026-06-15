import type { OnboardingTask } from "./imap-smtp-onboarding.js";

export class InvalidAccountTransferError extends Error {
  readonly code = "invalid_account_transfer";

  constructor(message = "invalid account transfer package") {
    super(message);
  }
}

export type AccountTransferAuthMethod = "password" | "oauth";
export type AccountTransferEngineProvider = "emailengine" | "native";

export interface AccountTransferAccount {
  id?: string;
  email: string;
  provider: string;
  authMethod: AccountTransferAuthMethod;
  displayName?: string;
  engineProvider: AccountTransferEngineProvider;
  providerPreset?: string;
  username?: string;
  labels?: string[];
  group?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface AccountTransferPackage {
  schemaVersion: 1;
  exportedAt: string;
  accounts: AccountTransferAccount[];
}

export interface AccountTransferSource {
  listTransferAccounts(input: {
    accountIds?: string[];
  }): Promise<AccountTransferAccount[]>;
}

export interface AccountTransferTaskStore {
  createTask(input: OnboardingTask): Promise<OnboardingTask>;
}

export interface AccountTransferService {
  exportConfig(input: {
    accountIds?: string[];
  }): Promise<AccountTransferPackage>;
  importConfig(input: {
    package: AccountTransferPackage;
  }): Promise<{
    importedTaskCount: number;
    reauthRequiredCount: number;
    tasks: OnboardingTask[];
  }>;
}

export interface AccountTransferServiceOptions {
  accountSource: AccountTransferSource;
  taskStore: AccountTransferTaskStore;
  createId: () => string;
  now?: () => string;
}

export function createAccountTransferService(
  options: AccountTransferServiceOptions,
): AccountTransferService {
  return {
    async exportConfig(input) {
      const accounts = await options.accountSource.listTransferAccounts({
        ...(input.accountIds ? { accountIds: input.accountIds } : {}),
      });

      return {
        schemaVersion: 1,
        exportedAt: options.now?.() ?? new Date().toISOString(),
        accounts: accounts.map(safeExportAccount),
      };
    },

    async importConfig(input) {
      validateTransferPackage(input.package);

      const tasks: OnboardingTask[] = [];
      for (const account of input.package.accounts) {
        const task = await options.taskStore.createTask({
          id: options.createId(),
          email: account.email,
          provider: account.provider,
          authMethod: account.authMethod,
          status: "pending",
          payload: buildReauthPayload(account),
        });
        tasks.push(task);
      }

      return {
        importedTaskCount: tasks.length,
        reauthRequiredCount: tasks.length,
        tasks,
      };
    },
  };
}

export function validateTransferPackage(
  value: unknown,
): AccountTransferPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidAccountTransferError();
  }

  const transferPackage = value as Partial<AccountTransferPackage>;
  if (
    transferPackage.schemaVersion !== 1 ||
    !isNonEmptyString(transferPackage.exportedAt) ||
    !Array.isArray(transferPackage.accounts)
  ) {
    throw new InvalidAccountTransferError();
  }

  for (const account of transferPackage.accounts) {
    if (!isValidTransferAccount(account)) {
      throw new InvalidAccountTransferError();
    }
  }

  return transferPackage as AccountTransferPackage;
}

function safeExportAccount(
  account: AccountTransferAccount,
): AccountTransferAccount {
  return compactObject({
    email: account.email,
    provider: account.provider,
    authMethod: normalizeAuthMethod(account.authMethod),
    displayName: account.displayName,
    engineProvider: normalizeEngineProvider(account.engineProvider),
    providerPreset: account.providerPreset,
    username: account.username,
    labels: safeLabels(account.labels),
    group: account.group,
    notes: account.notes,
  });
}

function buildReauthPayload(
  account: AccountTransferAccount,
): Record<string, unknown> {
  return compactObject({
    source: "account_transfer_import",
    transferVersion: 1,
    reauthRequired: true,
    displayName: account.displayName,
    engineProvider: normalizeEngineProvider(account.engineProvider),
    providerPreset: account.providerPreset,
    username: account.username,
    labels: safeLabels(account.labels),
    group: account.group,
    notes: account.notes,
    ...(account.authMethod === "oauth" ? { loginHint: account.email } : {}),
  });
}

function isValidTransferAccount(value: unknown): value is AccountTransferAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const account = value as Partial<AccountTransferAccount>;
  if (!isNonEmptyString(account.email) || !isNonEmptyString(account.provider)) {
    return false;
  }
  if (account.authMethod !== "password" && account.authMethod !== "oauth") {
    return false;
  }
  if (
    account.engineProvider !== "emailengine" &&
    account.engineProvider !== "native"
  ) {
    return false;
  }
  if (
    account.labels !== undefined &&
    (!Array.isArray(account.labels) ||
      !account.labels.every((item) => isNonEmptyString(item)))
  ) {
    return false;
  }

  return true;
}

function normalizeAuthMethod(
  value: AccountTransferAuthMethod,
): AccountTransferAuthMethod {
  return value === "oauth" ? "oauth" : "password";
}

function normalizeEngineProvider(
  value: AccountTransferEngineProvider,
): AccountTransferEngineProvider {
  return value === "native" ? "native" : "emailengine";
}

function safeLabels(value: string[] | undefined): string[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  return value;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
