import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  CheckCircle2,
  Globe2,
  Inbox,
  Mail,
  MailPlus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { ApiRequestError } from "./lib/emailHubApi";
import {
  applyMailActionStateToMailItem,
  dedupeMailItems,
  mailItemKey,
} from "./features/mail/mail-items";
import "./features/settings/SettingsAdmin.css";
import { HermesDock } from "./features/hermes/HermesDock";
import { HermesNotice } from "./features/hermes/HermesNotice";
import { HermesRuntimeSettingsPanel } from "./features/hermes/HermesRuntimeSettingsPanel";
import {
  hermesActionPlanErrorNotice,
  hermesDisabledSkillIdFromError,
  hermesRuleNavigationTarget,
  hermesSkillDisabledNotice,
} from "./features/hermes/hermesRules";
import {
  searchLaunchFromHermesResult,
  type HermesSearchLaunchOptions,
} from "./features/hermes/hermesSearchLaunch";
import { SearchPage } from "./features/search/SearchPage";
import { useResizablePane } from "./features/layout/useResizablePane";
import {
  detectHermesCommandIntent,
  hermesReaderCommandNotice,
} from "./features/hermes/hermesCommandIntent";
import {
  AddMailPage,
  SyncCenterPage,
  type AddMailProviderGroupId,
} from "./features/add-mail/AddMailAndSyncPages";
import {
  formatOAuthCallbackError,
  formatOAuthProviderDeniedError,
} from "./features/add-mail/oauthDiagnostics";
import { DomainAliasSettingsPanel } from "./features/domain-alias/DomainAliasSettingsPanel";
import { SettingsHomePage } from "./features/settings/SettingsHomePage";
import { MailWorkspace } from "./features/mail/MailWorkspace";
import type { MailItem, Tone } from "./features/mail/mail-items";
import type {
  FolderItem,
  HermesDockReaderIntent,
  HermesNoticeAction,
  HermesNoticeState,
  LabelItem,
  MailDensity,
  ProviderGroup,
  QuickCategory,
  SearchLaunch,
  SearchMailboxScope,
  SmartInboxBusyAction,
  UndoToastState,
} from "./features/mail/MailWorkspaceTypes";
import type {
  EmailHubApi,
  HermesEmailSearchQaResult,
  HermesActionPlanDto,
  HermesFollowupTrackerResult,
  HermesMessageTranslationResult,
  HermesMemoryDto,
  HermesRuleCandidateDto,
  HermesRuleHistoryBackfillDto,
  HermesRuleSimulationDto,
  HermesSkillRequiredPermission,
  HermesWorkspaceContextDto,
  LabelDto,
  MailAction,
  MailQuickFilter,
  MailActionResult,
  MailSearchScope,
  MailTagMode,
  MailboxDto,
  MessageDetailDto,
  MessageListItemDto,
  OAuthCallbackResult,
  OAuthProvider,
  ScheduledSendDto,
  SmartInboxFeedbackAction,
} from "./lib/emailHubApi";

type ViewId =
  | "mail"
  | "add-mail"
  | "search"
  | "hermes"
  | "domains"
  | "settings"
  | "sync";
const oauthCallbackCompletions = new WeakMap<
  EmailHubApi,
  Map<string, Promise<OAuthCallbackResult>>
>();

const PREVIEW_ACCOUNT_ID = "account_1";

const navItems: Array<{ id: ViewId; label: string; icon: typeof Inbox; count?: number }> = [
  { id: "mail", label: "邮箱", icon: Inbox },
  { id: "add-mail", label: "添加邮箱", icon: MailPlus },
  { id: "hermes", label: "Hermes", icon: Sparkles },
  { id: "domains", label: "配置域名", icon: Globe2 },
  { id: "settings", label: "设置", icon: Settings }
];

const folders: FolderItem[] = [
  { id: "inbox", label: "收件箱", count: 128 },
  { id: "flagged", label: "已标记", count: 9 },
  { id: "starred", label: "星标", count: 36 },
  { id: "snoozed", label: "稍后提醒", count: 12 },
  { id: "drafts", label: "草稿", count: 18 },
  { id: "sent", label: "已发送", count: 84 },
  { id: "archive", label: "归档", count: 342 },
  { id: "spam", label: "垃圾邮件", count: 26 },
  { id: "trash", label: "已删除", count: 132 },
  { id: "all", label: "所有邮件", count: 912 },
  { id: "attachments", label: "附件", count: 68 }
];

const aggregateFolderShell: FolderItem[] = [
  { id: "inbox", label: "收件箱", count: 0 },
  { id: "drafts", label: "草稿", count: 0 },
  { id: "sent", label: "已发送", count: 0 },
  { id: "trash", label: "已删除", count: 0 },
  { id: "junk", label: "垃圾邮件", count: 0 },
  { id: "archive", label: "归档", count: 0 },
  { id: "all", label: "所有邮件", count: 0 },
  { id: "flagged", label: "已标记", count: 0 },
  { id: "snoozed", label: "稍后提醒", count: 0 },
  { id: "attachments", label: "附件", count: 0 },
];

const previewLabels: LabelItem[] = [
  {
    id: "work",
    accountId: PREVIEW_ACCOUNT_ID,
    label: "工作",
    count: 32,
    tone: "coral",
  },
  {
    id: "customer",
    accountId: PREVIEW_ACCOUNT_ID,
    label: "客户",
    count: 18,
    tone: "green",
  },
  {
    id: "finance",
    accountId: PREVIEW_ACCOUNT_ID,
    label: "财务",
    count: 6,
    tone: "blue",
  },
  {
    id: "product",
    accountId: PREVIEW_ACCOUNT_ID,
    label: "产品",
    count: 42,
    tone: "yellow",
  },
  {
    id: "market",
    accountId: PREVIEW_ACCOUNT_ID,
    label: "市场",
    count: 15,
    tone: "purple",
  }
];



const providerGroups: ProviderGroup[] = [
  { id: "gmail", label: "Gmail", count: 2 },
  { id: "outlook", label: "Outlook", count: 1 },
  { id: "icloud", label: "iCloud", count: 1 },
  { id: "domestic", label: "163 / QQ", count: 2 },
  { id: "proton", label: "Proton", count: 1 },
  { id: "domain", label: "个人域名", count: 3 }
];

const quickCategories: QuickCategory[] = [
  { id: "codes", label: "验证码", count: 18, tone: "blue" },
  { id: "receipts", label: "账单/收据", count: 24, tone: "green" },
  { id: "shipping", label: "物流/订单", count: 21, tone: "yellow" },
  { id: "travel", label: "旅行/票务", count: 7, tone: "purple" },
  { id: "notifications", label: "系统通知", count: 149, tone: "coral" },
  { id: "newsletters", label: "订阅/营销", count: 67, tone: "purple" },
  { id: "social", label: "社交/社区", count: 12, tone: "blue" }
];



const mailItems: MailItem[] = [
  {
    id: "m1",
    accountId: PREVIEW_ACCOUNT_ID,
    receivedAt: "2026-06-12T10:24:00.000Z",
    sender: "张伟（客户成功）",
    email: "zhangwei@example.com",
    subject: "关于 Q2 合作方案的确认",
    preview: "附件是我们讨论的合作方案，请查收。如有任何问题，随时沟通。",
    time: "10:24",
    date: "2026年6月12日",
    label: "工作",
    tone: "coral",
    unread: true,
    starred: true,
    attachmentCount: 1,
    bucket: "P1 Urgent",
    score: 97,
    reasons: ["直接发给你", "你常回复此发件人", "Hermes 识别为需要回复", "今天 17:00 截止", "来自项目标签"]
  },
  {
    id: "m2",
    accountId: PREVIEW_ACCOUNT_ID,
    receivedAt: "2026-06-11T16:30:00.000Z",
    sender: "陈晨（客户）",
    email: "chenchen@example.com",
    subject: "需求文档 V2.1",
    preview: "更新后的需求文档已经上传，请查阅。里面有两个地方需要确认。",
    time: "昨天",
    date: "2026年6月11日",
    label: "客户",
    tone: "green",
    unread: true,
    starred: false,
    attachmentCount: 1,
    bucket: "P2 Important",
    score: 88,
    reasons: ["直接发给你", "你常回复此发件人"]
  },
  {
    id: "m3",
    accountId: PREVIEW_ACCOUNT_ID,
    receivedAt: "2026-06-12T09:58:00.000Z",
    sender: "李娜（市场部）",
    email: "lina@example.com",
    subject: "新品发布会排期确认",
    preview: "以下是新品发布会的初步排期，请确认是否需要调整。",
    time: "09:58",
    date: "2026年6月12日",
    label: "市场",
    tone: "purple",
    unread: true,
    starred: false,
    attachmentCount: 0,
    bucket: "P2 Important",
    score: 82,
    reasons: ["直接发给你", "来自项目标签"]
  },
  {
    id: "m4",
    accountId: PREVIEW_ACCOUNT_ID,
    receivedAt: "2026-06-11T13:40:00.000Z",
    sender: "王磊（技术支持）",
    email: "support@example.com",
    subject: "系统升级通知",
    preview: "我们将于本周五 22:00-24:00 进行系统升级。",
    time: "昨天",
    date: "2026年6月11日",
    label: "产品",
    tone: "yellow",
    unread: false,
    starred: false,
    attachmentCount: 0,
    bucket: "P5 Transactions",
    score: 43,
    reasons: ["系统通知", "无需立即处理"]
  },
  {
    id: "m5",
    accountId: PREVIEW_ACCOUNT_ID,
    receivedAt: "2026-06-11T09:15:00.000Z",
    sender: "财务部",
    email: "finance@example.com",
    subject: "5 月费用报销审批结果",
    preview: "您的报销单 EXP-202505-087 已审批通过，付款将在 2 个工作日内完成。",
    time: "昨天",
    date: "2026年6月11日",
    label: "财务",
    tone: "blue",
    unread: false,
    starred: false,
    attachmentCount: 0,
    bucket: "P5 Transactions",
    score: 38,
    reasons: ["票据通知", "无需回复"]
  },
  {
    id: "m6",
    accountId: PREVIEW_ACCOUNT_ID,
    receivedAt: "2026-05-30T08:20:00.000Z",
    sender: "产品团队",
    email: "product@example.com",
    subject: "迭代计划 - 第 23 周",
    preview: "本周迭代计划已更新，请相关同事审阅。",
    time: "5月30日",
    date: "2026年5月30日",
    label: "产品",
    tone: "yellow",
    unread: false,
    starred: false,
    attachmentCount: 0,
    bucket: "P4 FYI / Updates",
    score: 35,
    reasons: ["项目标签", "稍后处理"]
  }
];

