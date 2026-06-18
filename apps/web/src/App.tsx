import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Archive,
  AtSign,
  Bold,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Inbox,
  Italic,
  Link2,
  List,
  Mail,
  MailPlus,
  Paperclip,
  PenLine,
  Quote,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Undo2
} from "lucide-react";
import { ApiRequestError } from "./lib/emailHubApi";
import {
  applyMailActionStateToMailItem,
  dedupeMailItems,
  mailItemKey,
} from "./features/mail/mail-items";
import {
  composeBodyHtmlForPayload,
  formatComposeSelection,
} from "./features/compose/rich-text";
import { ComposeReview } from "./features/compose/ComposeReview";
import { formatComposeWarnings } from "./features/compose/composeWarnings";
import {
  HermesReaderTranslationControls,
  HermesReaderTranslationResult,
} from "./features/hermes/HermesReaderTranslationPanel";
import { useReaderTranslationPreferences } from "./features/hermes/useReaderTranslationPreferences";
import {
  HermesComposeDraftTools,
  HermesReplyAssistantPanel,
} from "./features/hermes/HermesComposeAssistPanel";
import {
  HermesReaderOrganizationPanel,
  HermesReaderSummaryPanel,
  formatHermesActionItemNote,
  hermesActionItemApplyId,
} from "./features/hermes/HermesReaderOrganizationPanels";
import { HermesDock, HermesNotice } from "./features/hermes/HermesDock";
import { HermesNaturalLanguageSearchPanel } from "./features/hermes/HermesNaturalLanguageSearchPanel";
import type { HermesQuickReplyAction } from "./features/hermes/HermesComposeAssistPanel";
import type { HermesOrganizationApplyAction } from "./features/hermes/HermesReaderOrganizationPanels";
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
import type { ComposeBodyFormat } from "./features/compose/rich-text";
import type { MailItem, Tone } from "./features/mail/mail-items";
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
  ComposeAttachmentMaintenanceCleanupResultDto,
  ComposeAttachmentMaintenanceStatusDto,
  DomainDeliveryLogDto,
  DomainDestinationDto,
  DomainDto,
  EmailHubApi,
  ApiHealthDto,
  FollowUpDto,
  GatekeeperMode,
  GatekeeperSenderDto,
  HermesEmailSearchQaResult,
  HermesActionItem,
  HermesActionPlanDto,
  HermesFollowupTrackerResult,
  HermesMessageSummaryResult,
  HermesMessageTranslationResult,
  HermesMessageOrganizationResult,
  HermesMemoryDto,
  HermesRuleCandidateDto,
  HermesRuleDto,
  HermesRuleHistoryBackfillDto,
  HermesRuleSimulationDto,
  HermesSkillRequiredPermission,
  HermesRetentionMaintenanceCleanupResultDto,
  HermesRetentionMaintenanceStatusDto,
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
  MailSendIdentityDiagnosticsDto,
  MailSendIdentityDto,
  MailTagMode,
  MailboxDto,
  MessageDetailDto,
  MessageListItemDto,
  MessageListSort,
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
type MailDensity = "roomy" | "comfortable" | "compact";
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
const COMPOSE_TEMPLATES = [
  {
    id: "follow_up",
    label: "跟进",
    subject: "跟进：",
    bodyText:
      "您好，\n\n想跟进一下上一封邮件里的事项。请您确认当前进展、下一步负责人和预计时间。\n\n谢谢。",
  },
  {
    id: "meeting_notes",
    label: "会议纪要",
    subject: "会议纪要：",
    bodyText:
      "大家好，\n\n以下是本次会议纪要：\n\n- 决议：\n- 待办：\n- 截止时间：\n\n如有遗漏请直接补充。",
  },
  {
    id: "handoff",
    label: "交接",
    subject: "交接说明：",
    bodyText:
      "您好，\n\n我整理了当前事项的交接信息：\n\n- 背景：\n- 当前状态：\n- 风险：\n- 下一步：\n\n请查收。",
  },
] as const;

type ComposeAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
type ReaderHermesBusy = "summary" | "translation" | "organize";
type SmartInboxBusyAction = "" | "bulk_done" | SmartInboxFeedbackAction;
type ReaderActionResult = boolean | Promise<boolean>;

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
  bodyHtml?: string;
  source: MailDraftSource;
  attachments?: MailDraftAttachmentDto[];
  replyToMessageId?: string;
  sourceMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
}

interface SearchLaunch extends HermesSearchLaunchOptions {
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
  accountId: string;
  label: string;
  count: number;
  tone: Tone;
}

const PREVIEW_ACCOUNT_ID = "account_1";

