import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Clock3, Download, ShieldCheck } from "lucide-react";

import { AddMailProviderCard } from "./AddMailProviderCard";
import "./AddMailPage.css";
import { ACCOUNT_CSV_TEMPLATE } from "./accountCsvTemplate";
import { AddMailConnectedAccountsPanel } from "./AddMailConnectedAccountsPanel";
import { formatProviderLabel, formatSyncStateLabel } from "./addMailFormatters";
import {
  accountIdentityKey,
  isProviderInAddMailProviderGroup,
} from "./addMailProviderGroups";
import { formatAccountCsvImportIssue } from "./csvImportIssues";
import {
  fallbackAddMailProviderOptions,
  providerCapabilityToOption,
  type AddMailProviderOption,
} from "./providerCapabilities";
import { ProtonBridgeServerFieldsPanel } from "./ProtonBridgeServerFieldsPanel";
import {
  defaultProtonBridgeServerFields,
  type ProtonBridgeServerFields,
} from "./protonBridgeOnboarding";
import {
  buildManualOnboardingInput,
  buildPresetOnboardingInput,
  defaultCustomServerFields,
  type CustomServerFields,
} from "./onboardingInput";
import { formatOAuthStartError } from "./oauthDiagnostics";
import { SyncCenterAccountNextAction } from "../sync-center/SyncCenterAccountNextAction";
import { SyncCenterLatestJobSummary } from "../sync-center/SyncCenterLatestJobSummary";
import { ConnectionDiagnosticList } from "../sync-center/ConnectionDiagnosticList";
import {
  apiErrorConnectionDiagnostics,
  connectionDiagnosticsFromTestResult,
} from "../sync-center/connectionDiagnostics";
import type {
  AccountImportCreateResult,
  AccountImportPreview,
  AccountImportPreviewRow,
  AccountTransferImportResult,
  AccountTransferPackage,
  EmailHubApi,
  ImapSmtpConnectionDiagnostic,
  MailEngineHealthDto,
  OAuthProvider,
  OperationalEventDto,
  ReauthorizationTaskDto,
  SyncCenterAccountDto,
  SyncCenterImapSmtpReauthorizationInput,
} from "../../lib/emailHubApi";

export type AddMailProviderGroupId =
  | "gmail"
  | "outlook"
  | "icloud"
  | "domestic"
  | "proton"
  | "domain";

export type PasswordReauthorizationFormState = {
  username: string;
  secret: string;
  useCustomServers: boolean;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
};

interface OAuthPendingState {
  provider: OAuthProvider;
  flow: "onboarding" | "reauthorization";
  returnTo: "add-mail";
  createdAt: string;
}

const ACCOUNT_CONNECT_SUCCESS_REDIRECT_MS = 650;
const OAUTH_PENDING_PREFIX = "email-hub:oauth:";

function storeOAuthPendingState(state: string, pending: OAuthPendingState): void {
  try {
    window.sessionStorage.setItem(
      `${OAUTH_PENDING_PREFIX}${state}`,
      JSON.stringify(pending),
    );
  } catch {
    // The app can continue without preserving the OAuth return hint.
  }
}

function formatMailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
export function AddMailPage(props: {
  api?: EmailHubApi;
  providerGroupId?: AddMailProviderGroupId;
  oauthRedirect: (url: string) => void;
  onConnected?: (accountId?: string) => Promise<void> | void;
  onComplete?: () => void;
  onOpenSyncCenter?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [manualProvider, setManualProvider] = useState<
    AddMailProviderOption | undefined
  >();
  const [activeCredentialProvider, setActiveCredentialProvider] =
    useState<AddMailProviderOption | undefined>();
  const [customServerFields, setCustomServerFields] =
    useState<CustomServerFields>(defaultCustomServerFields);
  const [protonBridgeServerFields, setProtonBridgeServerFields] =
    useState<ProtonBridgeServerFields>(defaultProtonBridgeServerFields);
  const [busyProvider, setBusyProvider] = useState("");
  const [diagnostics, setDiagnostics] = useState<OperationalEventDto[]>([]);
  const [onboardingRecoveryDiagnostics, setOnboardingRecoveryDiagnostics] =
    useState<ImapSmtpConnectionDiagnostic[]>([]);
  const [mailEngineHealth, setMailEngineHealth] =
    useState<MailEngineHealthDto | undefined>();
  const [mailEngineHealthUnavailable, setMailEngineHealthUnavailable] =
    useState(false);
  const [providerOptions, setProviderOptions] =
    useState<AddMailProviderOption[]>(fallbackAddMailProviderOptions);
  const [csvImportText, setCsvImportText] = useState("");
  const [csvPreview, setCsvPreview] = useState<AccountImportPreview | undefined>();
  const [csvImportResult, setCsvImportResult] =
    useState<AccountImportCreateResult | undefined>();
  const [transferPackageText, setTransferPackageText] = useState("");
  const [transferAccounts, setTransferAccounts] = useState<SyncCenterAccountDto[]>([]);
  const [selectedTransferAccountIds, setSelectedTransferAccountIds] = useState<string[]>([]);
  const [transferImportResult, setTransferImportResult] =
    useState<AccountTransferImportResult | undefined>();
  const [transferFileName, setTransferFileName] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkBusy, setBulkBusy] = useState("");
  const [busyImportTaskId, setBusyImportTaskId] = useState("");
  const [reauthorizations, setReauthorizations] = useState<
    ReauthorizationTaskDto[]
  >([]);
  const [passwordReauthorizationForms, setPasswordReauthorizationForms] =
    useState<Record<string, PasswordReauthorizationFormState>>({});
  const [reauthorizationDiagnostics, setReauthorizationDiagnostics] =
    useState<Record<string, ImapSmtpConnectionDiagnostic[]>>({});
  const [busyReauthorizationTaskId, setBusyReauthorizationTaskId] = useState("");
  const completionTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!props.api) {
      setProviderOptions(fallbackAddMailProviderOptions);
      return;
    }

    let cancelled = false;
    props.api
      .getMailProviderCapabilities()
      .then((response) => {
        if (cancelled) {
          return;
        }

        const nextProviders = response.providers.map(providerCapabilityToOption);
        setProviderOptions(
          nextProviders.length > 0
            ? nextProviders
            : fallbackAddMailProviderOptions,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setProviderOptions(fallbackAddMailProviderOptions);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineHealth(undefined);
      setMailEngineHealthUnavailable(false);
      return;
    }

    let cancelled = false;
    props.api
      .getMailEngineHealth()
      .then((health) => {
        if (!cancelled) {
          setMailEngineHealth(health);
          setMailEngineHealthUnavailable(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMailEngineHealth(undefined);
          setMailEngineHealthUnavailable(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setTransferAccounts([]);
      setSelectedTransferAccountIds([]);
      return;
    }

    let cancelled = false;
    props.api
      .listSyncCenterAccounts()
      .then((page) => {
        if (cancelled) {
          return;
        }
        setTransferAccounts(page.items);
        setSelectedTransferAccountIds((current) =>
          current.filter((accountId) =>
            page.items.some((account) => account.accountId === accountId),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTransferAccounts([]);
          setSelectedTransferAccountIds([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setReauthorizations([]);
      return;
    }
    if (typeof props.api.listSyncCenterReauthorizations !== "function") {
      setReauthorizations([]);
      return;
    }

    let cancelled = false;
    props.api
      .listSyncCenterReauthorizations()
      .then((page) => {
        if (!cancelled) {
          setReauthorizations(page.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReauthorizations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.api]);

  const visibleProviders = providerOptions.filter((provider) =>
    isProviderInAddMailProviderGroup(provider.provider, props.providerGroupId),
  );
  const visibleBridgeProvider = visibleProviders.find(
    (provider) => provider.action === "bridge",
  );
  const bridgeCredentialProvider =
    activeCredentialProvider?.action === "bridge"
      ? activeCredentialProvider
      : props.providerGroupId === "proton"
        ? visibleBridgeProvider
        : undefined;
  const showBridgeFieldHelp = Boolean(bridgeCredentialProvider);
  const credentialProvider =
    activeCredentialProvider &&
    (activeCredentialProvider.action === "password" ||
      activeCredentialProvider.action === "bridge")
      ? activeCredentialProvider
      : undefined;
  const showCredentialFields = Boolean(credentialProvider);
  const mailOnboardingUnavailable =
    mailEngineHealth?.capabilities.imapSmtpOnboarding === false;
  const visibleConnectedAccounts = transferAccounts.filter((account) =>
    isProviderInAddMailProviderGroup(account.provider, props.providerGroupId),
  );
  const activeConnectedAccountKeys = new Set(
    visibleConnectedAccounts
      .filter((account) => account.syncState !== "reauth_required")
      .map((account) => accountIdentityKey(account.email, account.provider)),
  );
  const visibleReauthorizations = reauthorizations.filter(
    (task) =>
      isAddMailReauthorizationTask(task) &&
      isProviderInAddMailProviderGroup(task.provider, props.providerGroupId) &&
      !activeConnectedAccountKeys.has(accountIdentityKey(task.email, task.provider)),
  );

  async function connectProvider(provider: AddMailProviderOption) {
    if (!props.api) {
      setNotice(`${provider.title} 连接服务还没有准备好。`);
      return;
    }

    if (mailOnboardingUnavailable && provider.action !== "manual") {
      setNotice("邮箱接入服务暂时不可用。");
      return;
    }

    if (provider.action === "oauth") {
      if (provider.disabled) {
        return;
      }
      if (provider.provider !== "gmail" && provider.provider !== "outlook") {
        setNotice(`${provider.title} 授权码或专用密码接入。`);
        return;
      }

      setBusyProvider(provider.provider);
      try {
        const loginHint = email.trim();
        const result = await props.api.startOAuthAccount({
          provider: provider.provider,
          redirectUri: `${window.location.origin}/oauth/callback`,
          ...(loginHint ? { loginHint } : {}),
        });
        storeOAuthPendingState(result.state, {
          provider: result.provider,
          flow: "onboarding",
          returnTo: "add-mail",
          createdAt: new Date().toISOString(),
        });
        props.oauthRedirect(result.authorizationUrl);
      } catch (error) {
        await loadOnboardingDiagnostics();
        setNotice(formatOAuthStartError(provider.title, error));
      } finally {
        setBusyProvider("");
      }
      return;
    }

    if (provider.action === "manual") {
      setManualProvider(provider);
      setActiveCredentialProvider(undefined);
      setNotice("");
      return;
    }

    setActiveCredentialProvider(provider);
    setManualProvider(undefined);
    setNotice("");
  }

  async function connectCredentialProvider() {
    const provider = credentialProvider;
    if (!props.api || !provider) {
      return;
    }

    if (mailOnboardingUnavailable) {
      setNotice("邮箱接入服务暂时不可用。");
      return;
    }

    const inputResult = buildPresetOnboardingInput(provider, {
      email,
      username,
      secret,
      bridgeFields: protonBridgeServerFields,
    });
    if (!inputResult.ok) {
      setNotice(inputResult.notice);
      return;
    }
    const input = inputResult.input;

    setBusyProvider(provider.provider);
    setDiagnostics([]);
    setOnboardingRecoveryDiagnostics([]);
    try {
      const testResult = await props.api.testImapSmtpConnection(input);
      if (!testResult.ok) {
        const recoveryDiagnostics =
          connectionDiagnosticsFromTestResult(testResult);
        await loadOnboardingDiagnostics();
        setOnboardingRecoveryDiagnostics(recoveryDiagnostics);
        setSecret("");
        setNotice(
          recoveryDiagnostics.length > 0
            ? `${provider.title} 连接检查未通过。`
            : `${provider.title} 连接检查未通过。`,
        );
        return;
      }

      const result = await props.api.onboardImapSmtpAccount(input);
      void Promise.resolve(props.onConnected?.(result.account?.id)).catch(() => {
        // Background mailbox refresh should not block the success transition.
      });
      setOnboardingRecoveryDiagnostics([]);
      setSecret("");
      setNotice(`${provider.title} 已接入，正在打开收件箱。`);
      scheduleAddMailCompletion();
    } catch (error) {
      const recoveryDiagnostics = apiErrorConnectionDiagnostics(error);
      await loadOnboardingDiagnostics();
      setOnboardingRecoveryDiagnostics(recoveryDiagnostics);
      setSecret("");
        setNotice(
          recoveryDiagnostics.length > 0
          ? `${provider.title} 暂时无法接入。`
          : `${provider.title} 暂时无法接入。`,
      );
    } finally {
      setBusyProvider("");
    }
  }

  async function connectManualProvider() {
    if (!props.api || !manualProvider) {
      return;
    }

    if (mailOnboardingUnavailable) {
      setNotice("邮箱接入服务暂时不可用。");
      return;
    }

    const inputResult = buildManualOnboardingInput(manualProvider, {
      email,
      fields: customServerFields,
    });
    if (!inputResult.ok) {
      setNotice(inputResult.notice);
      return;
    }
    const input = inputResult.input;

    setBusyProvider(manualProvider.provider);
    setDiagnostics([]);
    setOnboardingRecoveryDiagnostics([]);
    try {
      const testResult = await props.api.testImapSmtpConnection(input);
      if (!testResult.ok) {
        const recoveryDiagnostics =
          connectionDiagnosticsFromTestResult(testResult);
        await loadOnboardingDiagnostics();
        setOnboardingRecoveryDiagnostics(recoveryDiagnostics);
        clearCustomServerSecret();
        setNotice(
          recoveryDiagnostics.length > 0
            ? `${manualProvider.title} 连接检查未通过。`
            : `${manualProvider.title} 连接检查未通过。`,
        );
        return;
      }

      const result = await props.api.onboardImapSmtpAccount(input);
      void Promise.resolve(props.onConnected?.(result.account?.id)).catch(() => {
        // Background mailbox refresh should not block the success transition.
      });
      setOnboardingRecoveryDiagnostics([]);
      clearCustomServerSecret();
      setNotice(`${manualProvider.title} 已接入，正在打开收件箱。`);
      scheduleAddMailCompletion();
    } catch (error) {
      const recoveryDiagnostics = apiErrorConnectionDiagnostics(error);
      await loadOnboardingDiagnostics();
      setOnboardingRecoveryDiagnostics(recoveryDiagnostics);
      clearCustomServerSecret();
        setNotice(
          recoveryDiagnostics.length > 0
          ? `${manualProvider.title} 暂时无法接入。`
          : `${manualProvider.title} 暂时无法接入。`,
      );
    } finally {
      setBusyProvider("");
    }
  }

  function updateCustomServerField<K extends keyof CustomServerFields>(
    key: K,
    value: CustomServerFields[K],
  ) {
    setCustomServerFields((current) => ({ ...current, [key]: value }));
  }

  function updateProtonBridgeServerField<K extends keyof ProtonBridgeServerFields>(
    key: K,
    value: ProtonBridgeServerFields[K],
  ) {
    setProtonBridgeServerFields((current) => ({ ...current, [key]: value }));
  }

  function clearCustomServerSecret() {
    setCustomServerFields((current) => ({ ...current, secret: "" }));
  }

  function scheduleAddMailCompletion() {
    if (!props.onComplete) {
      return;
    }

    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
    }

    completionTimerRef.current = window.setTimeout(() => {
      props.onComplete?.();
    }, ACCOUNT_CONNECT_SUCCESS_REDIRECT_MS);
  }

  async function loadOnboardingDiagnostics() {
    if (!props.api) {
      return;
    }

    try {
      const page = await props.api.listOperationalEvents({
        service: "email-hub-api",
        lane: "account_onboarding",
        limit: 3,
      });
      setDiagnostics(page.items);
    } catch {
      setDiagnostics([]);
    }
  }

  async function previewCsvImport() {
    if (!props.api) {
      setBulkNotice("批量导入暂时不可用。");
      return;
    }
    if (!csvImportText.trim()) {
      setBulkNotice("CSV 内容为空。");
      return;
    }

    setBulkBusy("csv-preview");
    try {
      const result = await props.api.previewAccountCsv({ csv: csvImportText });
      setCsvPreview(result);
      setCsvImportResult(undefined);
      setBulkNotice(
        `预览完成：${result.summary.ready} 个可接入，${result.summary.invalid} 个需要修正。`,
      );
    } catch {
      setBulkNotice("CSV 预览失败。");
    } finally {
      setBulkBusy("");
    }
  }

  async function createCsvImport() {
    if (!props.api) {
      setBulkNotice("批量导入暂时无法开始。");
      return;
    }
    if (!csvImportText.trim()) {
      setBulkNotice("CSV 内容为空。");
      return;
    }

    setBulkBusy("csv-import");
    try {
      const result = await props.api.createAccountCsvImport({ csv: csvImportText });
      setCsvPreview(result);
      setCsvImportResult(result);
      setBulkNotice(
        `已创建 ${result.createdTaskCount} 个导入任务。`,
      );
      props.onConnected?.();
    } catch {
      setBulkNotice("导入任务创建失败。");
    } finally {
      setBulkBusy("");
    }
  }

  function downloadCsvTemplate() {
    const downloaded = downloadTextFile(
      "email-hub-account-import-template.csv",
      ACCOUNT_CSV_TEMPLATE,
      "text/csv;charset=utf-8",
    );
    setCsvImportText(ACCOUNT_CSV_TEMPLATE);
    setCsvPreview(undefined);
    setCsvImportResult(undefined);
    setBulkNotice(
      downloaded
        ? "CSV 模板已下载，并已放入文本框，可直接改成你的账号。"
        : "CSV 模板已放入文本框，可直接改成你的账号。",
    );
  }

  async function startImportedOAuthTask(task: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
  }) {
    if (task.authMethod !== "oauth") {
      props.onOpenSyncCenter?.();
      return;
    }
    if (!props.api) {
      setBulkNotice("继续授权暂时不可用。");
      return;
    }

    setBusyImportTaskId(task.id);
    try {
      const result = await props.api.startSyncCenterOAuthReauthorization({
        taskId: task.id,
        redirectUri: `${window.location.origin}/oauth/callback`,
      });
      storeOAuthPendingState(result.state, {
        provider: result.provider,
        flow: "reauthorization",
        returnTo: "add-mail",
        createdAt: new Date().toISOString(),
      });
      props.oauthRedirect(result.authorizationUrl);
    } catch {
      setBulkNotice(`${task.email} 授权暂时无法开始。`);
    } finally {
      setBusyImportTaskId("");
    }
  }

  async function startOAuthReauthorization(task: ReauthorizationTaskDto) {
    if (!props.api || task.authMethod !== "oauth") {
      setNotice("请重新提交这个邮箱的授权信息。");
      return;
    }

    setBusyReauthorizationTaskId(task.taskId);
    try {
      const result = await props.api.startSyncCenterOAuthReauthorization({
        taskId: task.taskId,
        redirectUri: `${window.location.origin}/oauth/callback`,
      });
      storeOAuthPendingState(result.state, {
        provider: result.provider,
        flow: "reauthorization",
        returnTo: "add-mail",
        createdAt: new Date().toISOString(),
      });
      props.oauthRedirect(result.authorizationUrl);
    } catch {
      setNotice("重新登录暂时无法开始。");
    } finally {
      setBusyReauthorizationTaskId("");
    }
  }

  function passwordReauthorizationForm(task: ReauthorizationTaskDto) {
    return (
      passwordReauthorizationForms[task.taskId] ??
      createPasswordReauthorizationForm(task)
    );
  }

  function updatePasswordReauthorizationForm(
    task: ReauthorizationTaskDto,
    patch: Partial<PasswordReauthorizationFormState>,
  ) {
    setPasswordReauthorizationForms((current) => ({
      ...current,
      [task.taskId]: {
        ...createPasswordReauthorizationForm(task),
        ...current[task.taskId],
        ...patch,
      },
    }));
  }

  function clearPasswordReauthorizationSecret(task: ReauthorizationTaskDto) {
    setPasswordReauthorizationForms((current) => {
      const existing = current[task.taskId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [task.taskId]: { ...existing, secret: "" },
      };
    });
  }

  function removePasswordReauthorizationForm(task: ReauthorizationTaskDto) {
    setPasswordReauthorizationForms((current) => {
      const remaining = { ...current };
      delete remaining[task.taskId];
      return remaining;
    });
  }

  function removeReauthorizationDiagnostics(task: ReauthorizationTaskDto) {
    setReauthorizationDiagnostics((current) => {
      const remaining = { ...current };
      delete remaining[task.taskId];
      return remaining;
    });
  }

  async function completePasswordReauthorization(
    event: FormEvent<HTMLFormElement>,
    task: ReauthorizationTaskDto,
  ) {
    event.preventDefault();
    if (!props.api || task.authMethod !== "password") {
      setNotice("请重新提交这个邮箱的授权信息。");
      return;
    }

    const form = passwordReauthorizationForm(task);
    const username = form.username.trim();
    const secret = form.secret.trim();
    if (!secret) {
      setNotice("请输入新的授权码或专用密码。");
      return;
    }

    const payload: SyncCenterImapSmtpReauthorizationInput = {
      taskId: task.taskId,
      ...(username ? { username } : {}),
      secret,
    };

    if (form.useCustomServers) {
      const imapHost = form.imapHost.trim();
      const smtpHost = form.smtpHost.trim();
      const imapPort = parseReauthorizationPort(form.imapPort);
      const smtpPort = parseReauthorizationPort(form.smtpPort);
      const endpointUsername = username || task.email;
      if (!imapHost || !smtpHost || !imapPort || !smtpPort) {
        setNotice("请填写有效的收信/发信主机和端口。");
        return;
      }

      payload.imap = {
        host: imapHost,
        port: imapPort,
        secure: form.imapSecure,
        username: endpointUsername,
        secret,
      };
      payload.smtp = {
        host: smtpHost,
        port: smtpPort,
        secure: form.smtpSecure,
        username: endpointUsername,
        secret,
      };
    }

    setBusyReauthorizationTaskId(task.taskId);
    try {
      const result = await props.api.completeSyncCenterImapSmtpReauthorization(
        payload,
      );
      setReauthorizations((current) =>
        current.filter((item) => item.taskId !== task.taskId),
      );
      removePasswordReauthorizationForm(task);
      removeReauthorizationDiagnostics(task);
      setNotice(`${result.account?.email ?? task.email} 已恢复同步。`);
      props.onConnected?.(result.account?.id);
    } catch (error) {
      const diagnostics = apiErrorConnectionDiagnostics(error);
      clearPasswordReauthorizationSecret(task);
      setReauthorizationDiagnostics((current) => ({
        ...current,
        [task.taskId]: diagnostics,
      }));
      setNotice(
        diagnostics.length > 0
          ? `${task.email} 重新授权未通过。`
          : `${task.email} 重新授权失败。`,
      );
    } finally {
      setBusyReauthorizationTaskId("");
    }
  }

  async function exportTransferPackage() {
    if (!props.api) {
      setBulkNotice("导出暂时不可用。");
      return;
    }

    setBulkBusy("transfer-export");
    setTransferImportResult(undefined);
    try {
      const selectedAccountIds = selectedTransferAccountIds;
      const transferPackage =
        selectedAccountIds.length > 0
          ? await props.api.exportAccountTransfer({
              accountIds: selectedAccountIds,
            })
          : await props.api.exportAccountTransfer();
      setTransferPackageText(JSON.stringify(transferPackage, null, 2));
      const downloaded = downloadJsonFile(
        `email-hub-transfer-${transferPackage.exportedAt.slice(0, 10)}.json`,
        transferPackage,
      );
      setBulkNotice(
        `已导出 ${transferPackage.accounts.length} 个账号配置，不包含密码或令牌。${
          downloaded ? "迁移包文件已生成。" : "迁移包已放入文本框。"
        }`,
      );
    } catch {
      setBulkNotice("账号配置导出失败。");
    } finally {
      setBulkBusy("");
    }
  }

  async function importTransferPackage() {
    if (!props.api) {
      setBulkNotice("导入暂时不可用。");
      return;
    }
    if (!transferPackageText.trim()) {
      setBulkNotice("迁移包 JSON 为空。");
      return;
    }

    let transferPackage: AccountTransferPackage;
    try {
      transferPackage = JSON.parse(transferPackageText) as AccountTransferPackage;
    } catch {
      setBulkNotice("迁移包不是有效 JSON。");
      return;
    }

    setBulkBusy("transfer-import");
    try {
      const result = await props.api.importAccountTransfer({
        package: transferPackage,
      });
      setTransferImportResult(result);
      setBulkNotice(
        `已导入 ${result.importedTaskCount} 个账号，${result.reauthRequiredCount} 个需要重新授权。`,
      );
      props.onConnected?.();
    } catch {
      setBulkNotice("迁移包导入失败。");
    } finally {
      setBulkBusy("");
    }
  }

  async function loadTransferPackageFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setBulkBusy("transfer-file");
    try {
      const text = await readBrowserFileText(file);
      const transferPackage = JSON.parse(text) as AccountTransferPackage;
      setTransferPackageText(JSON.stringify(transferPackage, null, 2));
      setTransferFileName(file.name);
      setTransferImportResult(undefined);
      setBulkNotice(
        `已读取迁移包文件：${file.name}，包含 ${transferPackage.accounts?.length ?? 0} 个账号。`,
      );
    } catch {
      setBulkNotice("迁移包文件读取失败，请选择有效 JSON 文件。");
    } finally {
      setBulkBusy("");
    }
  }

  function toggleTransferAccount(accountId: string, checked: boolean) {
    setSelectedTransferAccountIds((current) =>
      checked
        ? [...new Set([...current, accountId])]
        : current.filter((item) => item !== accountId),
    );
  }

  const showSyncCenterAction =
    (transferImportResult?.reauthRequiredCount ?? 0) > 0;
  const showEnterpriseImportPanel = false;

  return (
    <section className="workspace-page page-scroll add-mail-page">
      <header className="topbar single add-mail-topbar">
        <div>
          <h1>添加邮箱</h1>
        </div>
      </header>

      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}

      {visibleConnectedAccounts.length > 0 ? (
        <AddMailConnectedAccountsPanel accounts={visibleConnectedAccounts} />
      ) : null}

      {visibleReauthorizations.length > 0 ? (
        <ReauthorizationTasksPanel
          tasks={visibleReauthorizations}
          busyTaskId={busyReauthorizationTaskId}
          diagnostics={reauthorizationDiagnostics}
          passwordForm={passwordReauthorizationForm}
          onStartOAuth={(task) => void startOAuthReauthorization(task)}
          onSubmitPassword={(event, task) =>
            void completePasswordReauthorization(event, task)
          }
          onUpdatePasswordForm={updatePasswordReauthorizationForm}
        />
      ) : null}

      <ConnectionDiagnosticList
        ariaLabel="添加邮箱接入状态"
        className="page-panel diagnostic-list connection-diagnostic-list"
        diagnostics={onboardingRecoveryDiagnostics}
        rowClassName="diagnostic-row connection-diagnostic-row"
        title="接入状态"
      />

      <section className="page-panel add-mail-form" aria-label="添加邮箱信息">
        <label>
          <span>邮箱地址</span>
          <input
            aria-label="Add mail email"
            value={email}
            placeholder="name@example.com"
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
        </label>
        {showCredentialFields ? (
          <>
            <label>
              <span>{showBridgeFieldHelp ? "Bridge 用户名" : "登录用户名"}</span>
              <input
                aria-label="Add mail username"
                value={username}
                placeholder={email || "name@example.com"}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{showBridgeFieldHelp ? "Bridge 密码" : "授权码或专用密码"}</span>
              <input
                aria-label="Add mail secret"
                value={secret}
                type="password"
                placeholder="授权信息"
                onChange={(event) => setSecret(event.currentTarget.value)}
              />
            </label>
            <div className="credential-submit-row">
              <div>
                <strong>{credentialProvider?.title}</strong>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={
                  !credentialProvider ||
                  busyProvider === credentialProvider.provider
                }
                onClick={() => void connectCredentialProvider()}
              >
                {credentialProvider && busyProvider === credentialProvider.provider
                  ? "连接中"
                  : `接入${credentialProvider?.title ?? ""}`}
              </button>
            </div>
            {showBridgeFieldHelp ? (
              <ProtonBridgeServerFieldsPanel
                fields={protonBridgeServerFields}
                onFieldChange={updateProtonBridgeServerField}
              />
            ) : null}
          </>
        ) : null}
      </section>

      {manualProvider ? (
        <section className="page-panel custom-server-form" aria-label="个人域名邮箱服务器">
          <div className="custom-server-heading">
            <div>
              <h2>{manualProvider.title}</h2>
            </div>
            <button
              type="button"
              disabled={busyProvider === manualProvider.provider}
              onClick={() => void connectManualProvider()}
            >
              {busyProvider === manualProvider.provider
                ? "连接中"
                : `接入${manualProvider.title}`}
            </button>
          </div>

          <div className="custom-server-grid">
            <label>
              <span>登录用户名</span>
              <input
                aria-label="Custom mail username"
                value={customServerFields.username}
                placeholder={email || "name@example.com"}
                onChange={(event) =>
                  updateCustomServerField("username", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>专用密码</span>
              <input
                aria-label="Custom mail secret"
                value={customServerFields.secret}
                type="password"
                placeholder="邮箱专用密码"
                onChange={(event) =>
                  updateCustomServerField("secret", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>收信服务器</span>
              <input
                aria-label="Custom receive host"
                value={customServerFields.receiveHost}
                placeholder="mail.example.com"
                onChange={(event) =>
                  updateCustomServerField("receiveHost", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>收信端口</span>
              <input
                aria-label="Custom receive port"
                value={customServerFields.receivePort}
                inputMode="numeric"
                onChange={(event) =>
                  updateCustomServerField("receivePort", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>发信服务器</span>
              <input
                aria-label="Custom send host"
                value={customServerFields.sendHost}
                placeholder="smtp.example.com"
                onChange={(event) =>
                  updateCustomServerField("sendHost", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>发信端口</span>
              <input
                aria-label="Custom send port"
                value={customServerFields.sendPort}
                inputMode="numeric"
                onChange={(event) =>
                  updateCustomServerField("sendPort", event.currentTarget.value)
                }
              />
            </label>
            <label className="server-toggle">
              <input
                aria-label="Custom receive secure"
                checked={customServerFields.receiveSecure}
                type="checkbox"
                onChange={(event) =>
                  updateCustomServerField("receiveSecure", event.currentTarget.checked)
                }
              />
              <span>收信使用加密连接</span>
            </label>
            <label className="server-toggle">
              <input
                aria-label="Custom send secure"
                checked={customServerFields.sendSecure}
                type="checkbox"
                onChange={(event) =>
                  updateCustomServerField("sendSecure", event.currentTarget.checked)
                }
              />
              <span>发信使用加密连接</span>
            </label>
          </div>
        </section>
      ) : null}

      <div className="add-grid">
        {visibleProviders.map((provider) => (
          <AddMailProviderCard
            key={provider.provider}
            busy={busyProvider === provider.provider}
            disabled={mailOnboardingUnavailable || provider.disabled}
            provider={provider}
            onConnect={() => void connectProvider(provider)}
          />
        ))}
      </div>

      {showEnterpriseImportPanel ? (
      <details className="page-panel import-transfer-panel" aria-label="企业导入和账号迁移">
        <summary>企业导入 / 账号迁移</summary>
        <div className="custom-server-heading import-transfer-heading">
          <div>
            <h2>企业导入 / 账号转移</h2>
          </div>
          {showSyncCenterAction ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => props.onOpenSyncCenter?.()}
            >
              查看后续账号
            </button>
          ) : null}
        </div>
        {bulkNotice ? (
          <div className="backend-notice" role="status">
            {bulkNotice}
          </div>
        ) : null}
        <div className="import-transfer-grid">
          <label>
            <span>CSV 批量导入</span>
            <textarea
              aria-label="Account CSV import"
              value={csvImportText}
              placeholder="email,provider,display_name,auth_method,username,secret,labels,group,enabled,notes"
              onChange={(event) => {
                setCsvImportText(event.currentTarget.value);
                setCsvPreview(undefined);
                setCsvImportResult(undefined);
              }}
            />
          </label>
          <label>
            <span>
              账号迁移包{transferFileName ? ` · ${transferFileName}` : ""}
            </span>
            <textarea
              aria-label="Account transfer package"
              value={transferPackageText}
              placeholder='{"schemaVersion":1,"exportedAt":"...","accounts":[]}'
              onChange={(event) =>
                setTransferPackageText(event.currentTarget.value)
              }
            />
          </label>
        </div>
        <div className="transfer-account-picker" aria-label="迁移导出账号选择">
          <div>
            <strong>导出账号范围</strong>
            <span>
              {selectedTransferAccountIds.length > 0
                ? `已选择 ${selectedTransferAccountIds.length} 个账号`
                : "未选择时导出全部安全配置"}
            </span>
          </div>
          <div className="transfer-account-list">
            {transferAccounts.length > 0 ? (
              transferAccounts.map((account) => (
                <label key={account.accountId} className="field-toggle">
                  <input
                    aria-label={`Select transfer account ${account.email}`}
                    checked={selectedTransferAccountIds.includes(account.accountId)}
                    type="checkbox"
                    onChange={(event) =>
                      toggleTransferAccount(
                        account.accountId,
                        event.currentTarget.checked,
                      )
                    }
                  />
                  <span>
                    {account.email} · {formatSyncStateLabel(account.syncState)}
                  </span>
                </label>
              ))
            ) : (
              <span>暂无可导出的账号。</span>
            )}
          </div>
        </div>
        <div className="inline-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={downloadCsvTemplate}
          >
            <Download size={16} />
            下载 CSV 模板
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={bulkBusy === "csv-preview"}
            onClick={() => void previewCsvImport()}
          >
            预览 CSV
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={bulkBusy === "csv-import"}
            onClick={() => void createCsvImport()}
          >
            创建导入任务
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={bulkBusy === "transfer-export"}
            onClick={() => void exportTransferPackage()}
          >
            导出安全配置
          </button>
          <label className="file-button">
            <input
              aria-label="Account transfer file"
              accept="application/json,.json"
              type="file"
              onChange={(event) =>
                void loadTransferPackageFile(event.currentTarget.files?.[0])
              }
            />
            导入迁移包文件
          </label>
          <button
            className="ghost-button"
            type="button"
            disabled={bulkBusy === "transfer-import"}
            onClick={() => void importTransferPackage()}
          >
            导入迁移包
          </button>
        </div>
        {csvPreview ? (
          <CsvImportPreviewTable
            result={csvPreview}
            createdTaskCount={csvImportResult?.createdTaskCount}
            createdTasks={csvImportResult?.tasks}
          />
        ) : null}
        {transferImportResult ? (
          <TransferImportResultPanel
            result={transferImportResult}
            busyTaskId={busyImportTaskId}
            onOpenSyncCenter={props.onOpenSyncCenter}
            onStartOAuthTask={(task) => void startImportedOAuthTask(task)}
          />
        ) : null}
      </details>
      ) : null}

      {diagnostics.length > 0 ? (
        <section className="page-panel diagnostic-list" aria-label="添加邮箱诊断">
          <h2>最近诊断</h2>
          {diagnostics.map((event) => (
            <div className="diagnostic-row" key={event.id}>
              <strong>{friendlyOnboardingDiagnosticMessage(event)}</strong>
              <span>{event.occurredAt}</span>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}

function CsvImportPreviewTable(props: {
  result: AccountImportPreview;
  createdTaskCount?: number;
  createdTasks?: AccountImportCreateResult["tasks"];
}) {
  const createdTasksByRow = new Map(
    (props.createdTasks ?? []).map((task) => [task.rowNumber, task]),
  );

  return (
    <section className="migration-result-panel" aria-label="CSV 导入预览结果">
      <div className="migration-summary-grid">
        <p>
          <strong>{props.result.summary.totalRows}</strong>
          <span>总行数</span>
        </p>
        <p>
          <strong>{props.result.summary.ready}</strong>
          <span>可直接接入</span>
        </p>
        <p>
          <strong>{props.result.summary.invalid}</strong>
          <span>需要修正</span>
        </p>
        {props.createdTaskCount !== undefined ? (
          <p>
            <strong>{props.createdTaskCount}</strong>
            <span>已创建任务</span>
          </p>
        ) : null}
      </div>
      <div className="migration-table-wrap">
        <table className="migration-table">
          <thead>
            <tr>
              <th>行</th>
              <th>邮箱</th>
              <th>服务商</th>
              <th>授权</th>
              <th>状态</th>
              <th>问题</th>
              <th>后续</th>
            </tr>
          </thead>
          <tbody>
            {props.result.rows.map((row) => {
              const createdTask = createdTasksByRow.get(row.rowNumber);
              return (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td>{row.email ?? "未填写"}</td>
                  <td>{row.provider ? formatProviderLabel(row.provider) : "未识别"}</td>
                  <td>{row.authMethod === "oauth" ? "网页登录" : "专用密码"}</td>
                  <td>
                    <span className={`migration-status status-${row.status}`}>
                      {formatCsvImportStatus(row.status)}
                    </span>
                  </td>
                  <td>{formatCsvImportIssues(row)}</td>
                  <td>
                    {formatCsvImportNextAction(
                      row,
                      props.createdTaskCount !== undefined,
                      createdTask,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TransferImportResultPanel(props: {
  result: AccountTransferImportResult;
  busyTaskId?: string;
  onOpenSyncCenter?: () => void;
  onStartOAuthTask?: (
    task: AccountTransferImportResult["tasks"][number],
  ) => void;
}) {
  return (
    <section className="migration-result-panel" aria-label="账号迁移导入结果">
      <div className="migration-summary-grid">
        <p>
          <strong>{props.result.importedTaskCount}</strong>
          <span>已导入账号</span>
        </p>
        <p>
          <strong>{props.result.reauthRequiredCount}</strong>
          <span>需要重新授权</span>
        </p>
      </div>
      <ImportAuthorizationTaskList
        tasks={props.result.tasks}
        busyTaskId={props.busyTaskId}
        onOpenSyncCenter={props.onOpenSyncCenter}
        onStartOAuthTask={props.onStartOAuthTask}
      />
    </section>
  );
}

function ImportAuthorizationTaskList(props: {
  tasks: Array<{
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    status: string;
  }>;
  busyTaskId?: string;
  onOpenSyncCenter?: () => void;
  onStartOAuthTask?: (task: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    status: string;
  }) => void;
}) {
  return (
    <div className="migration-task-list" aria-label="导入后续授权任务">
      {props.tasks.map((task) => (
        <article className="migration-task-card" key={task.id}>
          <div>
            <strong>{task.email}</strong>
            <span>
              {formatProviderLabel(task.provider)} ·{" "}
              {task.authMethod === "oauth" ? "网页登录" : "专用密码"} ·{" "}
              {formatImportTaskStatus(task.status)}
            </span>
          </div>
          {task.authMethod === "oauth" ? (
            <button
              className="primary-button"
              type="button"
              aria-label={`继续授权 ${task.email}`}
              disabled={props.busyTaskId === task.id}
              onClick={() => props.onStartOAuthTask?.(task)}
            >
              继续授权
            </button>
          ) : (
            <span className="migration-task-hint">在上方重新提交授权信息</span>
          )}
        </article>
      ))}
    </div>
  );
}

function formatImportTaskStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    completed: "已完成",
    failed: "需处理",
  };
  return labels[status] ?? status;
}

function formatCsvImportStatus(status: AccountImportPreviewRow["status"]): string {
  if (status === "ready") return "可接入";
  if (status === "needs_oauth") return "需登录";
  if (status === "disabled") return "已跳过";
  return "需修正";
}

function formatCsvImportIssues(row: AccountImportPreviewRow): string {
  const issues = [...row.errors, ...row.warnings].map(formatAccountCsvImportIssue);
  return issues.length > 0 ? issues.join("；") : "无";
}

function formatCsvImportNextAction(
  row: AccountImportPreviewRow,
  tasksCreated: boolean,
  createdTask?: AccountImportCreateResult["tasks"][number],
): string {
  if (row.status === "invalid") {
    return "修正后再预览";
  }
  if (row.status === "disabled") {
    return "已跳过";
  }
  if (row.status === "needs_oauth") {
    return "请改为逐个网页登录";
  }
  if (createdTask) {
    return "已创建任务";
  }

  return tasksCreated ? "无需操作" : "创建任务后接入";
}

async function readBrowserFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

function downloadJsonFile(filename: string, value: unknown): boolean {
  return downloadTextFile(
    filename,
    JSON.stringify(value, null, 2),
    "application/json",
  );
}

function downloadTextFile(
  filename: string,
  text: string,
  type: string,
): boolean {
  if (
    typeof document === "undefined" ||
    typeof navigator === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    navigator.userAgent.toLowerCase().includes("jsdom")
  ) {
    return false;
  }

  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  return true;
}

function friendlyDiagnosticMessage(event: OperationalEventDto): string {
  if (event.event === "account_onboarding_connection_test_failed") {
    return "连接检查未通过";
  }
  if (event.event === "account_onboarding_failed") {
    return "邮箱接入失败";
  }
  if (event.event === "oauth_onboarding_start_failed") {
    return "登录窗口没有打开";
  }
  if (event.event === "oauth_onboarding_callback_failed") {
    return "登录授权没有完成";
  }

  return event.message ?? event.event;
}

function friendlyOnboardingDiagnosticMessage(event: OperationalEventDto): string {
  if (event.event === "account_onboarding_connection_test_failed") {
    return "连接检查未通过";
  }
  if (event.event === "account_onboarding_failed") {
    return "邮箱接入失败";
  }
  if (event.event === "oauth_onboarding_start_failed") {
    return "登录窗口没有打开";
  }
  if (event.event === "oauth_onboarding_callback_failed") {
    return "登录授权没有完成";
  }

  return "邮箱接入诊断记录";
}

function friendlySyncDiagnosticTitle(event: OperationalEventDto): string {
  const labels: Record<string, string> = {
    emailengine_webhook_ingested: "邮箱服务状态已更新",
    worker_result: "同步已处理",
    sync_account_failed: "同步没有完成",
    sync_account_dead_lettered: "同步多次失败",
    sync_job_retry_scheduled: "同步稍后重试",
    sync_job_dead_lettered: "同步多次失败",
    reauthorization_imap_smtp_failed: "重新授权没有通过",
    native_send_reauthorization_required: "发信权限需要重新授权",
    smtp_send_reauthorization_required: "发信权限需要重新提交授权码",
  };
  return labels[event.event] ?? friendlyDiagnosticMessage(event);
}

function friendlySyncDiagnosticDetail(event: OperationalEventDto): string | undefined {
  if (event.event === "emailengine_webhook_ingested") {
    return "已收到邮箱更新。";
  }
  if (event.event === "worker_result") {
    return "邮箱内容已同步。";
  }
  if (event.event === "sync_job_retry_scheduled") {
    return "稍后会自动重试。";
  }
  if (event.event === "sync_job_dead_lettered") {
    return "多次失败后已暂停重试。";
  }
  if (event.event === "reauthorization_imap_smtp_failed") {
    return "授权信息未通过。";
  }
  if (event.event.includes("reauthorization_required")) {
    return "账号需要重新授权。";
  }

  return event.message;
}

function formatOperationalEventSource(event: OperationalEventDto): string {
  if (event.event === "emailengine_webhook_ingested") {
    return "邮箱更新";
  }

  const labels: Record<string, string> = {
    "email-hub-api": "连接",
    "email-hub-worker": "同步",
  };

  return labels[event.service] ?? event.service;
}

function formatReauthorizationSource(source: string) {
  const labels: Record<string, string> = {
    native_send: "发信权限",
    native_smtp_send: "发信权限",
    account_transfer_import: "账号迁移",
    csv_import: "批量导入",
  };
  return labels[source] ?? source;
}

function formatReauthorizationSummary(task: ReauthorizationTaskDto): string {
  const parts = [
    formatProviderLabel(task.provider),
    task.authMethod === "oauth" ? "重新登录" : "重新提交授权码",
  ];
  const source = task.source ? formatReauthorizationSource(task.source) : "";
  if (
    source &&
    source !== task.source &&
    source !== "批量导入" &&
    source !== "账号迁移"
  ) {
    parts.push(source);
  }
  return parts.join(" · ");
}

function formatReauthorizationIssue(task: ReauthorizationTaskDto): string {
  if (!task.errorMessage && task.status !== "failed") {
    return "";
  }
  return task.authMethod === "oauth"
    ? "请重新登录。"
    : "请重新提交授权码或专用密码。";
}

function isAddMailReauthorizationTask(task: ReauthorizationTaskDto): boolean {
  return Boolean(
    task.reauthRequired &&
      (!task.source ||
        task.source === "emailengine_account_state" ||
        task.source === "native_send" ||
        task.source === "native_smtp_send"),
  );
}

function formatOperationalEventLevel(level: OperationalEventDto["level"]) {
  const labels: Record<OperationalEventDto["level"], string> = {
    debug: "记录",
    info: "信息",
    warn: "提醒",
    error: "错误",
  };
  return labels[level];
}

function createPasswordReauthorizationForm(
  task: ReauthorizationTaskDto,
): PasswordReauthorizationFormState {
  return {
    username: task.username ?? task.email,
    secret: "",
    useCustomServers: false,
    imapHost: "",
    imapPort: "993",
    imapSecure: true,
    smtpHost: "",
    smtpPort: "465",
    smtpSecure: true,
  };
}

function parseReauthorizationPort(value: string) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : undefined;
}

function ReauthorizationTasksPanel(props: {
  tasks: ReauthorizationTaskDto[];
  busyTaskId: string;
  diagnostics: Record<string, ImapSmtpConnectionDiagnostic[]>;
  passwordForm: (task: ReauthorizationTaskDto) => PasswordReauthorizationFormState;
  onStartOAuth: (task: ReauthorizationTaskDto) => void;
  onSubmitPassword: (
    event: FormEvent<HTMLFormElement>,
    task: ReauthorizationTaskDto,
  ) => void;
  onUpdatePasswordForm: (
    task: ReauthorizationTaskDto,
    patch: Partial<PasswordReauthorizationFormState>,
  ) => void;
}) {
  return (
    <section className="page-panel" aria-label="需要重新授权">
      <div className="custom-server-heading">
        <div>
          <h2>需要重新授权</h2>
        </div>
      </div>
      {props.tasks.map((task) => {
        const passwordForm = props.passwordForm(task);
        const taskDiagnostics = props.diagnostics[task.taskId] ?? [];

        return (
          <div
            className={`task-row ${
              task.authMethod === "password" ? "reauthorization-task-row" : ""
            }`}
            key={task.taskId}
          >
            <ShieldCheck size={19} />
            <div>
              <strong>{task.email}</strong>
              <span>
                {formatReauthorizationSummary(task)}
              </span>
              {formatReauthorizationIssue(task) ? (
                <p>{formatReauthorizationIssue(task)}</p>
              ) : null}
            </div>
            {task.authMethod === "oauth" ? (
              <div className="task-actions">
                <button
                  type="button"
                  aria-label={`重新登录 ${task.email}`}
                  disabled={props.busyTaskId === task.taskId}
                  onClick={() => props.onStartOAuth(task)}
                >
                  重新登录
                </button>
              </div>
            ) : (
              <form
                aria-label={`邮箱重新授权 ${task.email}`}
                className="reauthorization-form"
                onSubmit={(event) => props.onSubmitPassword(event, task)}
              >
                <label>
                  <span>登录用户名</span>
                  <input
                    aria-label={`登录用户名 ${task.email}`}
                    autoComplete="username"
                    type="text"
                    value={passwordForm.username}
                    onChange={(event) =>
                      props.onUpdatePasswordForm(task, {
                        username: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>授权码或专用密码</span>
                  <input
                    aria-label={`授权码或专用密码 ${task.email}`}
                    autoComplete="new-password"
                    type="password"
                    value={passwordForm.secret}
                    onChange={(event) =>
                      props.onUpdatePasswordForm(task, {
                        secret: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <label className="reauthorization-toggle">
                  <input
                    aria-label={`使用自定义收发信服务 ${task.email}`}
                    checked={passwordForm.useCustomServers}
                    type="checkbox"
                    onChange={(event) =>
                      props.onUpdatePasswordForm(task, {
                        useCustomServers: event.currentTarget.checked,
                      })
                    }
                  />
                  <span>使用自定义收发信服务</span>
                </label>
                {passwordForm.useCustomServers ? (
                  <div className="reauthorization-endpoints">
                    <label>
                      <span>收信主机</span>
                      <input
                        aria-label={`收信主机 ${task.email}`}
                        type="text"
                        value={passwordForm.imapHost}
                        onChange={(event) =>
                          props.onUpdatePasswordForm(task, {
                            imapHost: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>收信端口</span>
                      <input
                        aria-label={`收信端口 ${task.email}`}
                        inputMode="numeric"
                        type="text"
                        value={passwordForm.imapPort}
                        onChange={(event) =>
                          props.onUpdatePasswordForm(task, {
                            imapPort: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label className="reauthorization-toggle">
                      <input
                        aria-label={`收信安全连接 ${task.email}`}
                        checked={passwordForm.imapSecure}
                        type="checkbox"
                        onChange={(event) =>
                          props.onUpdatePasswordForm(task, {
                            imapSecure: event.currentTarget.checked,
                          })
                        }
                      />
                      <span>收信安全连接</span>
                    </label>
                    <label>
                      <span>发信主机</span>
                      <input
                        aria-label={`发信主机 ${task.email}`}
                        type="text"
                        value={passwordForm.smtpHost}
                        onChange={(event) =>
                          props.onUpdatePasswordForm(task, {
                            smtpHost: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>发信端口</span>
                      <input
                        aria-label={`发信端口 ${task.email}`}
                        inputMode="numeric"
                        type="text"
                        value={passwordForm.smtpPort}
                        onChange={(event) =>
                          props.onUpdatePasswordForm(task, {
                            smtpPort: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label className="reauthorization-toggle">
                      <input
                        aria-label={`发信安全连接 ${task.email}`}
                        checked={passwordForm.smtpSecure}
                        type="checkbox"
                        onChange={(event) =>
                          props.onUpdatePasswordForm(task, {
                            smtpSecure: event.currentTarget.checked,
                          })
                        }
                      />
                      <span>发信安全连接</span>
                    </label>
                  </div>
                ) : null}
                <button
                  type="submit"
                  aria-label={`提交重新授权 ${task.email}`}
                  disabled={props.busyTaskId === task.taskId}
                >
                  提交重新授权
                </button>
              </form>
            )}
            <ConnectionDiagnosticList
              ariaLabel={`重新授权检查 ${task.email}`}
              className="reauthorization-diagnostics"
              container="div"
              diagnostics={taskDiagnostics}
              role="status"
              rowClassName="reauthorization-diagnostic-card"
            />
          </div>
        );
      })}
    </section>
  );
}

export function SyncCenterPage(props: {
  api?: EmailHubApi;
  selectedAccountId?: string;
  oauthRedirect: (url: string) => void;
  onSelectAccount?: (accountId: string) => void;
}) {
  const [accounts, setAccounts] = useState<SyncCenterAccountDto[]>([]);
  const [reauthorizations, setReauthorizations] = useState<
    ReauthorizationTaskDto[]
  >([]);
  const [passwordReauthorizationForms, setPasswordReauthorizationForms] =
    useState<Record<string, PasswordReauthorizationFormState>>({});
  const [reauthorizationDiagnostics, setReauthorizationDiagnostics] =
    useState<Record<string, ImapSmtpConnectionDiagnostic[]>>({});
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
  const [busyReauthorizationTaskId, setBusyReauthorizationTaskId] = useState("");
  const [diagnosticAccount, setDiagnosticAccount] =
    useState<SyncCenterAccountDto | null>(null);
  const [diagnosticEvents, setDiagnosticEvents] = useState<OperationalEventDto[]>(
    [],
  );
  const [diagnosticNotice, setDiagnosticNotice] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const accountActionRequestRef = useRef<Record<string, number>>({});
  const accountActionNoticeRequestRef = useRef(0);
  const diagnosticRequestRef = useRef(0);

  function mergeAccountState(update: { accountId: string; syncState: string }) {
    setAccounts((current) =>
      current.map((account) =>
        account.accountId === update.accountId
          ? { ...account, syncState: update.syncState }
          : account,
      ),
    );
  }

  async function runAccountAction(
    account: SyncCenterAccountDto,
    action: "resync" | "pause" | "resume" | "retry-failed",
  ) {
    if (!props.api) {
      setNotice("同步操作暂时不可用。");
      return;
    }

    const actionKey = `${account.accountId}:${action}`;
    const requestId = (accountActionRequestRef.current[account.accountId] ?? 0) + 1;
    const noticeRequestId = accountActionNoticeRequestRef.current + 1;
    accountActionRequestRef.current[account.accountId] = requestId;
    accountActionNoticeRequestRef.current = noticeRequestId;
    setBusyActions((current) => new Set(current).add(actionKey));
    const canApplyResult = () =>
      accountActionRequestRef.current[account.accountId] === requestId;
    const canApplyNotice = () =>
      canApplyResult() &&
      accountActionNoticeRequestRef.current === noticeRequestId;
    try {
      if (action === "resync") {
        const result = await props.api.requestSyncCenterResync({
          accountId: account.accountId,
        });
        if (!canApplyResult()) {
          return;
        }
        if (canApplyNotice()) {
          setNotice(`重新同步已加入队列：${result.job.status}`);
        }
        return;
      }

      if (action === "pause") {
        const result = await props.api.pauseSyncCenterAccount({
          accountId: account.accountId,
        });
        if (!canApplyResult()) {
          return;
        }
        mergeAccountState(result.account);
        if (canApplyNotice()) {
          setNotice("同步已暂停。");
        }
        return;
      }

      if (action === "resume") {
        const result = await props.api.resumeSyncCenterAccount({
          accountId: account.accountId,
        });
        if (!canApplyResult()) {
          return;
        }
        mergeAccountState(result.account);
        if (canApplyNotice()) {
          setNotice("同步已恢复。");
        }
        return;
      }

      const result = await props.api.retryFailedSyncCenterJobs({
        accountId: account.accountId,
      });
      if (!canApplyResult()) {
        return;
      }
      if (canApplyNotice()) {
        setNotice(`已重新排队 ${result.retriedJobCount} 个失败任务。`);
      }
    } catch {
      if (canApplyNotice()) {
        setNotice("同步操作暂时失败。");
      }
    } finally {
      setBusyActions((current) => {
        const next = new Set(current);
        next.delete(actionKey);
        return next;
      });
    }
  }

  async function openAccountDiagnostics(account: SyncCenterAccountDto) {
    const requestId = diagnosticRequestRef.current + 1;
    diagnosticRequestRef.current = requestId;
    setDiagnosticAccount(account);

    if (!props.api) {
      setDiagnosticEvents([]);
      setDiagnosticNotice("检查暂时不可用。");
      return;
    }

    setDiagnosticBusy(true);
    setDiagnosticNotice("");
    try {
      const page = await props.api.listSyncCenterAccountDiagnostics({
        accountId: account.accountId,
        limit: 200,
      });
      if (diagnosticRequestRef.current !== requestId) {
        return;
      }
      setDiagnosticEvents(page.items);
      setDiagnosticNotice(
        page.items.length === 0 ? "这个账号还没有同步诊断记录。" : "",
      );
    } catch {
      if (diagnosticRequestRef.current === requestId) {
        setDiagnosticEvents([]);
        setDiagnosticNotice("检查暂时不可用。");
      }
    } finally {
      if (diagnosticRequestRef.current === requestId) {
        setDiagnosticBusy(false);
      }
    }
  }

  async function startOAuthReauthorization(task: ReauthorizationTaskDto) {
    if (!props.api || task.authMethod !== "oauth") {
      setNotice("这个账号需要在添加邮箱里重新提交授权信息。");
      return;
    }

    setBusyReauthorizationTaskId(task.taskId);
    try {
      const result = await props.api.startSyncCenterOAuthReauthorization({
        taskId: task.taskId,
        redirectUri: `${window.location.origin}/oauth/callback`,
      });
      storeOAuthPendingState(result.state, {
        provider: result.provider,
        flow: "reauthorization",
        returnTo: "add-mail",
        createdAt: new Date().toISOString(),
      });
      props.oauthRedirect(result.authorizationUrl);
    } catch {
      setNotice("重新登录暂时无法开始。");
    } finally {
      setBusyReauthorizationTaskId("");
    }
  }

  function passwordReauthorizationForm(task: ReauthorizationTaskDto) {
    return (
      passwordReauthorizationForms[task.taskId] ??
      createPasswordReauthorizationForm(task)
    );
  }

  function updatePasswordReauthorizationForm(
    task: ReauthorizationTaskDto,
    patch: Partial<PasswordReauthorizationFormState>,
  ) {
    setPasswordReauthorizationForms((current) => ({
      ...current,
      [task.taskId]: {
        ...createPasswordReauthorizationForm(task),
        ...current[task.taskId],
        ...patch,
      },
    }));
  }

  function clearPasswordReauthorizationSecret(task: ReauthorizationTaskDto) {
    setPasswordReauthorizationForms((current) => {
      const existing = current[task.taskId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [task.taskId]: { ...existing, secret: "" },
      };
    });
  }

  function removePasswordReauthorizationForm(task: ReauthorizationTaskDto) {
    setPasswordReauthorizationForms((current) => {
      const remaining = { ...current };
      delete remaining[task.taskId];
      return remaining;
    });
  }

  function removeReauthorizationDiagnostics(task: ReauthorizationTaskDto) {
    setReauthorizationDiagnostics((current) => {
      const remaining = { ...current };
      delete remaining[task.taskId];
      return remaining;
    });
  }

  async function completePasswordReauthorization(
    event: FormEvent<HTMLFormElement>,
    task: ReauthorizationTaskDto,
  ) {
    event.preventDefault();
    if (!props.api || task.authMethod !== "password") {
      setNotice("这个账号需要在添加邮箱里重新提交授权信息。");
      return;
    }

    const form = passwordReauthorizationForm(task);
    const username = form.username.trim();
    const secret = form.secret.trim();
    if (!secret) {
      setNotice("请输入新的授权码或专用密码。");
      return;
    }

    const payload: SyncCenterImapSmtpReauthorizationInput = {
      taskId: task.taskId,
      ...(username ? { username } : {}),
      secret,
    };

    if (form.useCustomServers) {
      const imapHost = form.imapHost.trim();
      const smtpHost = form.smtpHost.trim();
      const imapPort = parseReauthorizationPort(form.imapPort);
      const smtpPort = parseReauthorizationPort(form.smtpPort);
      const endpointUsername = username || task.email;
      if (!imapHost || !smtpHost || !imapPort || !smtpPort) {
        setNotice("请填写有效的收信/发信主机和端口。");
        return;
      }

      payload.imap = {
        host: imapHost,
        port: imapPort,
        secure: form.imapSecure,
        username: endpointUsername,
        secret,
      };
      payload.smtp = {
        host: smtpHost,
        port: smtpPort,
        secure: form.smtpSecure,
        username: endpointUsername,
        secret,
      };
    }

    setBusyReauthorizationTaskId(task.taskId);
    try {
      const result = await props.api.completeSyncCenterImapSmtpReauthorization(
        payload,
      );
      setReauthorizations((current) =>
        current.filter((item) => item.taskId !== task.taskId),
      );
      removePasswordReauthorizationForm(task);
      removeReauthorizationDiagnostics(task);
      setNotice(`${result.account?.email ?? task.email} 已恢复同步。`);
      props.api
        .listSyncCenterAccounts()
        .then((page) => setAccounts(page.items))
        .catch(() => undefined);
    } catch (error) {
      const diagnostics = apiErrorConnectionDiagnostics(error);
      clearPasswordReauthorizationSecret(task);
      setReauthorizationDiagnostics((current) => ({
        ...current,
        [task.taskId]: diagnostics,
      }));
      setNotice(
        diagnostics.length > 0
          ? `${task.email} 重新授权未通过。`
          : `${task.email} 重新授权失败。`,
      );
    } finally {
      setBusyReauthorizationTaskId("");
    }
  }

  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!props.api) {
      setAccounts([
        {
          accountId: "preview",
          email: "preview@example.com",
          provider: "gmail",
          syncState: "preview",
          nextAction: "connect_backend"
        }
      ]);
      setReauthorizations([]);
      setNotice("");
      return;
    }

    let alive = true;
    setNotice("");
    void Promise.all([
      props.api.listSyncCenterAccounts(),
      props.api.listSyncCenterReauthorizations(),
    ])
      .then(([accountPage, reauthorizationPage]) => {
        if (!alive) return;
        setAccounts(accountPage.items);
        setReauthorizations(reauthorizationPage.items);
        setNotice(accountPage.items.length === 0 ? "还没有连接邮箱。" : "");
      })
      .catch(() => {
        if (alive) {
          setNotice("账号状态暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  function isAccountActionBusy(accountId: string): boolean {
    return [...busyActions].some((key) => key.startsWith(`${accountId}:`));
  }

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>账号状态</h1>
        </div>
      </header>
      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}
      <section className="page-panel">
        {accounts.map((account) => (
          <div className="task-row" key={account.accountId}>
            <Clock3 size={19} />
            <div>
              <strong>{account.email}</strong>
              <span>{formatProviderLabel(account.provider)} · {formatSyncStateLabel(account.syncState)}</span>
              <SyncCenterAccountNextAction account={account} />
              <SyncCenterLatestJobSummary account={account} />
            </div>
            <div className="task-actions">
              <button
                type="button"
                aria-label={
                  props.selectedAccountId === account.accountId
                    ? `当前邮箱 ${account.email}`
                    : `使用邮箱 ${account.email}`
                }
                disabled={props.selectedAccountId === account.accountId}
                onClick={() => props.onSelectAccount?.(account.accountId)}
              >
                {props.selectedAccountId === account.accountId ? "当前邮箱" : "使用此邮箱"}
              </button>
              <button
                type="button"
                aria-label={`重新同步 ${account.email}`}
                disabled={isAccountActionBusy(account.accountId)}
                onClick={() => void runAccountAction(account, "resync")}
              >
                重新同步
              </button>
              <button
                type="button"
                aria-label={
                  account.syncState === "paused"
                    ? `恢复同步 ${account.email}`
                    : `暂停同步 ${account.email}`
                }
                disabled={
                  isAccountActionBusy(account.accountId)
                }
                onClick={() =>
                  void runAccountAction(
                    account,
                    account.syncState === "paused" ? "resume" : "pause",
                  )
                }
              >
                {account.syncState === "paused" ? "恢复" : "暂停"}
              </button>
              <button
                type="button"
                aria-label={`重试同步 ${account.email}`}
                disabled={isAccountActionBusy(account.accountId)}
                onClick={() => void runAccountAction(account, "retry-failed")}
              >
                重试
              </button>
              <button
                type="button"
                aria-label={`检查同步 ${account.email}`}
                disabled={diagnosticBusy && diagnosticAccount?.accountId === account.accountId}
                onClick={() => void openAccountDiagnostics(account)}
              >
                检查
              </button>
            </div>
          </div>
        ))}
      </section>
      {reauthorizations.length > 0 ? (
        <ReauthorizationTasksPanel
          tasks={reauthorizations}
          busyTaskId={busyReauthorizationTaskId}
          diagnostics={reauthorizationDiagnostics}
          passwordForm={passwordReauthorizationForm}
          onStartOAuth={(task) => void startOAuthReauthorization(task)}
          onSubmitPassword={(event, task) =>
            void completePasswordReauthorization(event, task)
          }
          onUpdatePasswordForm={updatePasswordReauthorizationForm}
        />
      ) : null}
      {diagnosticAccount ? (
        <section className="page-panel sync-diagnostics-panel" aria-label="同步诊断">
          <div className="sync-diagnostics-header">
            <div>
              <h2>同步诊断</h2>
              <p>
                {diagnosticAccount.email} · {formatProviderLabel(diagnosticAccount.provider)} ·{" "}
                {formatSyncStateLabel(diagnosticAccount.syncState)}
              </p>
            </div>
            <div className="task-actions">
              <button
                type="button"
                disabled={diagnosticBusy}
                onClick={() => void openAccountDiagnostics(diagnosticAccount)}
              >
                刷新
              </button>
              <button
                type="button"
                onClick={() => {
                  diagnosticRequestRef.current += 1;
                  setDiagnosticAccount(null);
                  setDiagnosticEvents([]);
                  setDiagnosticNotice("");
                  setDiagnosticBusy(false);
                }}
              >
                关闭
              </button>
            </div>
          </div>
          {diagnosticNotice ? (
            <div className="backend-notice" role="status">
              {diagnosticNotice}
            </div>
          ) : null}
          {diagnosticEvents.length > 0 ? (
            <div className="diagnostic-list">
              {diagnosticEvents.map((event) => (
                <div className="diagnostic-row sync-diagnostic-row" key={event.id}>
                  <div>
                    <strong>{friendlySyncDiagnosticTitle(event)}</strong>
                    <span>
                      {formatOperationalEventLevel(event.level)}
                      {event.jobId ? ` · ${event.jobId}` : ""}
                    </span>
                    {friendlySyncDiagnosticDetail(event) ? (
                      <p>{friendlySyncDiagnosticDetail(event)}</p>
                    ) : null}
                  </div>
                  <span>{formatMailDate(event.occurredAt)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
