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
import type {
  AttachmentDownload,
  AttachmentDto,
  DomainAliasDto,
  DomainDeliveryLogDto,
  DomainDestinationDto,
  DomainDto,
  EmailHubApi,
  FollowUpDto,
  GatekeeperMode,
  GatekeeperSenderDto,
  HermesFollowupTrackerResult,
  HermesQuickReplyScenario,
  HermesProviderCatalogItem,
  HermesProviderProbeMissing,
  HermesRuntimeMode,
  HermesRuntimeUpdateChannel,
  HermesRuntimeUpdatePolicy,
  HermesRuntimeVersionStatus,
  ImapSmtpConnectionTestResult,
  ImapSmtpOnboardingInput,
  AccountTransferPackage,
  MailQuickFilter,
  MailActionResult,
  MailComposePreviewDto,
  MailComposeSeedDto,
  MailComposeSeedAttachmentDto,
  MailComposeSeedMode,
  MailDraftAttachmentDto,
  MailDraftDto,
  MailDraftSource,
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
  SyncCenterAccountDto
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
const PREVIEW_ATTACHMENT_ROWS = [
  { name: "Q2_合作方案_最终版.pdf", size: "1.2 MB" },
  { name: "报价明细表.xlsx", size: "320 KB" },
];

type ComposeAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

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
  sender: string;
  email: string;
  subject: string;
  preview: string;
  time: string;
  date: string;
  label: string;
  tone: Tone;
  unread: boolean;
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

const labels = [
  { id: "work", label: "工作", count: 32, tone: "coral" },
  { id: "customer", label: "客户", count: 18, tone: "green" },
  { id: "finance", label: "财务", count: 6, tone: "blue" },
  { id: "product", label: "产品", count: 42, tone: "yellow" },
  { id: "market", label: "市场", count: 15, tone: "purple" }
] as const;

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

const mailItems: MailItem[] = [
  {
    id: "m1",
    sender: "张伟（客户成功）",
    email: "zhangwei@example.com",
    subject: "关于 Q2 合作方案的确认",
    preview: "附件是我们讨论的合作方案，请查收。如有任何问题，随时沟通。",
    time: "10:24",
    date: "2026年6月12日",
    label: "工作",
    tone: "coral",
    unread: true,
    bucket: "P1 Urgent",
    score: 97,
    reasons: ["直接发给你", "你常回复此发件人", "Hermes 识别为需要回复", "今天 17:00 截止", "来自项目标签"]
  },
  {
    id: "m2",
    sender: "陈晨（客户）",
    email: "chenchen@example.com",
    subject: "需求文档 V2.1",
    preview: "更新后的需求文档已经上传，请查阅。里面有两个地方需要确认。",
    time: "昨天",
    date: "2026年6月11日",
    label: "客户",
    tone: "green",
    unread: true,
    bucket: "P2 Important",
    score: 88,
    reasons: ["直接发给你", "你常回复此发件人"]
  },
  {
    id: "m3",
    sender: "李娜（市场部）",
    email: "lina@example.com",
    subject: "新品发布会排期确认",
    preview: "以下是新品发布会的初步排期，请确认是否需要调整。",
    time: "09:58",
    date: "2026年6月12日",
    label: "市场",
    tone: "purple",
    unread: true,
    bucket: "P2 Important",
    score: 82,
    reasons: ["直接发给你", "来自项目标签"]
  },
  {
    id: "m4",
    sender: "王磊（技术支持）",
    email: "support@example.com",
    subject: "系统升级通知",
    preview: "我们将于本周五 22:00-24:00 进行系统升级。",
    time: "昨天",
    date: "2026年6月11日",
    label: "产品",
    tone: "yellow",
    unread: false,
    bucket: "P5 Transactions",
    score: 43,
    reasons: ["系统通知", "无需立即处理"]
  },
  {
    id: "m5",
    sender: "财务部",
    email: "finance@example.com",
    subject: "5 月费用报销审批结果",
    preview: "您的报销单 EXP-202505-087 已审批通过，付款将在 2 个工作日内完成。",
    time: "昨天",
    date: "2026年6月11日",
    label: "财务",
    tone: "blue",
    unread: false,
    bucket: "P5 Transactions",
    score: 38,
    reasons: ["票据通知", "无需回复"]
  },
  {
    id: "m6",
    sender: "产品团队",
    email: "product@example.com",
    subject: "迭代计划 - 第 23 周",
    preview: "本周迭代计划已更新，请相关同事审阅。",
    time: "5月30日",
    date: "2026年5月30日",
    label: "产品",
    tone: "yellow",
    unread: false,
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
  { title: "Proton Mail", subtitle: "连接 Proton 邮箱", mark: "P", provider: "proton", action: "bridge" },
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
const PREVIEW_ACCOUNT_ID = "account_1";

export function App(props: AppProps = {}) {
  const oauthCallback = readOAuthCallbackFromLocation(
    typeof window === "undefined" ? undefined : window.location,
  );
  const [activeView, setActiveView] = useState<ViewId>("mail");
  const [activeAddMailProviderGroup, setActiveAddMailProviderGroup] = useState<
    AddMailProviderGroupId | undefined
  >();
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [activeMailId, setActiveMailId] = useState(props.api ? "" : mailItems[0].id);
  const [hermesPrompt, setHermesPrompt] = useState("搜索邮件、写回复、整理收件箱...");
  const [workspaceFolders, setWorkspaceFolders] = useState<FolderItem[]>(folders);
  const [workspaceMail, setWorkspaceMail] = useState<MailItem[]>(mailItems);
  const [selectedDetail, setSelectedDetail] = useState<MessageDetailDto | undefined>();
  const [undoToast, setUndoToast] = useState<UndoToastState | undefined>();
  const [backendNotice, setBackendNotice] = useState<string | undefined>();
  const [searchLaunch, setSearchLaunch] = useState<SearchLaunch | undefined>();
  const [navigationProviderGroups, setNavigationProviderGroups] =
    useState<ProviderGroup[]>(providerGroups);
  const [navigationQuickCategories, setNavigationQuickCategories] =
    useState<QuickCategory[]>(quickCategories);
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

  const accountId = selectedAccountId ?? PREVIEW_ACCOUNT_ID;
  const sortedMail = useMemo(() => [...workspaceMail].sort((left, right) => right.score - left.score), [workspaceMail]);
  const selectedMail = sortedMail.find((mail) => mail.id === activeMailId) ?? sortedMail[0];

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

  async function selectFirstBackendAccount() {
    if (!props.api) {
      return;
    }

    try {
      const page = await props.api.listSyncCenterAccounts();
      const firstAccount = page.items.find((account) => account.accountId);
      rememberSelectedAccount(firstAccount?.accountId);
    } catch {
      // Keep the local preview account when account discovery is unavailable.
    }
  }

  async function handleConnectedAccount(nextAccountId?: string) {
    if (nextAccountId) {
      rememberSelectedAccount(nextAccountId);
    } else {
      await selectFirstBackendAccount();
    }

    await refreshNavigationSummary();
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
        const firstAccount = page.items.find((account) => account.accountId);
        const selectedAccountExists =
          selectedAccountId &&
          selectedAccountId !== PREVIEW_ACCOUNT_ID &&
          page.items.some((account) => account.accountId === selectedAccountId);
        if (selectedAccountExists) {
          setAccountDiscoveryReady(true);
          return;
        }

        rememberSelectedAccount(firstAccount?.accountId);
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
    if (!props.api || !selectedAccountId || !accountDiscoveryReady) {
      return;
    }

    let alive = true;
    setBackendNotice("Loading mail...");
    void Promise.all([
      props.api.listMailboxes({ accountId }),
      props.api.listMessages({ accountId, limit: 50, sort: "smart" })
    ])
      .then(([mailboxPage, messagePage]) => {
        if (!alive) return;
        const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
        setWorkspaceFolders(mailboxPage.items.map(mapMailboxDtoToFolderItem));
        setWorkspaceMail(mappedMail);
        setActiveFolder(mailboxPage.items[0]?.id ?? "inbox");
        setActiveMailId(mappedMail[0]?.id ?? "");
        setBackendNotice(undefined);
      })
      .catch(() => {
        if (alive) {
          setBackendNotice("Mail service is temporarily unavailable; showing local preview.");
        }
      });

    return () => {
      alive = false;
    };
  }, [accountDiscoveryReady, accountId, props.api, selectedAccountId]);

  async function loadSavedView(savedView: string) {
    setActiveFolder(savedView);
    if (!props.api) {
      return;
    }

    setBackendNotice("正在加载分类邮件...");
    try {
      const messagePage = await props.api.listMessages({
        accountId,
        limit: 50,
        sort: "smart",
        savedView,
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(mappedMail[0]?.id ?? "");
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("分类邮件暂时不可用，正在显示当前邮件。");
    }
  }

  async function loadMailbox(mailboxId: string) {
    setActiveFolder(mailboxId);
    if (!props.api) {
      return;
    }

    setBackendNotice("正在加载邮箱目录...");
    try {
      const messagePage = await props.api.listMessages({
        accountId,
        mailboxId,
        limit: 50,
        sort: "smart",
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(mappedMail[0]?.id ?? "");
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("邮箱目录暂时不可用，正在显示当前邮件。");
    }
  }

  useEffect(() => {
    if (!props.api || !activeMailId) {
      return;
    }

    let alive = true;
    void props.api
      .getMessage({ accountId, messageId: activeMailId })
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
  }, [accountId, activeMailId, props.api]);

  useEffect(() => {
    setHermesFollowUpSuggestion(undefined);
    setFollowUpNotice(undefined);
  }, [activeMailId]);

  async function applySelectedAction(action: "done" | "archive" | "trash") {
    if (!props.api || !selectedMail) {
      return;
    }

    const result = await props.api.applyMailAction({
      accountId,
      messageId: selectedMail.id,
      action
    });
    applyActionResult(result);
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
    setWorkspaceMail((items) =>
      items.map((item) =>
        item.id === result.messageId
          ? {
              ...item,
              unread: result.state.unread,
              mailboxIds: result.state.mailboxIds
            }
          : item
      )
    );
    if (result.action === "done" && result.state.undoToken) {
      setUndoToast({
        accountId: result.accountId,
        messageId: result.messageId,
        undoToken: result.state.undoToken
      });
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
          <MailWorkspace
            api={props.api}
            accountId={accountId}
            activeFolder={activeFolder}
            activeMailId={activeMailId}
            folders={workspaceFolders}
            mail={sortedMail}
            selectedMail={selectedMail}
            selectedDetail={selectedDetail}
            undoToast={undoToast}
            backendNotice={backendNotice}
            quickCategories={navigationQuickCategories}
            hermesFollowUpSuggestion={hermesFollowUpSuggestion}
            followUpNotice={followUpNotice}
            density={mailDensity}
            onAddMail={() => setActiveView("add-mail")}
            onGlobalSearch={launchGlobalSearch}
            onDensityChange={setMailDensity}
            onFolderChange={(id) => void loadMailbox(id)}
            onSavedViewChange={(id) => void loadSavedView(id)}
            onMailChange={setActiveMailId}
            onDone={() => void applySelectedAction("done")}
            onUndoDone={() => void undoDone()}
            onTrackFollowUp={() => void trackSelectedFollowUp()}
            onConfirmHermesFollowUp={() => void confirmHermesFollowUp()}
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
            accountId={accountId}
            launch={searchLaunch}
          />
        ) : null}
        {activeView === "settings" ? (
          <SettingsPage api={props.api} accountId={accountId} />
        ) : null}
      </main>

      <HermesDock prompt={hermesPrompt} onPromptChange={setHermesPrompt} />
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
  quickCategories: QuickCategory[];
  hermesFollowUpSuggestion?: HermesFollowupTrackerResult;
  followUpNotice?: string;
  density: MailDensity;
  onAddMail: () => void;
  onGlobalSearch: (query: string) => void;
  onDensityChange: (density: MailDensity) => void;
  onFolderChange: (id: string) => void;
  onSavedViewChange: (id: string) => void;
  onMailChange: (id: string) => void;
  onDone: () => void;
  onUndoDone: () => void;
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
  const [rescheduleTimes, setRescheduleTimes] = useState<Record<string, string>>(
    {},
  );
  const composeAutosaveTimerRef = useRef<number | undefined>(undefined);
  const composeAutosaveGenerationRef = useRef(0);
  const lastSavedComposeSignatureRef = useRef("");

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
    setAttachmentDownloadBusyId(undefined);
    setAttachmentDownloadNotice("");
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
            {labels.map((label) => (
              <button key={label.id} className="label-row" type="button">
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
          <span>智能收件箱：先分类，再排序</span>
          </div>
          {props.mail.map((mail) => (
            <button
              key={mail.id}
              className={props.activeMailId === mail.id ? "message-row active" : "message-row"}
              onClick={() => props.onMailChange(mail.id)}
              type="button"
            >
              <span className={mail.unread ? "unread-dot" : "read-dot"} />
              <div className="message-row-main">
                <div className="row-topline">
                  <strong>{mail.sender}</strong>
                  <time>{mail.time}</time>
                </div>
                <div className="row-subject">
                  <Star size={14} className={mail.unread ? "star-hot" : ""} />
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
              onClick={props.onDone}
            >
              Done
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Ask Hermes to track follow-up"
              onClick={props.onTrackFollowUp}
            >
              Hermes 跟进
            </button>
            <button className="toolbar-button" type="button">归档</button>
            <button className="toolbar-button danger" type="button">删除</button>
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
              <Star size={19} className="star-hot" />
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

            <div className="message-body">
              <p>你好，</p>
              <p>{props.selectedDetail?.bodyText ?? props.selectedMail.preview}</p>
              <p>附件是我们讨论的合作方案，请查收。如果需要调整，我今天下午可以继续同步。</p>
              <p>谢谢。</p>
            </div>

            <div className="attachment-box">
              <div className="attachment-head">
                <strong>
                  {detailAttachments?.length ?? PREVIEW_ATTACHMENT_ROWS.length} 个附件
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
                : PREVIEW_ATTACHMENT_ROWS.map((attachment) => (
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
  if (capability.provider === "gmail" || capability.provider === "outlook") {
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
  const [providerOptions, setProviderOptions] =
    useState<ProviderOption[]>(providers);
  const [csvImportText, setCsvImportText] = useState("");
  const [transferPackageText, setTransferPackageText] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkBusy, setBulkBusy] = useState("");

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
    try {
      const testResult = await props.api.testImapSmtpConnection(input);
      if (!testResult.ok) {
        await loadOnboardingDiagnostics();
        setNotice(
          `${provider.title} 连接检查没有通过：${connectionCheckSummary(testResult)}`,
        );
        return;
      }

      const result = await props.api.onboardImapSmtpAccount(input);
      props.onConnected?.(result.account?.id);
      setNotice(`${provider.title} 已接入，同步会自动开始。`);
    } catch {
      await loadOnboardingDiagnostics();
      setNotice(`${provider.title} 暂时无法接入，请检查填写的信息。`);
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
    try {
      const testResult = await props.api.testImapSmtpConnection(input);
      if (!testResult.ok) {
        await loadOnboardingDiagnostics();
        setNotice(
          `${manualProvider.title} 连接检查没有通过，${connectionCheckSummary(testResult)}`,
        );
        return;
      }

      const result = await props.api.onboardImapSmtpAccount(input);
      props.onConnected?.(result.account?.id);
      setNotice(`${manualProvider.title} 已接入，同步会自动开始。`);
    } catch {
      await loadOnboardingDiagnostics();
      setNotice(`${manualProvider.title} 暂时无法接入，请检查填写的信息。`);
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
      setBulkNotice(
        `已创建 ${result.summary.ready + result.summary.needsOAuth} 个导入任务。`,
      );
      props.onConnected?.();
    } catch {
      setBulkNotice("导入任务创建失败，请检查 CSV 内容。");
    } finally {
      setBulkBusy("");
    }
  }

  async function exportTransferPackage() {
    if (!props.api) {
      setBulkNotice("连接服务后才能导出账号配置。");
      return;
    }

    setBulkBusy("transfer-export");
    try {
      const transferPackage = await props.api.exportAccountTransfer();
      setTransferPackageText(JSON.stringify(transferPackage, null, 2));
      setBulkNotice(`已导出 ${transferPackage.accounts.length} 个账号配置，不包含密码或令牌。`);
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

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar">
        <div>
          <h1>添加邮箱</h1>
          <p>选择要接入的邮箱，按提示登录或填写必要信息。</p>
        </div>
      </header>

      {notice ? <div className="backend-notice" role="status">{notice}</div> : null}

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
            <p>CSV 会创建待处理接入任务；迁移包只保存安全配置，导入后需要重新授权。</p>
          </div>
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
              placeholder="email,provider,display_name,auth_method,..."
              onChange={(event) => setCsvImportText(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>账号迁移包</span>
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
        <div className="inline-actions">
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
          <button
            className="ghost-button"
            type="button"
            disabled={bulkBusy === "transfer-import"}
            onClick={() => void importTransferPackage()}
          >
            导入迁移包
          </button>
        </div>
      </section>

      {diagnostics.length > 0 ? (
        <section className="page-panel diagnostic-list" aria-label="添加邮箱诊断">
          <h2>最近诊断</h2>
          {diagnostics.map((event) => (
            <div className="diagnostic-row" key={event.id}>
              <strong>{friendlyDiagnosticMessage(event)}</strong>
              <span>{event.occurredAt}</span>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
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

function connectionCheckSummary(result: ImapSmtpConnectionTestResult): string {
  const failed = Object.entries(result.checks)
    .filter(([, check]) => !check.ok)
    .map(([name, check]) =>
      check.code
        ? `${connectionCheckLabel(name)} ${check.code}`
        : connectionCheckLabel(name),
    );

  return failed.length > 0 ? failed.join(" / ") : "请检查邮箱地址和授权码";
}

function connectionCheckLabel(name: string): string {
  if (name === "imap") {
    return "收信";
  }
  if (name === "smtp") {
    return "发信";
  }

  return name;
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
    qq: "QQ 邮箱",
    "163": "163 邮箱",
    custom: "个人域名"
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
    account_transfer_import: "账号迁移",
    csv_import: "批量导入",
  };
  return labels[source] ?? source;
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
  const [busyAction, setBusyAction] = useState("");
  const [busyReauthorizationTaskId, setBusyReauthorizationTaskId] = useState("");
  const [diagnosticAccount, setDiagnosticAccount] =
    useState<SyncCenterAccountDto | null>(null);
  const [diagnosticEvents, setDiagnosticEvents] = useState<OperationalEventDto[]>(
    [],
  );
  const [diagnosticNotice, setDiagnosticNotice] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);

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

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>同步中心</h1>
          <p>查看连接状态、同步队列、失效账号和重新授权入口。</p>
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
          {reauthorizations.map((task) => (
            <div className="task-row" key={task.taskId}>
              <ShieldCheck size={19} />
              <div>
                <strong>{task.email}</strong>
                <span>
                  {formatProviderLabel(task.provider)} · {task.authMethod === "oauth" ? "重新登录" : "重新提交授权码"}
                  {task.source ? ` · ${formatReauthorizationSource(task.source)}` : ""}
                </span>
                {task.errorMessage ? <p>{task.errorMessage}</p> : null}
              </div>
              <div className="task-actions">
                <button
                  type="button"
                  aria-label={`Start reauthorization for ${task.email}`}
                  disabled={
                    task.authMethod !== "oauth" ||
                    busyReauthorizationTaskId === task.taskId
                  }
                  onClick={() => void startOAuthReauthorization(task)}
                >
                  {task.authMethod === "oauth" ? "重新登录" : "去添加邮箱处理"}
                </button>
              </div>
            </div>
          ))}
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
                    <strong>{event.event}</strong>
                    <span>
                      {event.service} · {event.level}
                      {event.jobId ? ` · ${event.jobId}` : ""}
                    </span>
                    {event.message ? <p>{event.message}</p> : null}
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
              <div className="search-result" key={mail.id}>
                <strong>{mail.subject}</strong>
                <span>
                  {mail.searchPreview ?? mail.preview} · {mail.sender} · {mail.date}{" "}
                  {mail.time}
                </span>
              </div>
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
  const [destinations, setDestinations] = useState<DomainDestinationDto[]>([]);
  const [aliases, setAliases] = useState<DomainAliasDto[]>([]);
  const [logs, setLogs] = useState<DomainDeliveryLogDto[]>([]);
  const [notice, setNotice] = useState("正在加载域名设置...");

  useEffect(() => {
    if (!props.api) {
      setDomains([
        {
          id: "preview_domain",
          domain: "demo.site",
          verificationStatus: "pending",
          dnsRecords: {},
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setDestinations([
        {
          id: "preview_destination",
          domainId: "preview_domain",
          email: "owner@example.net",
          verified: false,
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setAliases([
        {
          id: "preview_alias",
          domainId: "preview_domain",
          address: "support@demo.site",
          localPart: "support",
          enabled: true,
          destinationIds: ["preview_destination"],
          createdAt: "2026-06-13T08:00:00.000Z",
        },
      ]);
      setLogs([
        {
          id: "preview_log",
          domainId: "preview_domain",
          recipient: "support@demo.site",
          status: "delivered",
          createdAt: "2026-06-13T09:00:00.000Z",
        },
      ]);
      setNotice("正在显示本地预览，连接服务后会同步真实域名设置。");
      return;
    }

    let alive = true;
    setNotice("正在加载域名设置...");
    void props.api
      .listDomains()
      .then(async (domainPage) => {
        if (!alive) return;
        const firstDomain = domainPage.items[0];
        setDomains(domainPage.items);
        if (!firstDomain) {
          setDestinations([]);
          setAliases([]);
          setLogs([]);
          setNotice("还没有添加个人域名。");
          return;
        }

        const [destinationPage, aliasPage, logPage] = await Promise.all([
          props.api!.listDomainDestinations({ domainId: firstDomain.id }),
          props.api!.listDomainAliases({ domainId: firstDomain.id }),
          props.api!.listDomainDeliveryLogs({
            domainId: firstDomain.id,
            limit: 20,
          }),
        ]);
        if (!alive) return;
        setDestinations(destinationPage.items);
        setAliases(aliasPage.items);
        setLogs(logPage.items);
        setNotice("");
      })
      .catch(() => {
        if (!alive) return;
        setDomains([]);
        setDestinations([]);
        setAliases([]);
        setLogs([]);
        setNotice("域名设置暂时不可用。");
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  const title = props.mode === "domains" ? "域名管理" : "别名转发";
  const description =
    props.mode === "domains"
      ? "集中查看个人域名、验证状态、目标邮箱和最近投递。"
      : "查看别名地址、转发目标和最近投递状态。";

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
        <article className="settings-module">
          <div>
            <h3>个人域名</h3>
            {domains.length > 0 ? (
              domains.map((domain) => (
                <p key={domain.id}>
                  <strong>{domain.domain}</strong> · {formatDomainStatus(domain.verificationStatus)}
                </p>
              ))
            ) : (
              <p>还没有域名。</p>
            )}
          </div>
        </article>
        <article className="settings-module">
          <div>
            <h3>目标邮箱</h3>
            {destinations.length > 0 ? (
              destinations.map((destination) => (
                <p key={destination.id}>
                  <strong>{destination.email}</strong> · {destination.verified ? "已确认" : "待确认"}
                </p>
              ))
            ) : (
              <p>还没有目标邮箱。</p>
            )}
          </div>
        </article>
      </div>
      <div className="settings-card-grid">
        <article className="settings-module">
          <div>
            <h3>别名地址</h3>
            {aliases.length > 0 ? (
              aliases.map((alias) => (
                <p key={alias.id}>
                  <strong>{alias.address}</strong> · {alias.enabled ? "启用中" : "已停用"}
                </p>
              ))
            ) : (
              <p>还没有别名。</p>
            )}
          </div>
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

function HermesDock(props: { prompt: string; onPromptChange: (value: string) => void }) {
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
    setIsOpen(true);
    setActivityVersion((version) => version + 1);
  }

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
          <button className="dock-model" type="button" onClick={showDock}>
            <Sparkles size={18} />
            Hermes
          </button>
          <input
            className="dock-command-input"
            value={props.prompt}
            placeholder="搜索邮件、写回复、整理收件箱..."
            onChange={(event) => {
              props.onPromptChange(event.target.value);
              showDock();
            }}
            onKeyDown={showDock}
          />
          <button className="dock-send" type="button" aria-label="发送给 Hermes" onClick={showDock}>
            <Send size={18} />
          </button>
        </>
      )}
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

function mapMessageDtoToMailItem(message: MessageListItemDto): MailItem {
  return {
    id: message.id,
    sender: message.from.name ?? message.from.email,
    email: message.from.email,
    subject: message.subject,
    preview: message.snippet ?? "",
    time: formatMailTime(message.receivedAt),
    date: formatMailDate(message.receivedAt),
    label: bucketLabel(message.classification.bucket),
    tone: toneForBucket(message.classification.bucket),
    unread: message.unread,
    mailboxIds: message.mailboxIds,
    bucket: message.classification.bucket,
    score: message.classification.priorityScore,
    reasons: message.classification.reasons,
    searchPreview: message.searchPreview?.text,
  };
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

function isActionableFollowUpStatus(
  status: HermesFollowupTrackerResult["status"],
): status is "needs_reply" | "waiting_on_them" {
  return status === "needs_reply" || status === "waiting_on_them";
}