const navItems: Array<{ id: ViewId; label: string; icon: typeof Inbox; count?: number }> = [
  { id: "mail", label: "邮箱", icon: Inbox },
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
  { id: "notifications", label: "数据维护", description: "清理、审计、隐私", icon: Settings }
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

export interface AppProps {
  api?: EmailHubApi;
  defaultAccountId?: string;
  restrictToDefaultAccount?: boolean;
  oauthRedirect?: (url: string) => void;
}

interface UndoToastState {
  accountId: string;
  messageId: string;
  undoToken: string;
  mail?: MailItem;
}

interface OAuthCallbackParams {
  state: string;
  code: string;
  error?: string;
}

interface OAuthPendingState {
  provider: OAuthProvider;
  flow: "onboarding" | "reauthorization";
  returnTo: "add-mail";
  createdAt: string;
}

interface HermesNoticeState {
  text: string;
  skillId?: string;
  requiredPermission?: HermesSkillRequiredPermission;
}

interface HermesSkillSettingsFocus {
  skillId: string;
  requiredPermission?: HermesSkillRequiredPermission;
  requestId: number;
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
  const [hermesDockNoticeState, setHermesDockNoticeState] =
    useState<HermesNoticeState>();
  const [hermesSkillSettingsFocus, setHermesSkillSettingsFocus] =
    useState<HermesSkillSettingsFocus>();
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
  const [hermesWorkspaceContext, setHermesWorkspaceContext] =
    useState<HermesWorkspaceContextDto | undefined>();
  const [hermesWorkspaceContextLoading, setHermesWorkspaceContextLoading] =
    useState(false);
  const [hermesDockBusy, setHermesDockBusy] = useState(false);
  const hermesDockRequestRef = useRef(0);
  const [workspaceFolders, setWorkspaceFolders] = useState<FolderItem[]>(folders);
  const [workspaceMail, setWorkspaceMail] = useState<MailItem[]>(
    props.api ? [] : mailItems,
  );
  const [selectedDetail, setSelectedDetail] = useState<MessageDetailDto | undefined>();
  const [undoToast, setUndoToast] = useState<UndoToastState | undefined>();
  const [backendNotice, setBackendNotice] = useState<string | undefined>();
  const [searchLaunch, setSearchLaunch] = useState<SearchLaunch | undefined>();
  const [navigationProviderGroups, setNavigationProviderGroups] =
    useState<ProviderGroup[]>(props.api ? [] : providerGroups);
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
    skillId?: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) {
    setHermesDockNoticeState(
      notice ? { text: notice, skillId, requiredPermission } : undefined,
    );
  }

  function openHermesSkillSettings(
    skillId: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) {
    setHermesSkillSettingsFocus((current) => ({
      skillId,
      requiredPermission,
      requestId: (current?.requestId ?? 0) + 1,
    }));
    setActiveView("settings");
  }
  const [accountDiscoveryReady, setAccountDiscoveryReady] = useState(
    () => !props.api || Boolean(props.defaultAccountId),
  );
  const [mailDensity, setMailDensity] = useState<MailDensity>("compact");
  const [mailSort, setMailSort] = useState<MessageListSort>("smart");
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
  const accountId = selectedAccountId ?? PREVIEW_ACCOUNT_ID;
  const sortedMail = useMemo(
    () => sortMailItems(workspaceMail, mailSort),
    [mailSort, workspaceMail],
  );
  const sidebarMailCount = props.api
    ? workspaceMail.length
    : folders.find((folder) => folder.id === "inbox")?.count ?? workspaceMail.length;
  const effectiveNavItems = navItems.map((item) =>
    item.id === "mail" ? { ...item, count: sidebarMailCount } : item,
  );
  const selectedMail =
    sortedMail.find((mail) => mailItemKey(mail) === activeMailId) ?? sortedMail[0];
  const selectedMailAccountId = selectedMail?.accountId ?? selectedAccountId;
  const workspaceAccountId =
    selectedMailAccountId ?? selectedAccountId ?? PREVIEW_ACCOUNT_ID;
  const activeFolderSummary = folderSummaryForActiveView({
    activeFolder,
    folders: workspaceFolders,
    labels: navigationLabels,
    quickCategories: navigationQuickCategories,
    mail: workspaceMail,
  });

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
      setNavigationProviderGroups([]);
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

  function launchGlobalSearch(
    query: string,
    options: Omit<SearchLaunch, "query" | "requestId"> = {},
  ) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
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
      setHermesDockNotice("请先添加邮箱并完成同步，再让 Hermes 搜索邮件。");
      return;
    }

    setHermesDockBusy(true);
    if (isHermesRuleCommand(question)) {
      setHermesDockNotice("Hermes 正在生成可确认执行计划...");
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
          `Hermes 已生成执行计划，shadow simulation 命中 ${plan.simulation?.matchedCount ?? 0} 封邮件。`,
        );
      } catch (error) {
        if (!isCurrentHermesDockRequest(requestId)) {
          return;
        }
        setHermesDockNotice(
          hermesActionPlanErrorNotice(error, "create"),
          hermesDisabledSkillIdFromError(error, "action_plan"),
          hermesDisabledSkillRequiredPermissionFromError(error),
        );
      } finally {
        if (isCurrentHermesDockRequest(requestId)) {
          setHermesDockBusy(false);
        }
      }
      return;
    }

    setHermesDockNotice("Hermes 正在搜索已同步邮件...");
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
          : "Hermes 没有找到匹配邮件。",
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
    setHermesDockNotice("正在确认 Hermes 执行计划...");
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
          ? `Hermes 执行计划已完成：${rule.title}，已回填 ${confirmation.historyBackfill.appliedCount} 封历史邮件。${target ? `已打开${target.label}。` : ""}`
          : `Hermes 执行计划已完成：${rule.title}${target ? `，已打开${target.label}` : ""}。`,
      );
    } catch (error) {
      if (!isCurrentHermesDockRequest(requestId)) {
        return;
      }
      setHermesDockNotice(
        hermesActionPlanErrorNotice(error, "confirm"),
        hermesDisabledSkillIdFromError(error, "action_plan"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      if (isCurrentHermesDockRequest(requestId)) {
        setHermesDockBusy(false);
      }
    }
  }

  async function handleSettingsHermesRuleApproved(rule: HermesRuleDto) {
    const target = hermesRuleNavigationTarget(rule);
    await refreshNavigationSummary();
    await refreshLabels(rule.accountId);
    await refreshHermesWorkspaceContext({
      accountId: rule.accountId,
      force: true,
    });
    if (target?.kind === "savedView") {
      await loadSavedView(target.id);
      setActiveView("mail");
    } else if (target?.kind === "label") {
      await loadLabel(target.id);
      setActiveView("mail");
    }
  }

  useEffect(() => {
    void refreshNavigationSummary();
    void refreshConnectedAccountCount();
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
            sort: mailSort,
          }),
        ]).then(([mailboxPage, messagePage]) => ({
          folders: mailboxPage.items.map(mapMailboxDtoToFolderItem),
          messages: messagePage.items,
          activeFolderId: mailboxPage.items[0]?.id ?? "inbox",
        }))
      : props.api.listMessages({ limit: 50, sort: mailSort }).then((messagePage) => ({
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
        setActiveMailId(firstMailKey(mappedMail, mailSort));
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

  async function loadSavedView(savedView: string, sortOverride = mailSort) {
    setActiveFolder(savedView);
    if (!props.api) {
      return;
    }

    setBackendNotice("正在加载分类邮件...");
    try {
      const messagePage = await props.api.listMessages({
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
        limit: 50,
        sort: sortOverride,
        savedView,
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(firstMailKey(mappedMail, sortOverride));
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("分类邮件暂时不可用，正在显示当前邮件。");
    }
  }

  async function loadLabel(labelId: string, sortOverride = mailSort) {
    setActiveFolder(`label:${labelId}`);
    if (!props.api || !selectedAccountId) {
      return;
    }

    setBackendNotice("正在加载标签邮件...");
    try {
      const messagePage = await props.api.listMessages({
        accountId: selectedAccountId,
        limit: 50,
        sort: sortOverride,
        labelIds: [labelId],
        tagMode: "any",
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(firstMailKey(mappedMail, sortOverride));
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("标签邮件暂时不可用，正在显示当前邮件。");
    }
  }

  async function loadMailbox(mailboxId: string, sortOverride = mailSort) {
    setActiveFolder(mailboxId);
    if (!props.api) {
      return;
    }
    if (!selectedAccountId) {
      setBackendNotice("正在加载聚合收件箱...");
      try {
        const messagePage = await props.api.listMessages({
          limit: 50,
          sort: sortOverride,
        });
        const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
        setWorkspaceMail(mappedMail);
        setSelectedDetail(undefined);
        setActiveMailId(firstMailKey(mappedMail, sortOverride));
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
        sort: sortOverride,
      });
      const mappedMail = messagePage.items.map(mapMessageDtoToMailItem);
      setWorkspaceMail(mappedMail);
      setSelectedDetail(undefined);
      setActiveMailId(firstMailKey(mappedMail, sortOverride));
      setBackendNotice(undefined);
    } catch {
      setBackendNotice("邮箱目录暂时不可用，正在显示当前邮件。");
    }
  }

  async function refreshCurrentMail(sortOverride = mailSort) {
    if (activeFolder.startsWith("label:")) {
      await loadLabel(activeFolder.slice("label:".length), sortOverride);
      return;
    }

    if (navigationQuickCategories.some((category) => category.id === activeFolder)) {
      await loadSavedView(activeFolder, sortOverride);
      return;
    }

    await loadMailbox(activeFolder, sortOverride);
  }

  function changeMailSort(nextSort: MessageListSort) {
    setMailSort(nextSort);
    void refreshCurrentMail(nextSort);
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
    hermesDockRequestRef.current += 1;
    setHermesDockBusy(false);
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

      const shouldRemove =
        result.action === "done" || result.state.archived || result.state.deleted;
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
    } else if (result.action === "done" || result.state.archived || result.state.deleted) {
      const remainingMail = workspaceMail.filter(
        (item) => mailItemKey(item) !== resultKey,
      );
      setActiveMailId((current) =>
        current === resultKey ? firstMailKey(remainingMail, mailSort) : current,
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
      setBackendNotice("连接服务后才能执行 Smart Inbox 批量 Done。");
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

      if (succeededKeys.size > 0) {
        const remainingMail = workspaceMail.filter(
          (item) => !succeededKeys.has(mailItemKey(item)),
        );
        setWorkspaceMail(remainingMail);
        setActiveMailId((current) =>
          current && remainingMail.some((item) => mailItemKey(item) === current)
            ? current
            : firstMailKey(remainingMail, mailSort),
        );
        if (selectedMail && succeededKeys.has(mailItemKey(selectedMail))) {
          setSelectedDetail(undefined);
        }
      }

      setBackendNotice(
        failedCount > 0
          ? `Smart Inbox 已完成 ${succeededCount} 封，${failedCount} 封稍后重试。`
          : `Smart Inbox 已完成 ${succeededCount} 封${successContext}邮件。`,
      );
    } catch {
      setBackendNotice("Smart Inbox 批量 Done 暂时不可用。");
    } finally {
      setSmartInboxBusy("");
    }
  }

  async function applySmartInboxBucketDone(bucket: string) {
    await applySmartInboxItemsDone(
      workspaceMail.filter((item) => item.bucket === bucket),
      "当前 Smart Inbox 卡片没有可处理邮件。",
      bucketLabel(bucket),
    );
  }

  async function applySelectedMessagesDone(items: MailItem[]) {
    await applySmartInboxItemsDone(
      items,
      "请先选择要 Done 的邮件。",
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
      setBackendNotice("连接服务后才能训练 Smart Inbox。");
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
        setBackendNotice("Smart Inbox 反馈暂时不可用。");
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
                reasons: result.classification.reasons,
              }
            : item;
        }),
      );

      const failedCount = settled.length - results.length;
      const feedbackLabel = smartInboxFeedbackLabel(action);
      setBackendNotice(
        failedCount > 0
          ? `Smart Inbox 已学习 ${results.length} 封，${failedCount} 封稍后重试。`
          : results.length > 1
            ? `Smart Inbox 已学习 ${results.length} 封：${feedbackLabel}。`
            : `Smart Inbox 已学习：${feedbackLabel}。`,
      );
      return failedCount === 0;
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
              "Hermes 跟进识别服务暂时不可用，请检查后端配置。",
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
    } catch (error) {
      setFollowUpNotice(
        hermesSkillErrorNotice(error, {
          skillId: "followup_tracker",
          fallback: "Hermes 跟进保存失败。",
          unavailable: {
            hermes_follow_up_unavailable:
              "Hermes 跟进保存服务暂时不可用，请检查后端配置。",
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
          {effectiveNavItems.map((item) => {
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
            <strong>已连接 {connectedAccountCount} 个邮箱</strong>
            <span>{connectedAccountCount > 0 ? "Hermes 后端在线" : "等待邮箱接入"}</span>
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
                folderTitle={activeFolderSummary.title}
                folderCount={activeFolderSummary.count}
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
                sort={mailSort}
                onAddMail={() => setActiveView("add-mail")}
                onGlobalSearch={launchGlobalSearch}
                onDensityChange={setMailDensity}
                onRefresh={() => void refreshCurrentMail()}
                onSortChange={changeMailSort}
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
                onSelectedMessagesDone={(items) => void applySelectedMessagesDone(items)}
                onSmartInboxFeedback={recordSmartInboxFeedback}
              onMailActionResult={applyActionResult}
              onLabelsChanged={(accountId) => void refreshLabels(accountId)}
              onTrackFollowUp={() => void trackSelectedFollowUp()}
              onConfirmHermesFollowUp={() => void confirmHermesFollowUp()}
              onOpenHermesSkillSettings={openHermesSkillSettings}
            />
          ) : (
            <MailEmptyState
              notice={backendNotice}
              undoToast={undoToast}
              onAddMail={() => setActiveView("add-mail")}
              onOpenSyncCenter={() => setActiveView("sync")}
              onUndoDone={() => void undoDone()}
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
            accountId={selectedMail?.accountId ?? selectedAccountId ?? ""}
            restrictToAccount={Boolean(restrictToDefaultAccount)}
            labels={navigationLabels}
            launch={searchLaunch}
            onOpenResult={openSearchResult}
            onOpenHermesSkillSettings={openHermesSkillSettings}
          />
        ) : null}
        {activeView === "settings" ? (
          <SettingsPage
            api={props.api}
            accountId={props.api ? selectedAccountId : accountId}
            focusedHermesSkillId={hermesSkillSettingsFocus?.skillId}
            focusedHermesSkillPermission={
              hermesSkillSettingsFocus?.requiredPermission
            }
            hermesSkillFocusRequestId={hermesSkillSettingsFocus?.requestId}
            onHermesRuleApproved={(rule) =>
              void handleSettingsHermesRuleApproved(rule)
            }
          />
        ) : null}
      </main>

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
        noticeActionSkillId={hermesDockNoticeState?.skillId}
        noticeActionPermission={hermesDockNoticeState?.requiredPermission}
        formatDate={formatMailDate}
        onPromptChange={updateHermesPrompt}
        onOpen={() => void refreshHermesWorkspaceContext()}
        onSubmit={(prompt) => void submitHermesDockPrompt(prompt)}
        onApproveRule={() => void approveHermesDockRule()}
        onOpenSearch={launchGlobalSearch}
        onOpenHermesSkillSettings={openHermesSkillSettings}
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
        const result =
          pending.flow === "reauthorization"
            ? await props.api.completeSyncCenterOAuthReauthorizationCallback({
                state: props.callback.state,
                code: props.callback.code,
              })
            : await props.api.completeOAuthCallback({
                provider: pending.provider,
                state: props.callback.state,
                code: props.callback.code,
              });
        if (!alive) {
          return;
        }

        clearOAuthPendingState(props.callback.state);
        props.onConnected(result.account?.id);
        const actionText =
          pending.flow === "reauthorization" ? "已重新授权" : "已连接";
        setStatus({
          kind: "success",
          message: `${result.account?.email ?? result.task.email} ${actionText}，正在同步邮件。`,
        });
      } catch {
        if (alive) {
          const retryText =
            pending.flow === "reauthorization"
              ? "重新登录没有完成，请回到同步中心重试。"
              : "邮箱连接没有完成，请回到添加邮箱重试。";
          setStatus({
            kind: "error",
            message: retryText,
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

function MailWorkspace(props: {
  api?: EmailHubApi;
  accountId: string;
  activeFolder: string;
    activeMailId: string;
    folders: FolderItem[];
    mail: MailItem[];
    folderTitle: string;
    folderCount: number;
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
    sort: MessageListSort;
    onAddMail: () => void;
    onGlobalSearch: (query: string) => void;
    onDensityChange: (density: MailDensity) => void;
    onRefresh: () => void;
    onSortChange: (sort: MessageListSort) => void;
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
    onSelectedMessagesDone: (items: MailItem[]) => void;
    onSmartInboxFeedback: (
      action: SmartInboxFeedbackAction,
      items?: MailItem[],
    ) => ReaderActionResult;
  onMailActionResult: (result: MailActionResult) => void;
  onLabelsChanged: (accountId: string) => void;
  onTrackFollowUp: () => void;
  onConfirmHermesFollowUp: () => void;
  onOpenHermesSkillSettings: (
    skillId: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) => void;
}) {
  const [topSearchQuery, setTopSearchQuery] = useState("");
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [labelNotice, setLabelNotice] = useState("");
  const [labelBusy, setLabelBusy] = useState(false);
  const [selectedMailKeys, setSelectedMailKeys] = useState<Set<string>>(
    () => new Set(),
  );
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
  const [graphDiagnosticsByCandidate, setGraphDiagnosticsByCandidate] =
    useState<Record<string, MailSendIdentityDiagnosticsDto>>({});
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeRichHtmlEnabled, setComposeRichHtmlEnabled] = useState(false);
  const [composeTranslationSource, setComposeTranslationSource] = useState("auto");
  const [composeTranslationTarget, setComposeTranslationTarget] =
    useState("English");
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
  const [composeNoticeState, setComposeNoticeState] =
    useState<HermesNoticeState>({ text: "" });
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
  const [readerHermesNoticeState, setReaderHermesNoticeState] =
    useState<HermesNoticeState>({ text: "" });
  const [readerHermesBusy, setReaderHermesBusy] =
    useState<ReaderHermesBusy | undefined>();
  const readerTranslationPreferences =
    useReaderTranslationPreferences("Chinese");
  const readerTranslationSource = readerTranslationPreferences.sourceLanguage;
  const readerTranslationTarget = readerTranslationPreferences.targetLanguage;
  const [readerTranslationPreferenceBusy, setReaderTranslationPreferenceBusy] =
    useState(false);
  const [readerHermesSummary, setReaderHermesSummary] =
    useState<HermesMessageSummaryResult | undefined>();
  const [readerHermesTranslation, setReaderHermesTranslation] =
    useState<HermesMessageTranslationResult | undefined>();
  const [readerHermesOrganization, setReaderHermesOrganization] =
    useState<HermesMessageOrganizationResult | undefined>();
  const [readerHermesApplyBusy, setReaderHermesApplyBusy] =
    useState<string | undefined>();
  const [rescheduleTimes, setRescheduleTimes] = useState<Record<string, string>>(
    {},
  );
  const composeAutosaveTimerRef = useRef<number | undefined>(undefined);
  const composeAutosaveGenerationRef = useRef(0);
  const lastSavedComposeSignatureRef = useRef("");
  const composeMessageRequestRef = useRef(0);
  const composeMessageRequestActiveRef = useRef(false);
  const composeMessageAccountIdRef = useRef(props.accountId);
  const composeBodyRef = useRef(composeBody);
  const readerHermesRequestRef = useRef(0);
  const readerTranslationPreferenceRequestRef = useRef(0);
  composeMessageAccountIdRef.current = props.accountId;
  composeBodyRef.current = composeBody;
  const composeNotice = composeNoticeState.text;
  const readerHermesNotice = readerHermesNoticeState.text;

  function setComposeNotice(
    notice: string,
    skillId?: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) {
    setComposeNoticeState({ text: notice, skillId, requiredPermission });
  }

  function setReaderHermesNotice(
    notice: string,
    skillId?: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) {
    setReaderHermesNoticeState({ text: notice, skillId, requiredPermission });
  }

  function selectReaderTranslationSource(sourceLanguage: string) {
    readerTranslationPreferences.selectSourceLanguageForSender({
      accountId: props.selectedMail.accountId,
      senderEmail: props.selectedMail.email,
      sourceLanguage,
    });
  }

  function cancelComposeAutosave(status: ComposeAutosaveStatus = "idle") {
    if (composeAutosaveTimerRef.current !== undefined) {
      window.clearTimeout(composeAutosaveTimerRef.current);
      composeAutosaveTimerRef.current = undefined;
    }
    composeAutosaveGenerationRef.current += 1;
    setComposeAutosaveStatus(status);
  }

  function beginComposeMessageRequest(): number {
    const requestId = composeMessageRequestRef.current + 1;
    composeMessageRequestRef.current = requestId;
    composeMessageRequestActiveRef.current = true;
    setComposeBusy(true);
    return requestId;
  }

  function isCurrentComposeMessageRequest(requestId: number): boolean {
    return composeMessageRequestRef.current === requestId;
  }

  function finishComposeMessageRequest(requestId: number): void {
    if (isCurrentComposeMessageRequest(requestId)) {
      composeMessageRequestActiveRef.current = false;
      setComposeBusy(false);
    }
  }

  function invalidateComposeMessageRequest(): void {
    composeMessageRequestRef.current += 1;
    if (composeMessageRequestActiveRef.current) {
      composeMessageRequestActiveRef.current = false;
      setComposeBusy(false);
    }
  }

  function canApplyComposeMessageResult(input: {
    requestId: number;
    accountId: string;
    body: string;
  }): boolean {
    return (
      isCurrentComposeMessageRequest(input.requestId) &&
      composeMessageAccountIdRef.current === input.accountId &&
      composeBodyRef.current === input.body
    );
  }

  function currentComposeSignature(input: {
    to: ReturnType<typeof parseComposeRecipients>;
    cc: ReturnType<typeof parseComposeRecipients>;
    bcc: ReturnType<typeof parseComposeRecipients>;
    bodyText: string;
  }) {
    const bodyHtml = composeBodyHtmlForPayload(
      input.bodyText,
      composeRichHtmlEnabled,
    );
    return composeDraftSignature({
      accountId: props.accountId,
      ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: composeSubject.trim(),
      bodyText: input.bodyText,
      ...(bodyHtml ? { bodyHtml } : {}),
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
    invalidateComposeMessageRequest();
    readerHermesRequestRef.current += 1;
    readerTranslationPreferenceRequestRef.current += 1;
    setAttachmentDownloadBusyId(undefined);
    setAttachmentDownloadNotice("");
    setReaderHermesNotice("");
    setReaderHermesSummary(undefined);
    setReaderHermesTranslation(undefined);
    setReaderHermesOrganization(undefined);
    setReaderHermesBusy(undefined);
    readerTranslationPreferences.applyPreferenceForSender({
      accountId: props.selectedMail.accountId,
      senderEmail: props.selectedMail.email,
    });
    setReaderHermesApplyBusy(undefined);
    setReaderTranslationPreferenceBusy(false);
  }, [props.selectedMail.id]);

  useEffect(() => {
    invalidateComposeMessageRequest();
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
  const visibleAttachmentCount =
    detailAttachments?.length ??
    (props.api ? props.selectedMail.attachmentCount : PREVIEW_ATTACHMENT_ROWS.length);
  const previewAttachments = props.api ? [] : PREVIEW_ATTACHMENT_ROWS;
  const readerBodyText = messageReaderText(props.selectedDetail, props.selectedMail);
  const readerRecipientSummary = messageRecipientSummary(
    props.selectedDetail,
  );
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
    composeRichHtmlEnabled,
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

  async function diagnoseGraphSendIdentityCandidate(
    candidate: MailSendIdentityCandidateDto,
  ) {
    if (!props.api) {
      setComposeNotice("发件身份服务暂时不可用。");
      return;
    }

    setComposeBusy(true);
    try {
      const diagnostics =
        await props.api.diagnoseProviderSendIdentityCandidate({
          accountId: props.accountId,
          candidateId: candidate.id,
        });
      setGraphDiagnosticsByCandidate((current) => ({
        ...current,
        [candidate.id]: diagnostics,
      }));
      setSendIdentityCandidates((current) =>
        upsertSendIdentityCandidate(current, diagnostics.candidate),
      );
      setComposeNotice(`共享发件人诊断完成：${diagnostics.summary}`);
    } catch {
      setComposeNotice("共享发件人诊断失败。");
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
    setComposeRichHtmlEnabled(false);
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
    invalidateComposeMessageRequest();
    setComposeTo(formatComposeAddressList(draft.to));
    setComposeCc(formatComposeAddressList(draft.cc));
    setComposeBcc(formatComposeAddressList(draft.bcc));
    setComposeSubject(draft.subject);
    setComposeBody(draft.bodyText ?? "");
    setComposeRichHtmlEnabled(Boolean(draft.bodyHtml));
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

    const requestId = beginComposeMessageRequest();
    const selectedMail = props.selectedMail;
    const from = selectedComposeFrom;
    try {
      const seed = await props.api.createComposeSeed({
        accountId: props.accountId,
        messageId: selectedMail.id,
        mode,
        ...(from ? { from } : {}),
      });
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      applySeedToCompose(seed);
      focusComposeTarget(seed.warnings.includes("missing_recipient") ? "to" : "body");
    } catch {
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      setComposeNotice("无法从当前邮件生成草稿。");
    } finally {
      finishComposeMessageRequest(requestId);
    }
  }

  async function previewComposedMail() {
    if (!props.api) {
      setComposeNotice("预览服务暂时不可用。");
      return;
    }

    setComposeBusy(true);
    try {
      const bodyHtml = composeBodyHtmlForPayload(
        composeBody,
        composeRichHtmlEnabled,
      );
      const preview = await props.api.previewMailDraft({
        accountId: props.accountId,
        ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
        to: parseComposeRecipients(composeTo),
        cc: parseComposeRecipients(composeCc),
        bcc: parseComposeRecipients(composeBcc),
        subject: composeSubject,
        bodyText: composeBody,
        ...(bodyHtml ? { bodyHtml } : {}),
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

  async function askHermesForReaderSummary() {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("summary");
    setReaderHermesNotice("Hermes 正在总结当前邮件...");
    try {
      const result = await props.api.summarizeMessage({
        accountId: props.selectedMail.accountId,
        messageId: props.selectedMail.id,
        mode: "action_points",
        focus: "decisions, deadlines, blockers, and reply needs",
        language: "zh-CN",
        memoryScope: "global",
      });
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesSummary(result);
      setReaderHermesNotice(`Hermes 已总结：${result.skillRunId}`);
    } catch (error) {
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesSummary(undefined);
      setReaderHermesNotice(
        hermesSkillErrorNotice(error, {
          skillId: "thread_summarize",
          fallback: "Hermes 总结暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "thread_summarize"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      if (readerHermesRequestRef.current === requestId) {
        setReaderHermesBusy(undefined);
      }
    }
  }

  async function askHermesForReaderTranslation(
    options: { forceRefresh?: boolean } = {},
  ) {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("translation");
    setReaderHermesNotice(
      options.forceRefresh
        ? "Hermes 正在重新翻译当前邮件..."
        : "Hermes 正在翻译当前邮件...",
    );
    try {
      const result = await props.api.translateMessage({
        accountId: props.selectedMail.accountId,
        messageId: props.selectedMail.id,
        targetLanguage: readerTranslationTarget,
        ...(readerTranslationSource === "auto"
          ? {}
          : { sourceLanguage: readerTranslationSource }),
        tone: "preserve original meaning and formatting",
        memoryScope: `sender:${props.selectedMail.email}`,
        ...(options.forceRefresh ? { forceRefresh: true } : {}),
      });
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesTranslation(result);
      setReaderHermesNotice(
        `${options.forceRefresh ? "Hermes 已重新翻译" : "Hermes 已翻译"}：${result.skillRunId}`,
      );
    } catch (error) {
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesTranslation(undefined);
      setReaderHermesNotice(
        hermesSkillErrorNotice(error, {
          skillId: "translate_text",
          fallback: "Hermes 翻译暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "translate_text"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
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

    const sourceLanguage = readerTranslationPreferenceSourceLanguage(
      readerHermesTranslation,
      readerTranslationSource,
    );
    if (!sourceLanguage) {
      setReaderHermesNotice("请选择明确源语言后，再让 Hermes 记住翻译习惯。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    const preferenceRequestId = readerTranslationPreferenceRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    readerTranslationPreferenceRequestRef.current = preferenceRequestId;
    const accountId = props.selectedMail.accountId;
    const senderEmail = props.selectedMail.email;
    const targetLanguage = readerHermesTranslation.targetLanguage;

    setReaderTranslationPreferenceBusy(true);
    try {
      await props.api.confirmTranslationPreference({
        accountId,
        mode: "always",
        sourceLanguage,
        targetLanguage,
        memoryScope: `sender:${senderEmail}`,
        reason: `Reader translation preference for ${senderEmail}`,
      });
      if (
        readerHermesRequestRef.current !== requestId ||
        readerTranslationPreferenceRequestRef.current !== preferenceRequestId
      ) {
        return;
      }
      readerTranslationPreferences.rememberPreference({
        accountId,
        senderEmail,
        sourceLanguage,
        targetLanguage,
      });
      setReaderHermesNotice("Hermes 已记住这个翻译习惯。");
    } catch (error) {
      if (
        readerHermesRequestRef.current !== requestId ||
        readerTranslationPreferenceRequestRef.current !== preferenceRequestId
      ) {
        return;
      }
      setReaderHermesNotice(
        hermesSkillErrorNotice(error, {
          skillId: "translate_text",
          fallback: "Hermes 翻译习惯暂时无法保存。",
        }),
        hermesDisabledSkillIdFromError(error, "translate_text"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      if (readerTranslationPreferenceRequestRef.current === preferenceRequestId) {
        setReaderTranslationPreferenceBusy(false);
      }
    }
  }

  async function askHermesToOrganizeReader() {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
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
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("organize");
    setReaderHermesNotice("Hermes 正在整理当前邮件...");
    try {
      const organization = await props.api.organizeMessage({
        accountId: props.selectedMail.accountId,
        messageId: props.selectedMail.id,
        language: "zh-CN",
        memoryScope,
        memoryLayers,
      });
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesOrganization(organization);
      setReaderHermesNotice(
        `Hermes 已整理：${organization.priority.skillRunId}`,
      );
    } catch (error) {
      if (readerHermesRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesOrganization(undefined);
      setReaderHermesNotice(
        hermesSkillErrorNotice(error, {
          skillId: "priority_triage",
          fallback: "Hermes 整理暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "priority_triage"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
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

    let applied = false;
    let successNotice: string | undefined;
    if (action.kind === "mail") {
      applied = await props.onArchive();
    } else if (action.kind === "smart_inbox") {
      applied = await props.onSmartInboxFeedback(action.action);
    } else if (!props.api) {
      setReaderHermesNotice("连接服务后才能应用 Hermes 标签建议。");
      setReaderHermesApplyBusy(undefined);
      return;
    } else {
      try {
        const accountId = props.selectedMail.accountId;
        const normalizedLabelName = action.labelName.toLowerCase();
        const existingLabel = props.labels.find(
          (label) =>
            label.accountId === accountId &&
            label.label.toLowerCase() === normalizedLabelName,
        );
        let labelId = existingLabel?.id;
        if (!labelId) {
          const labelPage = await props.api.listLabels({ accountId });
          labelId = labelPage.items.find(
            (label) => label.name.toLowerCase() === normalizedLabelName,
          )?.id;
        }
        if (!labelId) {
          const label = await props.api.upsertLabel({
            accountId,
            name: action.labelName,
            color: "blue",
          });
          labelId = label.id;
        }
        const result = await props.api.applyMailAction({
          accountId,
          messageId: props.selectedMail.id,
          action: "apply_labels",
          labelIds: [labelId],
        });
        props.onMailActionResult(result);
        props.onLabelsChanged(accountId);
        applied = true;
        successNotice = `Hermes 建议已应用：${action.label}。写回状态：${result.command.status}。`;
      } catch {
        applied = false;
      }
    }

    setReaderHermesApplyBusy(undefined);
    setReaderHermesNotice(
      applied
        ? (successNotice ?? `Hermes 建议已应用：${action.label}。`)
        : `Hermes 建议应用失败：${action.label}。`,
    );
  }

  async function createHermesActionItemFollowUp(
    item: HermesActionItem,
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

    const requestId = beginComposeMessageRequest();
    const selectedMail = props.selectedMail;
    const from = selectedComposeFrom;
    try {
      const [seed, result] = await Promise.all([
        props.api.createComposeSeed({
          accountId: selectedMail.accountId,
          messageId: selectedMail.id,
          mode: "reply",
          ...(from ? { from } : {}),
        }),
        props.api.draftMessageReply({
          accountId: selectedMail.accountId,
          messageId: selectedMail.id,
          instruction: "Draft a concise reply in my normal style.",
          ...hermesReplyMemoryInput(selectedMail),
          memoryLayers: [
            "contact_memory",
            "writing_style_profile",
            "procedural_memory",
            "semantic_profile",
          ],
        }),
      ]);
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      applySeedToCompose(seed, {
        bodyText: result.draftText,
        source: "hermes_reply",
        hermesSkillRunId: result.skillRunId,
        hermesDraftText: result.draftText,
        notice: `Hermes 已生成回复草稿：${result.skillRunId}`,
      });
      focusComposeTarget("body");
    } catch (error) {
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      setComposeNotice(
        hermesSkillErrorNotice(error, {
          skillId: "reply_draft",
          fallback: "Hermes 写回复暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "reply_draft"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      finishComposeMessageRequest(requestId);
    }
  }

  async function askHermesForQuickReply(action: HermesQuickReplyAction) {
    if (!props.api) {
      setComposeNotice("Hermes 暂时不可用。");
      return;
    }

    const requestId = beginComposeMessageRequest();
    const selectedMail = props.selectedMail;
    const from = selectedComposeFrom;
    try {
      const [seed, result] = await Promise.all([
        props.api.createComposeSeed({
          accountId: selectedMail.accountId,
          messageId: selectedMail.id,
          mode: "reply",
          ...(from ? { from } : {}),
        }),
        props.api.quickMessageReply({
          accountId: selectedMail.accountId,
          messageId: selectedMail.id,
          scenario: action.scenario,
          instruction: action.instruction,
          tone: "warm professional",
          ...hermesReplyMemoryInput(selectedMail),
          memoryLayers: [
            "contact_memory",
            "writing_style_profile",
            "procedural_memory",
            "semantic_profile",
          ],
        }),
      ]);
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      applySeedToCompose(seed, {
        bodyText: result.draftText,
        source: "hermes_reply",
        hermesSkillRunId: result.skillRunId,
        hermesDraftText: result.draftText,
        notice: `Hermes 已生成快速回复：${result.skillRunId}`,
      });
      focusComposeTarget("body");
    } catch (error) {
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      setComposeNotice(
        hermesSkillErrorNotice(error, {
          skillId: "quick_reply",
          fallback: "Hermes 快速回复暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "quick_reply"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      finishComposeMessageRequest(requestId);
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
    const bodyHtml = composeBodyHtmlForPayload(
      input.bodyText,
      composeRichHtmlEnabled,
    );
    const shouldSendAttachmentManifest =
      composeAttachments.length > 0 ||
      Boolean(composeDraftId || composeScheduledId);
    return {
      accountId: props.accountId,
      ...(selectedComposeFrom ? { from: selectedComposeFrom } : {}),
      to: input.to,
      ...(input.cc.length > 0 ? { cc: input.cc } : {}),
      ...(input.bcc.length > 0 ? { bcc: input.bcc } : {}),
      subject: composeSubject.trim(),
      bodyText: input.bodyText,
      ...(bodyHtml ? { bodyHtml } : {}),
      source: composeSource,
      ...(shouldSendAttachmentManifest
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
    } catch (error) {
      setComposeNotice(composeAttachmentUploadErrorNotice(error));
    } finally {
      setComposeBusy(false);
    }
  }

  function insertComposeTemplate(template: (typeof COMPOSE_TEMPLATES)[number]) {
    setComposeSubject((current) =>
      current.trim() ? current : template.subject,
    );
    setComposeBody((current) =>
      current.trim() ? `${current.trim()}\n\n${template.bodyText}` : template.bodyText,
    );
    setComposeRichHtmlEnabled(false);
    setComposePreview(undefined);
    setComposeNotice(`已插入模板：${template.label}`);
    focusComposeTarget("body");
  }

  function applyComposeBodyFormat(format: ComposeBodyFormat) {
    const editor = document.getElementById("compose-body") as
      | HTMLTextAreaElement
      | null;
    const start = editor?.selectionStart ?? composeBody.length;
    const end = editor?.selectionEnd ?? composeBody.length;
    const selection = composeBody.slice(start, end);
    const formatted = formatComposeSelection(format, selection);
    const nextBody = `${composeBody.slice(0, start)}${formatted.text}${composeBody.slice(end)}`;
    setComposeBody(nextBody);
    setComposeRichHtmlEnabled(true);
    setComposePreview(undefined);
    window.requestAnimationFrame(() => {
      const nextEditor = document.getElementById("compose-body") as
        | HTMLTextAreaElement
        | null;
      nextEditor?.focus();
      nextEditor?.setSelectionRange(
        start + formatted.selectionStart,
        start + formatted.selectionEnd,
      );
    });
  }

  function clearComposeForm() {
    invalidateComposeMessageRequest();
    cancelComposeAutosave();
    lastSavedComposeSignatureRef.current = "";
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    setComposeRichHtmlEnabled(false);
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

  async function translateComposedMail() {
    if (!props.api) {
      setComposeNotice("Hermes 暂时不可用。");
      return;
    }

    const bodyText = composeBody.trim();
    if (!bodyText) {
      setComposeNotice("请先写正文，再让 Hermes 翻译。");
      return;
    }

    const requestId = beginComposeMessageRequest();
    const accountId = props.accountId;
    const originalBody = composeBody;
    try {
      const result = await props.api.translateText({
        accountId,
        text: bodyText,
        targetLanguage: composeTranslationTarget,
        ...(composeTranslationSource === "auto"
          ? {}
          : { sourceLanguage: composeTranslationSource }),
        tone: "preserve intent, formatting cues, recipients, and commitments",
        memoryScope: "global",
        memoryLayers: ["writing_style_profile", "semantic_profile"],
      });
      if (!canApplyComposeMessageResult({ requestId, accountId, body: originalBody })) {
        return;
      }
      setComposeBody(result.translatedText);
      setComposeRichHtmlEnabled(false);
      setComposeHermesSkillRunId(result.skillRunId);
      setComposeHermesDraftText(result.translatedText);
      setComposePreview(undefined);
      setComposeNotice(`Hermes 已翻译草稿：${result.skillRunId}`);
      focusComposeTarget("body");
    } catch (error) {
      if (!canApplyComposeMessageResult({ requestId, accountId, body: originalBody })) {
        return;
      }
      setComposeNotice(
        hermesSkillErrorNotice(error, {
          skillId: "translate_text",
          fallback: "Hermes 草稿翻译暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "translate_text"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      finishComposeMessageRequest(requestId);
    }
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

    const requestId = beginComposeMessageRequest();
    const accountId = props.accountId;
    const originalBody = composeBody;
    try {
      const result = await props.api.rewritePolishDraft({
        accountId,
        text: bodyText,
        action: "polish",
        instruction: "Polish this email while preserving intent, recipient details, and concrete commitments.",
        tone: "clear professional",
      });
      if (!canApplyComposeMessageResult({ requestId, accountId, body: originalBody })) {
        return;
      }
      setComposeBody(result.rewrittenText);
      setComposeRichHtmlEnabled(false);
      setComposeHermesSkillRunId(result.skillRunId);
      setComposeHermesDraftText(result.rewrittenText);
      setComposePreview(undefined);
      setComposeNotice(`Hermes 已润色：${result.skillRunId}`);
    } catch (error) {
      if (!canApplyComposeMessageResult({ requestId, accountId, body: originalBody })) {
        return;
      }
      setComposeNotice(
        hermesSkillErrorNotice(error, {
          skillId: "rewrite_polish",
          fallback: "Hermes 润色暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "rewrite_polish"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      finishComposeMessageRequest(requestId);
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

  async function submitNewLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newLabelName.trim();
    if (!name) {
      setLabelNotice("请输入标签名称。");
      return;
    }
    if (!props.api) {
      setLabelNotice("连接服务后才能创建标签。");
      return;
    }

    setLabelBusy(true);
    setLabelNotice("正在创建标签...");
    try {
      const label = await props.api.upsertLabel({
        accountId: props.accountId,
        name,
      });
      setNewLabelName("");
      setLabelFormOpen(false);
      setLabelNotice(`标签已创建：${label.name}`);
      props.onLabelsChanged(props.accountId);
    } catch {
      setLabelNotice("标签创建失败，请稍后再试。");
    } finally {
      setLabelBusy(false);
    }
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
  const visibleMailKeys = useMemo(
    () => new Set(props.mail.map((mail) => mailItemKey(mail))),
    [props.mail],
  );
  const selectedVisibleMail = props.mail.filter((mail) =>
    selectedMailKeys.has(mailItemKey(mail)),
  );
  const allVisibleSelected =
    props.mail.length > 0 && selectedVisibleMail.length === props.mail.length;

  useEffect(() => {
    setSelectedMailKeys((current) => {
      const next = new Set<string>();
      for (const key of current) {
        if (visibleMailKeys.has(key)) {
          next.add(key);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [visibleMailKeys]);

  function toggleAllVisibleMail(checked: boolean) {
    setSelectedMailKeys(
      checked ? new Set(props.mail.map((mail) => mailItemKey(mail))) : new Set(),
    );
  }

  function toggleVisibleMail(mail: MailItem, checked: boolean) {
    const key = mailItemKey(mail);
    setSelectedMailKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
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
        <UndoDoneNotice onUndoDone={props.onUndoDone} />
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
            <HermesNotice
              notice={composeNotice}
              skillId={composeNoticeState.skillId}
              requiredPermission={composeNoticeState.requiredPermission}
              compact
              onOpenSkillSettings={props.onOpenHermesSkillSettings}
            />
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
                {sendIdentityCandidates.map((candidate) => {
                  const diagnostics = graphDiagnosticsByCandidate[candidate.id];

                  return (
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
                          onClick={() =>
                            void verifyGraphSendIdentityCandidate(candidate)
                          }
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
                        <button
                          className="tiny-button"
                          type="button"
                          aria-label={`Diagnose Outlook shared sender ${candidate.from.address}`}
                          disabled={composeBusy}
                          onClick={() =>
                            void diagnoseGraphSendIdentityCandidate(candidate)
                          }
                        >
                          诊断
                        </button>
                      </div>
                      {diagnostics ? (
                        <div
                          className="graph-diagnostics-box"
                          aria-label={`Outlook shared sender diagnostics ${candidate.from.address}`}
                        >
                          <strong>
                            {formatGraphDiagnosticsStatus(diagnostics.status)}
                          </strong>
                          <p>{diagnostics.summary}</p>
                          <div className="graph-diagnostic-checks">
                            {diagnostics.checks.map((check) => (
                              <span
                                key={check.id}
                                className={`diagnostic-${check.status}`}
                              >
                                {check.title}：{check.detail}
                              </span>
                            ))}
                          </div>
                          <ul>
                            {diagnostics.nextActions.map((action) => (
                              <li key={action}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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
          <div className="compose-editor-tools" aria-label="Compose editor tools">
            <div className="compose-template-row" aria-label="Compose templates">
              {COMPOSE_TEMPLATES.map((template) => (
                <button
                  className="tiny-button"
                  type="button"
                  key={template.id}
                  aria-label={`Insert compose template ${template.label}`}
                  disabled={composeBusy}
                  onClick={() => insertComposeTemplate(template)}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <div className="compose-format-toolbar" aria-label="Compose format toolbar">
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Bold selected compose text"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("bold")}
              >
                <Bold size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Italic selected compose text"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("italic")}
              >
                <Italic size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="List selected compose text"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("list")}
              >
                <List size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Link selected compose text"
                title="插入链接"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("link")}
              >
                <Link2 size={14} />
              </button>
              <button
                className="tiny-icon-button"
                type="button"
                aria-label="Quote selected compose text"
                title="引用"
                disabled={composeBusy}
                onClick={() => applyComposeBodyFormat("quote")}
              >
                <Quote size={14} />
              </button>
            </div>
          </div>
          <textarea
            id="compose-body"
            aria-label="Compose body"
            value={composeBody}
            onChange={(event) => {
              invalidateComposeMessageRequest();
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
          <HermesComposeDraftTools
            sourceLanguage={composeTranslationSource}
            targetLanguage={composeTranslationTarget}
            busy={composeBusy}
            onSourceLanguageChange={setComposeTranslationSource}
            onTargetLanguageChange={setComposeTranslationTarget}
            onTranslate={() => void translateComposedMail()}
            onPolish={() => void polishComposedMail()}
            onPreview={() => void previewComposedMail()}
          />
          {composePreview ? (
            <ComposeReview
              preview={composePreview}
              bodyText={composeBody}
              controlledBodyHtml={composeBodyHtmlForPayload(
                composeBody,
                composeRichHtmlEnabled,
              )}
              attachments={composeAttachments}
              warningsText={formatComposeWarnings(composePreview.warnings)}
            />
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
            <button
              className="icon-button"
              type="button"
              aria-label="刷新邮箱列表"
              onClick={props.onRefresh}
            >
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
                <button
                  type="button"
                  aria-label="添加标签"
                  onClick={() => {
                    setLabelFormOpen((current) => !current);
                    setLabelNotice("");
                  }}
                >
                  +
                </button>
              </div>
              {labelFormOpen ? (
                <form
                  className="label-create-form"
                  aria-label="创建标签"
                  onSubmit={submitNewLabel}
                >
                  <input
                    aria-label="新标签名称"
                    placeholder="新标签"
                    value={newLabelName}
                    onChange={(event) => setNewLabelName(event.target.value)}
                  />
                  <button type="submit" disabled={labelBusy}>
                    {labelBusy ? "创建中" : "创建"}
                  </button>
                </form>
              ) : null}
              {labelNotice ? (
                <div className="backend-notice compact" role="status">
                  {labelNotice}
                </div>
              ) : null}
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
                <h2>{props.folderTitle}</h2>
                <span>{props.folderCount} 封邮件</span>
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
                <button
                  className="tiny-button"
                  type="button"
                  aria-label={
                    props.sort === "smart" ? "切换为按时间排序" : "切换为智能排序"
                  }
                  onClick={() =>
                    props.onSortChange(props.sort === "smart" ? "time" : "smart")
                  }
                >
                  {props.sort === "smart" ? "智能排序" : "按时间"}
                  <ChevronDown size={14} />
                </button>
            </div>
            </div>
            <div className="bulk-row">
              <label>
                <input
                  aria-label="选择当前列表全部邮件"
                  checked={allVisibleSelected}
                  type="checkbox"
                  onChange={(event) => toggleAllVisibleMail(event.currentTarget.checked)}
                />
                全部
              </label>
              <div className="smart-inbox-actions" aria-label="Smart Inbox actions">
                <span>
                  {selectedVisibleMail.length > 0
                    ? `已选 ${selectedVisibleMail.length} 封`
                    : `Smart Inbox · ${bucketLabel(selectedBucket)} · ${selectedBucketCount} 封`}
                </span>
                <div className="smart-inbox-action-set">
                  <button
                    className="tiny-button"
                    type="button"
                    aria-label="Smart Inbox done selected messages"
                    disabled={smartInboxDisabled || selectedVisibleMail.length === 0}
                    onClick={() => props.onSelectedMessagesDone(selectedVisibleMail)}
                  >
                    {props.smartInboxBusy === "bulk_done" &&
                    selectedVisibleMail.length > 0
                      ? "处理中"
                      : "选中 Done"}
                  </button>
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
                  onClick={() =>
                    void props.onSmartInboxFeedback(
                      "mark_important",
                      selectedVisibleMail,
                    )
                  }
                >
                  重要
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  aria-label="Smart Inbox move selected to newsletters"
                  disabled={smartInboxDisabled}
                  onClick={() =>
                    void props.onSmartInboxFeedback(
                      "move_to_newsletters",
                      selectedVisibleMail,
                    )
                  }
                >
                  订阅
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  aria-label="Smart Inbox move selected to feed"
                  disabled={smartInboxDisabled}
                  onClick={() =>
                    void props.onSmartInboxFeedback(
                      "move_to_feed",
                      selectedVisibleMail,
                    )
                  }
                >
                  Feed
                </button>
              </div>
            </div>
          </div>
            {props.mail.map((mail) => {
              const key = mailItemKey(mail);
              return (
                <div
                  key={key}
                  className={
                    props.activeMailId === key
                      ? "message-row active"
                      : "message-row"
                  }
                >
                  <input
                    aria-label={`Select message ${mail.subject}`}
                    checked={selectedMailKeys.has(key)}
                    type="checkbox"
                    onChange={(event) =>
                      toggleVisibleMail(mail, event.currentTarget.checked)
                    }
                  />
                  <span className={mail.unread ? "unread-dot" : "read-dot"} />
                  <button
                    className="message-row-open"
                    type="button"
                    onClick={() => props.onMailChange(key)}
                  >
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
                  </button>
                  <span className={`tag ${mail.tone}`}>{mail.label}</span>
                </div>
              );
            })}
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
            <HermesReaderTranslationControls
              sourceLanguage={readerTranslationSource}
              targetLanguage={readerTranslationTarget}
              busy={Boolean(readerHermesBusy)}
              onSourceLanguageChange={selectReaderTranslationSource}
              onTargetLanguageChange={
                readerTranslationPreferences.setTargetLanguage
              }
              onTranslate={() => void askHermesForReaderTranslation()}
            />
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
                <span>
                  {props.selectedMail.email} · {readerRecipientSummary} ·{" "}
                  {props.selectedMail.date} {props.selectedMail.time}
                </span>
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
              <HermesNotice
                notice={readerHermesNotice}
                skillId={readerHermesNoticeState.skillId}
                requiredPermission={readerHermesNoticeState.requiredPermission}
                onOpenSkillSettings={props.onOpenHermesSkillSettings}
              />
            ) : null}

            {readerHermesSummary ? (
              <HermesReaderSummaryPanel summary={readerHermesSummary} />
            ) : null}

            {readerHermesTranslation ? (
              <HermesReaderTranslationResult
                translation={readerHermesTranslation}
                preferenceBusy={readerTranslationPreferenceBusy}
                refreshBusy={readerHermesBusy === "translation"}
                canRememberPreference={Boolean(
                  readerTranslationPreferenceSourceLanguage(
                    readerHermesTranslation,
                    readerTranslationSource,
                  ),
                )}
                onRememberPreference={() =>
                  void rememberReaderTranslationPreference()
                }
                onRefresh={() =>
                  void askHermesForReaderTranslation({ forceRefresh: true })
                }
              />
            ) : null}

            {readerHermesOrganization ? (
              <HermesReaderOrganizationPanel
                organization={readerHermesOrganization}
                applyBusyId={readerHermesApplyBusy}
                formatDate={formatMailDate}
                onApplyAction={(action) =>
                  void applyHermesOrganizationSuggestion(action)
                }
                onCreateActionItemFollowUp={(item, index) =>
                  void createHermesActionItemFollowUp(item, index)
                }
              />
            ) : null}

            <div className="message-body">
              <p>{readerBodyText || "这封邮件还没有可显示的正文。"}</p>
            </div>

            <div className="attachment-box">
              <div className="attachment-head">
                <strong>
                  {visibleAttachmentCount} 个附件
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

            <HermesReplyAssistantPanel
              fromLabel={
                selectedComposeIdentity
                  ? formatSendIdentity(selectedComposeIdentity)
                  : "当前账号"
              }
              busy={composeBusy}
              onDraftReply={() => void askHermesForReplyDraft()}
              onQuickReply={(action) => void askHermesForQuickReply(action)}
            />
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

function formatGraphDiagnosticsStatus(
  status: MailSendIdentityDiagnosticsDto["status"],
): string {
  const labels: Record<MailSendIdentityDiagnosticsDto["status"], string> = {
    ready: "诊断通过",
    needs_from_verification: "需要验证 From",
    from_verification_failed: "From 权限失败",
    target_verification_recommended: "建议验证共享箱",
    target_verification_failed: "共享箱目标失败",
  };
  return labels[status];
}

function composeAttachmentUploadErrorNotice(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 413 || error.code === "request_body_too_large") {
      return "附件超过 25 MB，请压缩或拆分后再上传。";
    }
    if (error.code === "compose_attachment_storage_unavailable") {
      return "附件存储未配置，暂时不能上传附件。";
    }
  }

  return "附件上传失败，请重新选择文件。";
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
    bodyHtml: input.bodyHtml ?? null,
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
    bodyHtml: draft.bodyHtml,
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
  const [activeCredentialProvider, setActiveCredentialProvider] =
    useState<ProviderOption | undefined>();
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
  const [mailEngineHealthUnavailable, setMailEngineHealthUnavailable] =
    useState(false);
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

  const visibleProviders = providerOptions.filter((provider) =>
    props.providerGroupId
      ? addMailProviderGroupProviders[props.providerGroupId].includes(
          provider.provider,
        )
      : true,
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
  const mailOnboardingUnavailable =
    mailEngineHealth?.capabilities.imapSmtpOnboarding === false;

  async function connectProvider(provider: ProviderOption) {
    if (!props.api) {
      setNotice(`${provider.title} 连接服务还没有准备好。`);
      return;
    }

    if (mailOnboardingUnavailable && provider.action !== "manual") {
      setNotice("邮箱接入服务还没准备好，请先按上线体检完成配置。");
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
          flow: "onboarding",
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

    setActiveCredentialProvider(provider);
    const input = buildPresetOnboardingInput(provider, {
      email,
      username,
      secret,
    });
    if (!input) {
      setNotice(
        provider.action === "bridge"
          ? `${provider.title} 需要先填写邮箱、Bridge 用户名和 Bridge 密码。`
          : `${provider.title} 需要先填写邮箱和授权码。`,
      );
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
    } catch (error) {
      const recoveryDiagnostics = apiErrorConnectionDiagnostics(error);
      await loadOnboardingDiagnostics();
      setOnboardingRecoveryDiagnostics(recoveryDiagnostics);
      setSecret("");
      setNotice(
        recoveryDiagnostics.length > 0
          ? `${provider.title} 暂时无法接入，请按恢复建议处理后重试。`
          : `${provider.title} 暂时无法接入，连接信息未保存。请重新检查授权码或稍后再试。`,
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
      setNotice("邮箱接入服务还没准备好，请先按上线体检完成配置。");
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
    } catch (error) {
      const recoveryDiagnostics = apiErrorConnectionDiagnostics(error);
      await loadOnboardingDiagnostics();
      setOnboardingRecoveryDiagnostics(recoveryDiagnostics);
      clearCustomServerSecret();
      setNotice(
        recoveryDiagnostics.length > 0
          ? `${manualProvider.title} 暂时无法接入，请按恢复建议处理后重试。`
          : `${manualProvider.title} 暂时无法接入，连接信息未保存。请重新检查授权码或稍后再试。`,
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
        flow: "reauthorization",
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

      {props.api && (mailEngineHealth || mailEngineHealthUnavailable) ? (
        <MailEngineReadinessPanel
          health={mailEngineHealth}
          unavailable={mailEngineHealthUnavailable}
        />
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
          <span>{showBridgeFieldHelp ? "Bridge 用户名" : "登录用户名"}</span>
          <input
            aria-label="Add mail username"
            value={username}
            placeholder={
              showBridgeFieldHelp ? "Proton Bridge 中显示的用户名" : "不填则使用邮箱地址"
            }
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>{showBridgeFieldHelp ? "Bridge 密码" : "授权码或专用密码"}</span>
          <input
            aria-label="Add mail secret"
            value={secret}
            type="password"
            placeholder={
              showBridgeFieldHelp ? "Proton Bridge 中显示的密码" : "用于连接邮箱"
            }
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </label>
        {showBridgeFieldHelp ? (
          <div className="bridge-field-help" aria-label="Proton Bridge 接入提示">
            <strong>先启动 Proton Bridge 并保持登录。</strong>
            <span>
              邮箱地址填写 Proton 邮箱；Bridge 用户名和 Bridge 密码都使用 Proton Bridge 里显示的值，不是 Proton 账号密码。
            </span>
          </div>
        ) : null}
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
              disabled={
                busyProvider === manualProvider.provider ||
                mailOnboardingUnavailable
              }
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
        {visibleProviders.map((provider) => {
          const providerBlocked =
            mailOnboardingUnavailable && provider.action !== "manual";

          return (
            <article key={provider.title} className="provider-card">
              <ProviderIcon provider={provider.provider} title={provider.title} mark={provider.mark} />
              <div>
                <strong>{provider.title}</strong>
                <span>{provider.subtitle}</span>
                {provider.action === "bridge" ? (
                  <p className="provider-card-note">
                    先启动 Proton Bridge；使用 Bridge 用户名和 Bridge 密码连接。
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`连接 ${provider.title}`}
                disabled={busyProvider === provider.provider || providerBlocked}
                onClick={() => void connectProvider(provider)}
              >
                {busyProvider === provider.provider ? "连接中" : "连接"}
              </button>
            </article>
          );
        })}
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

function MailEngineReadinessPanel(props: {
  health?: MailEngineHealthDto;
  unavailable?: boolean;
}) {
  const degraded =
    props.unavailable || props.health?.readiness.status === "degraded";
  const statusRows = props.health
    ? mailEngineReadinessRows(props.health)
    : mailEngineUnavailableRows();
  return (
    <section
      className={`page-panel mail-engine-readiness ${
        degraded ? "is-degraded" : "is-ready"
      }`}
      aria-label="EmailEngine 上线体检"
    >
      <div>
        <strong>
          {props.unavailable
            ? "EmailEngine 体检暂时不可用"
            : degraded
              ? "EmailEngine 上线还差配置"
              : "EmailEngine 接入就绪"}
        </strong>
        <span>
          {props.health?.readiness.summary ??
            "无法读取后端上线体检，请先检查 API /health、网络和 API Token。"}
        </span>
      </div>
      <div className="mail-engine-readiness-grid">
        {statusRows.map((row) => (
          <p key={row.label}>
            <strong>{row.value}</strong>
            <span>{row.label}</span>
          </p>
        ))}
      </div>
      {props.health &&
      (props.health.missing.length > 0 || props.health.warnings.length > 0) ? (
        <div
          className="mail-engine-status-notes"
          aria-label="EmailEngine 缺失与警告"
        >
          {props.health.missing.length > 0 ? (
            <p>
              <strong>缺失</strong>
              <span>{props.health.missing.join(" / ")}</span>
            </p>
          ) : null}
          {props.health.warnings.length > 0 ? (
            <p>
              <strong>警告</strong>
              <span>{props.health.warnings.join(" / ")}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {props.health && props.health.readiness.setupActions.length > 0 ? (
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

function mailEngineReadinessRows(
  health: MailEngineHealthDto,
): Array<{ label: string; value: string }> {
  return [
    {
      label: "运行探测",
      value: formatMailEngineHttpStatus(health.checks?.http),
    },
    {
      label: "访问令牌",
      value: health.capabilities.accessTokenConfigured ? "已配置" : "缺少",
    },
    {
      label: "认证探测",
      value: formatMailEngineApiAuthStatus(health.checks?.apiAuth),
    },
    {
      label: "预置令牌",
      value: formatMailEngineConfiguredStatus(health.checks?.preparedToken),
    },
    {
      label: "回调密钥",
      value: formatMailEngineWebhookSecretStatus(health.checks?.webhookSecret),
    },
    {
      label: "邮箱接入",
      value: health.capabilities.imapSmtpOnboarding ? "可用" : "不可用",
    },
    {
      label: "附件下载",
      value: health.capabilities.attachmentDownload ? "可用" : "不可用",
    },
    {
      label: "发信链路",
      value: health.capabilities.send ? "可用" : "不可用",
    },
  ];
}

function mailEngineUnavailableRows(): Array<{ label: string; value: string }> {
  return [
    "运行探测",
    "访问令牌",
    "认证探测",
    "预置令牌",
    "回调密钥",
    "邮箱接入",
    "附件下载",
    "发信链路",
  ].map((label) => ({
    label,
    value: label === "运行探测" || label === "认证探测" ? "未探测" : "未知",
  }));
}

function formatApiDatabaseHealth(
  status: "ok" | "unavailable" | undefined,
): string {
  if (status === "ok") {
    return "可用";
  }

  if (status === "unavailable") {
    return "不可用";
  }

  return "未探测";
}

function MailEngineLaunchActivityPanel(props: {
  events: OperationalEventDto[];
  notice: string;
}) {
  return (
    <section
      className="page-panel sync-diagnostics-panel"
      aria-label="EmailEngine 运行事件体检"
    >
      <div className="sync-diagnostics-header">
        <div>
          <h2>EmailEngine 运行事件体检</h2>
          <p>最近 webhook、同步 worker 和重试链路活动。</p>
        </div>
      </div>
      {props.notice ? (
        <div className="backend-notice" role="status">
          {props.notice}
        </div>
      ) : null}
      {props.events.length > 0 ? (
        <div className="diagnostic-list">
          {props.events.map((event) => (
            <div className="diagnostic-row sync-diagnostic-row" key={event.id}>
              <div>
                <strong>{friendlySyncDiagnosticTitle(event)}</strong>
                <span>
                  {formatOperationalEventSource(event)} ·{" "}
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
  );
}

function formatMailEngineHttpStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["http"] | undefined,
): string {
  if (status === "ok") {
    return "可达";
  }

  if (status === "unavailable") {
    return "不可达";
  }

  return "未探测";
}

function formatMailEngineApiAuthStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["apiAuth"] | undefined,
): string {
  if (status === "ok") {
    return "可用";
  }

  if (status === "unauthorized") {
    return "被拒绝";
  }

  if (status === "unavailable") {
    return "不可用";
  }

  return "未探测";
}

function formatMailEngineConfiguredStatus(
  status:
    | NonNullable<MailEngineHealthDto["checks"]>["accessToken"]
    | NonNullable<MailEngineHealthDto["checks"]>["preparedToken"]
    | undefined,
): string {
  if (status === "configured") {
    return "已配置";
  }

  if (status === "missing") {
    return "缺少";
  }

  return "未探测";
}

function formatMailEngineWebhookSecretStatus(
  status: NonNullable<MailEngineHealthDto["checks"]>["webhookSecret"] | undefined,
): string {
  if (status === "custom") {
    return "已替换";
  }

  if (status === "default") {
    return "默认值";
  }

  if (status === "missing") {
    return "缺少";
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
  const username = fields.username.trim();
  const secret = fields.secret.trim();
  if (!email || !secret || (provider.action === "bridge" && !username)) {
    return undefined;
  }

  return {
    email,
    provider: provider.provider,
    secret,
    ...(username ? { username } : {}),
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
    worker_result: "同步任务已处理",
    sync_account_failed: "同步任务没有完成",
    sync_account_dead_lettered: "同步任务多次失败",
    sync_job_retry_scheduled: "同步任务等待重试",
    sync_job_dead_lettered: "同步任务多次失败",
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
  if (event.event === "worker_result") {
    return "后台已处理一条同步任务，邮箱镜像链路有最近活动。";
  }
  if (event.event === "sync_job_retry_scheduled") {
    return "同步任务会自动重试；如果持续出现，请打开账号诊断查看恢复建议。";
  }
  if (event.event === "sync_job_dead_lettered") {
    return "同步任务多次失败后已停止重试，请打开账号诊断处理。";
  }
  if (event.event === "reauthorization_imap_smtp_failed") {
    return "请检查授权码、专用密码和自定义服务器设置后重新提交。";
  }
  if (event.event.includes("reauthorization_required")) {
    return "请从上方重新授权入口恢复这个账号。";
  }

  return event.message;
}

function latestOperationalEvents(
  events: OperationalEventDto[],
  limit: number,
): OperationalEventDto[] {
  return [...events]
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    )
    .slice(0, limit);
}

function formatOperationalEventSource(event: OperationalEventDto): string {
  if (event.event === "emailengine_webhook_ingested") {
    return "Webhook";
  }

  const labels: Record<string, string> = {
    "email-hub-api": "API",
    "email-hub-worker": "Worker",
  };

  return labels[event.service] ?? event.service;
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
    gmail_app_password_required: "需要 Google 应用专用密码",
    outlook_app_password_or_web_login_required: "需要 Outlook 专用密码或网页登录",
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
    create_google_app_password: "请为 Gmail 创建应用专用密码，普通 Google 密码不能用于这里。",
    create_microsoft_app_password_or_enable_web_login:
      "请使用 Outlook 应用专用密码，或改用网页登录授权后重试。",
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
  const [apiHealth, setApiHealth] = useState<ApiHealthDto | undefined>();
  const [apiHealthUnavailable, setApiHealthUnavailable] = useState(false);
  const [mailEngineHealth, setMailEngineHealth] =
    useState<MailEngineHealthDto | undefined>();
  const [mailEngineHealthUnavailable, setMailEngineHealthUnavailable] =
    useState(false);
  const [mailEngineLaunchEvents, setMailEngineLaunchEvents] = useState<
    OperationalEventDto[]
  >([]);
  const [mailEngineLaunchNotice, setMailEngineLaunchNotice] = useState("");

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
        flow: "reauthorization",
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
      setApiHealth(undefined);
      setApiHealthUnavailable(false);
      return;
    }

    let alive = true;
    props.api
      .getApiHealth()
      .then((health) => {
        if (alive) {
          setApiHealth(health);
          setApiHealthUnavailable(false);
        }
      })
      .catch(() => {
        if (alive) {
          setApiHealth(undefined);
          setApiHealthUnavailable(true);
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineHealth(undefined);
      setMailEngineHealthUnavailable(false);
      return;
    }

    let alive = true;
    props.api
      .getMailEngineHealth()
      .then((health) => {
        if (alive) {
          setMailEngineHealth(health);
          setMailEngineHealthUnavailable(false);
        }
      })
      .catch(() => {
        if (alive) {
          setMailEngineHealth(undefined);
          setMailEngineHealthUnavailable(true);
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  useEffect(() => {
    if (!props.api) {
      setMailEngineLaunchEvents([]);
      setMailEngineLaunchNotice("");
      return;
    }

    let alive = true;
    setMailEngineLaunchNotice("正在读取最近运行事件...");
    void Promise.all([
      props.api.listOperationalEvents({
        service: "email-hub-api",
        event: "emailengine_webhook_ingested",
        lane: "sync",
        limit: 3,
      }),
      props.api.listOperationalEvents({
        service: "email-hub-worker",
        lane: "sync",
        limit: 5,
      }),
    ])
      .then(([webhookPage, workerPage]) => {
        if (!alive) {
          return;
        }
        const events = latestOperationalEvents(
          [...webhookPage.items, ...workerPage.items],
          5,
        );
        setMailEngineLaunchEvents(events);
        setMailEngineLaunchNotice(
          events.length > 0 ? "" : "还没有最近运行事件。",
        );
      })
      .catch(() => {
        if (alive) {
          setMailEngineLaunchEvents([]);
          setMailEngineLaunchNotice("最近运行事件暂时不可用。");
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
      {props.api && (apiHealth || apiHealthUnavailable) ? (
        <ApiHealthPanel health={apiHealth} unavailable={apiHealthUnavailable} />
      ) : null}
      {props.api && (mailEngineHealth || mailEngineHealthUnavailable) ? (
        <MailEngineReadinessPanel
          health={mailEngineHealth}
          unavailable={mailEngineHealthUnavailable}
        />
      ) : null}
      {props.api ? (
        <MailEngineLaunchActivityPanel
          events={mailEngineLaunchEvents}
          notice={mailEngineLaunchNotice}
        />
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

function ApiHealthPanel(props: { health?: ApiHealthDto; unavailable?: boolean }) {
  const degraded = props.unavailable || props.health?.ok === false;
  const databaseStatus = props.health?.checks?.database;
  return (
    <section
      className={`page-panel api-health-panel ${
        degraded ? "is-degraded" : "is-ready"
      }`}
      aria-label="API 运行体检"
    >
      <div>
        <strong>{degraded ? "后端运行需要检查" : "后端运行正常"}</strong>
        <span>
          {props.unavailable
            ? "无法读取 API /health，请检查后端进程、网络和 API Token。"
            : props.health?.ok
              ? "API 正常响应，数据库探测结果如下。"
              : "API 已响应，但依赖探测未全部通过。"}
        </span>
      </div>
      <div className="api-health-grid">
        <p>
          <strong>
            {props.health?.ok ? "可用" : props.unavailable ? "未知" : "异常"}
          </strong>
          <span>API</span>
        </p>
        <p>
          <strong>{formatApiDatabaseHealth(databaseStatus)}</strong>
          <span>数据库</span>
        </p>
      </div>
    </section>
  );
}

function SearchPage(props: {
  api?: EmailHubApi;
  accountId: string;
  restrictToAccount?: boolean;
  labels: LabelItem[];
  launch?: SearchLaunch;
  onOpenResult: (mail: MailItem) => void;
  onOpenHermesSkillSettings: (
    skillId: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [naturalLanguageQuery, setNaturalLanguageQuery] = useState("");
  const [results, setResults] = useState<MailItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [noticeState, setNoticeState] = useState<HermesNoticeState>({
    text: props.restrictToAccount
      ? "输入关键词后搜索当前邮箱。"
      : "输入关键词后搜索所有已同步邮件。",
  });
  const [searchAllAccounts, setSearchAllAccounts] = useState(
    () => !props.restrictToAccount,
  );
  const [quickFilters, setQuickFilters] = useState<MailQuickFilter[]>([]);
  const [qScopes, setQScopes] = useState<MailSearchScope[]>([
    "sender",
    "recipients",
    "subject",
    "body",
  ]);
  const [senderQuery, setSenderQuery] = useState<string | undefined>();
  const [recipientQuery, setRecipientQuery] = useState<string | undefined>();
  const [receivedAfter, setReceivedAfter] = useState<string | undefined>();
  const [receivedBefore, setReceivedBefore] = useState<string | undefined>();
  const [hasAttachment, setHasAttachment] = useState<boolean | undefined>();
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<MailTagMode>("any");
  const [hermesSearchBusy, setHermesSearchBusy] = useState(false);
  const notice = noticeState.text;

  function setNotice(
    nextNotice: string | ((current: string) => string),
    skillId?: string,
    requiredPermission?: HermesSkillRequiredPermission,
  ) {
    setNoticeState((current) => ({
      text:
        typeof nextNotice === "function"
          ? nextNotice(current.text)
          : nextNotice,
      skillId,
      requiredPermission,
    }));
  }

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

  function toggleSearchLabel(labelId: string) {
    setLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((item) => item !== labelId)
        : [...current, labelId],
    );
  }

  async function executeSearch(
    rawQuery: string,
    launchOverride?: Omit<SearchLaunch, "query" | "requestId">,
  ) {
    const trimmedQuery = rawQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      setHasSearched(false);
      setNotice("请输入要查找的关键词。");
      return false;
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
      return true;
    }

    const effectiveQuickFilters =
      launchOverride?.quickFilters ?? quickFilters;
    const effectiveQScopes = launchOverride?.qScopes ?? qScopes;
    const effectiveSenderQuery =
      launchOverride?.senderQuery ?? senderQuery;
    const effectiveRecipientQuery =
      launchOverride?.recipientQuery ?? recipientQuery;
    const effectiveReceivedAfter = normalizeReceivedAfterFilter(
      launchOverride?.receivedAfter ?? receivedAfter,
    );
    const effectiveReceivedBefore = normalizeReceivedBeforeFilter(
      launchOverride?.receivedBefore ?? receivedBefore,
    );
    const effectiveHasAttachment =
      launchOverride?.hasAttachment ?? hasAttachment;
    const effectiveLabelIds = launchOverride?.labelIds ?? labelIds;
    const effectiveTagMode = launchOverride?.tagMode ?? tagMode;
    const hasLaunchOverride = launchOverride !== undefined;
    const effectiveSearchAllAccounts = props.restrictToAccount
      ? false
      : hasLaunchOverride
        ? !launchOverride?.accountId
        : searchAllAccounts;
    const effectiveAccountId = launchOverride?.accountId ?? props.accountId;

    if (!effectiveSearchAllAccounts && !effectiveAccountId) {
      setResults([]);
      setHasSearched(true);
      setNotice("请先选择一个邮箱，或切换为搜索所有邮箱。");
      return false;
    }

    setNotice("正在搜索邮件...");
    try {
      const page = await props.api.listMessages({
        ...(effectiveSearchAllAccounts ? {} : { accountId: effectiveAccountId }),
        limit: 50,
        q: trimmedQuery,
        sort: "smart",
        ...(effectiveQuickFilters.length
          ? { quickFilters: effectiveQuickFilters }
          : {}),
        ...(effectiveQScopes.length ? { qScopes: effectiveQScopes } : {}),
        ...(effectiveSenderQuery ? { senderQuery: effectiveSenderQuery } : {}),
        ...(effectiveRecipientQuery
          ? { recipientQuery: effectiveRecipientQuery }
          : {}),
        ...(effectiveReceivedAfter ? { receivedAfter: effectiveReceivedAfter } : {}),
        ...(effectiveReceivedBefore
          ? { receivedBefore: effectiveReceivedBefore }
          : {}),
        ...(typeof effectiveHasAttachment === "boolean"
          ? { hasAttachment: effectiveHasAttachment }
          : {}),
        ...(effectiveLabelIds.length
          ? { labelIds: effectiveLabelIds, tagMode: effectiveTagMode }
          : {}),
      });
      const mappedResults = page.items.map(mapMessageDtoToMailItem);
      setResults(mappedResults);
      setHasSearched(true);
      setNotice(
        mappedResults.length > 0
          ? effectiveSearchAllAccounts
            ? "已搜索所有邮箱。"
            : "已搜索当前邮箱。"
          : "没有找到匹配邮件。",
      );
      return true;
    } catch {
      setResults([]);
      setHasSearched(true);
      setNotice("搜索暂时不可用，请稍后重试。");
      return false;
    }
  }

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeSearch(query);
  }

  async function runHermesNaturalLanguageSearch() {
    const question = naturalLanguageQuery.trim();
    if (!question) {
      setNotice("请输入自然语言问题。");
      return;
    }
    if (!props.api) {
      setQuery(question);
      await executeSearch(question);
      return;
    }
    if (!props.accountId) {
      setNotice("请先选择一个邮箱，再让 Hermes 搜索。");
      return;
    }

    setHermesSearchBusy(true);
    setNotice("Hermes 正在理解问题并搜索当前邮箱...");
    try {
      const result = await props.api.searchMailWithHermes({
        accountId: props.accountId,
        question,
        language: "zh-CN",
        limit: 10,
        memoryScope: "global",
      });
      const searchOptions = searchLaunchFromHermesResult(
        result,
        props.accountId,
      );
      setQuery(result.searchQuery);
      setQuickFilters(searchOptions.quickFilters ?? []);
      setQScopes(searchOptions.qScopes ?? [
        "sender",
        "recipients",
        "subject",
        "body",
      ]);
      setSenderQuery(searchOptions.senderQuery);
      setRecipientQuery(searchOptions.recipientQuery);
      setReceivedAfter(dateInputValue(searchOptions.receivedAfter));
      setReceivedBefore(dateInputValue(searchOptions.receivedBefore));
      setHasAttachment(searchOptions.hasAttachment);
      setLabelIds(searchOptions.labelIds ?? []);
      setTagMode(searchOptions.tagMode ?? "any");
      setSearchAllAccounts(false);
      const searched = await executeSearch(result.searchQuery, searchOptions);
      if (!searched) {
        return;
      }
      setNotice(
        result.matches.length > 0
          ? `Hermes 已读取 ${result.matches.length} 个候选结果，并同步到搜索结果。`
          : "Hermes 已同步搜索条件，但没有找到候选结果。",
      );
    } catch (error) {
      setNotice(
        hermesSkillErrorNotice(error, {
          skillId: "email_search_qa",
          fallback: "Hermes 自然语言搜索暂时不可用。",
        }),
        hermesDisabledSkillIdFromError(error, "email_search_qa"),
        hermesDisabledSkillRequiredPermissionFromError(error),
      );
    } finally {
      setHermesSearchBusy(false);
    }
  }

  useEffect(() => {
    if (!props.launch?.query) {
      return;
    }

    setQuery(props.launch.query);
    setQuickFilters(props.launch.quickFilters ?? []);
    setQScopes(props.launch.qScopes ?? [
      "sender",
      "recipients",
      "subject",
      "body",
    ]);
    setSenderQuery(props.launch.senderQuery);
    setRecipientQuery(props.launch.recipientQuery);
    setReceivedAfter(dateInputValue(props.launch.receivedAfter));
    setReceivedBefore(dateInputValue(props.launch.receivedBefore));
    setHasAttachment(props.launch.hasAttachment);
    setLabelIds(props.launch.labelIds ?? []);
    setTagMode(props.launch.tagMode ?? "any");
    setSearchAllAccounts(
      props.restrictToAccount ? false : !props.launch.accountId,
    );
    void executeSearch(props.launch.query, props.launch);
  }, [props.launch?.requestId]);

  useEffect(() => {
    if (props.restrictToAccount) {
      setSearchAllAccounts(false);
      setNotice((current) =>
        current === "输入关键词后搜索所有已同步邮件。"
          ? "输入关键词后搜索当前邮箱。"
          : current,
      );
    }
  }, [props.restrictToAccount]);

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
          <HermesNaturalLanguageSearchPanel
            query={naturalLanguageQuery}
            busy={hermesSearchBusy}
            onQueryChange={setNaturalLanguageQuery}
            onSubmit={() => void runHermesNaturalLanguageSearch()}
          />
          <div className="filter-row">
            <button
              className={searchAllAccounts ? "active" : ""}
            type="button"
            aria-label="Search all accounts"
            disabled={props.restrictToAccount}
            onClick={() => {
              if (!props.restrictToAccount) {
                setSearchAllAccounts(true);
              }
            }}
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
          <div className="search-advanced-grid" aria-label="高级搜索筛选">
            <label>
              <span>发件人</span>
              <input
                aria-label="搜索发件人"
                value={senderQuery ?? ""}
                onChange={(event) =>
                  setSenderQuery(event.target.value.trim() || undefined)
                }
              />
            </label>
            <label>
              <span>收件人</span>
              <input
                aria-label="搜索收件人"
                value={recipientQuery ?? ""}
                onChange={(event) =>
                  setRecipientQuery(event.target.value.trim() || undefined)
                }
              />
            </label>
            <label>
              <span>开始日期</span>
              <input
                aria-label="搜索开始日期"
                type="date"
                value={receivedAfter ?? ""}
                onChange={(event) =>
                  setReceivedAfter(event.target.value || undefined)
                }
              />
            </label>
            <label>
              <span>结束日期</span>
              <input
                aria-label="搜索结束日期"
                type="date"
                value={receivedBefore ?? ""}
                onChange={(event) =>
                  setReceivedBefore(event.target.value || undefined)
                }
              />
            </label>
            <label>
              <span>标签模式</span>
              <select
                aria-label="搜索标签模式"
                value={tagMode}
                onChange={(event) => setTagMode(event.target.value as MailTagMode)}
              >
                <option value="any">任一标签</option>
                <option value="all">全部标签</option>
              </select>
            </label>
            <label className="search-checkbox">
              <input
                aria-label="搜索必须有附件"
                type="checkbox"
                checked={hasAttachment === true}
                onChange={(event) =>
                  setHasAttachment(event.currentTarget.checked ? true : undefined)
                }
              />
              <span>必须有附件</span>
            </label>
          </div>
          {props.labels.length > 0 ? (
            <div className="filter-row" aria-label="标签搜索筛选">
              {props.labels.slice(0, 12).map((label) => (
                <button
                  key={label.id}
                  className={labelIds.includes(label.id) ? "active" : ""}
                  type="button"
                  aria-label={`Search label ${label.label}`}
                  onClick={() => toggleSearchLabel(label.id)}
                >
                  {label.label}
                </button>
              ))}
            </div>
          ) : null}
          <HermesNotice
            notice={notice}
            skillId={noticeState.skillId}
            requiredPermission={noticeState.requiredPermission}
            onOpenSkillSettings={props.onOpenHermesSkillSettings}
          />
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

function SettingsPage(props: {
  api?: EmailHubApi;
  accountId?: string;
  focusedHermesSkillId?: string;
  focusedHermesSkillPermission?: HermesSkillRequiredPermission;
  hermesSkillFocusRequestId?: number;
  onHermesRuleApproved?: (rule: HermesRuleDto) => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("hermes");
  const settingsAccountId = props.accountId ?? PREVIEW_ACCOUNT_ID;

  return (
    <section className="workspace-page page-scroll">
      <header className="topbar single">
        <div>
          <h1>设置</h1>
          <p>Hermes 配置、待办、别名转发、域名管理、清理和隐私集中管理。</p>
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
            <HermesRuntimeSettingsPanel
              api={props.api}
              accountId={props.accountId}
              focusedSkillId={props.focusedHermesSkillId}
              focusedPermission={props.focusedHermesSkillPermission}
              focusRequestId={props.hermesSkillFocusRequestId}
              onHermesRuleApproved={props.onHermesRuleApproved}
            />
          ) : null}
          {activeSection === "todo" ? (
            <TodoPage api={props.api} accountId={settingsAccountId} embedded />
          ) : null}
          {activeSection === "gatekeeper" ? (
            <GatekeeperSettingsPanel api={props.api} accountId={settingsAccountId} />
          ) : null}
          {activeSection === "aliases" ? (
            <DomainAliasSettingsPanel api={props.api} mode="aliases" />
          ) : null}
          {activeSection === "domains" ? (
            <DomainAliasSettingsPanel api={props.api} mode="domains" />
          ) : null}
          {activeSection === "notifications" ? (
            <ComposeAttachmentMaintenancePanel api={props.api} />
          ) : null}
        </div>
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

function ComposeAttachmentMaintenancePanel(props: { api?: EmailHubApi }) {
  const [status, setStatus] = useState<ComposeAttachmentMaintenanceStatusDto>(
    previewComposeAttachmentMaintenanceStatus(),
  );
  const [hermesStatus, setHermesStatus] =
    useState<HermesRetentionMaintenanceStatusDto>(
      previewHermesRetentionMaintenanceStatus(),
    );
  const [minAgeHours, setMinAgeHours] = useState("168");
  const [limit, setLimit] = useState("100");
  const [retentionDays, setRetentionDays] = useState("30");
  const [hermesLimit, setHermesLimit] = useState("500");
  const [busy, setBusy] = useState<
    "" | "refresh" | "cleanup" | "hermes-cleanup"
  >("");
  const [notice, setNotice] = useState("正在读取数据维护状态...");

  useEffect(() => {
    let alive = true;

    if (!props.api) {
      setStatus(previewComposeAttachmentMaintenanceStatus());
      setHermesStatus(previewHermesRetentionMaintenanceStatus());
      setNotice("本地预览维护状态，连接后会读取真实缓存。");
      return () => {
        alive = false;
      };
    }

    setBusy("refresh");
    void Promise.all([
      props.api.getComposeAttachmentMaintenanceStatus(),
      props.api.getHermesRetentionMaintenanceStatus(),
    ])
      .then(([nextStatus, nextHermesStatus]) => {
        if (!alive) return;
        setStatus(nextStatus);
        setHermesStatus(nextHermesStatus);
        setNotice("数据维护状态已同步。");
      })
      .catch(() => {
        if (!alive) return;
        setNotice("暂时无法读取数据维护状态。");
      })
      .finally(() => {
        if (alive) {
          setBusy("");
        }
      });

    return () => {
      alive = false;
    };
  }, [props.api]);

  async function refreshStatus() {
    if (!props.api) {
      setStatus(previewComposeAttachmentMaintenanceStatus());
      setHermesStatus(previewHermesRetentionMaintenanceStatus());
      setNotice("本地预览维护状态已刷新。");
      return;
    }

    setBusy("refresh");
    try {
      const [nextStatus, nextHermesStatus] = await Promise.all([
        props.api.getComposeAttachmentMaintenanceStatus(),
        props.api.getHermesRetentionMaintenanceStatus(),
      ]);
      setStatus(nextStatus);
      setHermesStatus(nextHermesStatus);
      setNotice("数据维护状态已刷新。");
    } catch {
      setNotice("刷新失败，请稍后再试。");
    } finally {
      setBusy("");
    }
  }

  async function cleanupUploads(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedMinAgeHours = readMaintenanceInteger(minAgeHours, 1, 24 * 90);
    const parsedLimit = readMaintenanceInteger(limit, 1, 10000);
    if (!parsedMinAgeHours || !parsedLimit) {
      setNotice("请输入有效的清理年龄和批量上限。");
      return;
    }

    if (!props.api) {
      setStatus({
        ...status,
        generatedAt: new Date().toISOString(),
        staleUnreferenced: 0,
        staleUnreferencedBytes: 0,
      });
      setNotice("预览清理完成：释放 2 MB。");
      return;
    }

    setBusy("cleanup");
    try {
      const result = await props.api.cleanupComposeAttachments({
        minAgeHours: parsedMinAgeHours,
        limit: parsedLimit,
      });
      setStatus(composeMaintenanceStatusFromCleanup(result));
      setNotice(
        `已清理 ${result.cleanup.deleted} 个未引用附件，释放 ${formatByteSize(
          result.cleanup.bytesDeleted,
        )}。`,
      );
    } catch {
      setNotice("清理失败，请检查服务状态后重试。");
    } finally {
      setBusy("");
    }
  }

  async function cleanupHermesRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedRetentionDays = readMaintenanceInteger(retentionDays, 1, 365);
    const parsedLimit = readMaintenanceInteger(hermesLimit, 1, 10000);
    if (!parsedRetentionDays || !parsedLimit) {
      setNotice("请输入有效的 Hermes 保留天数和批量上限。");
      return;
    }

    if (!props.api) {
      setHermesStatus({
        ...hermesStatus,
        generatedAt: new Date().toISOString(),
        retentionDays: parsedRetentionDays,
        retentionMs: parsedRetentionDays * 24 * 60 * 60 * 1000,
        cleanupLimit: parsedLimit,
        expiredRows: 0,
        scanLimited: false,
        tables: hermesStatus.tables.map((table) => ({
          ...table,
          expiredRows: 0,
          scanLimited: false,
        })),
      });
      setNotice("预览清理完成：Hermes 过期数据已归零。");
      return;
    }

    setBusy("hermes-cleanup");
    try {
      const result = await props.api.cleanupHermesRetention({
        retentionDays: parsedRetentionDays,
        limit: parsedLimit,
      });
      setHermesStatus(hermesRetentionStatusFromCleanup(result));
      setNotice(`已清理 ${result.cleanup.deleted} 条 Hermes 过期记录。`);
    } catch {
      setNotice("Hermes 清理失败，请检查服务状态后重试。");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="settings-panel" aria-label="数据维护面板">
      <header className="settings-panel-head">
        <div>
          <h2>数据维护</h2>
          <p>检查自托管部署里的临时上传、Hermes 缓存、审计和隐私数据，清理动作始终有批量上限。</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          disabled={busy === "refresh"}
          onClick={() => void refreshStatus()}
        >
          {busy === "refresh" ? "刷新中" : "刷新状态"}
        </button>
      </header>

      <div className="settings-card-grid maintenance-grid">
        <article className="settings-module maintenance-stat">
          <span>未引用附件</span>
          <strong>{status.staleUnreferenced.toLocaleString()}</strong>
          <p>{formatByteSize(status.staleUnreferencedBytes)} 可清理</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>受保护附件</span>
          <strong>{status.protected.toLocaleString()}</strong>
          <p>{status.protectedStorageKeyCount.toLocaleString()} 个草稿引用</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>扫描范围</span>
          <strong>{status.scanned.toLocaleString()}</strong>
          <p>
            上限 {status.scanLimit.toLocaleString()}
            {status.scanLimited ? " · 已截断" : ""}
          </p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>异常元数据</span>
          <strong>{status.invalid.toLocaleString()}</strong>
          <p>缓存总量 {formatByteSize(status.totalBytes)}</p>
        </article>
      </div>

      <div className="settings-card-grid maintenance-grid">
        <article className="settings-module maintenance-stat">
          <span>Hermes 过期记录</span>
          <strong>{hermesStatus.expiredRows.toLocaleString()}</strong>
          <p>{hermesStatus.scanLimited ? "超过扫描上限" : "当前可清理"}</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>Hermes 保留天数</span>
          <strong>{hermesStatus.retentionDays.toLocaleString()}</strong>
          <p>截止 {formatMailDate(hermesStatus.cutoff)}</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>Hermes 批量上限</span>
          <strong>{hermesStatus.cleanupLimit.toLocaleString()}</strong>
          <p>每次清理每张表</p>
        </article>
        <article className="settings-module maintenance-stat">
          <span>Hermes 受管表</span>
          <strong>{hermesStatus.tables.length.toLocaleString()}</strong>
          <p>缓存、审计、计划和运行记录</p>
        </article>
      </div>

      <section className="settings-module hermes-retention-table-list">
        <div className="sync-diagnostics-header">
          <div>
            <h3>Hermes 保留范围</h3>
            <p>{hermesStatus.scanLimited ? "部分表仍有更多过期记录" : "扫描结果在批量上限内"}</p>
          </div>
        </div>
        <div className="task-list">
          {hermesStatus.tables.map((table) => (
            <div className="task-row" key={table.table}>
              <Sparkles size={18} />
              <div>
                <strong>{formatHermesRetentionTableName(table.table)}</strong>
                <span>
                  {table.expiredRows.toLocaleString()} 条过期
                  {table.scanLimited ? " · 已截断" : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form className="settings-module maintenance-cleanup" onSubmit={cleanupUploads}>
        <div>
          <h3>手动清理</h3>
          <p>
            {`默认只删除超过 ${Math.round(
              status.retentionMs / 3600000,
            )} 小时、且没有草稿引用的上传缓存。`}
          </p>
        </div>
        <label>
          <span>最小保留小时</span>
          <input
            aria-label="清理最小保留小时"
            type="number"
            min={1}
            max={24 * 90}
            value={minAgeHours}
            onChange={(event) => setMinAgeHours(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>批量上限</span>
          <input
            aria-label="清理批量上限"
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(event) => setLimit(event.currentTarget.value)}
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={busy === "cleanup"}
        >
          {busy === "cleanup" ? "清理中" : "清理未引用附件"}
        </button>
      </form>

      <form
        className="settings-module maintenance-cleanup"
        aria-label="Hermes retention cleanup"
        onSubmit={cleanupHermesRetention}
      >
        <div>
          <h3>Hermes 清理</h3>
          <p>{`默认删除超过 ${hermesStatus.retentionDays} 天的缓存、计划、反馈、审计和运行记录。`}</p>
        </div>
        <label>
          <span>保留天数</span>
          <input
            aria-label="Hermes 保留天数"
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>批量上限</span>
          <input
            aria-label="Hermes 清理批量上限"
            type="number"
            min={1}
            max={10000}
            value={hermesLimit}
            onChange={(event) => setHermesLimit(event.currentTarget.value)}
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={busy === "hermes-cleanup"}
        >
          {busy === "hermes-cleanup" ? "清理中" : "清理 Hermes 过期数据"}
        </button>
      </form>

      <div className="backend-notice" role="status">
        {notice}
      </div>
    </section>
  );
}

function previewComposeAttachmentMaintenanceStatus(): ComposeAttachmentMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-16T00:00:00.000Z",
    storage: "local",
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    cleanupLimit: 100,
    protectedStorageKeyCount: 2,
    scanned: 12,
    scanLimit: 5000,
    scanLimited: false,
    uploads: 10,
    totalBytes: 8 * 1024 * 1024,
    protected: 2,
    fresh: 3,
    staleUnreferenced: 5,
    staleUnreferencedBytes: 2 * 1024 * 1024,
    invalid: 0,
    oldestCreatedAt: "2026-06-01T00:00:00.000Z",
    newestCreatedAt: "2026-06-15T23:00:00.000Z",
  };
}

function previewHermesRetentionMaintenanceStatus(): HermesRetentionMaintenanceStatusDto {
  return {
    generatedAt: "2026-06-16T00:00:00.000Z",
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    retentionDays: 30,
    cleanupLimit: 500,
    cutoff: "2026-05-17T00:00:00.000Z",
    expiredRows: 18,
    scanLimited: false,
    tables: [
      hermesRetentionTableStatus("hermes_message_translations", "updated_at", 3),
      hermesRetentionTableStatus("hermes_message_summaries", "updated_at", 2),
      hermesRetentionTableStatus("hermes_action_plans", "created_at", 4),
      hermesRetentionTableStatus("hermes_feedback", "created_at", 1),
      hermesRetentionTableStatus("hermes_audit_events", "created_at", 5),
      hermesRetentionTableStatus("hermes_skill_runs", "created_at", 3),
    ],
  };
}

function hermesRetentionTableStatus(
  table: string,
  timestampColumn: string,
  expiredRows: number,
): HermesRetentionMaintenanceStatusDto["tables"][number] {
  return {
    table,
    timestampColumn,
    expiredRows,
    scanLimit: 500,
    scanLimited: false,
  };
}

function composeMaintenanceStatusFromCleanup(
  result: ComposeAttachmentMaintenanceCleanupResultDto,
): ComposeAttachmentMaintenanceStatusDto {
  return {
    generatedAt: result.generatedAt,
    storage: result.storage,
    retentionMs: result.retentionMs,
    cleanupLimit: result.cleanupLimit,
    protectedStorageKeyCount: result.protectedStorageKeyCount,
    ...result.after,
  };
}

function hermesRetentionStatusFromCleanup(
  result: HermesRetentionMaintenanceCleanupResultDto,
): HermesRetentionMaintenanceStatusDto {
  return result.after;
}

function formatHermesRetentionTableName(table: string): string {
  const labels: Record<string, string> = {
    hermes_message_translations: "邮件翻译缓存",
    hermes_message_summaries: "邮件总结缓存",
    hermes_action_plans: "执行计划",
    hermes_feedback: "草稿反馈",
    hermes_audit_events: "审计日志",
    hermes_skill_runs: "运行记录",
  };

  return labels[table] ?? table;
}

function readMaintenanceInteger(
  value: string,
  min: number,
  max: number,
): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : undefined;
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted =
    Number.isInteger(value) || value >= 10 || unitIndex === 0
      ? String(Math.round(value))
      : value.toFixed(1);

  return `${formatted} ${units[unitIndex]}`;
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

function MailEmptyState(props: {
  notice?: string;
  undoToast?: UndoToastState;
  onAddMail: () => void;
  onOpenSyncCenter: () => void;
  onUndoDone: () => void;
}) {
  return (
    <section className="mail-empty-panel" aria-label="聚合收件箱空状态">
      {props.undoToast ? (
        <UndoDoneNotice onUndoDone={props.onUndoDone} />
      ) : null}
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

function UndoDoneNotice(props: { onUndoDone: () => void }) {
  return (
    <div className="backend-notice" role="status">
      Done queued.
      <button type="button" aria-label="Undo done" onClick={props.onUndoDone}>
        Undo
      </button>
    </div>
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
    reasons: message.classification.reasons,
    searchPreview: message.searchPreview?.text,
    };
  }

function sortMailItems(items: MailItem[], sort: MessageListSort): MailItem[] {
  const next = [...items];
  if (sort === "time") {
    return next.sort(
      (left, right) =>
        new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
    );
  }

  return next.sort((left, right) => right.score - left.score);
}

function firstMailKey(items: MailItem[], sort: MessageListSort): string {
  const [first] = sortMailItems(items, sort);
  return first ? mailItemKey(first) : "";
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

function isHermesRuleCommand(value: string): boolean {
  const command = value.trim();
  if (isHermesSearchCommand(command) && !isHermesAutomationCommand(command)) {
    return false;
  }

  return isHermesAutomationCommand(command);
}

function isHermesSearchCommand(value: string): boolean {
  return /搜索|查找|查询|寻找|找一下|找出|找找|搜一下|有哪些|哪些|有没有|在哪里|在哪|search|find|show|list|filter/i.test(
    value,
  );
}

function isHermesAutomationCommand(value: string): boolean {
  return (
    /(?:create|add|set up|setup|make|build|enable).*(?:rule|filter|label|folder|category)/i.test(
      value,
    ) ||
    /(?:auto|automatically|always).*(?:rule|filter|label|move|categorize|classify)/i.test(
      value,
    ) ||
    /(?:创建|新增|添加|新建|设置|建立|启用|生成).*(?:规则|分组|分类|标签|filter|rule)/iu.test(
      value,
    ) ||
    /(?:自动|以后|今后|每次|总是|一律|都).*(?:规则|分组|分类|标签|归类|移动到|移到|放到|放进|归到|归入|整理到|分配到)/u.test(
      value,
    ) ||
    /(?:把|将).*(?:邮件|邮箱|收件箱).*(?:放到|放进|归到|归入|归类|移动到|移到|整理到|分配到).*(?:分组|分类|标签|左侧|文件夹)/u.test(
      value,
    ) ||
    /(?:邮件|邮箱|收件箱).*(?:加|打|应用).*(?:标签|分类|分组)/u.test(
      value,
    ) ||
    /(?:创建|新增|添加|新建|加|放到|放进|归到|归入|归类|移动到|移到|整理到|分配到|自动).*(?:邮件|邮箱|收件箱|左侧)/u.test(
      value,
    )
  );
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
      return "Hermes 尚未配置模型接口，请到设置 > Hermes 配置填写服务地址、模型和访问密钥。";
    }
    const unavailableNotice = input.unavailable?.[error.code];
    if (unavailableNotice) {
      return unavailableNotice;
    }
  }

  return input.fallback;
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