export interface AppProps {
  api?: EmailHubApi;
  defaultAccountId?: string;
  initialView?: ViewId;
  restrictToDefaultAccount?: boolean;
  oauthRedirect?: (url: string) => void;
}

const BLANK_MAIL_ITEM_ID = "__blank_reader_message__";
const BLANK_MAIL_RECEIVED_AT = "1970-01-01T00:00:00.000Z";

function createBlankMailItem(accountId: string): MailItem {
  return {
    id: BLANK_MAIL_ITEM_ID,
    accountId,
    receivedAt: BLANK_MAIL_RECEIVED_AT,
    sender: "",
    email: "",
    subject: "",
    preview: "",
    time: "",
    date: "",
    label: "",
    tone: "blue",
    unread: false,
    starred: false,
    attachmentCount: 0,
    bucket: "",
    score: 0,
    reasons: [],
  };
}

interface OAuthCallbackParams {
  state: string;
  code: string;
  error?: string;
  issuer?: string;
}

interface OAuthPendingState {
  provider: OAuthProvider;
  flow: "onboarding" | "reauthorization";
  returnTo: "add-mail";
  createdAt: string;
}

function completeOAuthCallbackOnce(
  api: EmailHubApi,
  key: string,
  startCompletion: () => Promise<OAuthCallbackResult>,
): Promise<OAuthCallbackResult> {
  let apiCompletions = oauthCallbackCompletions.get(api);
  if (!apiCompletions) {
    apiCompletions = new Map();
    oauthCallbackCompletions.set(api, apiCompletions);
  }

  const existingCompletion = apiCompletions.get(key);
  if (existingCompletion) {
    return existingCompletion;
  }

  const completion = startCompletion();
  apiCompletions.set(key, completion);
  return completion;
}

const OAUTH_PENDING_PREFIX = "email-hub:oauth:";
const SELECTED_ACCOUNT_STORAGE_KEY = "email-hub:selected-account-id";
const MAIL_LIST_SORT = "time" as const;

