import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Archive,
  AtSign,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Inbox,
  Mail,
  MailPlus,
  Paperclip,
  PenLine,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2
} from "lucide-react";
import { ApiRequestError } from "./lib/emailHubApi";
import type {
  AttachmentDownload,
  AttachmentDto,
  AccountImportCreateResult,
  AccountImportPreview,
  AccountImportPreviewRow,
  AccountTransferImportResult,
  DomainAliasDto,
  DomainCatchAllMode,
  DomainCatchAllRuleDto,
  DomainDeliveryLogDto,
  DomainDestinationDto,
  DomainDto,
  EmailHubApi,
  FollowUpDto,
  GatekeeperMode,
  GatekeeperSenderDto,
  HermesEmailSearchQaResult,
  HermesActionItemExtractResult,
  HermesFollowupTrackerResult,
  HermesLabelSuggestResult,
  HermesNewsletterCleanupResult,
  HermesPriorityTriageResult,
  HermesMemoryDto,
  HermesQuickReplyScenario,
  HermesProviderCatalogItem,
  HermesProviderProbeMissing,
  HermesRuleCandidateDto,
  HermesRuleSimulationDto,
  HermesRuntimeMode,
  HermesRuntimeUpdateChannel,
  HermesRuntimeUpdatePolicy,
  HermesRuntimeVersionStatus,
  HermesThreadSummaryResult,
  HermesTranslateTextResult,
  HermesWorkspaceContextDto,
  ImapSmtpConnectionDiagnostic,
  ImapSmtpConnectionTestResult,
  ImapSmtpOnboardingInput,
  LabelDto,
  AccountTransferPackage,
  MailAction,
  MailQuickFilter,
  MailActionResult,
  MailComposePreviewDto,
  MailComposeSeedDto,
  MailComposeSeedAttachmentDto,
  MailComposeSeedMode,
  MailDraftAttachmentDto,
  MailDraftDto,
  MailDraftSource,
  MailEngineHealthDto,
  MailProviderCapabilityDto,
  MailSearchScope,
  MailSendIdentityCandidateDto,
  MailSendIdentityDto,
  MailboxDto,
  MessageDetailDto,
  MessageListItemDto,
  OAuthProvider,
  OperationalEventDto,
  ReauthorizationTaskDto,
  ScheduledSendDto,
  SmartInboxFeedbackAction,
  SyncCenterAccountDto,
  SyncCenterImapSmtpReauthorizationInput
} from "./lib/emailHubApi";

type ViewId = "mail" | "add-mail" | "sync" | "search" | "settings";
type SettingsSectionId =
  | "hermes"
  | "todo"
  | "gatekeeper"
  | "aliases"
  | "domains"
  | "notifications";
type Tone = "coral" | "blue" | "green" | "yellow" | "purple";
type MailDensity = "roomy" | "comfortable" | "compact";
type QuickReplyAction = {
  scenario: HermesQuickReplyScenario;
  label: string;
  instruction: string;
};

const MAX_COMPOSE_ATTACHMENTS = 20;
const MAX_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const COMPOSE_AUTOSAVE_DELAY_MS = 2_000;
const ACCOUNT_CSV_TEMPLATE = [
  "email,provider,display_name,auth_method,username,secret,imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,labels,group,enabled,notes",
  "owner@gmail.com,gmail,Owner,oauth,,,,,,,,,priority,personal,true,Log in with Google",
  "support@qq.com,qq,Support,password,support@qq.com,mailbox-auth-code,,,,,,,support,team,true,Use mailbox authorization code",
  "me@example.com,custom_domain,Personal domain,password,me@example.com,app-password,imap.example.com,993,tls,smtp.example.com,465,tls,personal,domain,true,Custom servers",
].join("\n");
const PREVIEW_ATTACHMENT_ROWS = [
  { name: "Q2_合作方案_最终版.pdf", size: "1.2 MB" },
  { name: "报价明细表.xlsx", size: "320 KB" },
];
const READER_TRANSLATION_LANGUAGES = [
  { value: "Chinese", label: "中文" },
  { value: "English", label: "English" },
  { value: "Japanese", label: "日本語" },
  { value: "Korean", label: "한국어" },
  { value: "Spanish", label: "Español" },
  { value: "French", label: "Français" },
] as const;

type ComposeAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
type ReaderHermesBusy = "summary" | "translation" | "organize";
type SmartInboxBusyAction = "" | "bulk_done" | SmartInboxFeedbackAction;
type ReaderActionResult = boolean | Promise<boolean>;

interface ReaderHermesOrganizationResult {
  priority: HermesPriorityTriageResult;
  labels: HermesLabelSuggestResult;
  newsletter: HermesNewsletterCleanupResult;
  actionItems: HermesActionItemExtractResult;
}

type HermesOrganizationApplyAction =
  | {
      id: string;
      label: string;
      kind: "smart_inbox";
      action: SmartInboxFeedbackAction;
    }
  | {
      id: string;
      label: string;
      kind: "mail";
      action: Extract<MailAction, "archive">;
    };

type PasswordReauthorizationFormState = {
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

interface ComposeDraftSignatureInput {
  accountId: string;
  from?: { address: string; name?: string };
  to: Array<{ address: string; name?: string }>;
  cc: Array<{ address: string; name?: string }>;
  bcc: Array<{ address: string; name?: string }>;
  subject: string;
  bodyText: string;
  source: MailDraftSource;
  attachments?: MailDraftAttachmentDto[];
  replyToMessageId?: string;
  sourceMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
}

interface SearchLaunch {
  query: string;
  requestId: number;
}

type AddMailProviderGroupId =
  | "gmail"
  | "outlook"
  | "icloud"
  | "domestic"
  | "proton"
  | "domain";

interface FolderItem {
  id: string;
  label: string;
  count: number;
}

interface MailItem {
  id: string;
  accountId: string;
  sender: string;
  email: string;
  subject: string;
  preview: string;
  time: string;
  date: string;
  label: string;
  tone: Tone;
  unread: boolean;
  starred: boolean;
  mailboxIds?: string[];
  bucket: string;
  score: number;
  reasons: string[];
  searchPreview?: string;
}

interface ProviderOption {
  title: string;
  subtitle: string;
  mark: string;
  provider: string;
  action: "oauth" | "password" | "bridge" | "manual";
}

interface ProviderGroup {
  id: string;
  label: string;
  count: number;
}

interface QuickCategory {
  id: string;
  label: string;
  count: number;
  tone: Tone;
}

interface LabelItem {
  id: string;
  label: string;
  count: number;
  tone: Tone;
}

const quickReplyActions: QuickReplyAction[] = [
  {
    scenario: "confirm",
    label: "确认",
    instruction: "Confirm politely and keep it concise.",
  },
  {
    scenario: "thanks",
    label: "感谢",
    instruction: "Thank them warmly and keep the reply short.",
  },
  {
    scenario: "follow_up",
    label: "推进",
    instruction: "Follow up with a clear next step.",
  },
  {
    scenario: "decline",
    label: "婉拒",
    instruction: "Decline politely without over-explaining.",
  },
];

const navItems: Array<{ id: ViewId; label: string; icon: typeof Inbox; count?: number }> = [
  { id: "mail", label: "邮箱", icon: Inbox, count: 128 },
  { id: "add-mail", label: "添加邮箱", icon: MailPlus },
  { id: "sync", label: "同步中心", icon: Clock3 },
  { id: "search", label: "搜索", icon: Search },
  { id: "settings", label: "设置", icon: Settings }
];

const settingsSections: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: typeof Inbox;
}> = [
  { id: "hermes", label: "Hermes 配置", description: "助手与学习偏好", icon: Sparkles },
  { id: "todo", label: "待办", description: "待回复、稍后、跟进", icon: CheckCircle2 },
  { id: "gatekeeper", label: "新发件人处理", description: "陌生来信进入哪里", icon: ShieldCheck },
  { id: "aliases", label: "别名转发", description: "转发规则和目标邮箱", icon: Send },
  { id: "domains", label: "域名管理", description: "域名验证与收信设置", icon: ShieldCheck },
  { id: "notifications", label: "通知与隐私", description: "提醒、审计、数据", icon: Settings }
];