export function App(props: AppProps = {}) {
  const [oauthCallback, setOauthCallback] = useState(
    () =>
      readOAuthCallbackFromLocation(
        typeof window === "undefined" ? undefined : window.location,
      ),
  );
  const sidebarResize = useResizablePane({
    initialSize: 184,
    minSize: 164,
    maxSize: 320,
    storageKey: "email-hub:layout:sidebar",
  });
  const [activeView, setActiveView] = useState<ViewId>(
    props.initialView ?? "mail",
  );
  const [activeAddMailProviderGroup, setActiveAddMailProviderGroup] = useState<
    AddMailProviderGroupId | undefined
  >();
  const [activeFolder, setActiveFolder] = useState("inbox");
  const activeFolderRef = useRef(activeFolder);
  activeFolderRef.current = activeFolder;
  const [activeMailId, setActiveMailId] = useState(
    props.api ? "" : mailItemKey(mailItems[0]),
  );
  const [hermesPrompt, setHermesPrompt] = useState("");
  const [hermesDockNoticeState, setHermesDockNoticeState] =
    useState<HermesNoticeState>();
  const [hermesDockResult, setHermesDockResult] = useState<
    HermesEmailSearchQaResult | undefined
  >();
  const [hermesDockSearchAccountId, setHermesDockSearchAccountId] =
    useState<string | undefined>();
  const [hermesDockRuleCandidate, setHermesDockRuleCandidate] =
    useState<HermesRuleCandidateDto | undefined>();
  const [hermesDockRuleSimulation, setHermesDockRuleSimulation] =
    useState<HermesRuleSimulationDto | undefined>();
  const [hermesDockActionPlan, setHermesDockActionPlan] =
    useState<HermesActionPlanDto | undefined>();
  const [hermesDockHistoryBackfill, setHermesDockHistoryBackfill] =
    useState<HermesRuleHistoryBackfillDto | undefined>();
  const [hermesDockLearnedMemory, setHermesDockLearnedMemory] =
    useState<HermesMemoryDto | undefined>();
  const [hermesDockReaderIntent, setHermesDockReaderIntent] =
    useState<HermesDockReaderIntent | undefined>();
  const [hermesWorkspaceContext, setHermesWorkspaceContext] =
    useState<HermesWorkspaceContextDto | undefined>();
  const [hermesWorkspaceContextLoading, setHermesWorkspaceContextLoading] =
    useState(false);
  const [hermesDockBusy, setHermesDockBusy] = useState(false);
  const hermesDockRequestRef = useRef(0);
  const [workspaceFolders, setWorkspaceFolders] = useState<FolderItem[]>(
    props.api ? aggregateFolderShell : folders,
  );
  const [workspaceMail, setWorkspaceMail] = useState<MailItem[]>(
    props.api ? [] : mailItems,
  );
  const [selectedDetail, setSelectedDetail] = useState<MessageDetailDto | undefined>();
  const [undoToast, setUndoToast] = useState<UndoToastState | undefined>();
  const [backendNotice, setBackendNotice] = useState<string | undefined>();
  const [searchLaunch, setSearchLaunch] = useState<SearchLaunch | undefined>();
  const [navigationProviderGroups, setNavigationProviderGroups] =
    useState<ProviderGroup[]>(props.api ? [] : providerGroups);
  const [navigationFolders, setNavigationFolders] =
    useState<FolderItem[]>(props.api ? aggregateFolderShell : folders);
  const [navigationQuickCategories, setNavigationQuickCategories] =
    useState<QuickCategory[]>(props.api ? [] : quickCategories);
  const [navigationLabels, setNavigationLabels] =
    useState<LabelItem[]>(props.api ? [] : previewLabels);
  const [connectedAccountCount, setConnectedAccountCount] = useState(
    props.api ? 0 : 5,
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
    () => {
      const storedAccountId = props.defaultAccountId ?? readSelectedAccountIdFromSession();
      if (props.api && !props.defaultAccountId && storedAccountId === PREVIEW_ACCOUNT_ID) {
        return undefined;
      }

      return storedAccountId;
    },
  );
  const hermesDockNotice = hermesDockNoticeState?.text;

  function setHermesDockNotice(
    notice: string | undefined,
    _skillId?: string,
    _requiredPermission?: HermesSkillRequiredPermission,
    action?: HermesNoticeAction,
  ) {
    setHermesDockNoticeState(
      notice ? { text: notice, action } : undefined,
    );
  }

  function openHermesRuntimeSettings() {
    setActiveView("hermes");
  }
  const [accountDiscoveryReady, setAccountDiscoveryReady] = useState(
    () => !props.api || Boolean(props.defaultAccountId),
  );
  const [mailDensity, setMailDensity] = useState<MailDensity>("compact");
  const mailLoadRequestRef = useRef(0);
  const [hermesFollowUpSuggestion, setHermesFollowUpSuggestion] = useState<
    HermesFollowupTrackerResult | undefined
  >();
  const [followUpNotice, setFollowUpNotice] = useState<string | undefined>();
  const [smartInboxBusy, setSmartInboxBusy] =
    useState<SmartInboxBusyAction>("");

  const restrictToDefaultAccount =
    props.api && props.defaultAccountId && props.restrictToDefaultAccount
      ? props.defaultAccountId
      : undefined;
  const fallbackPreviewAccountId = props.api ? "" : PREVIEW_ACCOUNT_ID;
  const sortedMail = useMemo(
    () => sortMailItems(workspaceMail),
    [workspaceMail],
  );
  const navigationInboxCount =
    navigationFolders.find((folder) => folder.id === "inbox")?.count ??
    workspaceFolders.find((folder) => folder.id === "inbox")?.count;
  const sidebarMailCount = props.api
    ? navigationInboxCount ?? 0
    : folders.find((folder) => folder.id === "inbox")?.count ?? workspaceMail.length;
  const effectiveNavItems = navItems.map((item) =>
    item.id === "mail" ? { ...item, count: sidebarMailCount } : item,
  );
  const primaryNavItems = effectiveNavItems.filter(
    (item) => item.id !== "settings",
  );
  const settingsNavItem = effectiveNavItems.find((item) => item.id === "settings");
  const selectedMail =
    sortedMail.find((mail) => mailItemKey(mail) === activeMailId) ?? sortedMail[0];
  const selectedMailAccountId = selectedMail?.accountId ?? selectedAccountId;
  const workspaceAccountId =
    selectedMailAccountId ?? selectedAccountId ?? fallbackPreviewAccountId;
  const activeFolderSummary = folderSummaryForActiveView({
    activeFolder,
    folders: workspaceFolders,
    labels: navigationLabels,
    quickCategories: navigationQuickCategories,
    mail: workspaceMail,
  });
  const appShellStyle = {
    "--sidebar-width": `${sidebarResize.size}px`,
  } as CSSProperties;

  function rememberSelectedAccount(nextAccountId: string | undefined) {
    if (!nextAccountId) {
      return;
    }

    setSelectedAccountId(nextAccountId);
    storeSelectedAccountIdInSession(nextAccountId);
  }

  async function refreshNavigationSummary() {
    if (!props.api) {
      return;
    }

    try {
      const summary = await props.api.getMailNavigationSummary();
      const nextFolders = Array.isArray(summary.folders)
        ? summary.folders.map(mapNavigationFolderDtoToFolderItem)
        : aggregateFolderShell;
      setNavigationProviderGroups(summary.providerGroups);
      setNavigationFolders(nextFolders);
      if (!selectedAccountId) {
        setWorkspaceFolders(nextFolders);
      }
      setNavigationQuickCategories(summary.quickCategories);
    } catch {
      setNavigationProviderGroups([]);
      setNavigationFolders(aggregateFolderShell);
      if (!selectedAccountId) {
        setWorkspaceFolders(aggregateFolderShell);
      }
      setNavigationQuickCategories([]);
    }
  }

  async function refreshConnectedAccountCount() {
    if (!props.api) {
      setConnectedAccountCount(5);
      return;
    }

    try {
      const page = await props.api.listSyncCenterAccounts();
      setConnectedAccountCount(page.items.length);
    } catch {
      setConnectedAccountCount(0);
    }
  }

  async function refreshLabels(accountIdForLabels = selectedAccountId) {
    if (!props.api || !accountIdForLabels) {
      setNavigationLabels(props.api ? [] : previewLabels);
      return;
    }

    try {
      const page = await props.api.listLabels({ accountId: accountIdForLabels });
      setNavigationLabels(page.items.map(mapLabelDtoToLabelItem));
    } catch {
      setNavigationLabels([]);
    }
  }

  async function selectFirstBackendAccount(): Promise<string | undefined> {
    if (!props.api) {
      return undefined;
    }

    try {
      const page = await props.api.listSyncCenterAccounts();
      const firstAccount = page.items.find((account) => account.accountId);
      rememberSelectedAccount(firstAccount?.accountId);
      return firstAccount?.accountId;
    } catch {
      // Keep the local preview account when account discovery is unavailable.
      return undefined;
    }
  }

  function replaceWorkspaceMail(mappedMail: MailItem[]) {
    const nextActiveMailId = firstMailKey(mappedMail);
    setWorkspaceMail(mappedMail);
    setActiveMailId(nextActiveMailId);
    setSelectedDetail((currentDetail) =>
      messageDetailKey(currentDetail) === nextActiveMailId
        ? currentDetail
      : undefined,
    );
  }

  function startMailLoadRequest(): number {
    mailLoadRequestRef.current += 1;
    return mailLoadRequestRef.current;
  }

  function isCurrentMailLoadRequest(requestId: number): boolean {
    return mailLoadRequestRef.current === requestId;
  }

  async function handleConnectedAccount(nextAccountId?: string) {
    let connectedAccountId = nextAccountId;
    if (nextAccountId) {
      rememberSelectedAccount(nextAccountId);
    } else {
      connectedAccountId = await selectFirstBackendAccount();
    }

    await refreshNavigationSummary();
    await refreshConnectedAccountCount();
    await refreshLabels(connectedAccountId ?? selectedAccountId);
  }

  function finishAddMailConnection() {
    setActiveView("mail");
    setActiveFolder("inbox");
  }

  function finishOAuthCallback() {
    if (
      typeof window !== "undefined" &&
      window.location.pathname === "/oauth/callback"
    ) {
      window.history.replaceState({}, "", "/");
    }

    setOauthCallback(undefined);
    setActiveView("mail");
    setActiveFolder("inbox");
  }

  function launchGlobalSearch(
    query: string,
    options: Omit<SearchLaunch, "query" | "requestId"> = {},
  ) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setSearchLaunch(undefined);
      setActiveView("search");
      return;
    }

    setSearchLaunch((current) => ({
      query: trimmedQuery,
      ...options,
      ...(restrictToDefaultAccount
        ? { accountId: options.accountId ?? restrictToDefaultAccount }
        : {}),
      requestId: (current?.requestId ?? 0) + 1,
    }));
    setActiveView("search");
  }

  function openSearchResult(mail: MailItem) {
    setWorkspaceMail((current) => {
      const resultKey = mailItemKey(mail);
      const withoutResult = current.filter((item) => mailItemKey(item) !== resultKey);
      return [mail, ...withoutResult];
    });
    setSelectedDetail(undefined);
    setActiveFolder("search");
    setActiveMailId(mailItemKey(mail));
    setActiveView("mail");
  }

  function updateHermesPrompt(value: string) {
    hermesDockRequestRef.current += 1;
    setHermesPrompt(value);
    setHermesDockBusy(false);
    setHermesDockNotice(undefined);
    setHermesDockResult(undefined);
    setHermesDockActionPlan(undefined);
    setHermesDockHistoryBackfill(undefined);
    setHermesDockLearnedMemory(undefined);
    setHermesDockReaderIntent(undefined);
    setHermesDockRuleCandidate(undefined);
    setHermesDockRuleSimulation(undefined);
  }

  function isCurrentHermesDockRequest(requestId: number): boolean {
    return hermesDockRequestRef.current === requestId;
  }

  async function refreshHermesWorkspaceContext(options: {
    accountId?: string;
    force?: boolean;
  } = {}) {
    if (!props.api || hermesWorkspaceContextLoading) {
      return;
    }

    const accountIdForContext =
      options.accountId ?? selectedMail?.accountId ?? selectedAccountId;
    if (!accountIdForContext) {
      return;
    }

    if (
      !options.force &&
      hermesWorkspaceContext?.accountScope.requestedAccountId ===
        accountIdForContext
    ) {
      return;
    }

    setHermesWorkspaceContextLoading(true);
    try {
      setHermesWorkspaceContext(
        await props.api.getHermesWorkspaceContext({
          accountId: accountIdForContext,
          ruleLimit: 10,
          labelLimit: 20,
        }),
      );
    } catch {
      // Keep the current context badge; prompt-specific errors are shown separately.
    } finally {
      setHermesWorkspaceContextLoading(false);
    }
  }

  async function submitHermesDockPrompt(rawPrompt: string) {
    const question = rawPrompt.trim();
    const requestId = hermesDockRequestRef.current + 1;
    hermesDockRequestRef.current = requestId;
    if (!question) {
      setHermesDockBusy(false);
      setHermesDockResult(undefined);
      setHermesDockSearchAccountId(undefined);
      setHermesDockActionPlan(undefined);
      setHermesDockHistoryBackfill(undefined);
      setHermesDockLearnedMemory(undefined);
      setHermesDockReaderIntent(undefined);
      setHermesDockRuleCandidate(undefined);
      setHermesDockRuleSimulation(undefined);
      setHermesDockNotice("请输入要让 Hermes 查找或回答的问题。");
      return;
    }

    setHermesDockResult(undefined);
    setHermesDockSearchAccountId(undefined);
    setHermesDockActionPlan(undefined);
    setHermesDockHistoryBackfill(undefined);
    setHermesDockLearnedMemory(undefined);
    setHermesDockReaderIntent(undefined);
    setHermesDockRuleCandidate(undefined);
    setHermesDockRuleSimulation(undefined);
    if (!props.api) {
      setHermesDockBusy(false);
      setHermesDockNotice("连接后 Hermes 会搜索已同步邮件并给出引用答案。");
      return;
    }

    const hermesAccountId = selectedMail?.accountId ?? selectedAccountId;
    if (!hermesAccountId) {
      setHermesDockBusy(false);
      setHermesDockNotice("Hermes 搜索需要已同步邮件。");
      return;
    }

    const hermesIntent = detectHermesCommandIntent(question);
    if (hermesIntent.kind === "reader") {
      if (!selectedMail) {
        setHermesDockBusy(false);
        setHermesDockNotice(
          "未打开邮件。",
        );
        return;
      }

      setActiveView("mail");
      setActiveMailId(mailItemKey(selectedMail));
      setHermesDockBusy(false);
      setHermesDockReaderIntent({
        action: hermesIntent.action,
        requestId,
      });
      setHermesDockNotice(hermesReaderCommandNotice(hermesIntent.action));
      return;
    }

    setHermesDockBusy(true);
    if (hermesIntent.kind === "rule") {
      setHermesDockNotice("");
      try {
        await refreshHermesWorkspaceContext({
          accountId: hermesAccountId,
          force: true,
        });
        if (!isCurrentHermesDockRequest(requestId)) {
          return;
        }
        const plan = await props.api.createHermesActionPlan({
          accountId: hermesAccountId,
          command: question,
          sampleLimit: 25,
        });
        if (!isCurrentHermesDockRequest(requestId)) {
          return;
        }
        setHermesDockActionPlan(plan);
        setHermesDockRuleCandidate(plan.candidate);
        setHermesDockRuleSimulation(plan.simulation);
        setHermesDockNotice(
          `Hermes 已准备整理建议，预计影响 ${plan.simulation?.matchedCount ?? 0} 封邮件。`,
        );
      } catch (error) {
        if (!isCurrentHermesDockRequest(requestId)) {
          return;
        }
        setHermesDockNotice(
          hermesActionPlanErrorNotice(error, "create"),
          hermesDisabledSkillIdFromError(error, "action_plan"),
          hermesDisabledSkillRequiredPermissionFromError(error),
          hermesNoticeActionFromError(error),
        );
      } finally {
        if (isCurrentHermesDockRequest(requestId)) {
          setHermesDockBusy(false);
        }
      }
      return;
    }

    setHermesDockNotice("");
    try {
      const memoryInput = hermesSearchMemoryInput(selectedMail);
      const result = await props.api.searchMailWithHermes({
        accountId: hermesAccountId,
        question,
        language: "zh-CN",
        limit: 5,
        ...memoryInput,
      });
      if (!isCurrentHermesDockRequest(requestId)) {
        return;
      }
      setHermesDockResult(result);
      setHermesDockSearchAccountId(hermesAccountId);
      setHermesDockNotice(
        result.matches.length > 0
          ? `Hermes 已基于 ${result.matches.length} 封邮件回答。`
          : "Hermes 已完成回答，未找到可引用邮件。",
      );
    } catch (error) {
      if (!isCurrentHermesDockRequest(requestId)) {
        return;
      }
      setHermesDockNotice(
        hermesSkillErrorNotice(error, {
          skillId: "email_search_qa",
          fallback: "Hermes 搜索暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "email_search_qa"),
        hermesDisabledSkillRequiredPermissionFromError(error),
        hermesNoticeActionFromError(error),
      );
    } finally {
      if (isCurrentHermesDockRequest(requestId)) {
        setHermesDockBusy(false);
      }
    }
  }

  async function approveHermesDockRule() {
    if (!props.api || !hermesDockRuleCandidate || !hermesDockActionPlan) {
      return;
    }

    const requestId = hermesDockRequestRef.current + 1;
    hermesDockRequestRef.current = requestId;
    setHermesDockBusy(true);
    setHermesDockNotice("");
    try {
      const confirmation = await props.api.confirmHermesActionPlan({
        planId: hermesDockActionPlan.id,
        accountId: hermesDockRuleCandidate.accountId,
        candidateId: hermesDockRuleCandidate.id,
      });
      if (!isCurrentHermesDockRequest(requestId)) {
        return;
      }
      const rule = confirmation.rule;
      setHermesDockRuleCandidate({
        ...hermesDockRuleCandidate,
        status: "approved",
        approvedAt: rule.approvedAt,
      });
      setHermesDockActionPlan({
        ...hermesDockActionPlan,
        status: "completed",
        steps: confirmation.steps,
        safety: confirmation.safety,
      });
      setHermesDockHistoryBackfill(confirmation.historyBackfill);
      setHermesDockLearnedMemory(confirmation.memory);
      const target = hermesRuleNavigationTarget(rule);
      await refreshNavigationSummary();
      await refreshLabels(hermesDockRuleCandidate.accountId);
      await refreshHermesWorkspaceContext({
        accountId: hermesDockRuleCandidate.accountId,
        force: true,
      });
      if (!isCurrentHermesDockRequest(requestId)) {
        return;
      }
      if (target?.kind === "savedView") {
        await loadSavedView(target.id);
        setActiveView("mail");
      } else if (target?.kind === "label") {
        await loadLabel(target.id);
        setActiveView("mail");
      }
      setHermesDockNotice(
        confirmation.historyBackfill
          ? `Hermes 已完成整理：${rule.title}，已整理 ${confirmation.historyBackfill.appliedCount} 封历史邮件。${target ? `已打开${target.label}。` : ""}`
          : `Hermes 已完成整理：${rule.title}${target ? `，已打开${target.label}` : ""}。`,
      );
    } catch (error) {
      if (!isCurrentHermesDockRequest(requestId)) {
        return;
      }
      setHermesDockNotice(
        hermesActionPlanErrorNotice(error, "confirm"),
        hermesDisabledSkillIdFromError(error, "action_plan"),
        hermesDisabledSkillRequiredPermissionFromError(error),
        hermesNoticeActionFromError(error),
      );
    } finally {
      if (isCurrentHermesDockRequest(requestId)) {
        setHermesDockBusy(false);
      }
    }
  }

  useEffect(() => {
    void refreshNavigationSummary();
    void refreshConnectedAccountCount();
  }, [props.api]);

  useEffect(() => {
    if (
      oauthCallback ||
      !props.api ||
      props.defaultAccountId ||
      accountDiscoveryReady
    ) {
      return;
    }

    let alive = true;
    void props.api
      .listSyncCenterAccounts()
      .then((page) => {
        if (!alive) {
          return;
        }
        const selectedAccountExists =
          selectedAccountId &&
          selectedAccountId !== PREVIEW_ACCOUNT_ID &&
          page.items.some((account) => account.accountId === selectedAccountId);
        if (selectedAccountExists) {
          setAccountDiscoveryReady(true);
          return;
        }

        setSelectedAccountId(undefined);
        clearSelectedAccountIdFromSession();
        setAccountDiscoveryReady(true);
      })
      .catch(() => {
        if (!alive) {
          return;
        }
        setAccountDiscoveryReady(true);
      });

    return () => {
      alive = false;
    };
  }, [
    accountDiscoveryReady,
    oauthCallback,
    props.api,
    props.defaultAccountId,
    selectedAccountId,
  ]);

  useEffect(() => {
    if (!props.api || !accountDiscoveryReady) {
      return;
    }

    let alive = true;
    setBackendNotice(undefined);
    const requestId = startMailLoadRequest();
    const request: Promise<{
      folders?: FolderItem[];
      messages: MessageListItemDto[];
      activeFolderId: string;
    }> = selectedAccountId
      ? Promise.all([
          props.api.listMailboxes({ accountId: selectedAccountId }),
          props.api.listMessages({
            accountId: selectedAccountId,
            limit: 50,
            sort: MAIL_LIST_SORT,
          }),
        ]).then(([mailboxPage, messagePage]) => ({
          folders: withOutlookFolderShell(
            mailboxPage.items.map(mapMailboxDtoToFolderItem),
          ),
          messages: messagePage.items,
          activeFolderId: mailboxPage.items[0]?.id ?? "inbox",
        }))
      : props.api.listMessages({ limit: 50, sort: MAIL_LIST_SORT }).then((messagePage) => ({
          messages: messagePage.items,
          activeFolderId: "inbox",
        }));

    void request
      .then((result) => {
        if (!alive || !isCurrentMailLoadRequest(requestId)) {
          return;
        }
        const mappedMail = result.messages.map(mapMessageDtoToMailItem);
        if (result.folders) {
          setWorkspaceFolders(result.folders);
        }
        setActiveFolder(result.activeFolderId);
        replaceWorkspaceMail(mappedMail);
        setBackendNotice(undefined);
      })
      .catch(() => {
        if (alive && isCurrentMailLoadRequest(requestId)) {
          setWorkspaceMail([]);
          setSelectedDetail(undefined);
          setActiveMailId("");
          setBackendNotice("邮件服务暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [accountDiscoveryReady, props.api, selectedAccountId]);

  useEffect(() => {
    if (!accountDiscoveryReady) {
      return;
    }
    void refreshLabels(selectedAccountId);
  }, [accountDiscoveryReady, props.api, selectedAccountId]);

  async function loadSavedView(savedView: string) {
    const requestId = startMailLoadRequest();
    setActiveFolder(savedView);
    if (!props.api) {
      return;
    }

    setBackendNotice(undefined);
    try {
      const messagePage = await props.api.listMessages({
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
        limit: 50,
        sort: MAIL_LIST_SORT,
        savedView,
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      if (!isCurrentMailLoadRequest(requestId)) {
        return;
      }
      replaceWorkspaceMail(mappedMail);
      setBackendNotice(undefined);
    } catch {
      if (isCurrentMailLoadRequest(requestId)) {
        setBackendNotice("分类邮件暂时不可用。");
      }
    }
  }

  async function loadLabel(labelId: string) {
    const requestId = startMailLoadRequest();
    setActiveFolder(`label:${labelId}`);
    if (!props.api || !selectedAccountId) {
      return;
    }

    setBackendNotice(undefined);
    try {
      const messagePage = await props.api.listMessages({
        accountId: selectedAccountId,
        limit: 50,
        sort: MAIL_LIST_SORT,
        labelIds: [labelId],
        tagMode: "any",
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      if (!isCurrentMailLoadRequest(requestId)) {
        return;
      }
      replaceWorkspaceMail(mappedMail);
      setBackendNotice(undefined);
    } catch {
      if (isCurrentMailLoadRequest(requestId)) {
        setBackendNotice("标签邮件暂时不可用。");
      }
    }
  }

  async function loadMailbox(mailboxId: string) {
    const requestId = startMailLoadRequest();
    setActiveFolder(mailboxId);
    if (!props.api) {
      return;
    }
    if (!selectedAccountId) {
      setBackendNotice(undefined);
      try {
        const aggregateFilter = aggregateMessageFilterForFolder(mailboxId);
        const messagePage = await props.api.listMessages({
          ...aggregateFilter,
          limit: 50,
          sort: MAIL_LIST_SORT,
        });
        const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
        if (!isCurrentMailLoadRequest(requestId)) {
          return;
        }
        replaceWorkspaceMail(mappedMail);
        setBackendNotice(undefined);
      } catch {
        if (isCurrentMailLoadRequest(requestId)) {
          setBackendNotice("聚合收件箱暂时不可用。");
        }
      }
      return;
    }

    setBackendNotice(undefined);
    try {
      const selectedFolder = workspaceFolders.find(
        (folder) => folder.id === mailboxId,
      );
      const messagePage = await props.api.listMessages({
        accountId: selectedAccountId,
        ...(selectedFolder?.virtual
          ? aggregateMessageFilterForFolder(mailboxId)
          : { mailboxId }),
        limit: 50,
        sort: MAIL_LIST_SORT,
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      if (!isCurrentMailLoadRequest(requestId)) {
        return;
      }
      replaceWorkspaceMail(mappedMail);
      setBackendNotice(undefined);
    } catch {
      if (isCurrentMailLoadRequest(requestId)) {
        setBackendNotice("邮箱目录暂时不可用。");
      }
    }
  }

  async function refreshCurrentMail() {
    if (activeFolder.startsWith("label:")) {
      await loadLabel(activeFolder.slice("label:".length));
      return;
    }

    if (navigationQuickCategories.some((category) => category.id === activeFolder)) {
      await loadSavedView(activeFolder);
      return;
    }

    await loadMailbox(activeFolder);
  }

  useEffect(() => {
    if (!props.api || !selectedMail) {
      setSelectedDetail(undefined);
      return;
    }

    let alive = true;
    const selectedKey = mailItemKey(selectedMail);
    setSelectedDetail((currentDetail) =>
      messageDetailKey(currentDetail) === selectedKey
        ? currentDetail
        : undefined,
    );
    void props.api
      .getMessage({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
      })
      .then((message) => {
        if (alive) {
          setSelectedDetail(
            messageDetailKey(message) === selectedKey ? message : undefined,
          );
        }
      })
      .catch(() => {
        if (alive) {
          setSelectedDetail(undefined);
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api, selectedMail?.accountId, selectedMail?.id]);

  useEffect(() => {
    hermesDockRequestRef.current += 1;
    setHermesDockBusy(false);
    setHermesFollowUpSuggestion(undefined);
    setFollowUpNotice(undefined);
  }, [activeMailId]);

  async function applySelectedAction(action: MailAction): Promise<boolean> {
    if (!props.api || !selectedMail) {
      setBackendNotice("邮件操作暂时不可用。");
      return false;
    }

    try {
      const result = await props.api.applyMailAction({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
        action
      });
      applyActionResult(result);
      return true;
    } catch {
      setBackendNotice("邮件操作暂时不可用。");
      return false;
    }
  }

  async function undoDone() {
    if (!props.api || !undoToast) {
      return;
    }

    try {
      const result = await props.api.applyMailAction({
        accountId: undoToast.accountId,
        messageId: undoToast.messageId,
        action: "undo_done",
        undoToken: undoToast.undoToken
      });
      applyActionResult(result);
      setUndoToast(undefined);
    } catch {
      setBackendNotice("撤销完成暂时不可用。");
    }
  }

  function applyActionResult(result: MailActionResult) {
    const resultKey = `${result.accountId}:${result.messageId}`;
    const removedMail = workspaceMail.find((item) => mailItemKey(item) === resultKey);
    setWorkspaceMail((items) => {
      if (result.action === "undo_done") {
        const existing = items.some((item) => mailItemKey(item) === resultKey);
        if (existing) {
          return items.map((item) =>
            mailItemKey(item) === resultKey
              ? applyMailActionStateToMailItem(item, result)
              : item,
          );
        }

        const restoredMail =
          undoToast?.accountId === result.accountId &&
          undoToast.messageId === result.messageId
            ? undoToast.mail
            : undefined;
        return restoredMail
          ? [applyMailActionStateToMailItem(restoredMail, result), ...items]
          : items;
      }

      const shouldRemove = shouldRemoveMailAfterAction(
        activeFolderRef.current,
        result,
      );
      const updated = items.map((item) =>
        item.accountId === result.accountId && item.id === result.messageId
          ? applyMailActionStateToMailItem(item, result)
          : item,
      );
      return shouldRemove
        ? updated.filter(
            (item) =>
              item.accountId !== result.accountId || item.id !== result.messageId,
          )
        : updated;
    });

    if (result.action === "undo_done") {
      setActiveMailId(resultKey);
      setSelectedDetail(undefined);
    } else if (shouldRemoveMailAfterAction(activeFolderRef.current, result)) {
      const remainingMail = workspaceMail.filter(
        (item) => mailItemKey(item) !== resultKey,
      );
      setActiveMailId((current) =>
        current === resultKey ? firstMailKey(remainingMail) : current,
      );
      if (selectedMail && mailItemKey(selectedMail) === resultKey) {
        setSelectedDetail(undefined);
      }
    }

    if (result.action === "done" && result.state.undoToken) {
      setUndoToast({
        accountId: result.accountId,
        messageId: result.messageId,
        undoToken: result.state.undoToken,
        ...(removedMail ? { mail: removedMail } : {}),
      });
    }
  }

  async function applySmartInboxItemsDone(
    candidates: MailItem[],
    emptyNotice: string,
    successContext: string,
  ) {
    if (!props.api) {
      setBackendNotice("批量处理暂时不可用。");
      return;
    }

    if (candidates.length === 0) {
      setBackendNotice(emptyNotice);
      return;
    }

    const messageIdsByGroup = new Map<
      string,
      { accountId: string; bucket: string; messageIds: string[] }
    >();
    for (const item of candidates) {
      const groupKey = `${item.accountId}:${item.bucket}`;
      const group =
        messageIdsByGroup.get(groupKey) ?? {
          accountId: item.accountId,
          bucket: item.bucket,
          messageIds: [],
        };
      group.messageIds.push(item.id);
      messageIdsByGroup.set(groupKey, group);
    }

    const listRequestId = mailLoadRequestRef.current;
    setSmartInboxBusy("bulk_done");
    try {
      const results = await Promise.all(
        [...messageIdsByGroup.values()].map((group) =>
          props.api!.applySmartInboxCardBulkAction({
            accountId: group.accountId,
            bucket: group.bucket,
            action: "done",
            messageIds: group.messageIds,
          }),
        ),
      );
      const succeededKeys = new Set<string>();
      let succeededCount = 0;
      let failedCount = 0;
      for (const result of results) {
        succeededCount += result.succeededCount;
        failedCount += result.failedCount;
        for (const item of result.succeeded) {
          succeededKeys.add(`${result.accountId}:${item.messageId}`);
        }
      }

      if (mailLoadRequestRef.current !== listRequestId) {
        return;
      }

      if (succeededKeys.size > 0) {
        const remainingMail = workspaceMail.filter(
          (item) => !succeededKeys.has(mailItemKey(item)),
        );
        setWorkspaceMail(remainingMail);
        setActiveMailId((current) =>
          current && remainingMail.some((item) => mailItemKey(item) === current)
            ? current
            : firstMailKey(remainingMail),
        );
        if (selectedMail && succeededKeys.has(mailItemKey(selectedMail))) {
          setSelectedDetail(undefined);
        }
      }

      setBackendNotice(
        failedCount > 0
          ? `智能收件箱已完成 ${succeededCount} 封，${failedCount} 封稍后重试。`
          : `智能收件箱已完成 ${succeededCount} 封${successContext}邮件。`,
      );
    } catch {
      if (mailLoadRequestRef.current === listRequestId) {
        setBackendNotice("智能收件箱批量完成暂时不可用。");
      }
    } finally {
      setSmartInboxBusy("");
    }
  }

  async function applySmartInboxBucketDone(bucket: string) {
    await applySmartInboxItemsDone(
      workspaceMail.filter((item) => item.bucket === bucket),
      "当前智能收件箱卡片没有可处理邮件。",
      bucketLabel(bucket),
    );
  }

  async function applySelectedMessagesDone(items: MailItem[]) {
    await applySmartInboxItemsDone(
      items,
      "未选择邮件。",
      "选中",
    );
  }

  async function recordSmartInboxFeedback(
    action: SmartInboxFeedbackAction,
    candidates: MailItem[] = [],
  ): Promise<boolean> {
    const targets = dedupeMailItems(
      candidates.length > 0 ? candidates : selectedMail ? [selectedMail] : [],
    );
    if (!props.api || targets.length === 0) {
      setBackendNotice("反馈暂时不可用。");
      return false;
    }

    setSmartInboxBusy(action);
    try {
      const settled = await Promise.allSettled(
        targets.map((target) =>
          props.api!.recordSmartInboxFeedback({
            accountId: target.accountId,
            messageId: target.id,
            action,
          }),
        ),
      );
      const results = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (results.length === 0) {
        setBackendNotice("智能收件箱反馈暂时不可用。");
        return false;
      }

      const resultByKey = new Map(
        results.map((result) => [`${result.accountId}:${result.messageId}`, result]),
      );
      setWorkspaceMail((items) =>
        items.map((item) => {
          const result = resultByKey.get(mailItemKey(item));
          return result
            ? {
                ...item,
                label: bucketLabel(result.classification.bucket),
                tone: toneForBucket(result.classification.bucket),
                bucket: result.classification.bucket,
                score: result.classification.priorityScore,
                reasons: userFacingClassificationReasons(
                  result.classification.reasons,
                ),
              }
            : item;
        }),
      );

      const failedCount = settled.length - results.length;
      const feedbackLabel = smartInboxFeedbackLabel(action);
      setBackendNotice(
        failedCount > 0
          ? `智能收件箱已学习 ${results.length} 封，${failedCount} 封稍后重试。`
          : results.length > 1
            ? `智能收件箱已学习 ${results.length} 封：${feedbackLabel}。`
            : `智能收件箱已学习：${feedbackLabel}。`,
      );
      return failedCount === 0;
    } catch {
      setBackendNotice("智能收件箱反馈暂时不可用。");
      return false;
    } finally {
      setSmartInboxBusy("");
    }
  }

  async function trackSelectedFollowUp() {
    if (!props.api || !selectedMail) {
      setFollowUpNotice("需要先完成服务连接，才能让 Hermes 创建跟进。");
      return;
    }

    try {
      const suggestion = await props.api.trackMessageFollowup({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
        language: "zh-CN",
        memoryScope: `sender:${selectedMail.email}`,
        memoryLayers: [
          "contact_memory",
          "procedural_memory",
          "semantic_profile",
          "writing_style_profile",
        ],
      });
      if (!suggestion.followupNeeded || !suggestion.dueAt) {
        setHermesFollowUpSuggestion(undefined);
        setFollowUpNotice("Hermes 没有发现需要创建的跟进提醒。");
        return;
      }

      setHermesFollowUpSuggestion(suggestion);
      setFollowUpNotice(undefined);
    } catch (error) {
      setHermesFollowUpSuggestion(undefined);
      setFollowUpNotice(
        hermesSkillErrorNotice(error, {
          skillId: "followup_tracker",
          fallback: "Hermes 跟进暂时不可用。",
          unavailable: {
            hermes_message_followup_unavailable:
              "Hermes 跟进暂时不可用。",
          },
        }),
      );
    }
  }

  async function confirmHermesFollowUp() {
    if (
      !props.api ||
      !selectedMail ||
      !hermesFollowUpSuggestion?.dueAt ||
      !isActionableFollowUpStatus(hermesFollowUpSuggestion.status)
    ) {
      return;
    }

    try {
      const followUp = await props.api.confirmHermesFollowUp({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
        skillRunId: hermesFollowUpSuggestion.skillRunId,
        status: hermesFollowUpSuggestion.status,
        dueAt: hermesFollowUpSuggestion.dueAt,
        nextAction: hermesFollowUpSuggestion.nextAction,
        reasons: hermesFollowUpSuggestion.reasons,
        sourceQuote: hermesFollowUpSuggestion.sourceQuote,
      });
      setHermesFollowUpSuggestion(undefined);
      setFollowUpNotice(`跟进已保存：${followUp.title ?? followUp.messageId}`);
    } catch (error) {
      setFollowUpNotice(
        hermesSkillErrorNotice(error, {
          skillId: "followup_tracker",
          fallback: "Hermes 跟进保存失败。",
          unavailable: {
            hermes_follow_up_unavailable: "Hermes 跟进保存失败。",
          },
        }),
      );
    }
  }

  if (oauthCallback) {
    return (
      <OAuthCallbackPage
        api={props.api}
        callback={oauthCallback}
        onConnected={handleConnectedAccount}
        onComplete={finishOAuthCallback}
      />
    );
  }

  return (
    <div className="app-shell" style={appShellStyle}>
      <aside className="global-sidebar" aria-label="全局功能栏">
        <div className="brand-row">
          <div className="brand-icon">
            <Mail size={20} />
          </div>
          <div>
            <strong>Email Hub</strong>
          </div>
        </div>

        <nav className="global-nav">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Fragment key={item.id}>
                <button
                  className={activeView === item.id ? "nav-button active" : "nav-button"}
                  onClick={() => {
                    setActiveView(item.id);
                    if (item.id === "add-mail") {
                      setActiveAddMailProviderGroup(undefined);
                    }
                  }}
                  type="button"
                  aria-label={item.label}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                  {item.count ? <strong>{item.count}</strong> : null}
                </button>
                {item.id === "add-mail" ? (
                  <div className="provider-nav" aria-label="添加邮箱服务商分类">
                    {navigationProviderGroups.map((group) => (
                      <button
                        key={group.id}
                        className={
                          activeAddMailProviderGroup === group.id ? "active" : ""
                        }
                        type="button"
                        onClick={() => {
                          setActiveAddMailProviderGroup(
                            group.id as AddMailProviderGroupId,
                          );
                          setActiveView("add-mail");
                        }}
                      >
                        <span>{group.label}</span>
                        <strong>{group.count}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-footer">
            <span className="online-dot" />
            <div>
              <strong>已连接 {connectedAccountCount} 个邮箱</strong>
            </div>
          </div>
          {settingsNavItem ? (
            <button
              className={
                activeView === settingsNavItem.id
                  ? "nav-button sidebar-settings-button active"
                  : "nav-button sidebar-settings-button"
              }
              onClick={() => setActiveView(settingsNavItem.id)}
              type="button"
              aria-label={settingsNavItem.label}
            >
              <Settings size={19} />
              <span>{settingsNavItem.label}</span>
            </button>
          ) : null}
        </div>
      </aside>
      <div
        className="pane-resize-handle sidebar-resize-handle"
        aria-label="调整左侧栏宽度"
        {...sidebarResize.separatorProps}
      />

      <main className="main-area">
        {activeView === "mail" ? (
          <MailWorkspace
            api={props.api}
            accountId={workspaceAccountId}
            activeFolder={activeFolder}
            activeMailId={activeMailId}
            folders={workspaceFolders}
            mail={sortedMail}
            folderTitle={activeFolderSummary.title}
            folderCount={activeFolderSummary.count}
            selectedMail={
              selectedMail ??
              createBlankMailItem(workspaceAccountId || PREVIEW_ACCOUNT_ID)
            }
            hasSelectedMail={Boolean(selectedMail)}
            selectedDetail={selectedDetail}
            undoToast={undoToast}
            backendNotice={backendNotice}
            smartInboxBusy={smartInboxBusy}
            quickCategories={navigationQuickCategories}
            labels={navigationLabels}
            hermesDockReaderIntent={hermesDockReaderIntent}
            hermesFollowUpSuggestion={hermesFollowUpSuggestion}
            followUpNotice={followUpNotice}
            density={mailDensity}
            onGlobalSearch={launchGlobalSearch}
            onDensityChange={setMailDensity}
            onRefresh={() => void refreshCurrentMail()}
            onFolderChange={(id) => void loadMailbox(id)}
            onSavedViewChange={(id) => void loadSavedView(id)}
            onLabelChange={(id) => void loadLabel(id)}
            onMailChange={setActiveMailId}
            onDone={() => applySelectedAction("done")}
            onArchive={() => applySelectedAction("archive")}
            onTrash={() => applySelectedAction("trash")}
            onToggleStar={() =>
              selectedMail
                ? applySelectedAction(selectedMail.starred ? "unstar" : "star")
                : false
            }
            onToggleRead={() =>
              selectedMail
                ? applySelectedAction(
                    selectedMail.unread ? "mark_read" : "mark_unread",
                  )
                : false
            }
            onUndoDone={() => void undoDone()}
            onSmartInboxBucketDone={(bucket) => void applySmartInboxBucketDone(bucket)}
            onSelectedMessagesDone={(items) => void applySelectedMessagesDone(items)}
            onSmartInboxFeedback={recordSmartInboxFeedback}
            onMailActionResult={applyActionResult}
            onLabelsChanged={(accountId) => void refreshLabels(accountId)}
            onTrackFollowUp={() => void trackSelectedFollowUp()}
            onConfirmHermesFollowUp={() => void confirmHermesFollowUp()}
            onOpenHermesRuntimeSettings={openHermesRuntimeSettings}
          />
        ) : null}
        {activeView === "add-mail" ? (
          <AddMailPage
            api={props.api}
            providerGroupId={activeAddMailProviderGroup}
            oauthRedirect={
              props.oauthRedirect ??
              ((url) => {
                window.location.assign(url);
              })
            }
            onConnected={(nextAccountId) => void handleConnectedAccount(nextAccountId)}
            onComplete={finishAddMailConnection}
            onOpenSyncCenter={() => setActiveView("sync")}
          />
        ) : null}
        {activeView === "sync" ? (
          <SyncCenterPage
            api={props.api}
            selectedAccountId={selectedAccountId}
            oauthRedirect={
              props.oauthRedirect ??
              ((url) => {
                window.location.assign(url);
              })
            }
            onSelectAccount={(nextAccountId) => {
              rememberSelectedAccount(nextAccountId);
              setAccountDiscoveryReady(true);
              setActiveView("mail");
            }}
          />
        ) : null}
        {activeView === "search" ? (
          <SearchPage
            api={props.api}
            accountId={selectedMail?.accountId ?? selectedAccountId ?? ""}
            restrictToAccount={Boolean(restrictToDefaultAccount)}
            labels={navigationLabels}
            quickCategories={navigationQuickCategories}
            launch={searchLaunch}
            previewMail={mailItems[0]}
            onOpenResult={openSearchResult}
          />
        ) : null}
        {activeView === "hermes" ? (
          <HermesPage
            api={props.api}
          />
        ) : null}
        {activeView === "domains" ? (
          <DomainSetupPage api={props.api} />
        ) : null}
        {activeView === "settings" ? (
          <SettingsHomePage
            api={props.api}
            connectedAccountCount={connectedAccountCount}
            onOpenAddMail={() => setActiveView("add-mail")}
            onOpenDomains={() => setActiveView("domains")}
            onOpenHermes={() => setActiveView("hermes")}
          />
        ) : null}
      </main>

      {activeView !== "hermes" ? (
        <HermesDock
          prompt={hermesPrompt}
          notice={hermesDockNotice}
          result={hermesDockResult}
          searchAccountId={hermesDockSearchAccountId}
          actionPlan={hermesDockActionPlan}
          ruleCandidate={hermesDockRuleCandidate}
          ruleSimulation={hermesDockRuleSimulation}
          historyBackfill={hermesDockHistoryBackfill}
          learnedMemory={hermesDockLearnedMemory}
          workspaceContext={hermesWorkspaceContext}
          workspaceContextLoading={hermesWorkspaceContextLoading}
          busy={hermesDockBusy}
          noticeActionLabel={hermesNoticeActionLabel(hermesDockNoticeState?.action)}
          formatDate={formatMailDate}
          onPromptChange={updateHermesPrompt}
          onOpen={() => void refreshHermesWorkspaceContext()}
          onSubmit={(prompt) => void submitHermesDockPrompt(prompt)}
          onApproveRule={() => void approveHermesDockRule()}
          onNoticeAction={
            hermesDockNoticeState?.action === "open_runtime_settings"
              ? openHermesRuntimeSettings
              : undefined
          }
          onOpenSearch={launchGlobalSearch}
        />
      ) : null}
    </div>
  );
}

function OAuthCallbackPage(props: {
  api?: EmailHubApi;
  callback: OAuthCallbackParams;
  onConnected: (accountId?: string) => Promise<void> | void;
  onComplete: () => void;
}) {
  const onConnectedRef = useRef(props.onConnected);
  const onCompleteRef = useRef(props.onComplete);
  const [status, setStatus] = useState<{
    kind: "working" | "success" | "error";
    message: string;
  }>({
    kind: "working",
    message: "确认登录",
  });

  useEffect(() => {
    onConnectedRef.current = props.onConnected;
  }, [props.onConnected]);

  useEffect(() => {
    onCompleteRef.current = props.onComplete;
  }, [props.onComplete]);

  useEffect(() => {
    let alive = true;

    async function completeCallback() {
      if (props.callback.error) {
        const pending = props.callback.state
          ? loadOAuthPendingState(props.callback.state)
          : undefined;
        setStatus({
          kind: "error",
          message: formatOAuthProviderDeniedError(
            pending?.flow ?? "onboarding",
          ),
        });
        return;
      }

      if (!props.callback.state || !props.callback.code) {
        setStatus({
          kind: "error",
          message: "登录信息不完整。",
        });
        return;
      }

      const pending = loadOAuthPendingState(props.callback.state);
      if (!pending) {
        setStatus({
          kind: "error",
          message: "登录已过期。",
        });
        return;
      }

      const callbackKey = [
        pending.flow,
        pending.provider,
        props.callback.state,
      ].join(":");

      if (!props.api) {
        setStatus({
          kind: "error",
          message: "邮箱服务暂时不可用。",
        });
        return;
      }

      const api = props.api;
      try {
        const result = await completeOAuthCallbackOnce(
          api,
          callbackKey,
          () =>
            pending.flow === "reauthorization"
              ? api.completeSyncCenterOAuthReauthorizationCallback({
                  state: props.callback.state,
                  code: props.callback.code,
                })
              : api.completeOAuthCallback({
                  provider: pending.provider,
                  state: props.callback.state,
                  code: props.callback.code,
                }),
        );
        if (!alive) {
          return;
        }

        clearOAuthPendingState(props.callback.state);
        setStatus({
          kind: "success",
          message:
            pending.flow === "reauthorization"
              ? "重新登录完成，正在打开收件箱。"
              : "邮箱已连接，正在打开收件箱。",
        });
        void Promise.resolve(onConnectedRef.current(result.account?.id)).catch(
          () => {
            // Mailbox refresh failures should not keep users on the callback URL.
          },
        );
        onCompleteRef.current();
      } catch (error) {
        if (alive) {
          clearOAuthPendingState(props.callback.state);
          setStatus({
            kind: "error",
            message: formatOAuthCallbackError({
              flow: pending.flow,
              error,
            }),
          });
        }
      }
    }

    void completeCallback();
    return () => {
      alive = false;
    };
  }, [
    props.api,
    props.callback.code,
    props.callback.error,
    props.callback.state,
  ]);

  return (
    <div className="app-shell oauth-shell">
      <main className="main-area">
        <section className="workspace-page page-scroll oauth-callback-page">
          <div
            className={`page-panel oauth-status-card oauth-status-card-${status.kind}`}
            role={status.kind === "error" ? "alert" : "status"}
            aria-label="网页登录状态"
          >
            <CheckCircle2 size={24} />
            <h1>{status.kind === "success" ? "邮箱已添加" : "添加邮箱"}</h1>
            <p>{status.message}</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function hasBackendAccountId(accountId: string): boolean {
  return accountId.trim().length > 0;
}

function readOAuthCallbackFromLocation(
  location: Location | undefined,
): OAuthCallbackParams | undefined {
  if (!location || location.pathname !== "/oauth/callback") {
    return undefined;
  }

  const params = new URLSearchParams(location.search);
  return {
    state: params.get("state") ?? "",
    code: params.get("code") ?? "",
    ...(params.get("error") ? { error: params.get("error") ?? undefined } : {}),
    ...(params.get("iss") ? { issuer: params.get("iss") ?? undefined } : {}),
  };
}

function storeOAuthPendingState(state: string, pending: OAuthPendingState): void {
  try {
    sessionStorage.setItem(`${OAUTH_PENDING_PREFIX}${state}`, JSON.stringify(pending));
  } catch {
    // If session storage is unavailable, the callback page will ask the user to retry.
  }
}

function loadOAuthPendingState(state: string): OAuthPendingState | undefined {
  try {
    const raw = sessionStorage.getItem(`${OAUTH_PENDING_PREFIX}${state}`);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<OAuthPendingState>;
    if (!isOAuthProvider(parsed.provider)) {
      return undefined;
    }

    return {
      provider: parsed.provider,
      flow:
        parsed.flow === "reauthorization" ? "reauthorization" : "onboarding",
      returnTo: "add-mail",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return undefined;
  }
}

function clearOAuthPendingState(state: string): void {
  try {
    sessionStorage.removeItem(`${OAUTH_PENDING_PREFIX}${state}`);
  } catch {
    // Nothing to clear when session storage is unavailable.
  }
}

function readSelectedAccountIdFromSession(): string | undefined {
  try {
    return sessionStorage.getItem(SELECTED_ACCOUNT_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeSelectedAccountIdInSession(accountId: string): void {
  try {
    sessionStorage.setItem(SELECTED_ACCOUNT_STORAGE_KEY, accountId);
  } catch {
    // The current app session can continue even when storage is unavailable.
  }
}

function clearSelectedAccountIdFromSession(): void {
  try {
    sessionStorage.removeItem(SELECTED_ACCOUNT_STORAGE_KEY);
  } catch {
    // The current app session can continue even when storage is unavailable.
  }
}

function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === "gmail" || value === "outlook";
}



function HermesPage(props: {
  api?: EmailHubApi;
}) {
  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>Hermes</h1>
        </div>
      </header>
      <div className="settings-detail">
        <HermesRuntimeSettingsPanel
          api={props.api}
        />
      </div>
    </section>
  );
}

function DomainSetupPage(props: {
  api?: EmailHubApi;
}) {
  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>配置域名</h1>
        </div>
      </header>
      <div className="settings-detail">
        <DomainAliasSettingsPanel api={props.api} mode="domains" />
      </div>
    </section>
  );
}

function hermesSearchMemoryInput(
  selectedMail: MailItem | undefined,
): { memoryScope: string } {
  if (!selectedMail?.email) {
    return { memoryScope: "global" };
  }

  return {
    memoryScope: `sender:${selectedMail.email}`,
  };
}

function hermesReplyMemoryInput(
  selectedMail: MailItem | undefined,
): { memoryScope: string } {
  if (!selectedMail?.email) {
    return { memoryScope: "global" };
  }

  return {
    memoryScope: `recipient:${selectedMail.email}`,
  };
}

function readerTranslationPreferenceSourceLanguage(
  translation: HermesMessageTranslationResult,
  selectedSourceLanguage: string,
): string | undefined {
  if (translation.sourceLanguage !== "auto") {
    return translation.sourceLanguage;
  }

  return selectedSourceLanguage !== "auto" ? selectedSourceLanguage : undefined;
}

function UndoDoneNotice(props: { onUndoDone: () => void }) {
  return (
    <div className="backend-notice" role="status">
      已标记完成。
      <button type="button" aria-label="撤销完成" onClick={props.onUndoDone}>
        撤销
      </button>
    </div>
  );
}

function mapMailboxDtoToFolderItem(mailbox: MailboxDto): FolderItem {
  return {
    id: mailbox.id,
    label: mailbox.name,
    count: mailbox.messageCount,
    role: mailbox.role,
  };
}

function withOutlookFolderShell(mailboxes: FolderItem[]): FolderItem[] {
  const existingIds = new Set(mailboxes.map((folder) => folder.id));
  const existingRoles = new Set(
    mailboxes
      .map((folder) => folder.role)
      .filter((role): role is string => Boolean(role)),
  );
  const missingFolders = aggregateFolderShell
    .filter(
      (folder) => !existingIds.has(folder.id) && !existingRoles.has(folder.id),
    )
    .map((folder) => ({ ...folder, virtual: true }));

  return [...mailboxes, ...missingFolders];
}

function mapNavigationFolderDtoToFolderItem(folder: {
  id: string;
  label: string;
  count: number;
}): FolderItem {
  return {
    id: folder.id,
    label: folder.label,
    count: folder.count,
  };
}

function aggregateMessageFilterForFolder(folderId: string): {
  mailboxRole?: string;
  quickFilters?: MailQuickFilter[];
  hasAttachment?: boolean;
} {
  if (
    folderId === "inbox" ||
    folderId === "drafts" ||
    folderId === "sent" ||
    folderId === "archive" ||
    folderId === "junk" ||
    folderId === "trash"
  ) {
    return { mailboxRole: folderId };
  }

  if (folderId === "flagged" || folderId === "starred") {
    return { quickFilters: ["starred"] };
  }

  if (folderId === "snoozed") {
    return { quickFilters: ["snoozed"] };
  }

  if (folderId === "attachments") {
    return { hasAttachment: true };
  }

  return {};
}

function shouldRemoveMailAfterAction(
  activeFolder: string,
  result: MailActionResult,
): boolean {
  if (result.action === "done" || result.state.archived || result.state.deleted) {
    return true;
  }

  return (
    result.action === "unstar" &&
    !result.state.starred &&
    (activeFolder === "flagged" || activeFolder === "starred")
  );
}

function hasSearchMailboxScope(scope: SearchMailboxScope): boolean {
  return Boolean(scope.mailboxId || scope.mailboxRole);
}

function mapLabelDtoToLabelItem(label: LabelDto): LabelItem {
  return {
    id: label.id,
    accountId: label.accountId,
    label: label.name,
    count: label.messageCount,
    tone: toneForLabelColor(label.color),
  };
}

function toneForLabelColor(color: LabelDto["color"]): Tone {
  return color === "mint" ? "green" : color;
}

function mapMessageDtoToMailItem(message: MessageListItemDto): MailItem {
    return {
      id: message.id,
      accountId: message.accountId,
      receivedAt: message.receivedAt,
      sender: message.from.name ?? message.from.email,
    email: message.from.email,
    subject: message.subject,
    preview: message.snippet ?? "",
    time: formatMailTime(message.receivedAt),
    date: formatMailDate(message.receivedAt),
    label: bucketLabel(message.classification.bucket),
    tone: toneForBucket(message.classification.bucket),
      unread: message.unread,
      starred: message.starred,
      attachmentCount: message.attachmentCount,
      mailboxIds: message.mailboxIds,
    bucket: message.classification.bucket,
    score: message.classification.priorityScore,
    reasons: userFacingClassificationReasons(message.classification.reasons),
    searchPreview: message.searchPreview?.text,
    };
  }

function sortMailItems(items: MailItem[]): MailItem[] {
  return [...items].sort(
    (left, right) =>
      new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
  );
}

function firstMailKey(items: MailItem[]): string {
  const [first] = sortMailItems(items);
  return first ? mailItemKey(first) : "";
}

function messageDetailKey(detail: MessageDetailDto | undefined): string {
  return detail ? `${detail.accountId}:${detail.id}` : "";
}

function folderSummaryForActiveView(input: {
  activeFolder: string;
  folders: FolderItem[];
  labels: LabelItem[];
  quickCategories: QuickCategory[];
  mail: MailItem[];
}): { title: string; count: number } {
  if (input.activeFolder.startsWith("label:")) {
    const labelId = input.activeFolder.slice("label:".length);
    const label = input.labels.find((item) => item.id === labelId);
    return {
      title: label?.label ?? "标签",
      count: label?.count ?? input.mail.length,
    };
  }

  const folder = input.folders.find((item) => item.id === input.activeFolder);
  if (folder) {
    return {
      title: folder.label,
      count: folder.count,
    };
  }

  const category = input.quickCategories.find((item) => item.id === input.activeFolder);
  if (category) {
    return {
      title: category.label,
      count: category.count,
    };
  }

  return {
    title: input.activeFolder === "search" ? "搜索结果" : "聚合收件箱",
    count: input.mail.length,
  };
}

function hermesSkillErrorNotice(
  error: unknown,
  input: {
    skillId: string;
    fallback: string;
    unavailable?: Record<string, string>;
  },
): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "hermes_skill_disabled") {
      return hermesSkillDisabledNotice(
        error.skillId ?? input.skillId,
        error.requiredPermission,
      );
    }
    if (error.code === "hermes_runtime_not_configured") {
      return "Hermes 暂时不可用。";
    }
    const unavailableNotice = input.unavailable?.[error.code];
    if (unavailableNotice) {
      return unavailableNotice;
    }
  }

  return input.fallback;
}

function hermesNoticeActionFromError(
  error: unknown,
): HermesNoticeAction | undefined {
  return error instanceof ApiRequestError &&
    error.code === "hermes_runtime_not_configured"
    ? "open_runtime_settings"
    : undefined;
}

function hermesNoticeActionLabel(
  action: HermesNoticeAction | undefined,
): string | undefined {
  return action === "open_runtime_settings" ? "设置 Hermes" : undefined;
}

function hermesDisabledSkillRequiredPermissionFromError(
  error: unknown,
): HermesSkillRequiredPermission | undefined {
  if (
    error instanceof ApiRequestError &&
    error.code === "hermes_skill_disabled"
  ) {
    return error.requiredPermission;
  }

  return undefined;
}

function messageRecipientSummary(detail: MessageDetailDto | undefined): string {
  if (!detail) {
    return "收件人：我";
  }

  const parts = [
    `收件人：${formatAddressList(detail.to)}`,
  ];
  if (detail.cc.length > 0) {
    parts.push(`抄送：${formatAddressList(detail.cc)}`);
  }
  return parts.join(" · ");
}

function formatAddressList(addresses: string[]): string {
  if (addresses.length === 0) {
    return "无";
  }
  const visible = addresses.slice(0, 3);
  const suffix = addresses.length > visible.length ? ` 等 ${addresses.length} 人` : "";
  return `${visible.join("、")}${suffix}`;
}

function dateInputValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
}

function normalizeReceivedAfterFilter(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes("T")) {
    return value;
  }
  return `${value}T00:00:00.000Z`;
}

function normalizeReceivedBeforeFilter(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.includes("T")) {
    return value;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function messageReaderText(
  detail: MessageDetailDto | undefined,
  mail: MailItem,
): string {
  const bodyText = detail?.bodyText?.trim();
  if (bodyText) {
    return bodyText;
  }

  const bodyHtml = detail?.bodyHtml?.trim();
  if (bodyHtml) {
    return htmlToReadableText(bodyHtml);
  }

  return (detail?.snippet ?? mail.preview).trim();
}

function htmlToReadableText(html: string): string {
  if (typeof document !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content
      .querySelectorAll("script, style, noscript, template")
      .forEach((node) => node.remove());
    return normalizeReaderText(template.content.textContent ?? "");
  }

  return normalizeReaderText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

function normalizeReaderText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMailTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatMailDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function bucketLabel(bucket: string): string {
  if (bucket.includes("Urgent")) return "优先";
  if (bucket.includes("Important")) return "重要";
  if (bucket.includes("Feed")) return "动态";
  if (bucket.includes("Transactions")) return "通知";
  return "邮件";
}

function toneForBucket(bucket: string): Tone {
  if (bucket.includes("Urgent")) return "coral";
  if (bucket.includes("Important")) return "green";
  if (bucket.includes("Feed")) return "purple";
  if (bucket.includes("Transactions")) return "blue";
  return "yellow";
}

function smartInboxFeedbackLabel(action: SmartInboxFeedbackAction): string {
  const labels: Record<SmartInboxFeedbackAction, string> = {
    mark_important: "标为重要",
    mark_not_important: "降低优先级",
    move_to_personal: "移到个人",
    move_to_notifications: "移到通知",
    move_to_newsletters: "移到订阅",
    move_to_feed: "移到动态",
    always_important_sender: "始终重要发件人",
    mute_sender: "静音发件人",
  };
  return labels[action];
}

function userFacingClassificationReasons(reasons: string[]): string[] {
  return reasons.map(formatClassificationReason).filter(Boolean);
}

function formatClassificationReason(reason: string): string {
  const normalized = reason.trim();
  const movedMatch = normalized.match(
    /^User moved(?: .+)? to (Newsletters|Feed|Notifications|Personal|Important)$/i,
  );
  if (movedMatch) {
    const targetLabels: Record<string, string> = {
      newsletters: "订阅",
      feed: "动态",
      notifications: "通知",
      personal: "个人",
      important: "重要",
    };
    return `已归入${targetLabels[movedMatch[1].toLowerCase()] ?? "邮件"}`;
  }
  return normalized;
}

function isActionableFollowUpStatus(
  status: HermesFollowupTrackerResult["status"],
): status is "needs_reply" | "waiting_on_them" {
  return status === "needs_reply" || status === "waiting_on_them";
}