const folders: FolderItem[] = [
  { id: "inbox", label: "收件箱", count: 128 },
  { id: "priority", label: "今日优先", count: 9 },
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

const previewLabels: LabelItem[] = [
  { id: "work", label: "工作", count: 32, tone: "coral" },
  { id: "customer", label: "客户", count: 18, tone: "green" },
  { id: "finance", label: "财务", count: 6, tone: "blue" },
  { id: "product", label: "产品", count: 42, tone: "yellow" },
  { id: "market", label: "市场", count: 15, tone: "purple" }
];

const densityOptions: Array<{ id: MailDensity; label: string; shortLabel: string }> = [
  { id: "roomy", label: "宽阔", shortLabel: "宽" },
  { id: "comfortable", label: "舒适", shortLabel: "舒" },
  { id: "compact", label: "紧凑", shortLabel: "紧" }
];

const providerGroups: ProviderGroup[] = [
  { id: "gmail", label: "Gmail", count: 2 },
  { id: "outlook", label: "Outlook", count: 1 },
  { id: "icloud", label: "iCloud", count: 1 },
  { id: "domestic", label: "163 / QQ", count: 2 },
  { id: "proton", label: "Proton", count: 1 },
  { id: "domain", label: "个人域名", count: 3 }
];

const addMailProviderGroupProviders: Record<AddMailProviderGroupId, string[]> = {
  gmail: ["gmail"],
  outlook: ["outlook"],
  icloud: ["icloud"],
  domestic: ["163", "qq", "tencent_exmail"],
  proton: ["proton", "proton_bridge"],
  domain: ["custom", "custom_domain"],
};

const quickCategories: QuickCategory[] = [
  { id: "codes", label: "验证码", count: 18, tone: "blue" },
  { id: "receipts", label: "账单/收据", count: 24, tone: "green" },
  { id: "shipping", label: "物流/订单", count: 21, tone: "yellow" },
  { id: "travel", label: "旅行/票务", count: 7, tone: "purple" },
  { id: "notifications", label: "系统通知", count: 149, tone: "coral" },
  { id: "newsletters", label: "订阅/营销", count: 67, tone: "purple" },
  { id: "social", label: "社交/社区", count: 12, tone: "blue" }
];

const folderIcons: Record<string, typeof Inbox> = {
  inbox: Inbox,
  priority: Clock3,
  starred: Star,
  snoozed: Clock3,
  drafts: FileText,
  sent: Send,
  archive: Archive,
  spam: ShieldCheck,
  trash: Trash2,
  all: Mail,
  attachments: Paperclip
};

const PREVIEW_ACCOUNT_ID = "account_1";

const mailItems: MailItem[] = [
  {
    id: "m1",
    accountId: PREVIEW_ACCOUNT_ID,
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
    bucket: "P1 Urgent",
    score: 97,
    reasons: ["直接发给你", "你常回复此发件人", "Hermes 识别为需要回复", "今天 17:00 截止", "来自项目标签"]
  },
  {
    id: "m2",
    accountId: PREVIEW_ACCOUNT_ID,
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
    bucket: "P2 Important",
    score: 88,
    reasons: ["直接发给你", "你常回复此发件人"]
  },
  {
    id: "m3",
    accountId: PREVIEW_ACCOUNT_ID,
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
    bucket: "P2 Important",
    score: 82,
    reasons: ["直接发给你", "来自项目标签"]
  },
  {
    id: "m4",
    accountId: PREVIEW_ACCOUNT_ID,
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
    bucket: "P5 Transactions",
    score: 43,
    reasons: ["系统通知", "无需立即处理"]
  },
  {
    id: "m5",
    accountId: PREVIEW_ACCOUNT_ID,
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
    bucket: "P5 Transactions",
    score: 38,
    reasons: ["票据通知", "无需回复"]
  },
  {
    id: "m6",
    accountId: PREVIEW_ACCOUNT_ID,
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
    bucket: "P4 FYI / Updates",
    score: 35,
    reasons: ["项目标签", "稍后处理"]
  }
];

const providers: ProviderOption[] = [
  { title: "Gmail", subtitle: "登录后同步 Gmail 邮件", mark: "G", provider: "gmail", action: "oauth" },
  { title: "Outlook", subtitle: "登录后同步 Outlook 邮件", mark: "O", provider: "outlook", action: "oauth" },
  { title: "163 邮箱", subtitle: "按提示完成邮箱授权", mark: "163", provider: "163", action: "password" },
  { title: "QQ 邮箱", subtitle: "按提示完成邮箱授权", mark: "QQ", provider: "qq", action: "password" },
  { title: "iCloud Mail", subtitle: "连接 iCloud 邮箱", mark: "iC", provider: "icloud", action: "password" },
  { title: "Proton Mail", subtitle: "连接 Proton 邮箱", mark: "P", provider: "proton_bridge", action: "bridge" },
  { title: "个人域名邮箱", subtitle: "连接企业或个人域名邮箱", mark: "@", provider: "custom", action: "manual" }
];

const providerIconSources: Record<string, string> = {
  gmail: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
  outlook: "https://res.cdn.office.net/assets/mail/pwa/v1/pngs/apple-touch-icon.png",
  "163": "https://mail.163.com/favicon.ico",
  qq: "https://mail.qq.com/favicon.ico",
  icloud: "https://www.icloud.com/favicon.ico",
  proton: "https://mail.proton.me/assets/apple-touch-icon.png",
  proton_bridge: "https://mail.proton.me/assets/apple-touch-icon.png",
  tencent_exmail: "https://exmail.qq.com/favicon.ico"
};

const fallbackHermesProviders: HermesProviderCatalogItem[] = [
  {
    key: "hermes",
    label: "Hermes 服务",
    category: "gateway",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: [],
    modelExamples: ["hermes-email"],
    capabilities: ["chat", "email_skills", "memory"]
  },
  {
    key: "openai-api",
    label: "OpenAI",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["openai"],
    modelExamples: ["gpt-5.2"],
    capabilities: ["chat", "email_skills"]
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    category: "cloud",
    authType: "api_key",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: [],
    modelExamples: ["openai/gpt-5.2"],
    capabilities: ["chat", "email_skills"]
  },
  {
    key: "ollama",
    label: "Ollama 本地",
    category: "local",
    authType: "none",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: [],
    modelExamples: ["qwen3:latest"],
    capabilities: ["chat", "email_skills"]
  },
  {
    key: "custom",
    label: "自定义模型服务",
    category: "custom",
    authType: "api_key_optional",
    requestProtocol: "openai_chat_completions",
    endpointEditable: true,
    aliases: ["openai-compatible"],
    modelExamples: ["provider/model-name"],
    capabilities: ["chat", "email_skills"]
  }
];

export interface AppProps {
  api?: EmailHubApi;
  defaultAccountId?: string;
  oauthRedirect?: (url: string) => void;
}

interface UndoToastState {
  accountId: string;
  messageId: string;
  undoToken: string;
}

interface OAuthCallbackParams {
  state: string;
  code: string;
  error?: string;
}

interface OAuthPendingState {
  provider: OAuthProvider;
  returnTo: "add-mail";
  createdAt: string;
}

const OAUTH_PENDING_PREFIX = "email-hub:oauth:";
const SELECTED_ACCOUNT_STORAGE_KEY = "email-hub:selected-account-id";

export function App(props: AppProps = {}) {
  const oauthCallback = readOAuthCallbackFromLocation(
    typeof window === "undefined" ? undefined : window.location,
  );
  const [activeView, setActiveView] = useState<ViewId>("mail");
  const [activeAddMailProviderGroup, setActiveAddMailProviderGroup] = useState<
    AddMailProviderGroupId | undefined
  >();
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [activeMailId, setActiveMailId] = useState(
    props.api ? "" : mailItemKey(mailItems[0]),
  );
  const [hermesPrompt, setHermesPrompt] = useState("");
  const [hermesDockNotice, setHermesDockNotice] = useState<string | undefined>();
  const [hermesDockResult, setHermesDockResult] = useState<
    HermesEmailSearchQaResult | undefined
  >();
  const [hermesDockRuleCandidate, setHermesDockRuleCandidate] =
    useState<HermesRuleCandidateDto | undefined>();
  const [hermesDockRuleSimulation, setHermesDockRuleSimulation] =
    useState<HermesRuleSimulationDto | undefined>();
  const [hermesWorkspaceContext, setHermesWorkspaceContext] =
    useState<HermesWorkspaceContextDto | undefined>();
  const [hermesWorkspaceContextLoading, setHermesWorkspaceContextLoading] =
    useState(false);
  const [hermesDockBusy, setHermesDockBusy] = useState(false);
  const [workspaceFolders, setWorkspaceFolders] = useState<FolderItem[]>(folders);
  const [workspaceMail, setWorkspaceMail] = useState<MailItem[]>(
    props.api ? [] : mailItems,
  );
  const [selectedDetail, setSelectedDetail] = useState<MessageDetailDto | undefined>();
  const [undoToast, setUndoToast] = useState<UndoToastState | undefined>();
  const [backendNotice, setBackendNotice] = useState<string | undefined>();
  const [searchLaunch, setSearchLaunch] = useState<SearchLaunch | undefined>();
  const [navigationProviderGroups, setNavigationProviderGroups] =
    useState<ProviderGroup[]>(providerGroups);
  const [navigationQuickCategories, setNavigationQuickCategories] =
    useState<QuickCategory[]>(quickCategories);
  const [navigationLabels, setNavigationLabels] =
    useState<LabelItem[]>(previewLabels);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
    () => {
      const storedAccountId = props.defaultAccountId ?? readSelectedAccountIdFromSession();
      if (props.api && !props.defaultAccountId && storedAccountId === PREVIEW_ACCOUNT_ID) {
        return undefined;
      }

      return storedAccountId;
    },
  );
  const [accountDiscoveryReady, setAccountDiscoveryReady] = useState(
    () => !props.api || Boolean(props.defaultAccountId),
  );
  const [mailDensity, setMailDensity] = useState<MailDensity>("compact");
  const [hermesFollowUpSuggestion, setHermesFollowUpSuggestion] = useState<
    HermesFollowupTrackerResult | undefined
  >();
  const [followUpNotice, setFollowUpNotice] = useState<string | undefined>();
  const [smartInboxBusy, setSmartInboxBusy] =
    useState<SmartInboxBusyAction>("");

  const accountId = selectedAccountId ?? PREVIEW_ACCOUNT_ID;
  const sortedMail = useMemo(
    () => [...workspaceMail].sort((left, right) => right.score - left.score),
    [workspaceMail],
  );
  const selectedMail =
    sortedMail.find((mail) => mailItemKey(mail) === activeMailId) ?? sortedMail[0];
  const selectedMailAccountId = selectedMail?.accountId ?? selectedAccountId;
  const workspaceAccountId =
    selectedMailAccountId ?? selectedAccountId ?? PREVIEW_ACCOUNT_ID;

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
      setNavigationProviderGroups(summary.providerGroups);
      setNavigationQuickCategories(summary.quickCategories);
    } catch {
      // Keep the local preview navigation when the backend summary is unavailable.
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

  async function handleConnectedAccount(nextAccountId?: string) {
    let connectedAccountId = nextAccountId;
    if (nextAccountId) {
      rememberSelectedAccount(nextAccountId);
    } else {
      connectedAccountId = await selectFirstBackendAccount();
    }

    await refreshNavigationSummary();
    await refreshLabels(connectedAccountId ?? selectedAccountId);
  }

  function launchGlobalSearch(query: string) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    setSearchLaunch((current) => ({
      query: trimmedQuery,
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
    setHermesPrompt(value);
    setHermesDockNotice(undefined);
    setHermesDockResult(undefined);
    setHermesDockRuleCandidate(undefined);
    setHermesDockRuleSimulation(undefined);
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
    if (!question) {
      setHermesDockResult(undefined);
      setHermesDockRuleCandidate(undefined);
      setHermesDockRuleSimulation(undefined);
      setHermesDockNotice("请输入要让 Hermes 查找或回答的问题。");
      return;
    }

    setHermesDockResult(undefined);
    setHermesDockRuleCandidate(undefined);
    setHermesDockRuleSimulation(undefined);
    if (!props.api) {
      setHermesDockNotice("连接后 Hermes 会搜索已同步邮件并给出引用答案。");
      return;
    }

    const hermesAccountId = selectedMail?.accountId ?? selectedAccountId;
    if (!hermesAccountId) {
      setHermesDockNotice("请先添加邮箱并完成同步，再让 Hermes 搜索邮件。");
      return;
    }

    setHermesDockBusy(true);
    if (isHermesRuleCommand(question)) {
      setHermesDockNotice("Hermes 正在读取邮箱环境并生成规则草案...");
      try {
        await refreshHermesWorkspaceContext({
          accountId: hermesAccountId,
          force: true,
        });
        const draft = await props.api.draftHermesRule({
          accountId: hermesAccountId,
          command: question,
        });
        const candidate = draft.candidates[0];
        if (!candidate) {
          setHermesDockNotice("Hermes 没有生成可确认的规则草案。");
          return;
        }
        const simulation = await props.api.simulateHermesRule({
          accountId: hermesAccountId,
          candidateId: candidate.id,
          sampleLimit: 25,
        });
        setHermesDockRuleCandidate(candidate);
        setHermesDockRuleSimulation(simulation);
        setHermesDockNotice(
          `Hermes 已生成规则草案，shadow simulation 命中 ${simulation.matchedCount} 封邮件。`,
        );
      } catch {
        setHermesDockNotice("Hermes 规则草案暂时不可用。");
      } finally {
        setHermesDockBusy(false);
      }
      return;
    }

    setHermesDockNotice("Hermes 正在搜索已同步邮件...");
    try {
      const result = await props.api.searchMailWithHermes({
        accountId: hermesAccountId,
        question,
        language: "zh-CN",
        limit: 5,
        memoryScope: "global",
      });
      setHermesDockResult(result);
      setHermesDockNotice(
        result.matches.length > 0
          ? `Hermes 已基于 ${result.matches.length} 封邮件回答。`
          : "Hermes 没有找到匹配邮件。",
      );
    } catch {
      setHermesDockNotice("Hermes 搜索暂时不可用。");
    } finally {
      setHermesDockBusy(false);
    }
  }

  async function approveHermesDockRule() {
    if (!props.api || !hermesDockRuleCandidate) {
      return;
    }

    setHermesDockBusy(true);
    setHermesDockNotice("正在启用 Hermes 规则...");
    try {
      const rule = await props.api.approveHermesRule({
        accountId: hermesDockRuleCandidate.accountId,
        candidateId: hermesDockRuleCandidate.id,
      });
      setHermesDockRuleCandidate({
        ...hermesDockRuleCandidate,
        status: "approved",
        approvedAt: rule.approvedAt,
      });
      await refreshNavigationSummary();
      await refreshLabels(hermesDockRuleCandidate.accountId);
      await refreshHermesWorkspaceContext({
        accountId: hermesDockRuleCandidate.accountId,
        force: true,
      });
      setHermesDockNotice(`Hermes 规则已启用：${rule.title}`);
    } catch {
      setHermesDockNotice("Hermes 规则启用失败。");
    } finally {
      setHermesDockBusy(false);
    }
  }

  useEffect(() => {
    void refreshNavigationSummary();
  }, [props.api]);

  useEffect(() => {
    if (!props.api || props.defaultAccountId || accountDiscoveryReady) {
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
  }, [accountDiscoveryReady, props.api, props.defaultAccountId, selectedAccountId]);

  useEffect(() => {
    if (!props.api || !accountDiscoveryReady) {
      return;
    }

    let alive = true;
    setBackendNotice("正在加载聚合收件箱...");
    const request = selectedAccountId
      ? Promise.all([
          props.api.listMailboxes({ accountId: selectedAccountId }),
          props.api.listMessages({
            accountId: selectedAccountId,
            limit: 50,
            sort: "smart",
          }),
        ]).then(([mailboxPage, messagePage]) => ({
          folders: mailboxPage.items.map(mapMailboxDtoToFolderItem),
          messages: messagePage.items,
          activeFolderId: mailboxPage.items[0]?.id ?? "inbox",
        }))
      : props.api.listMessages({ limit: 50, sort: "smart" }).then((messagePage) => ({
          folders,
          messages: messagePage.items,
          activeFolderId: "inbox",
        }));

    void request
      .then((result) => {
        if (!alive) {
          return;
        }
        const mappedMail = result.messages.map(mapMessageDtoToMailItem);
        setWorkspaceFolders(result.folders);
        setWorkspaceMail(mappedMail);
        setActiveFolder(result.activeFolderId);
        setActiveMailId(firstSmartMailKey(mappedMail));
        setSelectedDetail(undefined);
        setBackendNotice(
          mappedMail.length > 0
            ? undefined
            : selectedAccountId
              ? "当前邮箱还没有已同步邮件。"
              : "还没有已同步邮件，添加邮箱后会显示聚合收件箱。",
        );
      })
      .catch(() => {
        if (alive) {
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
    setActiveFolder(savedView);
    if (!props.api) {
      return;
    }

    setBackendNotice("正在加载分类邮件...");
    try {
      const messagePage = await props.api.listMessages({
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
        limit: 50,
        sort: "smart",
        savedView,
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(firstSmartMailKey(mappedMail));
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("分类邮件暂时不可用，正在显示当前邮件。");
    }
  }

  async function loadLabel(labelId: string) {
    setActiveFolder(`label:${labelId}`);
    if (!props.api || !selectedAccountId) {
      return;
    }

    setBackendNotice("正在加载标签邮件...");
    try {
      const messagePage = await props.api.listMessages({
        accountId: selectedAccountId,
        limit: 50,
        sort: "smart",
        labelIds: [labelId],
        tagMode: "any",
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(firstSmartMailKey(mappedMail));
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("标签邮件暂时不可用，正在显示当前邮件。");
    }
  }

  async function loadMailbox(mailboxId: string) {
    setActiveFolder(mailboxId);
    if (!props.api) {
      return;
    }
    if (!selectedAccountId) {
      setBackendNotice("正在加载聚合收件箱...");
      try {
        const messagePage = await props.api.listMessages({
          limit: 50,
          sort: "smart",
        });
        const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
        setWorkspaceMail(mappedMail);
        setSelectedDetail(undefined);
        setActiveMailId(firstSmartMailKey(mappedMail));
        setBackendNotice(undefined);
      } catch {
        setBackendNotice("聚合收件箱暂时不可用。");
      }
      return;
    }

    setBackendNotice("正在加载邮箱目录...");
    try {
      const messagePage = await props.api.listMessages({
        accountId: selectedAccountId,
        mailboxId,
        limit: 50,
        sort: "smart",
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(firstSmartMailKey(mappedMail));
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("邮箱目录暂时不可用，正在显示当前邮件。");
    }
  }

  useEffect(() => {
    if (!props.api || !selectedMail) {
      return;
    }

    let alive = true;
    void props.api
      .getMessage({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
      })
      .then((message) => {
        if (alive) {
          setSelectedDetail(message);
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
    setHermesFollowUpSuggestion(undefined);
    setFollowUpNotice(undefined);
  }, [activeMailId]);

  async function applySelectedAction(action: MailAction): Promise<boolean> {
    if (!props.api || !selectedMail) {
      setBackendNotice("连接服务后才能执行邮件操作。");
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

    const result = await props.api.applyMailAction({
      accountId: undoToast.accountId,
      messageId: undoToast.messageId,
      action: "undo_done",
      undoToken: undoToast.undoToken
    });
    applyActionResult(result);
    setUndoToast(undefined);
  }

  function applyActionResult(result: MailActionResult) {
    setWorkspaceMail((items) => {
      const shouldRemove =
        result.action !== "done" && (result.state.archived || result.state.deleted);
      const updated = items.map((item) =>
        item.accountId === result.accountId && item.id === result.messageId
          ? {
              ...item,
              unread: result.state.unread,
              starred: result.state.starred,
              mailboxIds: result.state.mailboxIds,
            }
          : item,
      );
      return shouldRemove
        ? updated.filter(
            (item) =>
              item.accountId !== result.accountId || item.id !== result.messageId,
          )
        : updated;
    });
    if (result.action === "done" && result.state.undoToken) {
      setUndoToast({
        accountId: result.accountId,
        messageId: result.messageId,
        undoToken: result.state.undoToken
      });
    }
  }

  async function applySmartInboxBucketDone(bucket: string) {
    if (!props.api) {
      setBackendNotice("连接服务后才能执行 Smart Inbox 批量 Done。");
      return;
    }

    const candidates = workspaceMail.filter((item) => item.bucket === bucket);
    if (candidates.length === 0) {
      setBackendNotice("当前 Smart Inbox 卡片没有可处理邮件。");
      return;
    }

    const messageIdsByAccount = new Map<string, string[]>();
    for (const item of candidates) {
      const ids = messageIdsByAccount.get(item.accountId) ?? [];
      ids.push(item.id);
      messageIdsByAccount.set(item.accountId, ids);
    }

    setSmartInboxBusy("bulk_done");
    try {
      const results = await Promise.all(
        [...messageIdsByAccount.entries()].map(([accountId, messageIds]) =>
          props.api!.applySmartInboxCardBulkAction({
            accountId,
            bucket,
            action: "done",
            messageIds,
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

      if (succeededKeys.size > 0) {
        const remainingMail = workspaceMail.filter(
          (item) => !succeededKeys.has(mailItemKey(item)),
        );
        setWorkspaceMail(remainingMail);
        setActiveMailId((current) =>
          current && remainingMail.some((item) => mailItemKey(item) === current)
            ? current
            : firstSmartMailKey(remainingMail),
        );
        if (selectedMail && succeededKeys.has(mailItemKey(selectedMail))) {
          setSelectedDetail(undefined);
        }
      }

      setBackendNotice(
        failedCount > 0
          ? `Smart Inbox 已完成 ${succeededCount} 封，${failedCount} 封稍后重试。`
          : `Smart Inbox 已完成 ${succeededCount} 封${bucketLabel(bucket)}邮件。`,
      );
    } catch {
      setBackendNotice("Smart Inbox 批量 Done 暂时不可用。");
    } finally {
      setSmartInboxBusy("");
    }
  }

  async function recordSmartInboxFeedback(
    action: SmartInboxFeedbackAction,
  ): Promise<boolean> {
    if (!props.api || !selectedMail) {
      setBackendNotice("连接服务后才能训练 Smart Inbox。");
      return false;
    }

    setSmartInboxBusy(action);
    try {
      const result = await props.api.recordSmartInboxFeedback({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
        action,
      });
      setWorkspaceMail((items) =>
        items.map((item) =>
          item.accountId === result.accountId && item.id === result.messageId
            ? {
                ...item,
                label: bucketLabel(result.classification.bucket),
                tone: toneForBucket(result.classification.bucket),
                bucket: result.classification.bucket,
                score: result.classification.priorityScore,
                reasons: result.classification.reasons,
              }
            : item,
        ),
      );
      setBackendNotice(`Smart Inbox 已学习：${smartInboxFeedbackLabel(action)}。`);
      return true;
    } catch {
      setBackendNotice("Smart Inbox 反馈暂时不可用。");
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
      const suggestion = await props.api.trackFollowup({
        subject: selectedMail.subject,
        threadText: selectedDetail?.bodyText ?? selectedMail.preview,
        userEmail: "me@example.com",
        participants: ["me@example.com", selectedMail.email],
        readMessageIds: [selectedMail.id],
      });
      if (!suggestion.followupNeeded || !suggestion.dueAt) {
        setHermesFollowUpSuggestion(undefined);
        setFollowUpNotice("Hermes 没有发现需要创建的跟进提醒。");
        return;
      }

      setHermesFollowUpSuggestion(suggestion);
      setFollowUpNotice(undefined);
    } catch {
      setHermesFollowUpSuggestion(undefined);
      setFollowUpNotice("Hermes 跟进暂时不可用。");
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

    const followUp = await props.api.confirmHermesFollowUp({
      accountId,
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
  }

  if (oauthCallback) {
    return (
      <OAuthCallbackPage
        api={props.api}
        callback={oauthCallback}
        onConnected={(nextAccountId) => void handleConnectedAccount(nextAccountId)}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="global-sidebar" aria-label="全局功能栏">
        <div className="brand-row">
          <div className="brand-icon">
            <Mail size={20} />
          </div>
          <div>
            <strong>Email Hub</strong>
            <span>快速聚合邮件</span>
          </div>
        </div>

        <nav className="global-nav">
          {navItems.map((item) => {
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

        <div className="sidebar-footer">
          <span className="online-dot" />
          <div>
            <strong>已连接 5 个邮箱</strong>
            <span>Hermes 本地在线</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        {activeView === "mail" ? (
          selectedMail ? (
            <MailWorkspace
              api={props.api}
              accountId={workspaceAccountId}
              activeFolder={activeFolder}
              activeMailId={activeMailId}
              folders={workspaceFolders}
              mail={sortedMail}
              selectedMail={selectedMail}
              selectedDetail={selectedDetail}
              undoToast={undoToast}
              backendNotice={backendNotice}
              smartInboxBusy={smartInboxBusy}
              quickCategories={navigationQuickCategories}
              labels={navigationLabels}
              hermesFollowUpSuggestion={hermesFollowUpSuggestion}
              followUpNotice={followUpNotice}
              density={mailDensity}
              onAddMail={() => setActiveView("add-mail")}
              onGlobalSearch={launchGlobalSearch}
              onDensityChange={setMailDensity}
              onFolderChange={(id) => void loadMailbox(id)}
              onSavedViewChange={(id) => void loadSavedView(id)}
              onLabelChange={(id) => void loadLabel(id)}
              onMailChange={setActiveMailId}
              onDone={() => applySelectedAction("done")}
              onArchive={() => applySelectedAction("archive")}
              onTrash={() => applySelectedAction("trash")}
              onToggleStar={() =>
                applySelectedAction(selectedMail.starred ? "unstar" : "star")
              }
              onToggleRead={() =>
                applySelectedAction(
                  selectedMail.unread ? "mark_read" : "mark_unread",
                )
              }
              onUndoDone={() => void undoDone()}
              onSmartInboxBucketDone={(bucket) => void applySmartInboxBucketDone(bucket)}
              onSmartInboxFeedback={recordSmartInboxFeedback}
              onTrackFollowUp={() => void trackSelectedFollowUp()}
              onConfirmHermesFollowUp={() => void confirmHermesFollowUp()}
            />
          ) : (
            <MailEmptyState
              notice={backendNotice}
              onAddMail={() => setActiveView("add-mail")}
              onOpenSyncCenter={() => setActiveView("sync")}
            />
          )
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
            accountId={selectedAccountId ?? selectedMail?.accountId ?? ""}
            launch={searchLaunch}
            onOpenResult={openSearchResult}
          />
        ) : null}
        {activeView === "settings" ? (
          <SettingsPage api={props.api} accountId={accountId} />
        ) : null}
      </main>

      <HermesDock
        prompt={hermesPrompt}
        notice={hermesDockNotice}
        result={hermesDockResult}
        ruleCandidate={hermesDockRuleCandidate}
        ruleSimulation={hermesDockRuleSimulation}
        workspaceContext={hermesWorkspaceContext}
        workspaceContextLoading={hermesWorkspaceContextLoading}
        busy={hermesDockBusy}
        onPromptChange={updateHermesPrompt}
        onOpen={() => void refreshHermesWorkspaceContext()}
        onSubmit={(prompt) => void submitHermesDockPrompt(prompt)}
        onApproveRule={() => void approveHermesDockRule()}
        onOpenSearch={launchGlobalSearch}
      />
    </div>
  );
}

function OAuthCallbackPage(props: {
  api?: EmailHubApi;
  callback: OAuthCallbackParams;
  onConnected: (accountId?: string) => void;
}) {
  const [status, setStatus] = useState<{
    kind: "working" | "success" | "error";
    message: string;
  }>({
    kind: "working",
    message: "正在完成邮箱连接...",
  });

  useEffect(() => {
    let alive = true;

    async function completeCallback() {
      if (props.callback.error) {
        setStatus({
          kind: "error",
          message: "登录没有完成，请回到添加邮箱重试。",
        });
        return;
      }

      if (!props.callback.state || !props.callback.code) {
        setStatus({
          kind: "error",
          message: "登录信息不完整，请回到添加邮箱重试。",
        });
        return;
      }

      const pending = loadOAuthPendingState(props.callback.state);
      if (!pending) {
        setStatus({
          kind: "error",
          message: "登录已过期，请回到添加邮箱重新开始。",
        });
        return;
      }

      if (!props.api) {
        setStatus({
          kind: "error",
          message: "邮箱服务暂时不可用，请稍后重试。",
        });
        return;
      }

      try {
        const result = await props.api.completeOAuthCallback({
          provider: pending.provider,
          state: props.callback.state,
          code: props.callback.code,
        });
        if (!alive) {
          return;
        }

        clearOAuthPendingState(props.callback.state);
        props.onConnected(result.account?.id);
        setStatus({
          kind: "success",
          message: `${result.account?.email ?? result.task.email} 已连接，正在同步邮件。`,
        });
      } catch {
        if (alive) {
          setStatus({
            kind: "error",
            message: "邮箱连接没有完成，请回到添加邮箱重试。",
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
    props.onConnected,
  ]);

  return (
    <div className="app-shell oauth-shell">
      <main className="main-area">
        <section className="workspace-page page-scroll oauth-callback-page">
          <div
            className="page-panel"
            role={status.kind === "error" ? "alert" : "status"}
            aria-label="OAuth callback status"
          >
            <CheckCircle2 size={24} />
            <h1>{status.kind === "success" ? "邮箱已连接" : "添加邮箱"}</h1>
            <p>{status.message}</p>
          </div>
        </section>
      </main>
    </div>
  );
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

function MailWorkspace(props: {
  api?: EmailHubApi;
  accountId: string;
  activeFolder: string;
  activeMailId: string;
  folders: FolderItem[];
  mail: MailItem[];
  selectedMail: MailItem;
  selectedDetail?: MessageDetailDto;
  undoToast?: UndoToastState;
  backendNotice?: string;
  smartInboxBusy: SmartInboxBusyAction;
  quickCategories: QuickCategory[];
  labels: LabelItem[];
  hermesFollowUpSuggestion?: HermesFollowupTrackerResult;
  followUpNotice?: string;
  density: MailDensity;
  onAddMail: () => void;
  onGlobalSearch: (query: string) => void;
  onDensityChange: (density: MailDensity) => void;
  onFolderChange: (id: string) => void;
  onSavedViewChange: (id: string) => void;
  onLabelChange: (id: string) => void;
  onMailChange: (id: string) => void;
  onDone: () => ReaderActionResult;
  onArchive: () => ReaderActionResult;
  onTrash: () => ReaderActionResult;
  onToggleStar: () => ReaderActionResult;
  onToggleRead: () => ReaderActionResult;
  onUndoDone: () => void;
  onSmartInboxBucketDone: (bucket: string) => void;
  onSmartInboxFeedback: (action: SmartInboxFeedbackAction) => ReaderActionResult;
  onTrackFollowUp: () => void;
  onConfirmHermesFollowUp: () => void;
}) {
  const [topSearchQuery, setTopSearchQuery] = useState("");
  const [composeFrom, setComposeFrom] = useState("");
  const [sendIdentities, setSendIdentities] = useState<MailSendIdentityDto[]>([]);
  const [sendIdentityCandidates, setSendIdentityCandidates] = useState<
    MailSendIdentityCandidateDto[]
  >([]);
  const [graphCandidateAddress, setGraphCandidateAddress] = useState("");
  const [graphCandidateName, setGraphCandidateName] = useState("");
  const [graphCandidateType, setGraphCandidateType] = useState<
    "shared_mailbox" | "send_on_behalf" | "unknown"
  >("shared_mailbox");
  const [graphTargetMailboxes, setGraphTargetMailboxes] = useState<
    Record<string, string>
  >({});
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSource, setComposeSource] = useState<MailDraftSource>("manual");
  const [composeAttachments, setComposeAttachments] = useState<
    MailDraftAttachmentDto[]
  >([]);
  const [composeReplyToMessageId, setComposeReplyToMessageId] = useState<
    string | undefined
  >();
  const [composeSourceMessageId, setComposeSourceMessageId] = useState<
    string | undefined
  >();
  const [composeHermesSkillRunId, setComposeHermesSkillRunId] = useState<
    string | undefined
  >();
  const [composeHermesDraftText, setComposeHermesDraftText] = useState<
    string | undefined
  >();
  const [composePreview, setComposePreview] =
    useState<MailComposePreviewDto | undefined>();
  const [composeDraftId, setComposeDraftId] = useState<string | undefined>();
  const [composeScheduledId, setComposeScheduledId] = useState<
    string | undefined
  >();
  const [composeScheduledAt, setComposeScheduledAt] = useState(
    defaultScheduleDateTimeLocal(),
  );
  const [composeNotice, setComposeNotice] = useState("");
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeAutosaveStatus, setComposeAutosaveStatus] =
    useState<ComposeAutosaveStatus>("idle");
  const [mailDrafts, setMailDrafts] = useState<MailDraftDto[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsNotice, setDraftsNotice] = useState("");
  const [outboxItems, setOutboxItems] = useState<ScheduledSendDto[]>([]);
  const [outboxBusyId, setOutboxBusyId] = useState<string | undefined>();
  const [outboxNotice, setOutboxNotice] = useState("");
  const [attachmentDownloadBusyId, setAttachmentDownloadBusyId] = useState<
    string | undefined
  >();
  const [attachmentDownloadNotice, setAttachmentDownloadNotice] = useState("");
  const [readerHermesNotice, setReaderHermesNotice] = useState("");
  const [readerHermesBusy, setReaderHermesBusy] =
    useState<ReaderHermesBusy | undefined>();
  const [readerTranslationTarget, setReaderTranslationTarget] = useState("Chinese");
  const [readerTranslationPreferenceBusy, setReaderTranslationPreferenceBusy] =
    useState(false);
  const [readerHermesSummary, setReaderHermesSummary] =
    useState<HermesThreadSummaryResult | undefined>();
  const [readerHermesTranslation, setReaderHermesTranslation] =
    useState<HermesTranslateTextResult | undefined>();
  const [readerHermesOrganization, setReaderHermesOrganization] =
    useState<ReaderHermesOrganizationResult | undefined>();
  const [readerHermesApplyBusy, setReaderHermesApplyBusy] =
    useState<string | undefined>();
  const [rescheduleTimes, setRescheduleTimes] = useState<Record<string, string>>(
    {},
  );
  const composeAutosaveTimerRef = useRef<number | undefined>(undefined);
  const composeAutosaveGenerationRef = useRef(0);
  const lastSavedComposeSignatureRef = useRef("");
  const readerHermesRequestRef = useRef(0);

  function cancelComposeAutosave(status: ComposeAutosaveStatus = "idle") {
    if (composeAutosaveTimerRef.current !== undefined) {
      window.clearTimeout(composeAutosaveTimerRef.current);
      composeAutosaveTimerRef.current = undefined;
    }
    composeAutosaveGenerationRef.current += 1;
    setComposeAutosaveStatus(status);
  }

  function currentComposeSignature(input: {
    to: ReturnType<typeof parseComposeRecipients>;
    cc: ReturnType<typeof parseComposeRecipients>;
    bcc: ReturnType<typeof parseComposeRecipients>;
    bodyText: string;
  }) {
    return composeDraftSignature({
      accountId: props.accountId,
      ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: composeSubject.trim(),
      bodyText: input.bodyText,
      source: composeSource,
      attachments: composeAttachments,
      replyToMessageId: composeReplyToMessageId,
      sourceMessageId: composeSourceMessageId,
      hermesSkillRunId: composeHermesSkillRunId,
      hermesDraftText: composeHermesDraftText,
    });
  }

  function rememberSavedComposeSignature(input: {
    to: ReturnType<typeof parseComposeRecipients>;
    cc: ReturnType<typeof parseComposeRecipients>;
    bcc: ReturnType<typeof parseComposeRecipients>;
    bodyText: string;
  }) {
    lastSavedComposeSignatureRef.current = currentComposeSignature(input);
    setComposeAutosaveStatus("saved");
  }

  useEffect(() => {
    readerHermesRequestRef.current += 1;
    setAttachmentDownloadBusyId(undefined);
    setAttachmentDownloadNotice("");
    setReaderHermesNotice("");
    setReaderHermesSummary(undefined);
    setReaderHermesTranslation(undefined);
    setReaderHermesOrganization(undefined);
    setReaderHermesBusy(undefined);
    setReaderHermesApplyBusy(undefined);
    setReaderTranslationPreferenceBusy(false);
  }, [props.selectedMail.id]);

  useEffect(() => {
    cancelComposeAutosave();
    lastSavedComposeSignatureRef.current = "";
    setComposeDraftId(undefined);
    setComposeScheduledId(undefined);
    setGraphTargetMailboxes({});
    setDraftsNotice("");
    setOutboxNotice("");
  }, [props.accountId]);

  useEffect(() => {
    if (!props.api) {
      const identities = previewSendIdentities(props.accountId);
      setSendIdentities(identities);
      setSendIdentityCandidates([]);
      setGraphTargetMailboxes({});
      setComposeFrom(identities[0]?.id ?? "");
      setMailDrafts([]);
      return;
    }

    let alive = true;
    void props.api
      .listSendIdentities({ accountId: props.accountId })
      .then((page) => {
        if (!alive) {
          return;
        }
        setSendIdentities(page.items);
        setSendIdentityCandidates(page.candidates ?? []);
        setGraphTargetMailboxes((current) =>
          mergeGraphTargetMailboxValues(current, page.candidates ?? []),
        );
        setComposeFrom((current) =>
          page.items.some((identity) => identity.id === current)
            ? current
            : page.items.find((identity) => identity.isDefault)?.id ??
              page.items[0]?.id ??
              "",
        );
      })
      .catch(() => {
        if (alive) {
          setSendIdentities([]);
          setSendIdentityCandidates([]);
          setGraphTargetMailboxes({});
          setComposeFrom("");
        }
      });

    setDraftsLoading(true);
    void props.api
      .listMailDrafts({ accountId: props.accountId, limit: 20 })
      .then((page) => {
        if (!alive) {
          return;
        }
        setMailDrafts(page.items);
        setDraftsNotice("");
      })
      .catch(() => {
        if (alive) {
          setMailDrafts([]);
          setDraftsNotice("草稿列表暂时不可用。");
        }
      })
      .finally(() => {
        if (alive) {
          setDraftsLoading(false);
        }
      });

    void props.api
      .listOutbox({ accountId: props.accountId, limit: 20 })
      .then((page) => {
        if (!alive) {
          return;
        }
        setOutboxItems(page.items);
        setRescheduleTimes((current) => seedRescheduleTimes(current, page.items));
      })
      .catch(() => {
        if (alive) {
          setOutboxNotice("待发队列暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.accountId, props.api]);

  const selectedComposeIdentity = sendIdentities.find(
    (identity) => identity.id === composeFrom,
  );
  const selectedComposeFrom =
    selectedComposeIdentity && !selectedComposeIdentity.isDefault
      ? selectedComposeIdentity.from
      : undefined;
  const detailAttachments = props.selectedDetail?.attachments;
  const previewAttachments = props.api ? [] : PREVIEW_ATTACHMENT_ROWS;
  const readerBodyText = messageReaderText(props.selectedDetail, props.selectedMail);
  const readerHermesApplyActions = readerHermesOrganization
    ? hermesOrganizationApplyActions(readerHermesOrganization)
    : [];
  const readerHermesUnsupportedActionCount = readerHermesOrganization
    ? hermesOrganizationUnsupportedActionCount(readerHermesOrganization)
    : 0;

  useEffect(() => {
    if (composeAutosaveTimerRef.current !== undefined) {
      window.clearTimeout(composeAutosaveTimerRef.current);
      composeAutosaveTimerRef.current = undefined;
    }
    composeAutosaveGenerationRef.current += 1;

    if (!props.api || composeBusy || composeScheduledId) {
      return;
    }

    const to = parseComposeRecipients(composeTo);
    const cc = parseComposeRecipients(composeCc);
    const bcc = parseComposeRecipients(composeBcc);
    const bodyText = composeBody.trim();
    if (to.length === 0 || !bodyText) {
      setComposeAutosaveStatus("idle");
      return;
    }

    const signatureInput = { to, cc, bcc, bodyText };
    const signature = currentComposeSignature(signatureInput);
    if (signature === lastSavedComposeSignatureRef.current) {
      setComposeAutosaveStatus(composeDraftId ? "saved" : "idle");
      return;
    }

    const generation = composeAutosaveGenerationRef.current;
    setComposeAutosaveStatus("pending");
    composeAutosaveTimerRef.current = window.setTimeout(() => {
      setComposeAutosaveStatus("saving");
      const request = composeDraftId
        ? props.api!.updateMailDraft({
            ...composeDraftPayload(signatureInput),
            draftId: composeDraftId,
          })
        : props.api!.createMailDraft(composeDraftPayload(signatureInput));

      void request
        .then((draft) => {
          if (generation !== composeAutosaveGenerationRef.current) {
            return;
          }
          setComposeDraftId(draft.id);
          lastSavedComposeSignatureRef.current = signature;
          setComposeAutosaveStatus("saved");
          void refreshMailDrafts().catch(() => {
            if (generation === composeAutosaveGenerationRef.current) {
              setDraftsNotice("草稿列表暂时不可用。");
            }
          });
        })
        .catch(() => {
          if (generation === composeAutosaveGenerationRef.current) {
            setComposeAutosaveStatus("error");
          }
        });
    }, COMPOSE_AUTOSAVE_DELAY_MS);

    return () => {
      if (composeAutosaveTimerRef.current !== undefined) {
        window.clearTimeout(composeAutosaveTimerRef.current);
        composeAutosaveTimerRef.current = undefined;
      }
    };
  }, [
    composeAttachments,
    composeBcc,
    composeBody,
    composeBusy,
    composeCc,
    composeDraftId,
    composeFrom,
    composeHermesDraftText,
    composeHermesSkillRunId,
    composeReplyToMessageId,
    composeScheduledId,
    composeSource,
    composeSourceMessageId,
    composeSubject,
    composeTo,
    props.accountId,
    props.api,
    selectedComposeFrom?.address,
    selectedComposeFrom?.name,
  ]);

  async function refreshSendIdentityState(preferredId?: string) {
    if (!props.api) {
      return;
    }

    const page = await props.api.listSendIdentities({ accountId: props.accountId });
    setSendIdentities(page.items);
    setSendIdentityCandidates(page.candidates ?? []);
    setGraphTargetMailboxes((current) =>
      mergeGraphTargetMailboxValues(current, page.candidates ?? []),
    );
    setComposeFrom((current) =>
      page.items.some((identity) => identity.id === preferredId)
        ? preferredId!
        : page.items.some((identity) => identity.id === current)
          ? current
          : page.items.find((identity) => identity.isDefault)?.id ??
            page.items[0]?.id ??
            "",
    );
  }

  async function refreshOutbox() {
    if (!props.api) {
      return;
    }

    const page = await props.api.listOutbox({ accountId: props.accountId, limit: 20 });
    setOutboxItems(page.items);
    setRescheduleTimes((current) => seedRescheduleTimes(current, page.items));
  }

  async function refreshMailDrafts() {
    if (!props.api) {
      return;
    }

    const page = await props.api.listMailDrafts({
      accountId: props.accountId,
      limit: 20,
    });
    setMailDrafts(page.items);
    setDraftsNotice("");
  }

  async function addGraphSendIdentityCandidate() {
    if (!props.api) {
      setComposeNotice("发件身份服务暂时不可用。");
      return;
    }

    const address = graphCandidateAddress.trim();
    if (!address) {
      setComposeNotice("请填写 Outlook 共享发件地址。");
      return;
    }

    setComposeBusy(true);
    try {
      const candidate = await props.api.addProviderSendIdentityCandidate({
        accountId: props.accountId,
        provider: "graph",
        address,
        ...(graphCandidateName.trim()
          ? { name: graphCandidateName.trim() }
          : {}),
        identityType: graphCandidateType,
      });
      setGraphCandidateAddress("");
      setGraphCandidateName("");
      setSendIdentityCandidates((current) =>
        upsertSendIdentityCandidate(current, candidate),
      );
      setGraphTargetMailboxes((current) => ({
        ...current,
        [candidate.id]: candidateTargetMailboxValue(candidate),
      }));
      setComposeNotice(`共享发件人待验证：${candidate.from.address}`);
    } catch {
      setComposeNotice("共享发件人添加失败。");
    } finally {
      setComposeBusy(false);
    }
  }

  async function verifyGraphSendIdentityCandidate(
    candidate: MailSendIdentityCandidateDto,
  ) {
    if (!props.api) {
      setComposeNotice("发件身份服务暂时不可用。");
      return;
    }

    setComposeBusy(true);
    try {
      const result = await props.api.verifyProviderSendIdentityCandidate({
        accountId: props.accountId,
        candidateId: candidate.id,
      });
      setSendIdentityCandidates((current) =>
        upsertSendIdentityCandidate(current, result.candidate),
      );
      if (result.verified) {
        await refreshSendIdentityState(result.candidate.id);
        setComposeNotice(`共享发件人已验证：${result.candidate.from.address}`);
      } else {
        setComposeNotice(
          `共享发件人验证失败：${result.errorCode ?? "权限不足"}`,
        );
      }
    } catch {
      setComposeNotice("共享发件人验证失败。");
    } finally {
      setComposeBusy(false);
    }
  }

  async function verifyGraphSendIdentityUserTarget(
    candidate: MailSendIdentityCandidateDto,
  ) {
    if (!props.api) {
      setComposeNotice("发件身份服务暂时不可用。");
      return;
    }
    if (candidate.verificationState !== "verified" || !candidate.enabled) {
      setComposeNotice("请先完成 Outlook 共享 From 验证。");
      return;
    }

    const targetMailbox =
      graphTargetMailboxes[candidate.id]?.trim() ??
      candidateTargetMailboxValue(candidate).trim();
    if (!targetMailbox) {
      setComposeNotice("请填写 Outlook 共享邮箱目标。");
      return;
    }

    setComposeBusy(true);
    try {
      const result = await props.api.verifyProviderSendIdentityUserTarget({
        accountId: props.accountId,
        candidateId: candidate.id,
        targetMailbox,
      });
      setSendIdentityCandidates((current) =>
        upsertSendIdentityCandidate(current, result.candidate),
      );
      setGraphTargetMailboxes((current) => ({
        ...current,
        [result.candidate.id]: candidateTargetMailboxValue(result.candidate),
      }));
      if (result.verified) {
        await refreshSendIdentityState(result.candidate.id);
        setComposeNotice(`共享发件箱 Sent Items 已启用：${targetMailbox}`);
      } else {
        setComposeNotice(
          `共享发件箱目标验证失败：${result.errorCode ?? "权限不足"}`,
        );
      }
    } catch {
      setComposeNotice("共享发件箱目标验证失败。");
    } finally {
      setComposeBusy(false);
    }
  }

  function applySeedToCompose(
    seed: MailComposeSeedDto,
    options: {
      bodyText?: string;
      source?: MailDraftSource;
      hermesSkillRunId?: string;
      hermesDraftText?: string;
      notice?: string;
    } = {},
  ) {
    setComposeTo(formatComposeAddressList(seed.to));
    setComposeCc(formatComposeAddressList(seed.cc));
    setComposeBcc(formatComposeAddressList(seed.bcc));
    setComposeSubject(seed.subject);
    setComposeBody(options.bodyText ?? seed.bodyText);
    setComposeSource(options.source ?? seed.source);
    setComposeAttachments(
      seed.mode === "forward" ? seed.attachments.map(composeAttachmentFromSeed) : [],
    );
    setComposeReplyToMessageId(seed.replyToMessageId);
    setComposeSourceMessageId(seed.sourceMessageId);
    setComposeHermesSkillRunId(options.hermesSkillRunId);
    setComposeHermesDraftText(options.hermesDraftText);
    setComposeDraftId(undefined);
    setComposeScheduledId(undefined);
    lastSavedComposeSignatureRef.current = "";
    setComposeAutosaveStatus("idle");
    setComposePreview(undefined);
    setComposeNotice(
      options.notice ??
        (seed.warnings.includes("missing_recipient")
          ? "转发草稿已准备，请补充收件人。"
          : "回复草稿已准备，可以继续编辑。"),
    );
  }

  function applyDraftToCompose(draft: MailDraftDto, scheduled?: ScheduledSendDto) {
    setComposeTo(formatComposeAddressList(draft.to));
    setComposeCc(formatComposeAddressList(draft.cc));
    setComposeBcc(formatComposeAddressList(draft.bcc));
    setComposeSubject(draft.subject);
    setComposeBody(draft.bodyText ?? "");
    setComposeSource(draft.source);
    setComposeAttachments(draft.attachments ?? []);
    setComposeReplyToMessageId(draft.replyToMessageId);
    setComposeSourceMessageId(draft.sourceMessageId);
    setComposeHermesSkillRunId(draft.hermesSkillRunId);
    setComposeHermesDraftText(draft.hermesDraftText);
    setComposeDraftId(draft.id);
    setComposeScheduledId(scheduled?.id);
    lastSavedComposeSignatureRef.current = composeDraftSignatureFromDraft(draft);
    setComposeAutosaveStatus(scheduled ? "idle" : "saved");
    if (scheduled) {
      setComposeScheduledAt(isoToDateTimeLocal(scheduled.scheduledAt));
    }
    setComposeFrom(resolveComposeIdentityId(draft.from));
    setComposePreview(undefined);
    setComposeNotice(
      scheduled
        ? `待发草稿已载入：${scheduled.id}`
        : `草稿已载入：${draft.id}`,
    );
  }

  function resolveComposeIdentityId(from?: MailDraftDto["from"]): string {
    if (from) {
      const matched = sendIdentities.find(
        (identity) =>
          identity.from.address.toLowerCase() === from.address.toLowerCase(),
      );
      if (matched) {
        return matched.id;
      }
    }

    return (
      sendIdentities.find((identity) => identity.isDefault)?.id ??
      sendIdentities[0]?.id ??
      composeFrom
    );
  }

  async function applyComposeSeed(mode: MailComposeSeedMode) {
    if (!props.api) {
      setComposeNotice("邮件服务暂时不可用。");
      return;
    }

    setComposeBusy(true);
    try {
      const seed = await props.api.createComposeSeed({
        accountId: props.accountId,
        messageId: props.selectedMail.id,
        mode,
        ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
      });
      applySeedToCompose(seed);
      focusComposeTarget(seed.warnings.includes("missing_recipient") ? "to" : "body");
    } catch {
      setComposeNotice("无法从当前邮件生成草稿。");
    } finally {
      setComposeBusy(false);
    }
  }

  async function previewComposedMail() {
    if (!props.api) {
      setComposeNotice("预览服务暂时不可用。");
      return;
    }

    setComposeBusy(true);
    try {
      const preview = await props.api.previewMailDraft({
        accountId: props.accountId,
        ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
        to: parseComposeRecipients(composeTo),
        cc: parseComposeRecipients(composeCc),
        bcc: parseComposeRecipients(composeBcc),
        subject: composeSubject,
        bodyText: composeBody,
        source: composeSource,
        ...(composeAttachments.length > 0
          ? { attachments: composeAttachments }
          : {}),
        ...(composeReplyToMessageId
          ? { replyToMessageId: composeReplyToMessageId }
          : {}),
        ...(composeSourceMessageId
          ? { sourceMessageId: composeSourceMessageId }
          : {}),
      });
      setComposePreview(preview);
      setComposeNotice(
        preview.readyToSend
          ? "预览已生成，可以保存、定时或发送。"
          : "预览已生成，请处理提示项后再发送。",
      );
    } catch {
      setComposeNotice("预览生成失败，请检查收件人和发件身份。");
    } finally {
      setComposeBusy(false);
    }
  }

  function currentReaderText(): string {
    return messageReaderText(props.selectedDetail, props.selectedMail);
  }

  async function askHermesForReaderSummary() {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
      return;
    }

    const threadText = currentReaderText();
    if (!threadText) {
      setReaderHermesNotice("这封邮件还没有可用于总结的正文。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("summary");
    setReaderHermesNotice("Hermes 正在总结当前邮件...");
    try {
      const result = await props.api.summarizeThread({
        subject: props.selectedMail.subject,
        threadText,
        mode: "action_points",
        focus: "decisions, deadlines, blockers, and reply needs",
        language: "zh-CN",
        readMessageIds: [props.selectedMail.id],
        memoryScope: "global",
      });
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesSummary(result);
      setReaderHermesNotice(`Hermes 已总结：${result.skillRunId}`);
    } catch {
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesSummary(undefined);
      setReaderHermesNotice("Hermes 总结暂时不可用。");
    } finally {
      if (readerHermesRequestRef.current === requestId) {
        setReaderHermesBusy(undefined);
      }
    }
  }

  async function askHermesForReaderTranslation() {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
      return;
    }

    const text = currentReaderText();
    if (!text) {
      setReaderHermesNotice("这封邮件还没有可用于翻译的正文。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("translation");
    setReaderHermesNotice("Hermes 正在翻译当前邮件...");
    try {
      const result = await props.api.translateText({
        text,
        targetLanguage: readerTranslationTarget,
        tone: "preserve original meaning and formatting",
        readMessageIds: [props.selectedMail.id],
        memoryScope: `sender:${props.selectedMail.email}`,
        memoryLayers: [
          "contact_memory",
          "procedural_memory",
          "semantic_profile",
        ],
      });
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesTranslation(result);
      setReaderHermesNotice(`Hermes 已翻译：${result.skillRunId}`);
    } catch {
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesTranslation(undefined);
      setReaderHermesNotice("Hermes 翻译暂时不可用。");
    } finally {
      if (readerHermesRequestRef.current === requestId) {
        setReaderHermesBusy(undefined);
      }
    }
  }

  async function rememberReaderTranslationPreference() {
    if (!props.api || !readerHermesTranslation) {
      setReaderHermesNotice("需要先翻译一次，才能保存翻译习惯。");
      return;
    }

    setReaderTranslationPreferenceBusy(true);
    try {
      await props.api.confirmTranslationPreference({
        mode: "always",
        sourceLanguage: readerHermesTranslation.sourceLanguage || "auto",
        targetLanguage: readerHermesTranslation.targetLanguage,
        memoryScope: `sender:${props.selectedMail.email}`,
        reason: `Reader translation preference for ${props.selectedMail.email}`,
      });
      setReaderHermesNotice("Hermes 已记住这个翻译习惯。");
    } catch {
      setReaderHermesNotice("Hermes 翻译习惯暂时无法保存。");
    } finally {
      setReaderTranslationPreferenceBusy(false);
    }
  }

  async function askHermesToOrganizeReader() {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
      return;
    }

    const threadText = currentReaderText();
    if (!threadText) {
      setReaderHermesNotice("这封邮件还没有可用于整理的正文。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    const memoryScope = `sender:${props.selectedMail.email}`;
    const memoryLayers = [
      "contact_memory",
      "procedural_memory",
      "semantic_profile",
      "writing_style_profile",
    ];
    const readMessageIds = [props.selectedMail.id];
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("organize");
    setReaderHermesNotice("Hermes 正在整理当前邮件...");
    try {
      const [priority, labelsResult, newsletter, actionItems] = await Promise.all([
        props.api.triagePriorityWithHermes({
          subject: props.selectedMail.subject,
          threadText,
          senderEmail: props.selectedMail.email,
          currentBucket: props.selectedMail.bucket,
          currentScore: props.selectedMail.score,
          currentReasons: props.selectedMail.reasons,
          language: "zh-CN",
          readMessageIds,
          memoryScope,
          memoryLayers,
        }),
        props.api.suggestLabelsWithHermes({
          subject: props.selectedMail.subject,
          threadText,
          senderEmail: props.selectedMail.email,
          currentLabels: [],
          availableLabels: props.labels.map((label) => label.label),
          language: "zh-CN",
          readMessageIds,
          memoryScope,
          memoryLayers,
        }),
        props.api.cleanupNewsletterWithHermes({
          subject: props.selectedMail.subject,
          threadText,
          senderEmail: props.selectedMail.email,
          currentBucket: props.selectedMail.bucket,
          language: "zh-CN",
          readMessageIds,
          memoryScope,
          memoryLayers,
        }),
        props.api.extractActionItemsWithHermes({
          subject: props.selectedMail.subject,
          threadText,
          language: "zh-CN",
          now: new Date().toISOString(),
          readMessageIds,
          memoryScope,
          memoryLayers,
        }),
      ]);
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesOrganization({
        priority,
        labels: labelsResult,
        newsletter,
        actionItems,
      });
      setReaderHermesNotice(`Hermes 已整理：${priority.skillRunId}`);
    } catch {
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesOrganization(undefined);
      setReaderHermesNotice("Hermes 整理暂时不可用。");
    } finally {
      if (readerHermesRequestRef.current === requestId) {
        setReaderHermesBusy(undefined);
      }
    }
  }

  async function applyHermesOrganizationSuggestion(
    action: HermesOrganizationApplyAction,
  ) {
    if (readerHermesApplyBusy) {
      return;
    }

    setReaderHermesApplyBusy(action.id);
    setReaderHermesNotice(`正在应用 Hermes 建议：${action.label}...`);

    const applied =
      action.kind === "mail"
        ? await props.onArchive()
        : await props.onSmartInboxFeedback(action.action);

    setReaderHermesApplyBusy(undefined);
    setReaderHermesNotice(
      applied
        ? `Hermes 建议已应用：${action.label}。`
        : `Hermes 建议应用失败：${action.label}。`,
    );
  }

  async function createHermesActionItemFollowUp(
    item: ReaderHermesOrganizationResult["actionItems"]["items"][number],
    index: number,
  ) {
    if (readerHermesApplyBusy) {
      return;
    }

    if (!props.api) {
      setReaderHermesNotice("连接服务后才能创建 Hermes 待办提醒。");
      return;
    }

    if (!item.dueAt) {
      setReaderHermesNotice("Hermes 待办缺少明确时间，暂不自动创建提醒。");
      return;
    }

    const busyId = hermesActionItemApplyId(item, index);
    setReaderHermesApplyBusy(busyId);
    setReaderHermesNotice(`正在创建 Hermes 待办提醒：${item.title}...`);

    try {
      const followUp = await props.api.createFollowUp({
        accountId: props.selectedMail.accountId,
        messageId: props.selectedMail.id,
        dueAt: item.dueAt,
        kind: "manual",
        title: item.title,
        note: formatHermesActionItemNote(item),
        source: "hermes_followup",
        hermesSkillRunId: readerHermesOrganization?.actionItems.skillRunId,
      });
      setReaderHermesNotice(`Hermes 待办提醒已创建：${followUp.title ?? item.title}。`);
    } catch {
      setReaderHermesNotice("Hermes 待办提醒创建失败。");
    } finally {
      setReaderHermesApplyBusy(undefined);
    }
  }

  async function askHermesForReplyDraft() {
    if (!props.api) {
      setComposeNotice("Hermes 暂时不可用。");
      return;
    }

    const threadText = (props.selectedDetail?.bodyText ?? props.selectedMail.preview).trim();
    if (!threadText) {
      setComposeNotice("这封邮件还没有可用于生成回复的正文。");
      return;
    }

    setComposeBusy(true);
    try {
      const [seed, result] = await Promise.all([
        props.api.createComposeSeed({
          accountId: props.accountId,
          messageId: props.selectedMail.id,
          mode: "reply",
          ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
        }),
        props.api.draftReply({
          subject: props.selectedMail.subject,
          threadText,
          instruction: "Draft a concise reply in my normal style.",
          readMessageIds: [props.selectedMail.id],
        }),
      ]);
      applySeedToCompose(seed, {
        bodyText: result.draftText,
        source: "hermes_reply",
        hermesSkillRunId: result.skillRunId,
        hermesDraftText: result.draftText,
        notice: `Hermes 已生成回复草稿：${result.skillRunId}`,
      });
      focusComposeTarget("body");
    } catch {
      setComposeNotice("Hermes 写回复暂时不可用。");
    } finally {
      setComposeBusy(false);
    }
  }

  async function askHermesForQuickReply(action: QuickReplyAction) {
    if (!props.api) {
      setComposeNotice("Hermes 暂时不可用。");
      return;
    }

    const threadText = (props.selectedDetail?.bodyText ?? props.selectedMail.preview).trim();
    if (!threadText) {
      setComposeNotice("这封邮件还没有可用于快速回复的正文。");
      return;
    }

    setComposeBusy(true);
    try {
      const [seed, result] = await Promise.all([
        props.api.createComposeSeed({
          accountId: props.accountId,
          messageId: props.selectedMail.id,
          mode: "reply",
          ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
        }),
        props.api.quickReply({
          subject: props.selectedMail.subject,
          threadText,
          scenario: action.scenario,
          instruction: action.instruction,
          tone: "warm professional",
          readMessageIds: [props.selectedMail.id],
        }),
      ]);
      applySeedToCompose(seed, {
        bodyText: result.draftText,
        source: "hermes_reply",
        hermesSkillRunId: result.skillRunId,
        hermesDraftText: result.draftText,
        notice: `Hermes 已生成快速回复：${result.skillRunId}`,
      });
      focusComposeTarget("body");
    } catch {
      setComposeNotice("Hermes 快速回复暂时不可用。");
    } finally {
      setComposeBusy(false);
    }
  }

  async function submitComposedMail(action: "save" | "send" | "schedule") {
    if (!props.api) {
      setComposeNotice("邮件服务暂时不可用。");
      return;
    }

    const to = parseComposeRecipients(composeTo);
    const cc = parseComposeRecipients(composeCc);
    const bcc = parseComposeRecipients(composeBcc);
    const bodyText = composeBody.trim();
    if (to.length === 0 || !bodyText) {
      setComposeNotice("请填写收件人和正文。");
      return;
    }

    const scheduledAt =
      action === "schedule" ? parseDateTimeLocal(composeScheduledAt) : undefined;
    if (action === "schedule" && !scheduledAt) {
      setComposeNotice("请选择有效的发送时间。");
      return;
    }

    cancelComposeAutosave("idle");
    setComposeBusy(true);
    try {
      const draft = await saveOrUpdateComposeDraft({
        to,
        cc,
        bcc,
        bodyText,
      });
      rememberSavedComposeSignature({ to, cc, bcc, bodyText });

      if (action === "send") {
        if (composeScheduledId) {
          await props.api.sendScheduledNow({
            accountId: props.accountId,
            scheduledId: composeScheduledId,
          });
          setComposeNotice(`待发邮件已提交立即发送：${composeScheduledId}`);
          clearComposeForm();
          await refreshOutbox();
          return;
        }

        const result = await props.api.sendMailDraft({
          accountId: props.accountId,
          draftId: draft.id,
        });
        setComposeNotice(`邮件已进入发送队列：${result.draft.id}`);
        clearComposeForm();
        await refreshMailDrafts();
        return;
      }

      if (action === "schedule" && scheduledAt) {
        if (composeScheduledId) {
          const scheduled = await props.api.rescheduleScheduledSend({
            accountId: props.accountId,
            scheduledId: composeScheduledId,
            scheduledAt,
          });
          setComposeNotice(`待发邮件已更新：${formatMailDate(scheduled.scheduledAt)}`);
          clearComposeForm();
          await refreshOutbox();
          return;
        }

        const scheduled = await props.api.scheduleMailDraft({
          accountId: props.accountId,
          draftId: draft.id,
          scheduledAt,
        });
        setComposeNotice(`邮件已定时：${formatMailDate(scheduled.scheduledAt)}`);
        clearComposeForm();
        await refreshMailDrafts();
        await refreshOutbox();
        return;
      }

      setComposeDraftId(draft.id);
      setComposeNotice(
        composeScheduledId
          ? `待发草稿已更新：${draft.id}`
          : composeDraftId
            ? `草稿已更新：${draft.id}`
            : `草稿已保存：${draft.id}`,
      );
      if (composeScheduledId) {
        await refreshOutbox();
      } else {
        await refreshMailDrafts();
      }
    } catch {
      setComposeNotice("写信操作失败，请稍后再试。");
    } finally {
      setComposeBusy(false);
    }
  }

  function composeDraftPayload(input: {
    to: ReturnType<typeof parseComposeRecipients>;
    cc: ReturnType<typeof parseComposeRecipients>;
    bcc: ReturnType<typeof parseComposeRecipients>;
    bodyText: string;
  }) {
    return {
      accountId: props.accountId,
      ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
      to: input.to,
      ...(input.cc.length > 0 ? { cc: input.cc } : {}),
      ...(input.bcc.length > 0 ? { bcc: input.bcc } : {}),
      subject: composeSubject.trim(),
      bodyText: input.bodyText,
      source: composeSource,
      ...(composeAttachments.length > 0
        ? { attachments: composeAttachments }
        : {}),
      ...(composeReplyToMessageId
        ? { replyToMessageId: composeReplyToMessageId }
        : {}),
      ...(composeSourceMessageId
        ? { sourceMessageId: composeSourceMessageId }
        : {}),
      ...(composeHermesSkillRunId
        ? { hermesSkillRunId: composeHermesSkillRunId }
        : {}),
      ...(composeHermesSkillRunId && composeHermesDraftText
        ? { hermesDraftText: composeHermesDraftText }
        : {}),
    };
  }

  function saveOrUpdateComposeDraft(input: {
    to: ReturnType<typeof parseComposeRecipients>;
    cc: ReturnType<typeof parseComposeRecipients>;
    bcc: ReturnType<typeof parseComposeRecipients>;
    bodyText: string;
  }) {
    const payload = composeDraftPayload(input);
    if (composeScheduledId) {
      return props.api!.updateScheduledDraft({
        ...payload,
        scheduledId: composeScheduledId,
      }).then((detail) => detail.draft);
    }

    if (composeDraftId) {
      return props.api!.updateMailDraft({
        ...payload,
        draftId: composeDraftId,
      });
    }

    return props.api!.createMailDraft(payload);
  }

  async function addComposeAttachments(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setComposeBusy(true);
    try {
      const selectedFiles = Array.from(files);
      if (composeAttachments.length + selectedFiles.length > MAX_COMPOSE_ATTACHMENTS) {
        setComposeNotice(`最多只能添加 ${MAX_COMPOSE_ATTACHMENTS} 个附件。`);
        return;
      }
      const existingBytes = composeAttachments.reduce(
        (sum, attachment) => sum + attachment.byteSize,
        0,
      );
      const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
      const totalBytes = existingBytes + selectedBytes;
      if (totalBytes > MAX_COMPOSE_ATTACHMENT_BYTES) {
        setComposeNotice("附件总大小不能超过 25 MB。");
        return;
      }

      const nextAttachments = await Promise.all(
        selectedFiles.map((file) =>
          props.api
            ? props.api.uploadComposeAttachment({
                accountId: props.accountId,
                file,
              })
            : composeAttachmentFromFile(file, props.accountId),
        ),
      );
      const merged = [...composeAttachments, ...nextAttachments];
      setComposeAttachments(merged);
      setComposeNotice(`已添加 ${nextAttachments.length} 个附件。`);
      setComposePreview(undefined);
    } catch {
      setComposeNotice("附件上传失败，请重新选择文件。");
    } finally {
      setComposeBusy(false);
    }
  }

  function clearComposeForm() {
    cancelComposeAutosave();
    lastSavedComposeSignatureRef.current = "";
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    setComposeSource("manual");
    setComposeAttachments([]);
    setComposeReplyToMessageId(undefined);
    setComposeSourceMessageId(undefined);
    setComposeHermesSkillRunId(undefined);
    setComposeHermesDraftText(undefined);
    setComposeDraftId(undefined);
    setComposeScheduledId(undefined);
    setComposePreview(undefined);
    setComposeScheduledAt(defaultScheduleDateTimeLocal());
  }

  async function polishComposedMail() {
    if (!props.api) {
      setComposeNotice("Hermes 暂时不可用。");
      return;
    }

    const bodyText = composeBody.trim();
    if (!bodyText) {
      setComposeNotice("请先写正文，再让 Hermes 润色。");
      return;
    }

    setComposeBusy(true);
    try {
      const result = await props.api.rewritePolishDraft({
        text: bodyText,
        action: "polish",
        instruction: "Polish this email while preserving intent, recipient details, and concrete commitments.",
        tone: "clear professional",
      });
      setComposeBody(result.rewrittenText);
      setComposeHermesSkillRunId(result.skillRunId);
      setComposeHermesDraftText(result.rewrittenText);
      setComposePreview(undefined);
      setComposeNotice(`Hermes 已润色：${result.skillRunId}`);
    } catch {
      setComposeNotice("Hermes 润色暂时不可用。");
    } finally {
      setComposeBusy(false);
    }
  }

  function editMailDraft(draft: MailDraftDto) {
    applyDraftToCompose(draft);
    setDraftsNotice(`已载入草稿：${draft.id}`);
    focusComposeTarget("body");
  }

  async function editOutboxItem(item: ScheduledSendDto) {
    if (!props.api || !item.canEdit) {
      return;
    }

    setOutboxBusyId(item.id);
    try {
      const detail = await props.api.getScheduledDraft({
        accountId: props.accountId,
        scheduledId: item.id,
      });
      applyDraftToCompose(detail.draft, detail.scheduledSend);
      setOutboxNotice(`已载入待发草稿：${item.id}`);
      focusComposeTarget("body");
    } catch {
      setOutboxNotice("加载待发草稿失败，请稍后再试。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  async function sendOutboxItemNow(item: ScheduledSendDto) {
    if (!props.api || !item.canSendNow) {
      return;
    }

    setOutboxBusyId(item.id);
    try {
      await props.api.sendScheduledNow({
        accountId: props.accountId,
        scheduledId: item.id,
      });
      setOutboxNotice(`已提交立即发送：${item.id}`);
      await refreshOutbox();
    } catch {
      setOutboxNotice("立即发送失败，请稍后再试。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  async function rescheduleOutboxItem(item: ScheduledSendDto) {
    if (!props.api || !item.canEdit) {
      return;
    }

    const scheduledAt = parseDateTimeLocal(
      rescheduleTimes[item.id] ?? isoToDateTimeLocal(item.scheduledAt),
    );
    if (!scheduledAt) {
      setOutboxNotice("请选择有效的发送时间。");
      return;
    }

    setOutboxBusyId(item.id);
    try {
      const updated = await props.api.rescheduleScheduledSend({
        accountId: props.accountId,
        scheduledId: item.id,
        scheduledAt,
      });
      setOutboxNotice(`已改到 ${formatMailDate(updated.scheduledAt)}`);
      await refreshOutbox();
    } catch {
      setOutboxNotice("改时间失败，请稍后再试。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  async function cancelOutboxItem(item: ScheduledSendDto) {
    if (!props.api || !item.canDelete) {
      return;
    }

    setOutboxBusyId(item.id);
    try {
      await props.api.cancelScheduledSend({
        accountId: props.accountId,
        scheduledId: item.id,
      });
      setOutboxNotice(`已取消定时发送：${item.id}`);
      await refreshOutbox();
    } catch {
      setOutboxNotice("取消定时发送失败，请稍后再试。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  function submitTopSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = topSearchQuery.trim();
    if (!trimmedQuery) {
      return;
    }

    props.onGlobalSearch(trimmedQuery);
  }

  async function downloadMessageAttachment(attachment: AttachmentDto) {
    if (!props.api) {
      setAttachmentDownloadNotice("附件下载服务暂时不可用。");
      return;
    }

    setAttachmentDownloadBusyId(attachment.id);
    setAttachmentDownloadNotice("");
    try {
      const download = await props.api.downloadAttachment({
        accountId: props.accountId,
        attachmentId: attachment.id,
      });
      saveAttachmentDownload(download, attachment.filename);
      setAttachmentDownloadNotice(`附件已开始下载：${attachment.filename}`);
    } catch {
      setAttachmentDownloadNotice(`附件下载失败：${attachment.filename}`);
    } finally {
      setAttachmentDownloadBusyId(undefined);
    }
  }

  const selectedBucket = props.selectedMail.bucket;
  const selectedBucketCount = props.mail.filter(
    (mail) => mail.bucket === selectedBucket,
  ).length;
  const smartInboxDisabled = props.smartInboxBusy !== "";

  return (
    <section className="workspace-page mail-page">
      <header className="topbar">
        <div>
          <h1>邮箱</h1>
          <p>邮箱目录放在第二栏，左侧只保留全局功能。</p>
        </div>
        <form
          className="top-search"
          role="search"
          aria-label="全局邮件搜索"
          onSubmit={submitTopSearch}
        >
          <Search size={18} />
          <input
            aria-label="全局搜索邮件"
            placeholder="搜索邮件、联系人或主题"
            value={topSearchQuery}
            onChange={(event) => setTopSearchQuery(event.target.value)}
          />
          <kbd>Ctrl /</kbd>
        </form>
        <div className="top-actions">
          <button className="ghost-button" type="button" onClick={props.onAddMail}>
            <MailPlus size={17} />
            添加邮箱
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => document.getElementById("compose-recipients")?.focus()}
          >
            <PenLine size={17} />
            写邮件
          </button>
        </div>
      </header>

      {props.backendNotice ? (
        <div className="backend-notice" role="status">{props.backendNotice}</div>
      ) : null}

      {props.undoToast ? (
        <div className="backend-notice" role="status">
          Done queued.
          <button type="button" aria-label="Undo done" onClick={props.onUndoDone}>
            Undo
          </button>
        </div>
      ) : null}

      <section className="compose-outbox-band" aria-label="写信和待发队列">
        <div className="compose-panel" aria-label="写邮件面板">
          <div className="compose-panel-head">
            <div>
              <strong>写邮件</strong>
              <span>
                当前账号：{props.accountId}
                {composeDraftId ? ` · 草稿：${composeDraftId}` : ""}
                {composeScheduledId ? ` · 待发：${composeScheduledId}` : ""}
                {composeAutosaveStatus !== "idle"
                  ? ` · ${formatComposeAutosaveStatus(composeAutosaveStatus)}`
                  : ""}
              </span>
            </div>
            <Send size={18} />
          </div>
          {composeNotice ? (
            <div className="backend-notice compact" role="status">
              {composeNotice}
            </div>
          ) : null}
          <label className="compose-from-field">
            <span>From</span>
            <select
              aria-label="Compose from identity"
              value={composeFrom}
              disabled={sendIdentities.length === 0}
              onChange={(event) => {
                setComposeFrom(event.target.value);
                setComposePreview(undefined);
              }}
            >
              {sendIdentities.length === 0 ? (
                <option value="">当前账号</option>
              ) : (
                sendIdentities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {formatSendIdentity(identity)}
                  </option>
                ))
              )}
            </select>
          </label>
          <div
            className="provider-candidate-box"
            aria-label="Outlook shared sender candidates"
          >
            <div className="provider-candidate-entry">
              <label>
                <span>Outlook 共享 From</span>
                <input
                  aria-label="Outlook shared sender address"
                  value={graphCandidateAddress}
                  onChange={(event) => setGraphCandidateAddress(event.target.value)}
                  placeholder="shared@example.com"
                />
              </label>
              <label>
                <span>名称</span>
                <input
                  aria-label="Outlook shared sender name"
                  value={graphCandidateName}
                  onChange={(event) => setGraphCandidateName(event.target.value)}
                  placeholder="Team Inbox"
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  aria-label="Outlook shared sender type"
                  value={graphCandidateType}
                  onChange={(event) =>
                    setGraphCandidateType(
                      event.target.value as typeof graphCandidateType,
                    )
                  }
                >
                  <option value="shared_mailbox">共享邮箱</option>
                  <option value="send_on_behalf">代表发送</option>
                  <option value="unknown">未知</option>
                </select>
              </label>
              <button
                className="tiny-button"
                type="button"
                aria-label="Add Outlook shared sender candidate"
                disabled={composeBusy}
                onClick={() => void addGraphSendIdentityCandidate()}
              >
                添加
              </button>
            </div>
            {sendIdentityCandidates.length > 0 ? (
              <div className="provider-candidate-list">
                {sendIdentityCandidates.map((candidate) => (
                  <div className="provider-candidate-row" key={candidate.id}>
                    <div className="provider-candidate-main">
                      <span>
                        {candidate.from.name
                          ? `${candidate.from.name} <${candidate.from.address}>`
                          : candidate.from.address}
                      </span>
                      <strong>{formatSendIdentityCandidateState(candidate)}</strong>
                    </div>
                    <label className="provider-target-field">
                      <span>目标邮箱</span>
                      <input
                        aria-label={`Outlook shared mailbox target ${candidate.from.address}`}
                        value={
                          graphTargetMailboxes[candidate.id] ??
                          candidateTargetMailboxValue(candidate)
                        }
                        disabled={
                          composeBusy ||
                          candidate.verificationState !== "verified" ||
                          !candidate.enabled
                        }
                        onChange={(event) =>
                          setGraphTargetMailboxes((current) => ({
                            ...current,
                            [candidate.id]: event.target.value,
                          }))
                        }
                        placeholder={candidate.from.address}
                      />
                    </label>
                    <strong>{formatSendIdentityTargetState(candidate)}</strong>
                    <div className="provider-candidate-actions">
                      <button
                        className="tiny-button"
                        type="button"
                        aria-label={`Verify Outlook shared sender ${candidate.from.address}`}
                        disabled={
                          composeBusy ||
                          (candidate.verificationState === "verified" &&
                            candidate.enabled)
                        }
                        onClick={() => void verifyGraphSendIdentityCandidate(candidate)}
                      >
                        验证 From
                      </button>
                      <button
                        className="tiny-button"
                        type="button"
                        aria-label={`Verify Outlook shared mailbox target ${candidate.from.address}`}
                        disabled={
                          composeBusy ||
                          candidate.verificationState !== "verified" ||
                          !candidate.enabled
                        }
                        onClick={() =>
                          void verifyGraphSendIdentityUserTarget(candidate)
                        }
                      >
                        验证共享箱
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="compose-recipient-grid">
            <label>
              <span>收件人</span>
              <input
                id="compose-recipients"
                aria-label="Compose recipients"
                value={composeTo}
                onChange={(event) => {
                  setComposeTo(event.target.value);
                  setComposePreview(undefined);
                }}
                placeholder="client@example.com, team@example.com"
              />
            </label>
            <label>
              <span>Cc</span>
              <input
                aria-label="Compose cc"
                value={composeCc}
                onChange={(event) => {
                  setComposeCc(event.target.value);
                  setComposePreview(undefined);
                }}
                placeholder="copy@example.com"
              />
            </label>
            <label>
              <span>Bcc</span>
              <input
                aria-label="Compose bcc"
                value={composeBcc}
                onChange={(event) => {
                  setComposeBcc(event.target.value);
                  setComposePreview(undefined);
                }}
                placeholder="audit@example.com"
              />
            </label>
          </div>
          <label>
            <span>主题</span>
            <input
              aria-label="Compose subject"
              value={composeSubject}
              onChange={(event) => {
                setComposeSubject(event.target.value);
                setComposePreview(undefined);
              }}
              placeholder="输入邮件主题"
            />
          </label>
          <textarea
            id="compose-body"
            aria-label="Compose body"
            value={composeBody}
            onChange={(event) => {
              setComposeBody(event.target.value);
              setComposePreview(undefined);
            }}
            placeholder="写邮件正文，或先在右侧用 Hermes 生成回复草稿"
          />
          <label className="compose-file-button">
            <Paperclip size={15} />
            <span>添加附件</span>
            <input
              aria-label="Attach files to compose"
              type="file"
              multiple
              disabled={composeBusy}
              onChange={(event) => {
                void addComposeAttachments(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {composeAttachments.length > 0 ? (
            <div className="compose-attachment-list" aria-label="Compose attachments">
              {composeAttachments.map((attachment) => (
                <div className="compose-attachment-row" key={attachment.attachmentId}>
                  <Paperclip size={15} />
                  <div>
                    <strong>{attachment.filename}</strong>
                    <span>
                      {formatAttachmentSize(attachment.byteSize)}
                      {attachment.inline ? " · inline" : ""}
                    </span>
                  </div>
                  <button
                    className="tiny-button"
                    type="button"
                    aria-label={`Remove attachment ${attachment.filename}`}
                    disabled={composeBusy}
                    onClick={() => {
                      setComposeAttachments((current) =>
                        current.filter((item) => item.attachmentId !== attachment.attachmentId),
                      );
                      setComposePreview(undefined);
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="composer-tool-row">
            <button
              className="tiny-button"
              type="button"
              aria-label="Polish composed draft with Hermes"
              disabled={composeBusy}
              onClick={() => void polishComposedMail()}
            >
              <Sparkles size={14} />
              润色
            </button>
            <button
              className="tiny-button"
              type="button"
              aria-label="Preview composed draft"
              disabled={composeBusy}
              onClick={() => void previewComposedMail()}
            >
              <FileText size={14} />
              预览
            </button>
          </div>
          {composePreview ? (
            <div className="compose-preview-box" role="status">
              <strong>
                {composePreview.readyToSend ? "可发送预览" : "预览待处理"}
              </strong>
              <span>
                {composePreview.to.length} 收件人 · {composePreview.estimatedSizeBytes} 字节
              </span>
              {composePreview.warnings.length > 0 ? (
                <em>{formatComposeWarnings(composePreview.warnings)}</em>
              ) : (
                <em>{composePreview.subject || "无主题"}</em>
              )}
            </div>
          ) : null}
          <div className="compose-schedule-row">
            <label>
              <span>发送时间</span>
              <input
                aria-label="Compose scheduled time"
                type="datetime-local"
                value={composeScheduledAt}
                onChange={(event) => setComposeScheduledAt(event.target.value)}
              />
            </label>
          </div>
          <div className="composer-actions">
            <button
              className="ghost-button"
              type="button"
              aria-label="Save composed draft"
              disabled={composeBusy}
              onClick={() => void submitComposedMail("save")}
            >
              保存草稿
            </button>
            <button
              className="ghost-button"
              type="button"
              aria-label="Schedule composed draft"
              disabled={composeBusy}
              onClick={() => void submitComposedMail("schedule")}
            >
              定时发送
            </button>
            <button
              className="primary-button"
              type="button"
              aria-label="Send composed draft now"
              disabled={composeBusy}
              onClick={() => void submitComposedMail("send")}
            >
              立即发送
            </button>
          </div>
        </div>

        <div className="drafts-panel" aria-label="草稿列表">
          <div className="compose-panel-head">
            <div>
              <strong>草稿</strong>
              <span>
                {draftsLoading ? "加载中" : `${mailDrafts.length} 封可编辑`}
              </span>
            </div>
            <FileText size={18} />
          </div>
          {draftsNotice ? (
            <div className="backend-notice compact" role="status">
              {draftsNotice}
            </div>
          ) : null}
          {mailDrafts.length === 0 ? (
            <div className="empty-drafts">
              {draftsLoading
                ? "正在加载草稿..."
                : draftsNotice
                  ? "无法读取保存草稿。"
                  : "当前没有保存草稿。"}
            </div>
          ) : (
            <div className="draft-list">
              {mailDrafts.map((draft) => {
                const recipients = formatComposeAddressList(draft.to);
                const attachmentCount = draft.attachments?.length ?? 0;
                return (
                  <div className="draft-row" key={draft.id}>
                    <div>
                      <strong>{draft.subject || "无主题草稿"}</strong>
                      <span>
                        {recipients || "未填写收件人"} · {formatMailDate(draft.updatedAt)}
                      </span>
                      <em>
                        {draft.id}
                        {attachmentCount > 0 ? ` · ${attachmentCount} 个附件` : ""}
                      </em>
                    </div>
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label={`Edit saved draft ${draft.id}`}
                      disabled={composeBusy}
                      onClick={() => editMailDraft(draft)}
                    >
                      编辑
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="outbox-panel" aria-label="待发队列">
          <div className="compose-panel-head">
            <div>
              <strong>待发队列</strong>
              <span>{outboxItems.length} 封待处理</span>
            </div>
            <Clock3 size={18} />
          </div>
          {outboxNotice ? (
            <div className="backend-notice compact" role="status">
              {outboxNotice}
            </div>
          ) : null}
          {outboxItems.length === 0 ? (
            <div className="empty-outbox">当前没有待发邮件。</div>
          ) : (
            <div className="outbox-list">
              {outboxItems.map((item) => (
                <div className="outbox-row" key={item.id}>
                  <div>
                    <strong>{item.draftId}</strong>
                    <span>{item.status} · {formatMailDate(item.scheduledAt)}</span>
                    {item.lastError ? <em>{item.lastError}</em> : null}
                  </div>
                  <input
                    aria-label={`Reschedule ${item.id}`}
                    type="datetime-local"
                    value={rescheduleTimes[item.id] ?? isoToDateTimeLocal(item.scheduledAt)}
                    disabled={!item.canEdit || outboxBusyId === item.id}
                    onChange={(event) =>
                      setRescheduleTimes((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                  <div className="outbox-actions">
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label={`Edit scheduled draft ${item.id}`}
                      disabled={!item.canEdit || outboxBusyId === item.id}
                      onClick={() => void editOutboxItem(item)}
                    >
                      编辑
                    </button>
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label={`Reschedule scheduled send ${item.id}`}
                      disabled={!item.canEdit || outboxBusyId === item.id}
                      onClick={() => void rescheduleOutboxItem(item)}
                    >
                      改时间
                    </button>
                    <button
                      className="tiny-button"
                      type="button"
                      aria-label={`Send scheduled send ${item.id} now`}
                      disabled={!item.canSendNow || outboxBusyId === item.id}
                      onClick={() => void sendOutboxItemNow(item)}
                    >
                      立即发送
                    </button>
                    <button
                      className="tiny-button danger"
                      type="button"
                      aria-label={`Cancel scheduled send ${item.id}`}
                      disabled={!item.canDelete || outboxBusyId === item.id}
                      onClick={() => void cancelOutboxItem(item)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className={`mail-grid outlook-layout layout-${props.density}`} aria-label="邮箱三栏工作台">
        <aside className="mail-directory" aria-label="邮箱目录栏">
          <div className="directory-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="写邮件"
              onClick={() => document.getElementById("compose-recipients")?.focus()}
            >
              <PenLine size={18} />
            </button>
            <button className="icon-button" type="button" aria-label="刷新">
              <Clock3 size={18} />
            </button>
          </div>

          <div className="directory-section">
            <div className="section-label">所有邮箱</div>
            {props.folders.map((folder) => {
              const Icon = folderIcons[folder.id] ?? Inbox;
              return (
                <button
                  key={folder.id}
                  className={props.activeFolder === folder.id ? "folder-row active" : "folder-row"}
                  onClick={() => props.onFolderChange(folder.id)}
                  type="button"
                >
                  <Icon size={17} />
                  <span>{folder.label}</span>
                  <strong>{folder.count}</strong>
                </button>
              );
            })}
          </div>

          <div className="directory-section">
            <div className="section-label with-action">
              标签/项目
              <button type="button" aria-label="添加标签">
                +
              </button>
            </div>
            {props.labels.map((label) => (
              <button
                key={label.id}
                className={
                  props.activeFolder === `label:${label.id}`
                    ? "label-row active"
                    : "label-row"
                }
                type="button"
                onClick={() => props.onLabelChange(label.id)}
              >
                <span className={`label-dot ${label.tone}`} />
                <span>{label.label}</span>
                <strong>{label.count}</strong>
              </button>
            ))}
          </div>

          <div className="directory-section" aria-label="常用分类">
            <div className="section-label">常用分类</div>
            {props.quickCategories.map((category) => (
              <button
                key={category.id}
                className={
                  props.activeFolder === category.id
                    ? "label-row category-row active"
                    : "label-row category-row"
                }
                onClick={() => props.onSavedViewChange(category.id)}
                type="button"
              >
                <span className={`label-dot ${category.tone}`} />
                <span>{category.label}</span>
                <strong>{category.count}</strong>
              </button>
            ))}
          </div>
        </aside>

        <section className={`message-list-panel density-${props.density}`} aria-label="邮件列表">
          <div className="list-toolbar">
            <div>
              <h2>收件箱</h2>
              <span>128 封邮件</span>
            </div>
            <div className="list-toolbar-actions">
              <div className="density-control" aria-label="邮件列表密度">
                {densityOptions.map((option) => (
                  <button
                    key={option.id}
                    className={props.density === option.id ? "active" : ""}
                    type="button"
                    aria-label={option.label}
                    onClick={() => props.onDensityChange(option.id)}
                  >
                    <span aria-hidden="true">{option.shortLabel}</span>
                  </button>
                ))}
              </div>
              <button className="tiny-button" type="button">
                按时间
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
          <div className="bulk-row">
            <label>
              <input type="checkbox" />
              全部
            </label>
            <div className="smart-inbox-actions" aria-label="Smart Inbox actions">
              <span>
                Smart Inbox · {bucketLabel(selectedBucket)} · {selectedBucketCount} 封
              </span>
              <div className="smart-inbox-action-set">
                <button
                  className="tiny-button"
                  type="button"
                  aria-label={`Smart Inbox done ${selectedBucket}`}
                  disabled={smartInboxDisabled || selectedBucketCount === 0}
                  onClick={() => props.onSmartInboxBucketDone(selectedBucket)}
                >
                  {props.smartInboxBusy === "bulk_done" ? "处理中" : "批量 Done"}
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  aria-label="Smart Inbox mark selected important"
                  disabled={smartInboxDisabled}
                  onClick={() => void props.onSmartInboxFeedback("mark_important")}
                >
                  重要
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  aria-label="Smart Inbox move selected to newsletters"
                  disabled={smartInboxDisabled}
                  onClick={() =>
                    void props.onSmartInboxFeedback("move_to_newsletters")
                  }
                >
                  订阅
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  aria-label="Smart Inbox move selected to feed"
                  disabled={smartInboxDisabled}
                  onClick={() => void props.onSmartInboxFeedback("move_to_feed")}
                >
                  Feed
                </button>
              </div>
            </div>
          </div>
          {props.mail.map((mail) => (
            <button
              key={mailItemKey(mail)}
              className={
                props.activeMailId === mailItemKey(mail)
                  ? "message-row active"
                  : "message-row"
              }
              onClick={() => props.onMailChange(mailItemKey(mail))}
              type="button"
            >
              <span className={mail.unread ? "unread-dot" : "read-dot"} />
              <div className="message-row-main">
                <div className="row-topline">
                  <strong>{mail.sender}</strong>
                  <time>{mail.time}</time>
                </div>
                <div className="row-subject">
                  <Star size={14} className={mail.starred ? "star-hot" : ""} />
                  <span>{mail.subject}</span>
                </div>
                <p>{mail.preview}</p>
                <div className="reason-line">
                  {mail.reasons.slice(0, 2).map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              </div>
              <span className={`tag ${mail.tone}`}>{mail.label}</span>
            </button>
          ))}
        </section>

        <article className="reader-panel">
          <div className="reader-toolbar">
            <button
              className="toolbar-button"
              type="button"
              disabled={composeBusy}
              onClick={() => void applyComposeSeed("reply")}
            >
              回复
            </button>
            <button
              className="toolbar-button"
              type="button"
              disabled={composeBusy}
              onClick={() => void applyComposeSeed("reply_all")}
            >
              回复全部
            </button>
            <button
              className="toolbar-button"
              type="button"
              disabled={composeBusy}
              onClick={() => void applyComposeSeed("forward")}
            >
              转发
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Done selected message"
              onClick={() => void props.onDone()}
            >
              Done
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label={
                props.selectedMail.starred
                  ? "Unstar selected message"
                  : "Star selected message"
              }
              onClick={() => void props.onToggleStar()}
            >
              {props.selectedMail.starred ? "取消星标" : "星标"}
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label={
                props.selectedMail.unread
                  ? "Mark selected message as read"
                  : "Mark selected message as unread"
              }
              onClick={() => void props.onToggleRead()}
            >
              {props.selectedMail.unread ? "标已读" : "标未读"}
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Ask Hermes to track follow-up"
              onClick={props.onTrackFollowUp}
            >
              Hermes 跟进
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Ask Hermes to summarize selected message"
              disabled={Boolean(readerHermesBusy)}
              onClick={() => void askHermesForReaderSummary()}
            >
              Hermes 总结
            </button>
            <div className="reader-translation-control">
              <select
                aria-label="Hermes translation target language"
                value={readerTranslationTarget}
                disabled={Boolean(readerHermesBusy)}
                onChange={(event) => setReaderTranslationTarget(event.target.value)}
              >
                {READER_TRANSLATION_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
              <button
                className="toolbar-button"
                type="button"
                aria-label="Ask Hermes to translate selected message"
                disabled={Boolean(readerHermesBusy)}
                onClick={() => void askHermesForReaderTranslation()}
              >
                翻译
              </button>
            </div>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Ask Hermes to organize selected message"
              disabled={Boolean(readerHermesBusy)}
              onClick={() => void askHermesToOrganizeReader()}
            >
              Hermes 整理
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Archive selected message"
              onClick={() => void props.onArchive()}
            >
              归档
            </button>
            <button
              className="toolbar-button danger"
              type="button"
              aria-label="Trash selected message"
              onClick={() => void props.onTrash()}
            >
              删除
            </button>
          </div>

          <div className="reader-content">
            <div className="reader-heading">
              <h2>{props.selectedMail.subject}</h2>
              <span className={`tag ${props.selectedMail.tone}`}>{props.selectedMail.label}</span>
            </div>
            <div className="sender-line">
              <div className="avatar">{props.selectedMail.sender.slice(0, 1)}</div>
              <div>
                <strong>{props.selectedMail.sender}</strong>
                <span>{props.selectedMail.email} · 收件人：我 · {props.selectedMail.date} {props.selectedMail.time}</span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Toggle selected message star"
                title={props.selectedMail.starred ? "取消星标" : "星标"}
                onClick={props.onToggleStar}
              >
                <Star
                  size={19}
                  className={props.selectedMail.starred ? "star-hot" : ""}
                />
              </button>
            </div>

            <div className="reason-box">
              <div>
                <Sparkles size={18} />
                <strong>为什么排前面</strong>
              </div>
              <p>
                {props.selectedMail.bucket} · 分数 {props.selectedMail.score}，{props.selectedMail.reasons.join("，")}。
              </p>
            </div>

            {props.followUpNotice ? (
              <div className="backend-notice" role="status">
                {props.followUpNotice}
              </div>
            ) : null}

            {props.hermesFollowUpSuggestion ? (
              <div className="reason-box" role="status">
                <div>
                  <Sparkles size={18} />
                  <strong>Hermes 跟进建议</strong>
                </div>
                <p>
                  {props.hermesFollowUpSuggestion.nextAction ??
                    "Hermes 建议创建跟进提醒"}
                </p>
                <p>
                  {props.hermesFollowUpSuggestion.dueAt
                    ? `提醒时间 ${formatMailDate(props.hermesFollowUpSuggestion.dueAt)}`
                    : "等待你确认提醒时间"}
                </p>
                <button
                  className="ghost-button"
                  type="button"
                  aria-label="Confirm Hermes follow-up"
                  onClick={props.onConfirmHermesFollowUp}
                >
                  确认创建提醒
                </button>
              </div>
            ) : null}

            {readerHermesNotice ? (
              <div className="backend-notice" role="status">
                {readerHermesNotice}
              </div>
            ) : null}

            {readerHermesSummary ? (
              <div className="reason-box hermes-reader-result" role="status">
                <div>
                  <Sparkles size={18} />
                  <strong>Hermes 摘要</strong>
                </div>
                <p>{readerHermesSummary.summaryText}</p>
              </div>
            ) : null}

            {readerHermesTranslation ? (
              <div
                className="reason-box hermes-reader-result hermes-translation-result"
                role="status"
                aria-label="Hermes 邮件翻译"
              >
                <div>
                  <Sparkles size={18} />
                  <strong>
                    Hermes 翻译 ·{" "}
                    {translationLanguageLabel(readerHermesTranslation.targetLanguage)}
                  </strong>
                </div>
                <p>{readerHermesTranslation.translatedText}</p>
                <div className="hermes-apply-actions">
                  <button
                    className="tiny-button"
                    type="button"
                    aria-label="Remember Hermes translation preference"
                    disabled={readerTranslationPreferenceBusy}
                    onClick={() => void rememberReaderTranslationPreference()}
                  >
                    {readerTranslationPreferenceBusy ? "保存中" : "记住这个翻译习惯"}
                  </button>
                </div>
              </div>
            ) : null}

            {readerHermesOrganization ? (
              <div
                className="reason-box hermes-reader-result hermes-organize-result"
                role="status"
                aria-label="Hermes 整理建议"
              >
                <div>
                  <Sparkles size={18} />
                  <strong>Hermes 整理建议</strong>
                </div>
                <p>
                  {readerHermesOrganization.priority.bucket} · 分数{" "}
                  {readerHermesOrganization.priority.score} ·{" "}
                  {readerHermesOrganization.priority.reasons.join("，")}
                </p>
                {readerHermesOrganization.priority.explanation ? (
                  <p>{readerHermesOrganization.priority.explanation}</p>
                ) : null}
                {readerHermesOrganization.labels.labels.length > 0 ? (
                  <p>
                    标签：{" "}
                    {readerHermesOrganization.labels.labels
                      .map((label) =>
                        label.reason ? `${label.name}（${label.reason}）` : label.name,
                      )
                      .join("，")}
                  </p>
                ) : null}
                {readerHermesOrganization.labels.actions.length > 0 ? (
                  <p>
                    建议动作：{" "}
                    {readerHermesOrganization.labels.actions
                      .map(formatHermesLabelAction)
                      .join("，")}
                  </p>
                ) : null}
                <p>
                  订阅判断：{readerHermesOrganization.newsletter.senderCategory} ·{" "}
                  {Math.round(readerHermesOrganization.newsletter.confidence * 100)}%
                  {readerHermesOrganization.newsletter.reasons.length > 0
                    ? ` · ${readerHermesOrganization.newsletter.reasons.join("，")}`
                    : ""}
                </p>
                {readerHermesOrganization.newsletter.actions.length > 0 ? (
                  <p>
                    订阅建议：{" "}
                    {readerHermesOrganization.newsletter.actions
                      .map(formatHermesNewsletterAction)
                      .join("，")}
                  </p>
                ) : null}
                {readerHermesApplyActions.length > 0 ? (
                  <div
                    className="hermes-apply-actions"
                    aria-label="Hermes 可执行整理动作"
                  >
                    {readerHermesApplyActions.map((action) => (
                      <button
                        key={action.id}
                        className="tiny-button"
                        type="button"
                        aria-label={`Apply Hermes organization action ${action.label}`}
                        disabled={Boolean(readerHermesApplyBusy)}
                        onClick={() => void applyHermesOrganizationSuggestion(action)}
                      >
                        {readerHermesApplyBusy === action.id ? "应用中" : action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {readerHermesUnsupportedActionCount > 0 ? (
                  <p>
                    还有 {readerHermesUnsupportedActionCount} 条建议需要标签、稍后或退订能力，当前仅展示不执行。
                  </p>
                ) : null}
                {readerHermesOrganization.actionItems.items.length > 0 ? (
                  <ul className="hermes-action-list">
                    {readerHermesOrganization.actionItems.items.map((item, index) => {
                      const applyId = hermesActionItemApplyId(item, index);
                      return (
                        <li key={hermesActionItemKey(item, index)}>
                          <span>
                            <strong>{item.title}</strong>
                            {item.owner ? ` · ${item.owner}` : ""}
                            {item.dueText ?? item.dueAt
                              ? ` · ${item.dueText ?? formatMailDate(item.dueAt!)}`
                              : ""}
                            {item.priority ? ` · ${item.priority}` : ""}
                          </span>
                          {item.dueAt ? (
                            <button
                              className="tiny-button"
                              type="button"
                              aria-label={`Create Hermes action item follow-up ${item.title}`}
                              disabled={Boolean(readerHermesApplyBusy)}
                              onClick={() =>
                                void createHermesActionItemFollowUp(item, index)
                              }
                            >
                              {readerHermesApplyBusy === applyId
                                ? "创建中"
                                : "创建提醒"}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>待办：未发现明确待办。</p>
                )}
              </div>
            ) : null}

            <div className="message-body">
              <p>{readerBodyText || "这封邮件还没有可显示的正文。"}</p>
            </div>

            <div className="attachment-box">
              <div className="attachment-head">
                <strong>
                  {detailAttachments?.length ?? previewAttachments.length} 个附件
                </strong>
                <Paperclip size={17} />
              </div>
              {attachmentDownloadNotice ? (
                <div className="backend-notice compact" role="status">
                  {attachmentDownloadNotice}
                </div>
              ) : null}
              {detailAttachments
                ? detailAttachments.map((attachment) => (
                    <div className="attachment-row" key={attachment.id}>
                      <FileText size={18} />
                      <div>
                        <strong>{attachment.filename}</strong>
                        <span>{formatAttachmentSize(attachment.byteSize)}</span>
                      </div>
                      <button
                        className="icon-button attachment-download-button"
                        type="button"
                        aria-label={`Download attachment ${attachment.filename}`}
                        title={`Download ${attachment.filename}`}
                        disabled={attachmentDownloadBusyId === attachment.id}
                        onClick={() => void downloadMessageAttachment(attachment)}
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  ))
                : previewAttachments.map((attachment) => (
                    <div className="attachment-row" key={attachment.name}>
                      <FileText size={18} />
                      <div>
                        <strong>{attachment.name}</strong>
                        <span>{attachment.size}</span>
                      </div>
                    </div>
                  ))}
            </div>

            <div className="reply-toolbox">
              <div className="composer-top">
                <span>
                  From:{" "}
                  {selectedComposeIdentity
                    ? formatSendIdentity(selectedComposeIdentity)
                    : "当前账号"}
                </span>
                <button
                  type="button"
                  aria-label="Ask Hermes to draft reply"
                  disabled={composeBusy}
                  onClick={() => void askHermesForReplyDraft()}
                >
                  Hermes 写回复
                </button>
              </div>
              <div className="quick-reply-row" aria-label="Hermes 快速回复">
                {quickReplyActions.map((action) => (
                  <button
                    key={action.scenario}
                    type="button"
                    aria-label={`Ask Hermes quick reply ${action.scenario}`}
                    disabled={composeBusy}
                    onClick={() => void askHermesForQuickReply(action)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function focusComposeTarget(target: "to" | "body"): void {
  const elementId = target === "to" ? "compose-recipients" : "compose-body";
  document.getElementById(elementId)?.focus();
}

function previewSendIdentities(accountId: string): MailSendIdentityDto[] {
  return [
    {
      id: "account:preview",
      accountId,
      from: { address: "work@demo.site", name: "Work" },
      source: "account",
      isDefault: true,
      verified: true,
    },
  ];
}

function upsertSendIdentityCandidate(
  candidates: MailSendIdentityCandidateDto[],
  candidate: MailSendIdentityCandidateDto,
): MailSendIdentityCandidateDto[] {
  const next = candidates.filter((item) => item.id !== candidate.id);
  return [...next, candidate].sort((left, right) =>
    left.from.address.localeCompare(right.from.address),
  );
}

function formatSendIdentity(identity: MailSendIdentityDto): string {
  const label = identity.from.name
    ? `${identity.from.name} <${identity.from.address}>`
    : identity.from.address;
  const markers = [
    ...(identity.isDefault ? ["默认"] : []),
    ...(identity.source === "domain_alias" ? ["域名别名"] : []),
    ...(identity.source === "provider_native"
      ? [providerNativeIdentityLabel(identity)]
      : []),
  ];
  return markers.length > 0 ? `${label} · ${markers.join(" · ")}` : label;
}

function translationLanguageLabel(value: string): string {
  return (
    READER_TRANSLATION_LANGUAGES.find((language) => language.value === value)?.label ??
    value
  );
}

function hermesOrganizationApplyActions(
  result: ReaderHermesOrganizationResult,
): HermesOrganizationApplyAction[] {
  const actions = new Map<string, HermesOrganizationApplyAction>();
  const add = (action: HermesOrganizationApplyAction) => {
    if (!actions.has(action.id)) {
      actions.set(action.id, action);
    }
  };

  for (const action of result.labels.actions) {
    if (action.type === "archive") {
      add({ id: "mail:archive", kind: "mail", action: "archive", label: "归档" });
    }
    if (action.type === "move_to_feed") {
      add({
        id: "smart_inbox:move_to_feed",
        kind: "smart_inbox",
        action: "move_to_feed",
        label: "移到 Feed",
      });
    }
    if (action.type === "mark_important") {
      add({
        id: "smart_inbox:mark_important",
        kind: "smart_inbox",
        action: "mark_important",
        label: "标为重要",
      });
    }
  }

  for (const action of result.newsletter.actions) {
    if (action.type === "archive") {
      add({ id: "mail:archive", kind: "mail", action: "archive", label: "归档" });
    }
    if (action.type === "move_to_feed") {
      add({
        id: "smart_inbox:move_to_feed",
        kind: "smart_inbox",
        action: "move_to_feed",
        label: "移到 Feed",
      });
    }
    if (action.type === "mark_not_important") {
      add({
        id: "smart_inbox:mark_not_important",
        kind: "smart_inbox",
        action: "mark_not_important",
        label: "降低优先级",
      });
    }
  }

  return [...actions.values()];
}

function hermesOrganizationUnsupportedActionCount(
  result: ReaderHermesOrganizationResult,
): number {
  const unsupportedLabelActions = result.labels.actions.filter(
    (action) =>
      action.type === "apply_label" ||
      action.type === "snooze" ||
      action.type === "keep_in_inbox",
  ).length;
  const unsupportedNewsletterActions = result.newsletter.actions.filter(
    (action) => action.type === "unsubscribe_later" || action.type === "keep_in_inbox",
  ).length;
  return unsupportedLabelActions + unsupportedNewsletterActions;
}

function hermesActionItemKey(
  item: ReaderHermesOrganizationResult["actionItems"]["items"][number],
  index: number,
): string {
  return `${index}:${item.title}:${item.dueAt ?? item.dueText ?? ""}`;
}

function hermesActionItemApplyId(
  item: ReaderHermesOrganizationResult["actionItems"]["items"][number],
  index: number,
): string {
  return `followup:${hermesActionItemKey(item, index)}`;
}

function formatHermesActionItemNote(
  item: ReaderHermesOrganizationResult["actionItems"]["items"][number],
): string {
  return [
    item.owner ? `Owner: ${item.owner}` : undefined,
    item.priority ? `Priority: ${item.priority}` : undefined,
    item.status ? `Status: ${item.status}` : undefined,
    item.sourceQuote ? `Source: ${item.sourceQuote}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHermesLabelAction(
  action: ReaderHermesOrganizationResult["labels"]["actions"][number],
): string {
  const actionLabels: Record<typeof action.type, string> = {
    apply_label: "应用标签",
    archive: "归档",
    snooze: "稍后",
    keep_in_inbox: "保留收件箱",
    move_to_feed: "移入 Feed",
    mark_important: "标为重要",
  };
  const target = action.label ?? action.snoozeUntil;
  const base = target ? `${actionLabels[action.type]} ${target}` : actionLabels[action.type];
  return action.reason ? `${base}（${action.reason}）` : base;
}

function formatHermesNewsletterAction(
  action: ReaderHermesOrganizationResult["newsletter"]["actions"][number],
): string {
  const actionLabels: Record<typeof action.type, string> = {
    move_to_feed: "移入 Feed",
    archive: "归档",
    unsubscribe_later: "稍后退订",
    keep_in_inbox: "保留收件箱",
    mark_not_important: "降低优先级",
  };
  const base = action.unsubscribeUrl
    ? `${actionLabels[action.type]} ${action.unsubscribeUrl}`
    : actionLabels[action.type];
  return action.reason ? `${base}（${action.reason}）` : base;
}

function formatSendIdentityCandidateState(
  candidate: MailSendIdentityCandidateDto,
): string {
  if (candidate.verificationState === "verified" && candidate.enabled) {
    return "已验证";
  }
  if (candidate.verificationState === "failed") {
    return candidate.verificationError
      ? `失败 ${candidate.verificationError}`
      : "失败";
  }
  if (candidate.verificationState === "pending") {
    return "待验证";
  }
  return "未验证";
}

function formatSendIdentityTargetState(
  candidate: MailSendIdentityCandidateDto,
): string {
  if (
    candidate.sendMailTargetMode === "users" &&
    candidate.userSendMailEligible
  ) {
    return "共享发件箱已启用";
  }
  if (candidate.userTargetVerificationError) {
    return `目标失败 ${candidate.userTargetVerificationError}`;
  }
  if (candidate.verificationState === "verified" && candidate.enabled) {
    return "可选目标邮箱";
  }
  return "先验证 From";
}

function candidateTargetMailboxValue(
  candidate: MailSendIdentityCandidateDto,
): string {
  return (
    candidate.targetMailbox?.userPrincipalName ??
    candidate.targetMailbox?.userId ??
    candidate.from.address
  );
}

function mergeGraphTargetMailboxValues(
  current: Record<string, string>,
  candidates: MailSendIdentityCandidateDto[],
): Record<string, string> {
  const next = { ...current };
  for (const candidate of candidates) {
    if (!next[candidate.id]) {
      next[candidate.id] = candidateTargetMailboxValue(candidate);
    }
  }
  return next;
}

function providerNativeIdentityLabel(identity: MailSendIdentityDto): string {
  const provider = identity.provider ? providerLabel(identity.provider) : "服务商";
  const typeLabel: Partial<Record<NonNullable<MailSendIdentityDto["identityType"]>, string>> = {
    alias: "授权别名",
    shared_mailbox: "共享邮箱",
    send_on_behalf: "代表发送",
    group: "群组身份",
  };
  const suffix = identity.identityType
    ? typeLabel[identity.identityType]
    : undefined;
  return suffix ? `${provider}${suffix}` : `${provider}授权`;
}

function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "gmail" || normalized === "google") {
    return "Gmail";
  }
  if (
    normalized === "graph" ||
    normalized === "outlook" ||
    normalized === "microsoft"
  ) {
    return "Outlook";
  }
  return provider.trim() || "服务商";
}

function formatComposeAddressList(addresses: Array<{ address: string; name?: string }>): string {
  return addresses
    .map((address) =>
      address.name ? `${address.name} <${address.address}>` : address.address,
    )
    .join(", ");
}

function composeDraftSignature(input: ComposeDraftSignatureInput): string {
  return JSON.stringify({
    accountId: input.accountId,
    from: input.from ? normalizedComposeAddress(input.from) : null,
    to: input.to.map(normalizedComposeAddress),
    cc: input.cc.map(normalizedComposeAddress),
    bcc: input.bcc.map(normalizedComposeAddress),
    subject: input.subject.trim(),
    bodyText: input.bodyText.trim(),
    source: input.source,
    attachments: (input.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      source: attachment.source,
      attachmentId: attachment.attachmentId,
      storageKey: attachment.storageKey ?? null,
      filename: attachment.filename,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      inline: attachment.inline,
      contentId: attachment.contentId ?? null,
    })),
    replyToMessageId: input.replyToMessageId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    hermesSkillRunId: input.hermesSkillRunId ?? null,
    hermesDraftText: input.hermesDraftText ?? null,
  });
}

function composeDraftSignatureFromDraft(draft: MailDraftDto): string {
  return composeDraftSignature({
    accountId: draft.accountId,
    from: draft.from,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    bodyText: draft.bodyText ?? "",
    source: draft.source,
    attachments: draft.attachments,
    replyToMessageId: draft.replyToMessageId,
    sourceMessageId: draft.sourceMessageId,
    hermesSkillRunId: draft.hermesSkillRunId,
    hermesDraftText: draft.hermesDraftText,
  });
}

function normalizedComposeAddress(address: { address: string; name?: string }) {
  const name = address.name?.trim();
  return {
    address: address.address.trim().toLowerCase(),
    ...(name ? { name } : {}),
  };
}

function formatComposeAutosaveStatus(status: ComposeAutosaveStatus): string {
  switch (status) {
    case "pending":
      return "自动保存待处理";
    case "saving":
      return "自动保存中";
    case "saved":
      return "已自动保存";
    case "error":
      return "自动保存失败";
    case "idle":
      return "";
  }
}

function formatComposeWarnings(
  warnings: MailComposePreviewDto["warnings"],
): string {
  const labels: Record<MailComposePreviewDto["warnings"][number], string> = {
    missing_recipient: "缺少收件人",
    missing_body: "缺少正文",
    missing_subject: "缺少主题",
    large_body: "正文过大",
  };
  return warnings.map((warning) => labels[warning]).join("，");
}

function providerCapabilityToOption(
  capability: MailProviderCapabilityDto,
): ProviderOption {
  return {
    title: capability.label,
    subtitle: capability.connectionLabel,
    mark: providerMark(capability),
    provider: capability.provider,
    action: providerAction(capability),
  };
}

function providerAction(
  capability: MailProviderCapabilityDto,
): ProviderOption["action"] {
  if (capability.supportsWebLogin) {
    return "oauth";
  }
  if (capability.requiresLocalBridge) {
    return "bridge";
  }
  if (capability.accountGroup === "domain") {
    return "manual";
  }

  return "password";
}

function providerMark(capability: MailProviderCapabilityDto): string {
  const knownMarks: Record<string, string> = {
    gmail: "G",
    outlook: "O",
    "163": "163",
    qq: "QQ",
    icloud: "iC",
    proton_bridge: "P",
    tencent_exmail: "企",
    custom_domain: "@",
  };

  return knownMarks[capability.provider] ?? capability.label.slice(0, 2);
}

interface CustomServerFields {
  username: string;
  secret: string;
  receiveHost: string;
  receivePort: string;
  receiveSecure: boolean;
  sendHost: string;
  sendPort: string;
  sendSecure: boolean;
}

function AddMailPage(props: {
  api?: EmailHubApi;
  providerGroupId?: AddMailProviderGroupId;
  oauthRedirect: (url: string) => void;
  onConnected?: (accountId?: string) => void;
  onOpenSyncCenter?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [manualProvider, setManualProvider] = useState<ProviderOption | undefined>();
  const [customServerFields, setCustomServerFields] =
    useState<CustomServerFields>({
      username: "",
      secret: "",
      receiveHost: "",
      receivePort: "993",
      receiveSecure: true,
      sendHost: "",
      sendPort: "465",
      sendSecure: true,
    });
  const [busyProvider, setBusyProvider] = useState("");
  const [diagnostics, setDiagnostics] = useState<OperationalEventDto[]>([]);
  const [onboardingRecoveryDiagnostics, setOnboardingRecoveryDiagnostics] =
    useState<ImapSmtpConnectionDiagnostic[]>([]);
  const [mailEngineHealth, setMailEngineHealth] =
    useState<MailEngineHealthDto | undefined>();
  const [providerOptions, setProviderOptions] =
    useState<ProviderOption[]>(providers);
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

  useEffect(() => {
    if (!props.api) {
      setProviderOptions(providers);
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
        setProviderOptions(nextProviders.length > 0 ? nextProviders : providers);
      })
      .catch(() => {
        if (!cancelled) {
          setProviderOptions(providers);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineHealth(undefined);
      return;
    }

    let cancelled = false;
    props.api
      .getMailEngineHealth()
      .then((health) => {
        if (!cancelled) {
          setMailEngineHealth(health);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMailEngineHealth(undefined);
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

  const visibleProviders = providerOptions.filter((provider) =>
    props.providerGroupId
      ? addMailProviderGroupProviders[props.providerGroupId].includes(
          provider.provider,
        )
      : true,
  );

  async function connectProvider(provider: ProviderOption) {
    if (!props.api) {
      setNotice(`${provider.title} 连接服务还没有准备好。`);
      return;
    }

    if (provider.action === "oauth") {
      setBusyProvider(provider.provider);
      try {
        const result = await props.api.startOAuthAccount({
          provider: provider.provider === "outlook" ? "outlook" : "gmail",
          redirectUri: `${window.location.origin}/oauth/callback`,
        });
        storeOAuthPendingState(result.state, {
          provider: result.provider,
          returnTo: "add-mail",
          createdAt: new Date().toISOString(),
        });
        props.oauthRedirect(result.authorizationUrl);
      } catch {
        await loadOnboardingDiagnostics();
        setNotice(`${provider.title} 暂时无法开始连接。`);
      } finally {
        setBusyProvider("");
      }
      return;
    }

    if (provider.action === "manual") {
      setManualProvider(provider);
      setNotice(`${provider.title} 需要填写收信和发信服务器信息。`);
      return;
    }

    const input = buildPresetOnboardingInput(provider, {
      email,
      username,
      secret,
    });
    if (!input) {
      setNotice(`${provider.title} 需要先填写邮箱和授权码。`);
      return;
    }

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
            ? `${provider.title} 连接检查没有通过，请按提示处理。`
            : `${provider.title} 连接检查没有通过，请检查邮箱地址、授权码和收发信服务器。`,
        );
        return;
      }

      const result = await props.api.onboardImapSmtpAccount(input);
      props.onConnected?.(result.account?.id);
      setOnboardingRecoveryDiagnostics([]);
      setSecret("");
      setNotice(`${provider.title} 已接入，同步会自动开始。`);
    } catch {
      await loadOnboardingDiagnostics();
      setOnboardingRecoveryDiagnostics([]);
      setSecret("");
      setNotice(
        `${provider.title} 暂时无法接入，连接信息未保存。请重新检查授权码或稍后再试。`,
      );
    } finally {
      setBusyProvider("");
    }
  }

  async function connectManualProvider() {
    if (!props.api || !manualProvider) {
      return;
    }

    const input = buildManualOnboardingInput(manualProvider, {
      email,
      fields: customServerFields,
    });
    if (!input) {
      setNotice(`${manualProvider.title} 需要填写邮箱、服务器、用户名和密码。`);
      return;
    }

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
            ? `${manualProvider.title} 连接检查没有通过，请按提示处理。`
            : `${manualProvider.title} 连接检查没有通过，请检查邮箱地址、授权码和收发信服务器。`,
        );
        return;
      }

      const result = await props.api.onboardImapSmtpAccount(input);
      props.onConnected?.(result.account?.id);
      setOnboardingRecoveryDiagnostics([]);
      clearCustomServerSecret();
      setNotice(`${manualProvider.title} 已接入，同步会自动开始。`);
    } catch {
      await loadOnboardingDiagnostics();
      setOnboardingRecoveryDiagnostics([]);
      clearCustomServerSecret();
      setNotice(
        `${manualProvider.title} 暂时无法接入，连接信息未保存。请重新检查授权码或稍后再试。`,
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

  function clearCustomServerSecret() {
    setCustomServerFields((current) => ({ ...current, secret: "" }));
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
      setBulkNotice("连接服务后才能预览批量导入。");
      return;
    }
    if (!csvImportText.trim()) {
      setBulkNotice("请先粘贴 CSV 内容。");
      return;
    }

    setBulkBusy("csv-preview");
    try {
      const result = await props.api.previewAccountCsv({ csv: csvImportText });
      setCsvPreview(result);
      setCsvImportResult(undefined);
      setBulkNotice(
        `预览完成：${result.summary.ready} 个可接入，${result.summary.needsOAuth} 个需要登录，${result.summary.invalid} 个需要修正。`,
      );
    } catch {
      setBulkNotice("CSV 预览失败，请检查表头和行内容。");
    } finally {
      setBulkBusy("");
    }
  }

  async function createCsvImport() {
    if (!props.api) {
      setBulkNotice("连接服务后才能创建批量导入任务。");
      return;
    }
    if (!csvImportText.trim()) {
      setBulkNotice("请先粘贴 CSV 内容。");
      return;
    }

    setBulkBusy("csv-import");
    try {
      const result = await props.api.createAccountCsvImport({ csv: csvImportText });
      setCsvPreview(result);
      setCsvImportResult(result);
      setBulkNotice(
        `已创建 ${result.createdTaskCount} 个导入任务，${result.summary.needsOAuth} 个需要在同步中心继续授权。`,
      );
      props.onConnected?.();
    } catch {
      setBulkNotice("导入任务创建失败，请检查 CSV 内容。");
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
      setBulkNotice("连接服务后才能继续授权。");
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
        returnTo: "add-mail",
        createdAt: new Date().toISOString(),
      });
      props.oauthRedirect(result.authorizationUrl);
    } catch {
      setBulkNotice(`${task.email} 授权暂时无法开始，请稍后再试。`);
    } finally {
      setBusyImportTaskId("");
    }
  }

  async function exportTransferPackage() {
    if (!props.api) {
      setBulkNotice("连接服务后才能导出账号配置。");
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
      setBulkNotice("连接服务后才能导入迁移包。");
      return;
    }
    if (!transferPackageText.trim()) {
      setBulkNotice("请先粘贴迁移包 JSON。");
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
      setBulkNotice("迁移包导入失败，请检查格式和账号字段。");
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
    (csvImportResult?.summary.needsOAuth ?? 0) > 0 ||
    (transferImportResult?.reauthRequiredCount ?? 0) > 0;

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar">
        <div>
          <h1>添加邮箱</h1>
          <p>选择要接入的邮箱，按提示登录或填写必要信息。</p>
        </div>
      </header>

      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}

      {mailEngineHealth ? (
        <MailEngineReadinessPanel health={mailEngineHealth} />
      ) : null}

      {onboardingRecoveryDiagnostics.length > 0 ? (
        <section
          className="page-panel diagnostic-list connection-diagnostic-list"
          aria-label="添加邮箱恢复建议"
        >
          <h2>恢复建议</h2>
          {onboardingRecoveryDiagnostics.map((diagnostic) => (
            <div
              className="diagnostic-row connection-diagnostic-row"
              key={`${diagnostic.provider}:${diagnostic.affected}:${diagnostic.code}`}
            >
              <div>
                <strong>{formatConnectionDiagnosticTitle(diagnostic)}</strong>
                <span>
                  {formatProviderLabel(diagnostic.provider)} ·{" "}
                  {formatConnectionDiagnosticScope(diagnostic)}
                </span>
                <p>{formatConnectionDiagnosticAction(diagnostic)}</p>
              </div>
            </div>
          ))}
        </section>
      ) : null}

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
        <label>
          <span>登录用户名</span>
          <input
            aria-label="Add mail username"
            value={username}
            placeholder="不填则使用邮箱地址"
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>授权码或专用密码</span>
          <input
            aria-label="Add mail secret"
            value={secret}
            type="password"
            placeholder="用于连接邮箱"
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </label>
      </section>

      {manualProvider ? (
        <section className="page-panel custom-server-form" aria-label="个人域名邮箱服务器">
          <div className="custom-server-heading">
            <div>
              <h2>{manualProvider.title}</h2>
              <p>填写收信和发信服务器，系统会先测试连接，再开始同步。</p>
            </div>
            <button
              type="button"
              disabled={busyProvider === manualProvider.provider}
              onClick={() => void connectManualProvider()}
            >
              {busyProvider === manualProvider.provider
                ? "正在测试"
                : `测试并接入${manualProvider.title}`}
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
          <article key={provider.title} className="provider-card">
            <ProviderIcon provider={provider.provider} title={provider.title} mark={provider.mark} />
            <div>
              <strong>{provider.title}</strong>
              <span>{provider.subtitle}</span>
            </div>
            <button
              type="button"
              aria-label={`连接 ${provider.title}`}
              disabled={busyProvider === provider.provider}
              onClick={() => void connectProvider(provider)}
            >
              {busyProvider === provider.provider ? "连接中" : "连接"}
            </button>
          </article>
        ))}
      </div>

      <section className="page-panel import-transfer-panel" aria-label="批量导入和账号转移">
        <div className="custom-server-heading">
          <div>
            <h2>批量导入 / 账号转移</h2>
            <p>CSV 先预览再创建任务；迁移包只保存安全配置，导入后从同步中心重新授权。</p>
          </div>
          {showSyncCenterAction ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => props.onOpenSyncCenter?.()}
            >
              打开同步中心授权
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
              <span>连接服务后会列出可导出的账号。</span>
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
            busyTaskId={busyImportTaskId}
            onOpenSyncCenter={props.onOpenSyncCenter}
            onStartOAuthTask={(task) => void startImportedOAuthTask(task)}
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
      </section>

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

function MailEngineReadinessPanel(props: { health: MailEngineHealthDto }) {
  const degraded = props.health.readiness.status === "degraded";
  return (
    <section
      className={`page-panel mail-engine-readiness ${
        degraded ? "is-degraded" : "is-ready"
      }`}
      aria-label="EmailEngine 上线体检"
    >
      <div>
        <strong>
          {degraded ? "EmailEngine 上线还差配置" : "EmailEngine 接入就绪"}
        </strong>
        <span>{props.health.readiness.summary}</span>
      </div>
      <div className="mail-engine-readiness-grid">
        <p>
          <strong>
            {formatMailEngineHttpStatus(props.health.checks?.http ?? "skipped")}
          </strong>
          <span>运行探测</span>
        </p>
        <p>
          <strong>
            {props.health.capabilities.accessTokenConfigured ? "已配置" : "缺少"}
          </strong>
          <span>访问令牌</span>
        </p>
        <p>
          <strong>
            {props.health.capabilities.imapSmtpOnboarding ? "可用" : "不可用"}
          </strong>
          <span>邮箱接入</span>
        </p>
        <p>
          <strong>{props.health.capabilities.send ? "可用" : "不可用"}</strong>
          <span>发信链路</span>
        </p>
      </div>
      {props.health.readiness.setupActions.length > 0 ? (
        <div className="mail-engine-setup-actions">
          {props.health.readiness.setupActions.map((action) => (
            <div key={action.code}>
              <strong>{action.label}</strong>
              <span>{action.env.join(" / ")}</span>
              <p>{action.effect}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatMailEngineHttpStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["http"],
): string {
  if (status === "ok") {
    return "可达";
  }

  if (status === "unavailable") {
    return "不可达";
  }

  return "未探测";
}

function CsvImportPreviewTable(props: {
  result: AccountImportPreview;
  createdTaskCount?: number;
  createdTasks?: AccountImportCreateResult["tasks"];
  busyTaskId?: string;
  onOpenSyncCenter?: () => void;
  onStartOAuthTask?: (task: AccountImportCreateResult["tasks"][number]) => void;
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
          <strong>{props.result.summary.needsOAuth}</strong>
          <span>需要登录</span>
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
                    {createdTask?.authMethod === "oauth" ? (
                      <button
                        className="table-action-button"
                        type="button"
                        aria-label={`Continue authorization for row ${row.rowNumber} ${createdTask.email}`}
                        disabled={props.busyTaskId === createdTask.id}
                        onClick={() => props.onStartOAuthTask?.(createdTask)}
                      >
                        继续授权
                      </button>
                    ) : (
                      formatCsvImportNextAction(
                        row,
                        props.createdTaskCount !== undefined,
                        createdTask,
                      )
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
              aria-label={`Continue authorization for ${task.email}`}
              disabled={props.busyTaskId === task.id}
              onClick={() => props.onStartOAuthTask?.(task)}
            >
              继续授权
            </button>
          ) : (
            <button
              className="ghost-button"
              type="button"
              aria-label={`Open Sync Center for ${task.email}`}
              onClick={() => props.onOpenSyncCenter?.()}
            >
              去同步中心
            </button>
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
  const issues = [...row.errors, ...row.warnings];
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
    return tasksCreated ? "等待授权任务" : "创建任务后授权";
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

function buildPresetOnboardingInput(
  provider: ProviderOption,
  fields: { email: string; username: string; secret: string },
): ImapSmtpOnboardingInput | undefined {
  const email = fields.email.trim();
  const secret = fields.secret.trim();
  if (!email || !secret) {
    return undefined;
  }

  return {
    email,
    provider: provider.provider,
    secret,
    ...(fields.username.trim() ? { username: fields.username.trim() } : {}),
  };
}

function buildManualOnboardingInput(
  provider: ProviderOption,
  input: { email: string; fields: CustomServerFields },
): ImapSmtpOnboardingInput | undefined {
  const email = input.email.trim();
  const username = input.fields.username.trim() || email;
  const secret = input.fields.secret.trim();
  const receiveHost = input.fields.receiveHost.trim();
  const sendHost = input.fields.sendHost.trim();
  const receivePort = toServerPort(input.fields.receivePort);
  const sendPort = toServerPort(input.fields.sendPort);

  if (
    !email ||
    !username ||
    !secret ||
    !receiveHost ||
    !sendHost ||
    !receivePort ||
    !sendPort
  ) {
    return undefined;
  }

  return {
    email,
    provider: provider.provider === "custom" ? "custom_domain" : provider.provider,
    imap: {
      host: receiveHost,
      port: receivePort,
      secure: input.fields.receiveSecure,
      username,
      secret,
    },
    smtp: {
      host: sendHost,
      port: sendPort,
      secure: input.fields.sendSecure,
      username,
      secret,
    },
  };
}

function toServerPort(value: string): number | undefined {
  const port = Number(value.trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function friendlyDiagnosticMessage(event: OperationalEventDto): string {
  if (event.event === "account_onboarding_connection_test_failed") {
    return "连接检查没有通过";
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
    return "连接检查没有通过";
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
    sync_account_failed: "同步任务没有完成",
    sync_account_dead_lettered: "同步任务多次失败",
    reauthorization_imap_smtp_failed: "重新授权没有通过",
    native_send_reauthorization_required: "发信权限需要重新授权",
    smtp_send_reauthorization_required: "发信权限需要重新提交授权码",
  };
  return labels[event.event] ?? friendlyDiagnosticMessage(event);
}

function friendlySyncDiagnosticDetail(event: OperationalEventDto): string | undefined {
  if (event.event === "emailengine_webhook_ingested") {
    return "系统已收到邮箱服务回调，正在按本地同步状态处理。";
  }
  if (event.event === "reauthorization_imap_smtp_failed") {
    return "请检查授权码、专用密码和自定义服务器设置后重新提交。";
  }
  if (event.event.includes("reauthorization_required")) {
    return "请从上方重新授权入口恢复这个账号。";
  }

  return event.message;
}

function ProviderIcon(props: { provider: string; title: string; mark: string }) {
  const source = providerIconSources[props.provider];

  if (source) {
    return (
      <div className="provider-icon official-icon" aria-label={`${props.title} 图标`}>
        <img src={source} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </div>
    );
  }

  if (props.provider === "custom") {
    return (
      <div className="provider-icon custom-icon" aria-label={`${props.title} 图标`}>
        <AtSign size={22} />
      </div>
    );
  }

  return (
    <div className={`provider-icon ${props.provider}-icon`} aria-label={`${props.title} 图标`}>
      <span>{props.mark}</span>
    </div>
  );
}

function formatProviderLabel(provider: string) {
  const labels: Record<string, string> = {
    gmail: "Gmail",
    outlook: "Outlook",
    icloud: "iCloud",
    proton: "Proton",
    proton_bridge: "Proton Mail",
    qq: "QQ 邮箱",
    "163": "163 邮箱",
    tencent_exmail: "腾讯企业邮箱",
    custom: "个人域名",
    custom_domain: "个人域名",
    graph: "Outlook",
  };
  return labels[provider] ?? provider;
}

function isHermesProviderRuntimeSelectable(
  provider: HermesProviderCatalogItem,
): boolean {
  return (
    provider.requestProtocol !== "external_oauth" &&
    provider.requestProtocol !== "aws_bedrock" &&
    provider.authType !== "oauth" &&
    provider.authType !== "aws_credentials"
  );
}

function formatHermesMissingFields(fields: HermesProviderProbeMissing[]): string {
  const labels: Record<HermesProviderProbeMissing, string> = {
    endpoint_url: "服务地址",
    model: "模型名称",
    api_key: "访问密钥",
    oauth_session: "外部登录",
    aws_credentials: "云服务凭证",
  };
  return fields.map((field) => labels[field]).join("、");
}

function formatHermesMemoryLayer(layer: string) {
  const labels: Record<string, string> = {
    writing_style_profile: "写作风格",
    contact_memory: "联系人偏好",
    procedural_memory: "处理规则",
    semantic_profile: "语义偏好",
  };
  return labels[layer] ?? layer;
}

function formatHermesMemoryContent(content: Record<string, unknown>) {
  return JSON.stringify(content, null, 2);
}

function parseHermesMemoryContent(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hermes memory content must be an object.");
  }

  return parsed as Record<string, unknown>;
}

function parseHermesMemoryConfidence(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : undefined;
}

function formatSyncStateLabel(state: string) {
  if (state === "paused") {
    return "已暂停";
  }

  const labels: Record<string, string> = {
    preview: "预览",
    syncing: "正在同步",
    connected: "已连接",
    reauth_required: "需要重新登录",
    error: "需要处理",
    idle: "等待同步"
  };
  return labels[state] ?? state;
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

function formatOperationalEventLevel(level: OperationalEventDto["level"]) {
  const labels: Record<OperationalEventDto["level"], string> = {
    debug: "调试",
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

function apiErrorConnectionDiagnostics(
  error: unknown,
): ImapSmtpConnectionDiagnostic[] {
  if (!(error instanceof ApiRequestError)) {
    return [];
  }

  return error.diagnostics?.filter(isImapSmtpConnectionDiagnostic) ?? [];
}

function connectionDiagnosticsFromTestResult(
  result: ImapSmtpConnectionTestResult,
): ImapSmtpConnectionDiagnostic[] {
  return result.diagnostics?.filter(isImapSmtpConnectionDiagnostic) ?? [];
}

function isImapSmtpConnectionDiagnostic(
  value: unknown,
): value is ImapSmtpConnectionDiagnostic {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.code === "string" &&
    typeof value.provider === "string" &&
    value.severity === "action_required" &&
    (value.affected === "account" ||
      value.affected === "imap" ||
      value.affected === "smtp") &&
    typeof value.message === "string" &&
    typeof value.recoveryAction === "string"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConnectionDiagnosticTitle(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<string, string> = {
    proton_bridge_unreachable: "Proton Bridge 未连接",
    mail_server_unreachable: "邮箱服务连接不上",
    mail_credentials_rejected: "授权信息被拒绝",
    icloud_app_specific_password_required: "需要 Apple 专用密码",
    qq_authorization_code_required: "需要 QQ 邮箱授权码",
    netease_163_authorization_code_required: "需要 163 邮箱授权码",
  };

  return labels[diagnostic.code] ?? "连接设置需要处理";
}

function formatConnectionDiagnosticAction(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<string, string> = {
    start_proton_bridge: "请启动 Proton Bridge 并保持登录后重试。",
    check_mail_server_connection: "请检查收信/发信服务器、端口和网络后重试。",
    check_mailbox_credentials: "请确认邮箱地址、用户名和授权码或专用密码。",
    create_apple_app_specific_password: "请在 Apple ID 中创建 App 专用密码后重试。",
    enable_qq_mail_authorization_code:
      "请在 QQ 邮箱设置里开启服务并使用生成的授权码。",
    enable_163_mail_authorization_code:
      "请在 163 邮箱设置里开启客户端授权并使用生成的授权码。",
  };

  return labels[diagnostic.recoveryAction] ?? "请按邮箱服务商的授权要求处理后重试。";
}

function formatConnectionDiagnosticScope(
  diagnostic: ImapSmtpConnectionDiagnostic,
): string {
  const labels: Record<ImapSmtpConnectionDiagnostic["affected"], string> = {
    account: "账号",
    imap: "收信",
    smtp: "发信",
  };

  return labels[diagnostic.affected];
}

function formatDomainStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "待确认",
    verified: "已确认",
    failed: "需处理"
  };
  return labels[status] ?? status;
}

function formatDeliveryStatus(status: string) {
  const labels: Record<string, string> = {
    accepted: "已接收",
    matched: "已匹配",
    queued: "排队中",
    delivered: "已送达",
    deferred: "稍后重试",
    bounced: "退回",
    dropped: "已丢弃"
  };
  return labels[status] ?? status;
}

function SyncCenterPage(props: {
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
  const [busyAction, setBusyAction] = useState("");
  const [busyReauthorizationTaskId, setBusyReauthorizationTaskId] = useState("");
  const [diagnosticAccount, setDiagnosticAccount] =
    useState<SyncCenterAccountDto | null>(null);
  const [diagnosticEvents, setDiagnosticEvents] = useState<OperationalEventDto[]>(
    [],
  );
  const [diagnosticNotice, setDiagnosticNotice] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [mailEngineHealth, setMailEngineHealth] =
    useState<MailEngineHealthDto | undefined>();

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
      setNotice("连接服务后才能处理同步。");
      return;
    }

    const actionKey = `${account.accountId}:${action}`;
    setBusyAction(actionKey);
    try {
      if (action === "resync") {
        const result = await props.api.requestSyncCenterResync({
          accountId: account.accountId,
        });
        setNotice(`重新同步已加入队列：${result.job.status}`);
        return;
      }

      if (action === "pause") {
        const result = await props.api.pauseSyncCenterAccount({
          accountId: account.accountId,
        });
        mergeAccountState(result.account);
        setNotice("同步已暂停。");
        return;
      }

      if (action === "resume") {
        const result = await props.api.resumeSyncCenterAccount({
          accountId: account.accountId,
        });
        mergeAccountState(result.account);
        setNotice("同步已恢复。");
        return;
      }

      const result = await props.api.retryFailedSyncCenterJobs({
        accountId: account.accountId,
      });
      setNotice(`已重新排队 ${result.retriedJobCount} 个失败任务。`);
    } catch {
      setNotice("同步操作暂时失败，请稍后再试。");
    } finally {
      setBusyAction("");
    }
  }

  async function openAccountDiagnostics(account: SyncCenterAccountDto) {
    setDiagnosticAccount(account);

    if (!props.api) {
      setDiagnosticEvents([]);
      setDiagnosticNotice("连接服务后才能查看同步诊断。");
      return;
    }

    setDiagnosticBusy(true);
    setDiagnosticNotice("正在加载同步诊断...");
    try {
      const page = await props.api.listSyncCenterAccountDiagnostics({
        accountId: account.accountId,
        limit: 200,
      });
      setDiagnosticEvents(page.items);
      setDiagnosticNotice(
        page.items.length === 0 ? "这个账号还没有同步诊断记录。" : "",
      );
    } catch {
      setDiagnosticEvents([]);
      setDiagnosticNotice("同步诊断暂时不可用。");
    } finally {
      setDiagnosticBusy(false);
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
        returnTo: "add-mail",
        createdAt: new Date().toISOString(),
      });
      props.oauthRedirect(result.authorizationUrl);
    } catch {
      setNotice("重新登录暂时无法开始，请稍后再试。");
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
          ? `${task.email} 重新授权没有通过，请按提示处理。`
          : `${task.email} 重新授权失败，请检查授权码和收发信服务器设置。`,
      );
    } finally {
      setBusyReauthorizationTaskId("");
    }
  }

  const [notice, setNotice] = useState("正在加载同步状态...");

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
      setNotice("正在显示本地预览，连接服务后会同步真实状态。");
      return;
    }

    let alive = true;
    setNotice("正在加载同步状态...");
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
          setNotice("同步中心暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineHealth(undefined);
      return;
    }

    let alive = true;
    props.api
      .getMailEngineHealth()
      .then((health) => {
        if (alive) {
          setMailEngineHealth(health);
        }
      })
      .catch(() => {
        if (alive) {
          setMailEngineHealth(undefined);
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>同步中心</h1>
          <p>查看连接状态、同步队列、失效账号和重新授权入口。</p>
        </div>
      </header>
      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}
      {mailEngineHealth ? (
        <MailEngineReadinessPanel health={mailEngineHealth} />
      ) : null}
      <section className="page-panel">
        {accounts.map((account) => (
          <div className="task-row" key={account.accountId}>
            <Clock3 size={19} />
            <div>
              <strong>{account.email}</strong>
              <span>{formatProviderLabel(account.provider)} · {formatSyncStateLabel(account.syncState)}</span>
            </div>
            <div className="task-actions">
              <button
                type="button"
                aria-label={
                  props.selectedAccountId === account.accountId
                    ? `Active account ${account.email}`
                    : `Use account ${account.email}`
                }
                disabled={props.selectedAccountId === account.accountId}
                onClick={() => props.onSelectAccount?.(account.accountId)}
              >
                {props.selectedAccountId === account.accountId ? "当前邮箱" : "使用此邮箱"}
              </button>
              <button
                type="button"
                aria-label={`Request resync for ${account.email}`}
                disabled={busyAction === `${account.accountId}:resync`}
                onClick={() => void runAccountAction(account, "resync")}
              >
                重新同步
              </button>
              <button
                type="button"
                aria-label={
                  account.syncState === "paused"
                    ? `Resume sync for ${account.email}`
                    : `Pause sync for ${account.email}`
                }
                disabled={
                  busyAction === `${account.accountId}:pause` ||
                  busyAction === `${account.accountId}:resume`
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
                aria-label={`Retry failed sync jobs for ${account.email}`}
                disabled={busyAction === `${account.accountId}:retry-failed`}
                onClick={() => void runAccountAction(account, "retry-failed")}
              >
                重试失败
              </button>
              <button
                type="button"
                aria-label={`View sync diagnostics for ${account.email}`}
                disabled={diagnosticBusy && diagnosticAccount?.accountId === account.accountId}
                onClick={() => void openAccountDiagnostics(account)}
              >
                查看诊断
              </button>
            </div>
          </div>
        ))}
      </section>
      {reauthorizations.length > 0 ? (
        <section className="page-panel" aria-label="需要重新授权">
          <div className="custom-server-heading">
            <div>
              <h2>需要重新授权</h2>
              <p>这些账号的登录或发信权限已失效，重新授权后会恢复同步和发送。</p>
            </div>
          </div>
          {reauthorizations.map((task) => {
            const passwordForm = passwordReauthorizationForm(task);
            const taskDiagnostics =
              reauthorizationDiagnostics[task.taskId] ?? [];
            return (
              <div
                className={`task-row ${task.authMethod === "password" ? "reauthorization-task-row" : ""}`}
                key={task.taskId}
              >
                <ShieldCheck size={19} />
                <div>
                  <strong>{task.email}</strong>
                  <span>
                    {formatProviderLabel(task.provider)} ·{" "}
                    {task.authMethod === "oauth" ? "重新登录" : "重新提交授权码"}
                    {task.source ? ` · ${formatReauthorizationSource(task.source)}` : ""}
                  </span>
                  {task.errorMessage ? <p>{task.errorMessage}</p> : null}
                </div>
                {task.authMethod === "oauth" ? (
                  <div className="task-actions">
                    <button
                      type="button"
                      aria-label={`Start reauthorization for ${task.email}`}
                      disabled={busyReauthorizationTaskId === task.taskId}
                      onClick={() => void startOAuthReauthorization(task)}
                    >
                      重新登录
                    </button>
                  </div>
                ) : (
                  <form
                    aria-label={`Mail server reauthorization for ${task.email}`}
                    className="reauthorization-form"
                    onSubmit={(event) =>
                      void completePasswordReauthorization(event, task)
                    }
                  >
                    <label>
                      <span>登录用户名</span>
                      <input
                        aria-label={`Reauthorization username for ${task.email}`}
                        autoComplete="username"
                        type="text"
                        value={passwordForm.username}
                        onChange={(event) =>
                          updatePasswordReauthorizationForm(task, {
                            username: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>授权码或专用密码</span>
                      <input
                        aria-label={`Reauthorization secret for ${task.email}`}
                        autoComplete="new-password"
                        type="password"
                        value={passwordForm.secret}
                        onChange={(event) =>
                          updatePasswordReauthorizationForm(task, {
                            secret: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label className="reauthorization-toggle">
                      <input
                        aria-label={`Use custom receiving and sending settings for ${task.email}`}
                        checked={passwordForm.useCustomServers}
                        type="checkbox"
                        onChange={(event) =>
                          updatePasswordReauthorizationForm(task, {
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
                            aria-label={`Receiving host for ${task.email}`}
                            type="text"
                            value={passwordForm.imapHost}
                            onChange={(event) =>
                              updatePasswordReauthorizationForm(task, {
                                imapHost: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>收信端口</span>
                          <input
                            aria-label={`Receiving port for ${task.email}`}
                            inputMode="numeric"
                            type="text"
                            value={passwordForm.imapPort}
                            onChange={(event) =>
                              updatePasswordReauthorizationForm(task, {
                                imapPort: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <label className="reauthorization-toggle">
                          <input
                            aria-label={`Receiving secure connection for ${task.email}`}
                            checked={passwordForm.imapSecure}
                            type="checkbox"
                            onChange={(event) =>
                              updatePasswordReauthorizationForm(task, {
                                imapSecure: event.currentTarget.checked,
                              })
                            }
                          />
                          <span>收信安全连接</span>
                        </label>
                        <label>
                          <span>发信主机</span>
                          <input
                            aria-label={`Sending host for ${task.email}`}
                            type="text"
                            value={passwordForm.smtpHost}
                            onChange={(event) =>
                              updatePasswordReauthorizationForm(task, {
                                smtpHost: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>发信端口</span>
                          <input
                            aria-label={`Sending port for ${task.email}`}
                            inputMode="numeric"
                            type="text"
                            value={passwordForm.smtpPort}
                            onChange={(event) =>
                              updatePasswordReauthorizationForm(task, {
                                smtpPort: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <label className="reauthorization-toggle">
                          <input
                            aria-label={`Sending secure connection for ${task.email}`}
                            checked={passwordForm.smtpSecure}
                            type="checkbox"
                            onChange={(event) =>
                              updatePasswordReauthorizationForm(task, {
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
                      aria-label={`Complete reauthorization for ${task.email}`}
                      disabled={busyReauthorizationTaskId === task.taskId}
                    >
                      提交重新授权
                    </button>
                  </form>
                )}
                {taskDiagnostics.length > 0 ? (
                  <div
                    className="reauthorization-diagnostics"
                    role="status"
                    aria-label={`Reauthorization diagnostics for ${task.email}`}
                  >
                    {taskDiagnostics.map((diagnostic) => (
                      <div
                        className="reauthorization-diagnostic-card"
                        key={`${diagnostic.affected}:${diagnostic.code}`}
                      >
                        <div>
                          <strong>{formatConnectionDiagnosticTitle(diagnostic)}</strong>
                          <span>
                            {formatProviderLabel(diagnostic.provider)} ·{" "}
                            {formatConnectionDiagnosticScope(diagnostic)}
                          </span>
                        </div>
                        <p>{formatConnectionDiagnosticAction(diagnostic)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
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
                  setDiagnosticAccount(null);
                  setDiagnosticEvents([]);
                  setDiagnosticNotice("");
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

function SearchPage(props: {
  api?: EmailHubApi;
  accountId: string;
  launch?: SearchLaunch;
  onOpenResult: (mail: MailItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MailItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [notice, setNotice] = useState("输入关键词后搜索所有已同步邮件。");
  const [searchAllAccounts, setSearchAllAccounts] = useState(true);
  const [quickFilters, setQuickFilters] = useState<MailQuickFilter[]>([]);
  const [qScopes, setQScopes] = useState<MailSearchScope[]>([
    "sender",
    "recipients",
    "subject",
    "body",
  ]);

  function toggleQuickFilter(filter: MailQuickFilter) {
    setQuickFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter],
    );
  }

  function toggleSearchScope(scope: MailSearchScope) {
    setQScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function executeSearch(rawQuery: string) {
    const trimmedQuery = rawQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      setHasSearched(false);
      setNotice("请输入要查找的关键词。");
      return;
    }

    if (!props.api) {
      setResults([
        {
          ...mailItems[0],
          subject: "关于 Q2 合作方案的确认",
          preview: "命中：合同、附件、客户标签",
        },
      ]);
      setHasSearched(true);
      setNotice("本地预览结果。连接后会搜索已同步邮件。");
      return;
    }

    if (!searchAllAccounts && !props.accountId) {
      setResults([]);
      setHasSearched(true);
      setNotice("请先选择一个邮箱，或切换为搜索所有邮箱。");
      return;
    }

    setNotice("正在搜索邮件...");
    try {
      const page = await props.api.listMessages({
        ...(searchAllAccounts ? {} : { accountId: props.accountId }),
        limit: 50,
        q: trimmedQuery,
        sort: "smart",
        ...(quickFilters.length ? { quickFilters } : {}),
        ...(qScopes.length ? { qScopes } : {}),
      });
      const mappedResults = page.items.map(mapMessageDtoToMailItem);
      setResults(mappedResults);
      setHasSearched(true);
      setNotice(
        mappedResults.length > 0
          ? searchAllAccounts
            ? "已搜索所有邮箱。"
            : "已搜索当前邮箱。"
          : "没有找到匹配邮件。",
      );
    } catch {
      setResults([]);
      setHasSearched(true);
      setNotice("搜索暂时不可用，请稍后重试。");
    }
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeSearch(query);
  }

  useEffect(() => {
    if (!props.launch?.query) {
      return;
    }

    setQuery(props.launch.query);
    void executeSearch(props.launch.query);
  }, [props.launch?.requestId]);

  return (
    <section className="workspace-page page-scroll narrow">
      <header className="topbar single">
        <div>
          <h1>搜索</h1>
          <p>关键词、附件、自然语言、账号、标签、日期筛选。</p>
        </div>
      </header>
      <section className="page-panel search-panel">
        <form className="search-form" onSubmit={runSearch}>
          <label className="large-search">
            <Search size={21} />
            <input
              aria-label="搜索邮件"
              placeholder="搜索邮件、联系人、主题或附件"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit">
            执行搜索
          </button>
        </form>
        <div className="filter-row">
          <button
            className={searchAllAccounts ? "active" : ""}
            type="button"
            aria-label="Search all accounts"
            onClick={() => setSearchAllAccounts(true)}
          >
            全部账号
          </button>
          <button
            className={!searchAllAccounts ? "active" : ""}
            type="button"
            aria-label="Search current account"
            onClick={() => setSearchAllAccounts(false)}
          >
            当前账号
          </button>
          <button
            className={quickFilters.includes("attachments") ? "active" : ""}
            type="button"
            aria-label="Filter attachments"
            onClick={() => toggleQuickFilter("attachments")}
          >
            有附件
          </button>
          <button
            className={quickFilters.includes("unread") ? "active" : ""}
            type="button"
            aria-label="Filter unread"
            onClick={() => toggleQuickFilter("unread")}
          >
            未读
          </button>
          <button
            className={qScopes.includes("body") ? "active" : ""}
            type="button"
            aria-label="Search body scope"
            onClick={() => toggleSearchScope("body")}
          >
            正文/附件
          </button>
          <button
            className={qScopes.includes("sender") ? "active" : ""}
            type="button"
            aria-label="Search sender scope"
            onClick={() => toggleSearchScope("sender")}
          >
            发件人
          </button>
          <button
            className={qScopes.includes("recipients") ? "active" : ""}
            type="button"
            aria-label="Search recipients scope"
            onClick={() => toggleSearchScope("recipients")}
          >
            收件人
          </button>
        </div>
        <div className="backend-notice" role="status">{notice}</div>
        {results.length > 0
          ? results.map((mail) => (
              <button
                className="search-result"
                key={mailItemKey(mail)}
                type="button"
                aria-label={`Open search result ${mail.subject}`}
                onClick={() => props.onOpenResult(mail)}
              >
                <strong>{mail.subject}</strong>
                <span>
                  {mail.searchPreview ?? mail.preview} · {mail.sender} · {mail.date}{" "}
                  {mail.time}
                </span>
              </button>
            ))
          : null}
        {hasSearched && results.length === 0 ? (
          <div className="empty-search">没有匹配邮件。</div>
        ) : null}
      </section>
    </section>
  );
}

function SettingsPage(props: { api?: EmailHubApi; accountId: string }) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("hermes");

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>设置</h1>
          <p>Hermes 配置、待办、别名转发、域名管理、通知和隐私集中管理。</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置目录">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                className={activeSection === section.id ? "active" : ""}
                type="button"
                aria-label={section.label}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={18} />
                <span>{section.label}</span>
                <small>{section.description}</small>
              </button>
            );
          })}
        </nav>

        <div className="settings-detail">
          {activeSection === "hermes" ? (
            <HermesRuntimeSettingsPanel api={props.api} />
          ) : null}
          {activeSection === "todo" ? (
            <TodoPage api={props.api} accountId={props.accountId} embedded />
          ) : null}
          {activeSection === "gatekeeper" ? (
            <GatekeeperSettingsPanel api={props.api} accountId={props.accountId} />
          ) : null}
          {activeSection === "aliases" ? (
            <DomainAliasSettingsPanel api={props.api} mode="aliases" />
          ) : null}
          {activeSection === "domains" ? (
            <DomainAliasSettingsPanel api={props.api} mode="domains" />
          ) : null}
          {activeSection === "notifications" ? (
            <SettingsPlaceholder
              title="通知与隐私"
              description="管理提醒、AI 审计、学习数据查看和删除入口。"
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function HermesRuntimeSettingsPanel(props: { api?: EmailHubApi }) {
  const abilities = [
    "线程总结",
    "写回复",
    "改写润色",
    "自然语言查邮件",
    "提取待办",
    "优先级判断",
    "标签建议",
    "跟进识别",
  ];
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<HermesRuntimeMode>("external_hermes");
  const [providerKey, setProviderKey] = useState("hermes");
  const [endpointUrl, setEndpointUrl] = useState(
    "http://localhost:11434/v1/chat/completions",
  );
  const [model, setModel] = useState("hermes-email");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [updatePolicy, setUpdatePolicy] =
    useState<HermesRuntimeUpdatePolicy>("manual");
  const [updateChannel, setUpdateChannel] =
    useState<HermesRuntimeUpdateChannel>("stable");
  const [version, setVersion] = useState<HermesRuntimeVersionStatus>();
  const [hermesProviders, setHermesProviders] = useState<
    HermesProviderCatalogItem[]
  >(fallbackHermesProviders);
  const [notice, setNotice] = useState("正在读取 Hermes 配置...");
  const providerOptions = useMemo<HermesProviderCatalogItem[]>(() => {
    if (hermesProviders.some((provider) => provider.key === providerKey)) {
      return hermesProviders;
    }

    return [
      ...hermesProviders,
      {
        key: providerKey,
        label: providerKey,
        category: "custom" as const,
        authType: "api_key_optional" as const,
        requestProtocol: "openai_chat_completions" as const,
        endpointEditable: true,
        aliases: [],
        modelExamples: [model],
        capabilities: ["chat", "email_skills"]
      }
    ];
  }, [hermesProviders, model, providerKey]);
  const selectedProvider = useMemo(
    () => providerOptions.find((provider) => provider.key === providerKey),
    [providerKey, providerOptions],
  );

  function applyProviderSelection(nextProviderKey: string) {
    const provider = providerOptions.find((item) => item.key === nextProviderKey);

    if (provider && !isHermesProviderRuntimeSelectable(provider)) {
      setNotice("这个模型接口需要先完成外部配置，暂时不能直接选择。");
      return;
    }

    setProviderKey(nextProviderKey);
    if (!provider) {
      return;
    }

    if (provider.defaultEndpoint !== undefined) {
      setEndpointUrl(provider.defaultEndpoint);
    } else if (!provider.endpointEditable) {
      setEndpointUrl("");
    }

    if (provider.modelExamples[0]) {
      setModel(provider.modelExamples[0]);
    }
  }

  function currentRuntimePayload() {
    return {
      enabled,
      mode,
      providerKey,
      endpointUrl,
      model,
      updatePolicy,
      updateChannel,
    };
  }

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setNotice("本地预览配置，连接后会保存到后端。");
      return () => {
        alive = false;
      };
    }

    void props.api
      .getHermesProviders()
      .then((catalog) => {
        if (!alive) return;
        if (catalog.providers.length > 0) {
          setHermesProviders(catalog.providers);
        }
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取 Hermes 模型接口目录，已使用本地兜底。");
      });

    void props.api
      .getHermesRuntimeSettings()
      .then((settings) => {
        if (!alive) return;
        setEnabled(settings.enabled);
        setMode(settings.mode);
        setProviderKey(settings.providerKey);
        setEndpointUrl(settings.endpointUrl ?? "");
        setModel(settings.model);
        setApiKeyConfigured(settings.apiKeyConfigured);
        setUpdatePolicy(settings.updatePolicy);
        setUpdateChannel(settings.updateChannel);
        setVersion({
          installedVersion: settings.installedVersion,
          latestVersion: settings.latestVersion,
          updateAvailable: settings.updateAvailable,
          updatePolicy: settings.updatePolicy,
          updateChannel: settings.updateChannel,
          lastCheckedAt: settings.lastCheckedAt,
        });
        setNotice(
          settings.apiKeyConfigured
            ? "Hermes 已连接访问密钥。"
            : "Hermes 尚未填写访问密钥。",
        );
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取 Hermes 配置。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!props.api) {
      setApiKeyConfigured(Boolean(apiKey.trim()));
      setNotice("预览配置已更新。");
      return;
    }

    setNotice("正在保存 Hermes 配置...");
    try {
      const saved = await props.api.updateHermesRuntimeSettings({
        enabled,
        mode,
        providerKey,
        endpointUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        updatePolicy,
        updateChannel,
      });
      setEnabled(saved.enabled);
      setMode(saved.mode);
      setProviderKey(saved.providerKey);
      setEndpointUrl(saved.endpointUrl ?? "");
      setModel(saved.model);
      setApiKey("");
      setApiKeyConfigured(saved.apiKeyConfigured);
      setVersion({
        installedVersion: saved.installedVersion,
        latestVersion: saved.latestVersion,
        updateAvailable: saved.updateAvailable,
        updatePolicy: saved.updatePolicy,
        updateChannel: saved.updateChannel,
        lastCheckedAt: saved.lastCheckedAt,
      });
      setNotice("Hermes 配置已保存。");
    } catch {
      setNotice("保存失败，请检查服务地址和模型名称。");
    }
  }

  async function testConnection() {
    if (!props.api) {
      setNotice("预览模式不会发起连接测试。");
      return;
    }

    setNotice("正在测试 Hermes 连接...");
    try {
      const result = await props.api.probeHermesProvider({
        providerKey,
        endpointUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      if (result.ok) {
        setNotice(`当前配置可用：${result.model ?? model}`);
        return;
      }
      if (result.status === "external_auth_required") {
        setNotice("这个模型接口需要先完成外部配置。");
        return;
      }
      if (result.status === "missing_configuration") {
        setNotice(`请补全：${formatHermesMissingFields(result.missing)}`);
        return;
      }
      setNotice("连接失败，请检查服务地址、模型和访问密钥。");
    } catch {
      setNotice("连接失败，请检查服务地址、模型和访问密钥。");
    }
  }

  async function clearApiKey() {
    if (!props.api) {
      setApiKey("");
      setApiKeyConfigured(false);
      setNotice("访问密钥已清除。");
      return;
    }

    setNotice("正在清除访问密钥...");
    try {
      const saved = await props.api.clearHermesRuntimeApiKey(
        currentRuntimePayload(),
      );
      setEnabled(saved.enabled);
      setMode(saved.mode);
      setProviderKey(saved.providerKey);
      setEndpointUrl(saved.endpointUrl ?? "");
      setModel(saved.model);
      setApiKey("");
      setApiKeyConfigured(saved.apiKeyConfigured);
      setUpdatePolicy(saved.updatePolicy);
      setUpdateChannel(saved.updateChannel);
      setNotice("访问密钥已清除。");
    } catch {
      setNotice("清除失败，请稍后再试。");
    }
  }

  async function checkUpdate() {
    if (!props.api) {
      setNotice("预览模式不会检查更新。");
      return;
    }

    setNotice("正在检查 Hermes 版本...");
    try {
      const result = await props.api.checkHermesRuntimeUpdate();
      setVersion(result);
      setNotice(result.updateAvailable ? "发现可用更新。" : "当前版本已是最新。");
    } catch {
      setNotice("暂时无法检查更新。");
    }
  }

  return (
    <section className="settings-panel" aria-label="Hermes 配置">
      <header className="settings-panel-head">
        <div>
          <h2>Hermes 配置</h2>
          <p>助手、写作习惯、版本和访问密钥集中管理；收件箱只保留底部快捷入口。</p>
        </div>
        <button className="ghost-button" type="button" onClick={checkUpdate}>
          检查更新
        </button>
      </header>

      <form className="settings-form" onSubmit={saveSettings}>
        <div className="settings-card-grid">
          <article className="settings-module">
            <label className="field-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>启用 Hermes</span>
            </label>
            <label>
              <span>连接方式</span>
              <select
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as HermesRuntimeMode)
                }
              >
                <option value="external_hermes">Hermes 服务</option>
                <option value="openai_compatible">兼容服务</option>
                <option value="builtin">内置服务</option>
              </select>
            </label>
            <label>
              <span>模型接口</span>
              <select
                value={providerKey}
                onChange={(event) => applyProviderSelection(event.target.value)}
              >
                {providerOptions.map((provider) => (
                  <option
                    key={provider.key}
                    value={provider.key}
                    disabled={!isHermesProviderRuntimeSelectable(provider)}
                  >
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>服务地址</span>
              <input
                value={endpointUrl}
                onChange={(event) => setEndpointUrl(event.target.value)}
                disabled={selectedProvider?.endpointEditable === false}
                placeholder="http://localhost:11434/v1/chat/completions"
              />
            </label>
          </article>

          <article className="settings-module">
            <label>
              <span>模型名称</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="hermes-email"
              />
            </label>
            <label>
              <span>访问密钥</span>
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={apiKeyConfigured ? "已保存，留空则不修改" : "可留空"}
                type="password"
              />
            </label>
            <div className="inline-actions">
              <button className="primary-button" type="submit">
                保存配置
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={testConnection}
              >
                测试连接
              </button>
              {apiKeyConfigured ? (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void clearApiKey()}
                >
                  清除访问密钥
                </button>
              ) : null}
            </div>
          </article>
        </div>

        <div className="settings-card-grid">
          <article className="settings-module">
            <h3>版本策略</h3>
            <label>
              <span>提醒方式</span>
              <select
                value={updatePolicy}
                onChange={(event) =>
                  setUpdatePolicy(
                    event.target.value as HermesRuntimeUpdatePolicy,
                  )
                }
              >
                <option value="manual">手动确认</option>
                <option value="notify">有更新时提醒</option>
                <option value="auto_patch">仅小版本自动</option>
              </select>
            </label>
            <label>
              <span>更新通道</span>
              <select
                value={updateChannel}
                onChange={(event) =>
                  setUpdateChannel(
                    event.target.value as HermesRuntimeUpdateChannel,
                  )
                }
              >
                <option value="stable">稳定</option>
                <option value="preview">预览</option>
              </select>
            </label>
            <p>
              {version?.installedVersion
                ? `当前 ${version.installedVersion}`
                : "当前版本待检测"}
              {version?.latestVersion ? ` · 最新 ${version.latestVersion}` : ""}
            </p>
          </article>
          <article className="settings-module">
            <h3>学习边界</h3>
            <p>写回复、归档、星标、移动标签和你的修改会进入可查看的学习记录。</p>
            <p>写操作默认先预览，不会直接发送邮件。</p>
          </article>
        </div>
      </form>

      <div className="backend-notice" role="status">
        {notice}
      </div>

      <div className="skill-grid compact">
        {abilities.map((ability) => (
          <article key={ability} className="skill-card">
            <Sparkles size={18} />
            <div>
              <strong>{ability}</strong>
              <span>先预览，再由你确认。</span>
            </div>
          </article>
        ))}
      </div>

      <HermesMemoryManagerPanel api={props.api} />
    </section>
  );
}

function HermesMemoryManagerPanel(props: { api?: EmailHubApi }) {
  const previewMemories: HermesMemoryDto[] = [
    {
      id: "preview-writing-style",
      layer: "writing_style_profile",
      scope: "global",
      content: {
        preference: "Keep replies concise, warm, and action-oriented.",
      },
      confidence: 0.82,
      createdAt: "2026-06-15T08:00:00.000Z",
      updatedAt: "2026-06-15T09:00:00.000Z",
    },
  ];
  const [memories, setMemories] = useState<HermesMemoryDto[]>([]);
  const [memoryEdits, setMemoryEdits] = useState<
    Record<string, { contentText: string; confidenceText: string }>
  >({});
  const [memoryLayerFilter, setMemoryLayerFilter] = useState("");
  const [memoryScopeFilter, setMemoryScopeFilter] = useState("");
  const [memoryLimit, setMemoryLimit] = useState("50");
  const [memoryNotice, setMemoryNotice] = useState("正在读取 Hermes 学习记录...");
  const [busyMemoryId, setBusyMemoryId] = useState("");
  const [pendingDeleteMemoryId, setPendingDeleteMemoryId] = useState("");

  function syncMemoryEdits(nextMemories: HermesMemoryDto[]) {
    setMemoryEdits(
      Object.fromEntries(
        nextMemories.map((memory) => [
          memory.id,
          {
            contentText: formatHermesMemoryContent(memory.content),
            confidenceText: String(memory.confidence),
          },
        ]),
      ),
    );
  }

  async function loadMemories() {
    const limit = Number.parseInt(memoryLimit, 10);
    const safeLimit = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : 50;

    if (!props.api) {
      setMemories(previewMemories);
      syncMemoryEdits(previewMemories);
      setMemoryNotice("本地预览学习记录，连接后会读取真实 Hermes 学习记录。");
      return;
    }

    setMemoryNotice("正在读取 Hermes 学习记录...");
    try {
      const page = await props.api.listHermesMemories({
        ...(memoryLayerFilter.trim() ? { layer: memoryLayerFilter.trim() } : {}),
        ...(memoryScopeFilter.trim() ? { scope: memoryScopeFilter.trim() } : {}),
        limit: safeLimit,
      });
      setMemories(page.items);
      syncMemoryEdits(page.items);
      setPendingDeleteMemoryId("");
      setMemoryNotice(
        page.items.length === 0
          ? "没有匹配的 Hermes 学习记录。"
          : `已读取 ${page.items.length} 条 Hermes 学习记录。`,
      );
    } catch {
      setMemoryNotice("Hermes 学习记录暂时不可用。");
    }
  }

  useEffect(() => {
    void loadMemories();
    // Filters are applied by the explicit refresh button to avoid reloading while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.api]);

  function updateMemoryEdit(
    memory: HermesMemoryDto,
    patch: Partial<{ contentText: string; confidenceText: string }>,
  ) {
    setMemoryEdits((current) => ({
      ...current,
      [memory.id]: {
        contentText:
          current[memory.id]?.contentText ??
          formatHermesMemoryContent(memory.content),
        confidenceText:
          current[memory.id]?.confidenceText ?? String(memory.confidence),
        ...patch,
      },
    }));
  }

  async function saveMemory(memory: HermesMemoryDto) {
    const edit = memoryEdits[memory.id] ?? {
      contentText: formatHermesMemoryContent(memory.content),
      confidenceText: String(memory.confidence),
    };
    let content;
    try {
      content = parseHermesMemoryContent(edit.contentText);
    } catch {
      setMemoryNotice("学习内容必须是 JSON 对象。");
      return;
    }

    const confidence = parseHermesMemoryConfidence(edit.confidenceText);
    if (confidence === undefined) {
      setMemoryNotice("置信度必须在 0 到 1 之间。");
      return;
    }

    if (!props.api) {
      setMemories((current) =>
        current.map((item) =>
          item.id === memory.id
            ? {
                ...item,
                content,
                confidence,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setMemoryNotice("预览学习记录已更新。");
      return;
    }

    setBusyMemoryId(memory.id);
    setMemoryNotice("正在保存 Hermes 学习记录...");
    try {
      const saved = await props.api.updateHermesMemory({
        id: memory.id,
        content,
        confidence,
      });
      setMemories((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      updateMemoryEdit(saved, {
        contentText: formatHermesMemoryContent(saved.content),
        confidenceText: String(saved.confidence),
      });
      setMemoryNotice("Hermes 学习记录已保存。");
    } catch {
      setMemoryNotice("保存 Hermes 学习记录失败。");
    } finally {
      setBusyMemoryId("");
    }
  }

  async function deleteMemory(memory: HermesMemoryDto) {
    if (pendingDeleteMemoryId !== memory.id) {
      setPendingDeleteMemoryId(memory.id);
      setMemoryNotice(`再次点击确认删除 ${formatHermesMemoryLayer(memory.layer)}。`);
      return;
    }

    if (!props.api) {
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDeleteMemoryId("");
      setMemoryNotice("预览学习记录已删除。");
      return;
    }

    setBusyMemoryId(memory.id);
    setMemoryNotice("正在删除 Hermes 学习记录...");
    try {
      await props.api.deleteHermesMemory({ id: memory.id });
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDeleteMemoryId("");
      setMemoryNotice("Hermes 学习记录已删除。");
    } catch {
      setMemoryNotice("删除 Hermes 学习记录失败。");
    } finally {
      setBusyMemoryId("");
    }
  }

  return (
    <section className="settings-subpanel" aria-label="Hermes 学习记录">
      <header className="settings-panel-head">
        <div>
          <h3>学习记录</h3>
          <p>查看、修正或删除 Hermes 用来适配你写作和整理习惯的记忆。</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void loadMemories()}>
          刷新学习记录
        </button>
      </header>

      <div className="memory-filter-grid">
        <label>
          <span>层级</span>
          <input
            aria-label="Hermes memory layer filter"
            value={memoryLayerFilter}
            onChange={(event) => setMemoryLayerFilter(event.target.value)}
            placeholder="writing_style_profile"
          />
        </label>
        <label>
          <span>作用域</span>
          <input
            aria-label="Hermes memory scope filter"
            value={memoryScopeFilter}
            onChange={(event) => setMemoryScopeFilter(event.target.value)}
            placeholder="global"
          />
        </label>
        <label>
          <span>数量</span>
          <input
            aria-label="Hermes memory limit"
            inputMode="numeric"
            value={memoryLimit}
            onChange={(event) => setMemoryLimit(event.target.value)}
          />
        </label>
      </div>

      <div className="backend-notice compact" role="status">
        {memoryNotice}
      </div>

      <div className="hermes-memory-list">
        {memories.map((memory) => {
          const edit = memoryEdits[memory.id] ?? {
            contentText: formatHermesMemoryContent(memory.content),
            confidenceText: String(memory.confidence),
          };
          const isBusy = busyMemoryId === memory.id;
          return (
            <article className="hermes-memory-card" key={memory.id}>
              <div className="hermes-memory-meta">
                <div>
                  <strong>{formatHermesMemoryLayer(memory.layer)}</strong>
                  <span>作用域 {memory.scope}</span>
                </div>
                <span>{formatMailDate(memory.updatedAt)}</span>
              </div>
              <label>
                <span>内容 JSON</span>
                <textarea
                  aria-label={`Hermes memory content ${memory.id}`}
                  value={edit.contentText}
                  onChange={(event) =>
                    updateMemoryEdit(memory, {
                      contentText: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>置信度</span>
                <input
                  aria-label={`Hermes memory confidence ${memory.id}`}
                  inputMode="decimal"
                  value={edit.confidenceText}
                  onChange={(event) =>
                    updateMemoryEdit(memory, {
                      confidenceText: event.target.value,
                    })
                  }
                />
              </label>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void saveMemory(memory)}
                >
                  保存学习记录
                </button>
                <button
                  className="ghost-button danger"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void deleteMemory(memory)}
                >
                  {pendingDeleteMemoryId === memory.id ? "确认删除" : "准备删除"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const gatekeeperOptions: Array<{
  mode: GatekeeperMode;
  label: string;
  description: string;
}> = [
  {
    mode: "off_accept_all",
    label: "不筛新发件人",
    description: "新来信直接进入原邮箱目录，适合刚开始使用。",
  },
  {
    mode: "inside_email",
    label: "在邮箱内提醒",
    description: "陌生发件人仍进邮箱，但会显示提醒，方便快速判断。",
  },
  {
    mode: "before_inbox",
    label: "先进入新发件人",
    description: "第一次来信先集中到新发件人区域，确认后再进入主收件箱。",
  },
];

function GatekeeperSettingsPanel(props: { api?: EmailHubApi; accountId: string }) {
  const [mode, setMode] = useState<GatekeeperMode>("off_accept_all");
  const [notice, setNotice] = useState("正在读取当前设置...");
  const [senders, setSenders] = useState<GatekeeperSenderDto[]>([]);
  const [senderBusy, setSenderBusy] = useState("");

  async function loadSenders() {
    if (!props.api) {
      setSenders([
        {
          senderId: "preview_sender",
          email: "new-client@example.com",
          domain: "example.com",
          status: "unknown",
          messageCount: 2,
          latestMessageId: "preview_message",
          latestReceivedAt: "2026-06-14T08:00:00.000Z",
          bulkAvailable: true,
        },
      ]);
      return;
    }

    try {
      const page = await props.api.listGatekeeperSenders({
        accountId: props.accountId,
        status: "unknown",
      });
      setSenders(page.items);
    } catch {
      setSenders([]);
    }
  }

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setMode("inside_email");
      setNotice("本地预览设置。连接后会保存到当前邮箱账号。");
      void loadSenders();
      return () => {
        alive = false;
      };
    }

    void props.api
      .getGatekeeperSettings({ accountId: props.accountId })
      .then((settings) => {
        if (!alive) return;
        setMode(settings.mode);
        setNotice("设置已同步。");
        void loadSenders();
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取设置，稍后可重试。");
      });

    return () => {
      alive = false;
    };
  }, [props.accountId, props.api]);

  async function chooseMode(nextMode: GatekeeperMode) {
    setMode(nextMode);

    if (!props.api) {
      setNotice(`当前：${gatekeeperModeLabel(nextMode)}`);
      return;
    }

    setNotice("正在保存...");
    try {
      const saved = await props.api.updateGatekeeperSettings({
        accountId: props.accountId,
        mode: nextMode,
      });
      setMode(saved.mode);
      setNotice(`当前：${gatekeeperModeLabel(saved.mode)}`);
      await loadSenders();
    } catch {
      setNotice("保存失败，请稍后重试。");
    }
  }

  async function decideSender(
    sender: GatekeeperSenderDto,
    action: "accept" | "block" | "block_domain",
  ) {
    if (!props.api) {
      setSenders((current) =>
        current.filter((item) => item.senderId !== sender.senderId),
      );
      setNotice(
        action === "accept"
          ? "预览：发件人已放行。"
          : "预览：发件人已阻止。",
      );
      return;
    }

    const actionKey = `${sender.senderId}:${action}`;
    setSenderBusy(actionKey);
    try {
      if (action === "accept") {
        await props.api.acceptGatekeeperSender({
          accountId: props.accountId,
          senderId: sender.senderId,
        });
        setNotice(`${sender.email} 已放行。`);
      } else if (action === "block") {
        await props.api.blockGatekeeperSender({
          accountId: props.accountId,
          senderId: sender.senderId,
        });
        setNotice(`${sender.email} 已阻止。`);
      } else {
        await props.api.blockGatekeeperDomain({
          accountId: props.accountId,
          domain: sender.domain,
        });
        setNotice(`${sender.domain} 已阻止。`);
      }
      await loadSenders();
    } catch {
      setNotice("新发件人处理失败，请稍后重试。");
    } finally {
      setSenderBusy("");
    }
  }

  async function bulkAcceptSenders() {
    if (senders.length === 0) {
      setNotice("没有待处理的新发件人。");
      return;
    }
    if (!props.api) {
      setSenders([]);
      setNotice("预览：已批量放行。");
      return;
    }

    setSenderBusy("bulk:accept");
    try {
      const result = await props.api.bulkDecideGatekeeperSenders({
        accountId: props.accountId,
        senderIds: senders.filter((sender) => sender.bulkAvailable).map((sender) => sender.senderId),
        action: "accept",
      });
      setNotice(`已放行 ${result.items.length} 个发件人。`);
      await loadSenders();
    } catch {
      setNotice("批量处理失败，确认当前模式是否允许批量操作。");
    } finally {
      setSenderBusy("");
    }
  }

  return (
    <section className="settings-panel" aria-label="Gatekeeper settings">
      <header className="settings-panel-head">
        <div>
          <h2>新发件人处理</h2>
          <p>控制第一次联系你的发件人怎么进入邮箱，避免重要邮件和陌生来信混在一起。</p>
        </div>
      </header>
      <div className="mode-grid">
        {gatekeeperOptions.map((option) => (
          <button
            key={option.mode}
            className={mode === option.mode ? "mode-button active" : "mode-button"}
            type="button"
            aria-label={option.label}
            onClick={() => void chooseMode(option.mode)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <div className="backend-notice" role="status">
        {notice.startsWith("当前：")
          ? notice
          : `当前：${gatekeeperModeLabel(mode)} · ${notice}`}
      </div>
      <section className="settings-module gatekeeper-senders">
        <div className="sync-diagnostics-header">
          <div>
            <h3>新发件人</h3>
            <p>{senders.length ? `${senders.length} 个待处理` : "暂无待处理发件人"}</p>
          </div>
          <div className="task-actions">
            <button
              type="button"
              disabled={senderBusy === "bulk:accept"}
              onClick={() => void bulkAcceptSenders()}
            >
              批量放行
            </button>
            <button type="button" onClick={() => void loadSenders()}>
              刷新
            </button>
          </div>
        </div>
        {senders.map((sender) => (
          <div className="task-row" key={sender.senderId}>
            <ShieldCheck size={19} />
            <div>
              <strong>{sender.email}</strong>
              <span>
                {sender.domain} · {sender.messageCount} 封
                {sender.latestReceivedAt ? ` · ${formatMailDate(sender.latestReceivedAt)}` : ""}
              </span>
            </div>
            <div className="task-actions">
              <button
                type="button"
                aria-label={`Accept sender ${sender.email}`}
                disabled={senderBusy === `${sender.senderId}:accept`}
                onClick={() => void decideSender(sender, "accept")}
              >
                放行
              </button>
              <button
                type="button"
                aria-label={`Block sender ${sender.email}`}
                disabled={senderBusy === `${sender.senderId}:block`}
                onClick={() => void decideSender(sender, "block")}
              >
                阻止发件人
              </button>
              <button
                type="button"
                aria-label={`Block domain ${sender.domain}`}
                disabled={senderBusy === `${sender.senderId}:block_domain`}
                onClick={() => void decideSender(sender, "block_domain")}
              >
                阻止域名
              </button>
            </div>
          </div>
        ))}
      </section>
    </section>
  );
}

function gatekeeperModeLabel(mode: GatekeeperMode): string {
  return gatekeeperOptions.find((option) => option.mode === mode)?.label ?? "不筛新发件人";
}

function SettingsPlaceholder(props: { title: string; description: string }) {
  return (
    <section className="settings-panel">
      <header className="settings-panel-head">
        <div>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
        </div>
      </header>
      <article className="settings-module">
        <div>
          <h3>模块入口</h3>
          <p>保留在设置二级目录里，不放回左侧主导航。</p>
        </div>
        <button className="ghost-button" type="button">打开</button>
      </article>
    </section>
  );
}

function DomainAliasSettingsPanel(props: {
  api?: EmailHubApi;
  mode: "aliases" | "domains";
}) {
  const [domains, setDomains] = useState<DomainDto[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [destinations, setDestinations] = useState<DomainDestinationDto[]>([]);
  const [aliases, setAliases] = useState<DomainAliasDto[]>([]);
  const [logs, setLogs] = useState<DomainDeliveryLogDto[]>([]);
  const [notice, setNotice] = useState("正在加载域名设置...");
  const [domainInput, setDomainInput] = useState("");
  const [destinationEmail, setDestinationEmail] = useState("");
  const [aliasLocalPart, setAliasLocalPart] = useState("");
  const [aliasDestinationId, setAliasDestinationId] = useState("");
  const [catchAllMode, setCatchAllMode] =
    useState<DomainCatchAllMode>("reject");
  const [catchAllDestinationId, setCatchAllDestinationId] = useState("");
  const [lastCatchAll, setLastCatchAll] =
    useState<DomainCatchAllRuleDto | undefined>();
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    if (!props.api) {
      const previewDomainId = "preview_domain";
      const previewDestinationId = "preview_destination";
      setDomains([
        {
          id: previewDomainId,
          domain: "demo.site",
          verificationStatus: "pending",
          dnsRecords: {
            ownershipTxt: {
              type: "TXT",
              name: "_emailhub.demo.site",
              value: "emailhub-domain-verification=preview_domain",
            },
            mx: {
              type: "MX",
              name: "demo.site",
              value: "10 mx.emailhub.local",
            },
          },
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setSelectedDomainId(previewDomainId);
      setDestinations([
        {
          id: previewDestinationId,
          domainId: previewDomainId,
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setAliases([
        {
          id: "preview_alias",
          domainId: previewDomainId,
          address: "support@demo.site",
          localPart: "support",
          enabled: true,
          destinationIds: [previewDestinationId],
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setLogs([
        {
          id: "preview_log",
          domainId: previewDomainId,
          recipient: "support@demo.site",
          status: "delivered",
          createdAt: "2026-06-13T09:00:00.000Z",
        },
      ]);
      setAliasDestinationId(previewDestinationId);
      setCatchAllDestinationId(previewDestinationId);
      setLastCatchAll(undefined);
      setNotice("正在显示本地预览，连接服务后会同步真实域名设置。");
      return;
    }

    let alive = true;
    setNotice("正在加载域名设置...");
    void props.api.listDomains()
      .then((domainPage) => {
        if (!alive) {
          return undefined;
        }
        setDomains(domainPage.items);
        const nextDomainId =
          domainPage.items.find((domain) => domain.id === selectedDomainId)?.id ??
          domainPage.items[0]?.id ??
          "";
        setSelectedDomainId(nextDomainId);
        if (!nextDomainId) {
          setDestinations([]);
          setAliases([]);
          setLogs([]);
          setNotice("还没有添加个人域名。");
          return undefined;
        }
        return loadDomainDetail(nextDomainId, alive);
      })
      .catch(() => {
        if (!alive) return;
        setDomains([]);
        setSelectedDomainId("");
        setDestinations([]);
        setAliases([]);
        setLogs([]);
        setNotice("域名设置暂时不可用。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  async function loadDomainDetail(domainId: string, alive = true) {
    if (!props.api || !domainId) {
      return;
    }

    try {
      const [destinationPage, aliasPage, catchAllResponse, logPage] = await Promise.all([
        props.api.listDomainDestinations({ domainId }),
        props.api.listDomainAliases({ domainId }),
        props.api.getDomainCatchAll({ domainId }),
        props.api.listDomainDeliveryLogs({
          domainId,
          limit: 20,
        }),
      ]);
      if (!alive) {
        return;
      }
      setDestinations(destinationPage.items);
      setAliases(aliasPage.items);
      setLogs(logPage.items);
      setLastCatchAll(catchAllResponse.item ?? undefined);
      setCatchAllMode(catchAllResponse.item?.config.mode ?? "reject");
      const preferredCatchAllDestinationId =
        catchAllResponse.item?.config.destinationIds?.[0] ??
        destinationPage.items[0]?.id ??
        "";
      setAliasDestinationId(destinationPage.items[0]?.id ?? "");
      setCatchAllDestinationId(preferredCatchAllDestinationId);
      setNotice("");
    } catch {
      if (!alive) {
        return;
      }
      setDestinations([]);
      setAliases([]);
      setLogs([]);
      setNotice("域名详情暂时不可用。");
    }
  }

  async function refreshDomains(preferredDomainId?: string) {
    if (!props.api) {
      return;
    }
    const domainPage = await props.api.listDomains();
    setDomains(domainPage.items);
    const nextDomainId =
      preferredDomainId ??
      domainPage.items.find((domain) => domain.id === selectedDomainId)?.id ??
      domainPage.items[0]?.id ??
      "";
    setSelectedDomainId(nextDomainId);
    if (!nextDomainId) {
      setDestinations([]);
      setAliases([]);
      setLogs([]);
      setNotice("还没有添加个人域名。");
      return;
    }
    await loadDomainDetail(nextDomainId);
  }

  async function createDomain() {
    if (!props.api) {
      setNotice("连接服务后才能添加域名。");
      return;
    }
    const domain = domainInput.trim();
    if (!domain) {
      setNotice("请先填写域名。");
      return;
    }

    setBusyAction("domain");
    try {
      const created = await props.api.createDomain({ domain });
      setDomainInput("");
      setNotice(`${created.domain} 已加入域名管理，等待 DNS 验证。`);
      await refreshDomains(created.id);
    } catch {
      setNotice("域名添加失败，请检查域名格式或是否已存在。");
    } finally {
      setBusyAction("");
    }
  }

  async function createDestination() {
    if (!props.api) {
      setNotice("连接服务后才能添加目标邮箱。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    const email = destinationEmail.trim();
    if (!email) {
      setNotice("请先填写目标邮箱。");
      return;
    }

    setBusyAction("destination");
    try {
      const destination = await props.api.createDomainDestination({
        domainId: selectedDomainId,
        email,
      });
      setDestinationEmail("");
      setAliasDestinationId(destination.id);
      setCatchAllDestinationId(destination.id);
      setNotice(`${destination.email} 已加入转发目标，等待确认。`);
      await loadDomainDetail(selectedDomainId);
    } catch {
      setNotice("目标邮箱添加失败，请检查邮箱格式。");
    } finally {
      setBusyAction("");
    }
  }

  async function createAlias() {
    if (!props.api) {
      setNotice("连接服务后才能添加别名。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    const localPart = aliasLocalPart.trim();
    if (!localPart) {
      setNotice("请先填写别名前缀。");
      return;
    }
    if (!aliasDestinationId) {
      setNotice("请先添加并选择一个转发目标。");
      return;
    }

    setBusyAction("alias");
    try {
      const alias = await props.api.createDomainAlias({
        domainId: selectedDomainId,
        localPart,
        destinationIds: [aliasDestinationId],
      });
      setAliasLocalPart("");
      setNotice(`${alias.address} 已创建并启用。`);
      await loadDomainDetail(selectedDomainId);
    } catch {
      setNotice("别名创建失败，请检查前缀和转发目标。");
    } finally {
      setBusyAction("");
    }
  }

  async function setCatchAll() {
    if (!props.api) {
      setNotice("连接服务后才能设置 catch-all。");
      return;
    }
    if (!selectedDomainId) {
      setNotice("请先选择域名。");
      return;
    }
    if (catchAllMode === "forward" && !catchAllDestinationId) {
      setNotice("转发 catch-all 需要先选择目标邮箱。");
      return;
    }

    setBusyAction("catch-all");
    try {
      const rule = await props.api.setDomainCatchAll({
        domainId: selectedDomainId,
        mode: catchAllMode,
        ...(catchAllMode === "forward"
          ? { destinationIds: [catchAllDestinationId] }
          : {}),
      });
      setLastCatchAll(rule);
      setNotice(`Catch-all 已设置为${formatCatchAllMode(rule.config.mode)}。`);
    } catch {
      setNotice("Catch-all 设置失败，请检查目标邮箱和模式。");
    } finally {
      setBusyAction("");
    }
  }

  async function selectDomain(domainId: string) {
    setSelectedDomainId(domainId);
    setLastCatchAll(undefined);
    setNotice("正在加载域名详情...");
    await loadDomainDetail(domainId);
  }

  const title = props.mode === "domains" ? "域名管理" : "别名转发";
  const description =
    props.mode === "domains"
      ? "集中管理个人域名、DNS 验证、目标邮箱和 catch-all。"
      : "集中管理别名地址、转发目标、catch-all 和最近投递状态。";
  const selectedDomain = domains.find((domain) => domain.id === selectedDomainId);
  const dnsRecords = selectedDomain
    ? domainDnsRecordRows(selectedDomain.dnsRecords)
    : [];

  return (
    <section className="settings-panel">
      <header className="settings-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}
      <div className="settings-card-grid">
        <article className="settings-module domain-command">
          <div>
            <h3>添加个人域名</h3>
            <p>新增后会生成 TXT、MX、SPF 和 DMARC 记录。</p>
          </div>
          <label>
            <span>域名</span>
            <input
              aria-label="Domain name"
              value={domainInput}
              placeholder="example.com"
              onChange={(event) => setDomainInput(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={busyAction === "domain"}
            onClick={() => void createDomain()}
          >
            {busyAction === "domain" ? "添加中" : "添加域名"}
          </button>
        </article>
        <article className="settings-module domain-command">
          <div>
            <h3>当前域名</h3>
            <p>
              {selectedDomain
                ? `${selectedDomain.domain} · ${formatDomainStatus(selectedDomain.verificationStatus)}`
                : "还没有域名。"}
            </p>
          </div>
          <label>
            <span>选择域名</span>
            <select
              aria-label="Domain selector"
              value={selectedDomainId}
              disabled={domains.length === 0}
              onChange={(event) => void selectDomain(event.currentTarget.value)}
            >
              {domains.length === 0 ? (
                <option value="">无域名</option>
              ) : null}
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.domain} · {formatDomainStatus(domain.verificationStatus)}
                </option>
              ))}
            </select>
          </label>
          <div className="dns-record-list" aria-label="Domain DNS records">
            {dnsRecords.length > 0 ? (
              dnsRecords.map((record) => (
                <p key={`${record.label}-${record.name}-${record.value}`}>
                  <strong>{record.label}</strong>
                  <span>{record.type} · {record.name}</span>
                  <code>{record.value}</code>
                </p>
              ))
            ) : (
              <p>创建域名后会显示 DNS 记录。</p>
            )}
          </div>
        </article>
      </div>
      <div className="settings-card-grid">
        <article className="settings-module domain-command">
          <div>
            <h3>目标邮箱</h3>
            <p>目标邮箱会接收别名和 catch-all 转发。</p>
          </div>
          <label>
            <span>邮箱地址</span>
            <input
              aria-label="Domain destination email"
              value={destinationEmail}
              placeholder="owner@example.net"
              onChange={(event) => setDestinationEmail(event.currentTarget.value)}
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            disabled={busyAction === "destination" || !selectedDomainId}
            onClick={() => void createDestination()}
          >
            {busyAction === "destination" ? "添加中" : "添加目标邮箱"}
          </button>
          <div className="domain-item-list">
            {destinations.length > 0 ? (
              destinations.map((destination) => (
                <p key={destination.id}>
                  <strong>{destination.email}</strong>
                  <span>{destination.verified ? "已确认" : "待确认"}</span>
                </p>
              ))
            ) : (
              <p>还没有目标邮箱。</p>
            )}
          </div>
        </article>
        <article className="settings-module domain-command">
          <div>
            <h3>别名地址</h3>
            <p>每个别名绑定一个当前域名下的转发目标。</p>
          </div>
          <div className="alias-form-grid">
            <label>
              <span>别名前缀</span>
              <input
                aria-label="Domain alias local part"
                value={aliasLocalPart}
                placeholder="support"
                onChange={(event) => setAliasLocalPart(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>转发目标</span>
              <select
                aria-label="Domain alias destination"
                value={aliasDestinationId}
                disabled={destinations.length === 0}
                onChange={(event) => setAliasDestinationId(event.currentTarget.value)}
              >
                {destinations.length === 0 ? (
                  <option value="">无目标邮箱</option>
                ) : null}
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={busyAction === "alias" || !selectedDomainId}
            onClick={() => void createAlias()}
          >
            {busyAction === "alias" ? "创建中" : "创建别名"}
          </button>
          <div className="domain-item-list">
            {aliases.length > 0 ? (
              aliases.map((alias) => (
                <p key={alias.id}>
                  <strong>{alias.address}</strong>
                  <span>{alias.enabled ? "启用中" : "已停用"}</span>
                </p>
              ))
            ) : (
              <p>还没有别名。</p>
            )}
          </div>
        </article>
      </div>
      <div className="settings-card-grid">
        <article className="settings-module domain-command">
          <div>
            <h3>Catch-all</h3>
            <p>
              {lastCatchAll
                ? `最近设置：${formatCatchAllMode(lastCatchAll.config.mode)}`
                : "未在本次会话中变更。"}
            </p>
          </div>
          <div className="alias-form-grid">
            <label>
              <span>模式</span>
              <select
                aria-label="Domain catch-all mode"
                value={catchAllMode}
                onChange={(event) =>
                  setCatchAllMode(event.currentTarget.value as DomainCatchAllMode)
                }
              >
                <option value="reject">拒收未知地址</option>
                <option value="forward">转发到目标邮箱</option>
                <option value="auto_create">自动创建别名</option>
                <option value="discard">静默丢弃</option>
              </select>
            </label>
            <label>
              <span>目标邮箱</span>
              <select
                aria-label="Domain catch-all destination"
                value={catchAllDestinationId}
                disabled={destinations.length === 0 || catchAllMode !== "forward"}
                onChange={(event) =>
                  setCatchAllDestinationId(event.currentTarget.value)
                }
              >
                {destinations.length === 0 ? (
                  <option value="">无目标邮箱</option>
                ) : null}
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="ghost-button"
            type="button"
            disabled={busyAction === "catch-all" || !selectedDomainId}
            onClick={() => void setCatchAll()}
          >
            {busyAction === "catch-all" ? "保存中" : "保存 Catch-all"}
          </button>
        </article>
        <article className="settings-module">
          <div>
            <h3>最近投递</h3>
            {logs.length > 0 ? (
              logs.map((log) => (
                <p key={log.id}>
                  <strong>{log.recipient}</strong> · {formatDeliveryStatus(log.status)}
                </p>
              ))
            ) : (
              <p>还没有投递记录。</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function domainDnsRecordRows(value: unknown): Array<{
  label: string;
  type: string;
  name: string;
  value: string;
}> {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, record]) => {
      if (!record || typeof record !== "object") {
        return undefined;
      }
      const candidate = record as Record<string, unknown>;
      if (
        typeof candidate.type !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.value !== "string"
      ) {
        return undefined;
      }
      return {
        label: formatDnsRecordLabel(key),
        type: candidate.type,
        name: candidate.name,
        value: candidate.value,
      };
    })
    .filter((record): record is {
      label: string;
      type: string;
      name: string;
      value: string;
    } => record !== undefined);
}

function formatDnsRecordLabel(value: string): string {
  if (value === "ownershipTxt") return "所有权";
  if (value === "mx") return "MX";
  if (value === "spf") return "SPF";
  if (value === "dmarc") return "DMARC";
  return value;
}

function formatCatchAllMode(value: DomainCatchAllMode): string {
  if (value === "forward") return "转发";
  if (value === "auto_create") return "自动创建别名";
  if (value === "discard") return "静默丢弃";
  return "拒收";
}

function TodoPage(props: { api?: EmailHubApi; accountId: string; embedded?: boolean }) {
  const [items, setItems] = useState<FollowUpDto[]>([]);
  const [notice, setNotice] = useState("正在加载待办...");

  useEffect(() => {
    if (!props.api) {
      setItems([
        {
          id: "preview_followup",
          accountId: props.accountId,
          messageId: "preview_message",
          kind: "waiting_on_them",
          status: "open",
          dueAt: "2026-06-14T09:00:00.000Z",
          title: "今天 17:00 前确认 Q2 合作方案",
          note: "来自邮件和 Hermes 提取。",
          source: "hermes_followup",
          createdAt: "2026-06-13T09:00:00.000Z",
          updatedAt: "2026-06-13T09:00:00.000Z",
        },
      ]);
      setNotice("正在显示本地预览，连接服务后会同步真实待办。");
      return;
    }

    let alive = true;
    setNotice("正在加载待办...");
    void props.api
      .listFollowUps({
        accountId: props.accountId,
        status: "open",
        limit: 50,
      })
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNotice(page.items.length === 0 ? "没有待处理事项。" : "");
      })
      .catch(() => {
        if (alive) {
          setNotice("待办暂时不可用。");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.accountId, props.api]);

  async function markDone(item: FollowUpDto) {
    if (!props.api) {
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      return;
    }

    const updated = await props.api.updateFollowUp({
      id: item.id,
      status: "done",
    });
    setItems((current) => current.filter((candidate) => candidate.id !== updated.id));
    setNotice(`${updated.title ?? updated.messageId} marked done.`);
  }

  return (
    <section className={props.embedded ? "settings-panel" : "workspace-page page-scroll narrow"}>
      <header className="topbar single">
        <div>
          <h1>待办</h1>
          <p>待回复、稍后提醒和跟进事项集中处理。</p>
        </div>
      </header>
      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}
      <section className="page-panel">
        {items.map((item) => (
          <div className="task-row" key={item.id}>
            <CheckCircle2 size={19} />
            <div>
              <strong>{item.title ?? item.messageId}</strong>
              <span>
                {item.note ?? item.kind} · {formatMailDate(item.dueAt)}
              </span>
            </div>
            <button
              type="button"
              aria-label="Mark follow-up done"
              onClick={() => void markDone(item)}
            >
              完成
            </button>
          </div>
        ))}
      </section>
    </section>
  );
}

function HermesDock(props: {
  prompt: string;
  notice?: string;
  result?: HermesEmailSearchQaResult;
  ruleCandidate?: HermesRuleCandidateDto;
  ruleSimulation?: HermesRuleSimulationDto;
  workspaceContext?: HermesWorkspaceContextDto;
  workspaceContextLoading?: boolean;
  busy: boolean;
  onPromptChange: (value: string) => void;
  onOpen: () => void;
  onSubmit: (prompt: string) => void;
  onApproveRule: () => void;
  onOpenSearch: (query: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activityVersion, setActivityVersion] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsOpen(false);
    }, 5_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activityVersion, isOpen, props.prompt]);

  function showDock() {
    if (!isOpen) {
      props.onOpen();
    }
    setIsOpen(true);
    setActivityVersion((version) => version + 1);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    showDock();
    props.onSubmit(props.prompt);
  }

  const result = props.result;
  const ruleCandidate = props.ruleCandidate;
  const rulePreview = ruleCandidate
    ? hermesRulePreview(ruleCandidate)
    : undefined;

  return (
    <section
      className={`hermes-dock dock-short is-blurred ${isOpen ? "is-open" : "is-collapsed"}`}
      aria-label="Hermes 底部输入"
      onFocus={showDock}
      onMouseMove={isOpen ? showDock : undefined}
    >
      {!isOpen ? (
        <button className="dock-launcher" type="button" aria-label="打开 Hermes" onClick={showDock}>
          <Sparkles size={18} />
          <span>随便问问</span>
        </button>
      ) : (
        <>
          <form className="dock-command-form" onSubmit={submitPrompt}>
            <button className="dock-model" type="button" onClick={showDock}>
              <Sparkles size={18} />
              Hermes
            </button>
            <input
              className="dock-command-input"
              aria-label="Hermes 指令"
              value={props.prompt}
              placeholder="搜索邮件、写回复、整理收件箱..."
              onChange={(event) => {
                props.onPromptChange(event.target.value);
                showDock();
              }}
              onKeyDown={showDock}
            />
            <button
              className="dock-send"
              type="submit"
              aria-label="发送给 Hermes"
              disabled={props.busy}
            >
              <Send size={18} />
            </button>
          </form>
          <HermesWorkspaceContextBar
            context={props.workspaceContext}
            loading={props.workspaceContextLoading}
          />
          {props.notice ? (
            <div className="dock-result-status" role="status">
              {props.notice}
            </div>
          ) : null}
          {result ? (
            <div className="dock-result" aria-label="Hermes 搜索回答">
              <div className="dock-result-head">
                <strong>Hermes 搜索回答</strong>
                <span>{result.searchQuery}</span>
              </div>
              <p>{result.answerText}</p>
              {result.citations.length > 0 ? (
                <div className="dock-citations" aria-label="Hermes 引用邮件">
                  {result.citations.slice(0, 3).map((citation) => (
                    <button
                      className="dock-citation"
                      type="button"
                      key={`${citation.messageId}-${citation.resultIndex}`}
                      aria-label={`Hermes citation ${citation.subject}`}
                      onClick={() => props.onOpenSearch(result.searchQuery)}
                    >
                      <span>{citation.subject}</span>
                      <small>
                        {citation.from.name ?? citation.from.email} ·{" "}
                        {formatMailDate(citation.receivedAt)} · {citation.bucket}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                className="dock-action"
                type="button"
                onClick={() => props.onOpenSearch(result.searchQuery)}
              >
                同步到搜索页
              </button>
            </div>
          ) : null}
          {ruleCandidate ? (
            <div className="dock-result" aria-label="Hermes 规则草案">
              <div className="dock-result-head">
                <strong>Hermes 规则草案</strong>
                <span>{ruleCandidate.status === "approved" ? "已启用" : "待确认"}</span>
              </div>
              <p>{ruleCandidate.title}</p>
              {rulePreview ? (
                <p>
                  左侧分组：{rulePreview.label} · 关键词{" "}
                  {rulePreview.keywords.slice(0, 5).join("，")}
                </p>
              ) : null}
              {props.ruleSimulation ? (
                <p>
                  Shadow simulation：命中 {props.ruleSimulation.matchedCount} 封邮件
                </p>
              ) : null}
              <button
                className="dock-action"
                type="button"
                disabled={props.busy || ruleCandidate.status === "approved"}
                onClick={props.onApproveRule}
              >
                {ruleCandidate.status === "approved" ? "已启用" : "启用规则"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function HermesWorkspaceContextBar(props: {
  context?: HermesWorkspaceContextDto;
  loading?: boolean;
}) {
  if (props.loading && !props.context) {
    return (
      <div className="dock-context" role="status">
        <span>正在读取邮箱环境...</span>
      </div>
    );
  }

  const context = props.context;
  if (!context) {
    return null;
  }

  const confirmationBoundary = context.operationBoundaries.find(
    (boundary) => boundary.mode === "confirmation_required",
  );
  const statusLabel =
    context.mailEngine?.readiness.status === "ready"
      ? "EmailEngine ready"
      : "EmailEngine degraded";

  return (
    <div className="dock-context" aria-label="Hermes mailbox context">
      <span>{context.accounts.length} 个账号</span>
      <span>{context.navigation?.quickCategories.length ?? 0} 个分组</span>
      <span>{context.rules.length} 条规则</span>
      <span>{statusLabel}</span>
      {confirmationBoundary ? <span>规则需确认</span> : null}
    </div>
  );
}

function MailEmptyState(props: {
  notice?: string;
  onAddMail: () => void;
  onOpenSyncCenter: () => void;
}) {
  return (
    <section className="mail-empty-panel" aria-label="聚合收件箱空状态">
      <div>
        <Inbox size={24} />
        <h2>聚合收件箱</h2>
        <p>{props.notice ?? "还没有可显示的邮件。"}</p>
      </div>
      <div className="task-actions">
        <button type="button" onClick={props.onAddMail}>
          添加邮箱
        </button>
        <button type="button" onClick={props.onOpenSyncCenter}>
          打开同步中心
        </button>
      </div>
    </section>
  );
}

function mapMailboxDtoToFolderItem(mailbox: MailboxDto): FolderItem {
  return {
    id: mailbox.id,
    label: mailbox.name,
    count: mailbox.messageCount
  };
}

function mapLabelDtoToLabelItem(label: LabelDto): LabelItem {
  return {
    id: label.id,
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
    mailboxIds: message.mailboxIds,
    bucket: message.classification.bucket,
    score: message.classification.priorityScore,
    reasons: message.classification.reasons,
    searchPreview: message.searchPreview?.text,
  };
}

function isHermesRuleCommand(value: string): boolean {
  return /规则|分组|分类|标签|filter|rule/i.test(value);
}

function hermesRulePreview(
  candidate: HermesRuleCandidateDto,
): { label: string; keywords: string[] } | undefined {
  const savedView = hermesRuleSavedView(candidate.action);
  if (savedView) {
    return {
      label: savedView.label,
      keywords: savedView.keywords,
    };
  }

  const label = hermesRuleLabel(candidate.action);
  if (!label) {
    return undefined;
  }
  return {
    label,
    keywords: hermesRuleKeywords(candidate.condition),
  };
}

function hermesRuleSavedView(
  action: Record<string, unknown>,
): { label: string; keywords: string[] } | undefined {
  if (action.type !== "ensure_saved_view") {
    return undefined;
  }
  const savedView = action.savedView;
  if (!savedView || typeof savedView !== "object" || Array.isArray(savedView)) {
    return undefined;
  }

  const record = savedView as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.label !== "string") {
    return undefined;
  }
  return {
    label: record.label,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.filter((keyword): keyword is string => typeof keyword === "string")
      : [],
  };
}

function hermesRuleLabel(action: Record<string, unknown>): string | undefined {
  if (action.type !== "apply_label" || typeof action.labelName !== "string") {
    return undefined;
  }
  return action.labelName;
}

function hermesRuleKeywords(condition: Record<string, unknown>): string[] {
  return Array.isArray(condition.anyKeywords)
    ? condition.anyKeywords.filter((keyword): keyword is string => typeof keyword === "string")
    : [];
}

function mailItemKey(mail: Pick<MailItem, "accountId" | "id">): string {
  return `${mail.accountId}:${mail.id}`;
}

function firstSmartMailKey(items: MailItem[]): string {
  const [first] = [...items].sort((left, right) => right.score - left.score);
  return first ? mailItemKey(first) : "";
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
    return normalizeReaderText(template.content.textContent ?? "");
  }

  return normalizeReaderText(html.replace(/<[^>]*>/g, " "));
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

function parseComposeRecipients(value: string): Array<{ address: string; name?: string }> {
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const displayMatch = /^(.*?)<([^>]+)>$/.exec(part);
      if (displayMatch) {
        const name = displayMatch[1]?.trim().replace(/^"|"$/g, "");
        const address = displayMatch[2]?.trim() ?? "";
        return name ? { address, name } : { address };
      }

      return { address: part };
    })
    .filter((recipient) => recipient.address.includes("@"));
}

function defaultScheduleDateTimeLocal(): string {
  return dateToDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000));
}

function parseDateTimeLocal(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function isoToDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return dateToDateTimeLocal(date);
}

function dateToDateTimeLocal(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function seedRescheduleTimes(
  current: Record<string, string>,
  items: ScheduledSendDto[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const item of items) {
    next[item.id] = current[item.id] ?? isoToDateTimeLocal(item.scheduledAt);
  }

  return next;
}

function composeAttachmentFromSeed(
  attachment: MailComposeSeedAttachmentDto,
): MailDraftAttachmentDto {
  return {
    id: attachment.id,
    source: "message_attachment",
    attachmentId: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    inline: attachment.inline,
  };
}

async function composeAttachmentFromFile(
  file: File,
  accountId: string,
): Promise<MailDraftAttachmentDto> {
  const contentBase64 = await fileToBase64(file);
  const attachmentId = `upload_${accountId}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}_${file.name}_${file.size}_${file.lastModified}`;
  return {
    id: attachmentId,
    source: "uploaded_file",
    attachmentId,
    filename: file.name || "attachment",
    contentType: file.type || "application/octet-stream",
    byteSize: file.size,
    inline: false,
    contentBase64,
  };
}

async function fileToBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer !== "function") {
    return fileToBase64WithReader(file);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function fileToBase64WithReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file read failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const marker = "base64,";
      const index = result.indexOf(marker);
      if (index < 0) {
        reject(new Error("file read failed"));
        return;
      }
      resolve(result.slice(index + marker.length));
    };
    reader.readAsDataURL(file);
  });
}

function saveAttachmentDownload(
  download: AttachmentDownload,
  fallbackFilename: string,
): void {
  const objectUrl = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = sanitizeDownloadFilename(download.filename, fallbackFilename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function sanitizeDownloadFilename(filename: string, fallbackFilename: string): string {
  const safeName = (filename || fallbackFilename || "attachment")
    .replace(/[\\/\0\r\n]/g, "_")
    .trim();
  return safeName || "attachment";
}

function formatAttachmentSize(byteSize: number): string {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.ceil(byteSize / 1024))} KB`;
}

function bucketLabel(bucket: string): string {
  if (bucket.includes("Urgent")) return "优先";
  if (bucket.includes("Important")) return "重要";
  if (bucket.includes("Feed")) return "订阅";
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
    move_to_feed: "移到 Feed",
    always_important_sender: "始终重要发件人",
    mute_sender: "静音发件人",
  };
  return labels[action];
}

function isActionableFollowUpStatus(
  status: HermesFollowupTrackerResult["status"],
): status is "needs_reply" | "waiting_on_them" {
  return status === "needs_reply" || status === "waiting_on_them";
}
