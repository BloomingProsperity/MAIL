import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import {
  Archive,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Inbox,
  Mail,
  Paperclip,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { mailItemKey } from "./mail-items";
import {
  composeBodyHtmlForPayload,
  formatComposeSelection,
} from "../compose/rich-text";
import type { ComposeBodyFormat } from "../compose/rich-text";
import "../compose/ComposeSurface.css";
import {
  HermesReaderTranslationControls,
  HermesReaderTranslationResult,
} from "../hermes/HermesReaderTranslationPanel";
import { useReaderTranslationPreferences } from "../hermes/useReaderTranslationPreferences";
import { HermesReplyAssistantPanel } from "../hermes/HermesComposeAssistPanel";
import type { HermesQuickReplyAction } from "../hermes/HermesComposeAssistPanel";
import {
  HermesReaderOrganizationPanel,
  HermesReaderSummaryPanel,
  formatHermesActionItemNote,
  hermesActionItemApplyId,
} from "../hermes/HermesReaderOrganizationPanels";
import type { HermesOrganizationApplyAction } from "../hermes/HermesReaderOrganizationPanels";
import { HermesNotice } from "../hermes/HermesNotice";
import {
  hermesDisabledSkillIdFromError,
} from "../hermes/hermesRules";
import type { HermesSearchLaunchOptions } from "../hermes/hermesSearchLaunch";
import { useResizablePane } from "../layout/useResizablePane";
import type { MailItem, Tone } from "./mail-items";
import { MailComposePanels } from "./MailComposePanels";
import { MailDirectoryListPanes } from "./MailDirectoryListPanes";
import type {
  AttachmentDto,
  EmailHubApi,
  HermesActionItem,
  HermesFollowupTrackerResult,
  HermesMessageOrganizationResult,
  HermesMessageSummaryResult,
  HermesMessageTranslationResult,
  HermesSkillRequiredPermission,
  LabelDto,
  MailActionResult,
  MailComposePreviewDto,
  MailComposeSeedDto,
  MailComposeSeedAttachmentDto,
  MailComposeSeedMode,
  MailDraftAttachmentDto,
  MailDraftDto,
  MailDraftSource,
  MailQuickFilter,
  MailSendIdentityCandidateDto,
  MailSendIdentityDiagnosticsDto,
  MailSendIdentityDto,
  MessageDetailDto,
  MailTagMode,
  ScheduledSendDto,
  SmartInboxFeedbackAction,
} from "../../lib/emailHubApi";
import type {
  ComposeAutosaveInFlight,
  ComposeAutosaveStatus,
  ComposeDraftSignatureInput,
  ComposeSurface,
  FolderItem,
  HermesDockReaderIntent,
  HermesNoticeAction,
  HermesNoticeState,
  LabelItem,
  MailDensity,
  QuickCategory,
  ReaderActionResult,
  ReaderHermesBusy,
  SmartInboxBusyAction,
  TopSearchScope,
  UndoToastState,
} from "./MailWorkspaceTypes";
import {
  UndoDoneNotice,
  aggregateMessageFilterForFolder,
  bucketLabel,
  candidateTargetMailboxValue,
  composeAttachmentFromFile,
  composeAttachmentFromSeed,
  composeAttachmentUploadErrorNotice,
  composeDraftSignature,
  composeDraftSignatureFromDraft,
  defaultScheduleDateTimeLocal,
  focusComposeTarget,
  formatAttachmentSize,
  formatComposeAddressList,
  formatComposeAutosaveStatus,
  formatGraphDiagnosticsStatus,
  formatMailDate,
  formatScheduledSendStatus,
  formatSendIdentity,
  formatSendIdentityCandidateState,
  formatSendIdentityTargetState,
  hasBackendAccountId,
  hermesDisabledSkillRequiredPermissionFromError,
  hermesNoticeActionFromError,
  hermesNoticeActionLabel,
  hermesReplyMemoryInput,
  hermesSkillErrorNotice,
  isoToDateTimeLocal,
  mergeGraphTargetMailboxValues,
  messageReaderText,
  messageRecipientSummary,
  parseComposeRecipients,
  parseDateTimeLocal,
  previewSendIdentities,
  readerTranslationPreferenceSourceLanguage,
  saveAttachmentDownload,
  seedRescheduleTimes,
  upsertSendIdentityCandidate,
} from "./mailWorkspaceUtils";

const MAX_COMPOSE_ATTACHMENTS = 20;
const MAX_COMPOSE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const COMPOSE_AUTOSAVE_DELAY_MS = 2_000;
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
const densityOptions: Array<{ id: MailDensity; label: string; shortLabel: string }> = [
  { id: "roomy", label: "宽松", shortLabel: "宽" },
  { id: "comfortable", label: "舒适", shortLabel: "舒" },
  { id: "compact", label: "紧凑", shortLabel: "紧" },
];
const folderIcons: Record<string, typeof Inbox> = {
  inbox: Inbox,
  flagged: Star,
  priority: Clock3,
  starred: Star,
  snoozed: Clock3,
  drafts: FileText,
  sent: Send,
  archive: Archive,
  junk: ShieldCheck,
  spam: ShieldCheck,
  trash: Trash2,
  all: Mail,
  attachments: Paperclip,
};
export function MailWorkspace(props: {
  api?: EmailHubApi;
  accountId: string;
  activeFolder: string;
    activeMailId: string;
    folders: FolderItem[];
    mail: MailItem[];
    folderTitle: string;
    folderCount: number;
    selectedMail: MailItem;
    hasSelectedMail: boolean;
  selectedDetail?: MessageDetailDto;
  undoToast?: UndoToastState;
  backendNotice?: string;
  smartInboxBusy: SmartInboxBusyAction;
  quickCategories: QuickCategory[];
  labels: LabelItem[];
  hermesDockReaderIntent?: HermesDockReaderIntent;
    hermesFollowUpSuggestion?: HermesFollowupTrackerResult;
    followUpNotice?: string;
    density: MailDensity;
    onGlobalSearch: (query: string, options?: HermesSearchLaunchOptions) => void;
    onDensityChange: (density: MailDensity) => void;
    onRefresh: () => void;
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
  onOpenHermesRuntimeSettings: () => void;
}) {
  const directoryResize = useResizablePane({
    initialSize: 168,
    minSize: 132,
    maxSize: 260,
    storageKey: "email-hub:layout:mail-directory",
  });
  const messageListResize = useResizablePane({
    initialSize: 460,
    minSize: 420,
    maxSize: 640,
    storageKey: "email-hub:layout:message-list",
  });
  const [topSearchQuery, setTopSearchQuery] = useState("");
  const [topSearchScope, setTopSearchScope] = useState<TopSearchScope>("all");
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
  const [composeAdvancedSenderOpen, setComposeAdvancedSenderOpen] =
    useState(false);
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
  const [composeSurface, setComposeSurface] =
    useState<ComposeSurface>("closed");
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
  const attachmentDownloadRequestRef = useRef(0);
  const [readerHermesNoticeState, setReaderHermesNoticeState] =
    useState<HermesNoticeState>({ text: "" });
  const [readerHermesBusy, setReaderHermesBusy] =
    useState<ReaderHermesBusy | undefined>();
  const [composeSlotElement, setComposeSlotElement] =
    useState<HTMLDivElement | null>(null);
  const attachComposeSlot = useCallback((element: HTMLDivElement | null) => {
    setComposeSlotElement(element);
  }, []);
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
  const composeDraftSessionRef = useRef(0);
  const composeAutosaveInFlightRef = useRef<
    ComposeAutosaveInFlight | undefined
  >(undefined);
  const lastSavedComposeSignatureRef = useRef("");
  const composeMessageRequestRef = useRef(0);
  const composeMessageRequestActiveRef = useRef(false);
  const composeMessageAccountIdRef = useRef(props.accountId);
  const outboxEditRequestRef = useRef(0);
  const composeBodyRef = useRef(composeBody);
  const readerHermesRequestRef = useRef(0);
  const readerHermesApplyRequestRef = useRef(0);
  const hermesDockReaderIntentRequestRef = useRef<number | undefined>(
    undefined,
  );
  const readerTranslationPreferenceRequestRef = useRef(0);
  composeMessageAccountIdRef.current = props.accountId;
  composeBodyRef.current = composeBody;
  const composeNotice = composeNoticeState.text;
  const readerHermesNotice = readerHermesNoticeState.text;
  const readerControlsDisabled = !props.hasSelectedMail || composeBusy;
  const readerHermesControlsDisabled =
    !props.hasSelectedMail || Boolean(readerHermesBusy);

  function setComposeNotice(
    notice: string,
    _skillId?: string,
    _requiredPermission?: HermesSkillRequiredPermission,
    action?: HermesNoticeAction,
  ) {
    setComposeNoticeState({ text: notice, action });
  }

  function setReaderHermesNotice(
    notice: string,
    _skillId?: string,
    _requiredPermission?: HermesSkillRequiredPermission,
    action?: HermesNoticeAction,
  ) {
    setReaderHermesNoticeState({ text: notice, action });
  }

  function openComposeSurface(surface: ComposeSurface, focus: "to" | "body") {
    setComposeSurface(surface);
    window.setTimeout(() => focusComposeTarget(focus), 0);
  }

  function invalidateOutboxEditRequest() {
    outboxEditRequestRef.current += 1;
  }

  function openNewComposeSurface() {
    invalidateOutboxEditRequest();
    clearComposeForm();
    setComposeNotice("");
    openComposeSurface("floating", "to");
  }

  function closeComposeSurface() {
    setComposeSurface("closed");
  }

  function selectReaderTranslationSource(sourceLanguage: string) {
    if (!props.hasSelectedMail) {
      return;
    }

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

  useLayoutEffect(() => {
    invalidateComposeMessageRequest();
    readerHermesRequestRef.current += 1;
    readerHermesApplyRequestRef.current += 1;
    readerTranslationPreferenceRequestRef.current += 1;
    setAttachmentDownloadBusyId(undefined);
    setAttachmentDownloadNotice("");
    setReaderHermesNotice("");
    setReaderHermesSummary(undefined);
    setReaderHermesTranslation(undefined);
    setReaderHermesOrganization(undefined);
    setReaderHermesBusy(undefined);
    if (!props.hasSelectedMail) {
      setReaderHermesApplyBusy(undefined);
      setReaderTranslationPreferenceBusy(false);
      return;
    }

    readerTranslationPreferences.applyPreferenceForSender({
      accountId: props.selectedMail.accountId,
      senderEmail: props.selectedMail.email,
    });
    setReaderHermesApplyBusy(undefined);
    setReaderTranslationPreferenceBusy(false);
  }, [
    props.hasSelectedMail,
    props.selectedMail.accountId,
    props.selectedMail.email,
    props.selectedMail.id,
  ]);

  useEffect(() => {
    const intent = props.hermesDockReaderIntent;
    if (
      !intent ||
      !props.hasSelectedMail ||
      hermesDockReaderIntentRequestRef.current === intent.requestId
    ) {
      return;
    }

    hermesDockReaderIntentRequestRef.current = intent.requestId;
    if (intent.action === "summarize_message") {
      void askHermesForReaderSummary();
    } else if (intent.action === "translate_message") {
      void askHermesForReaderTranslation();
    } else {
      void askHermesForReplyDraft();
    }
  }, [props.hasSelectedMail, props.hermesDockReaderIntent?.requestId]);

  useEffect(() => {
    invalidateComposeMessageRequest();
    cancelComposeAutosave();
    lastSavedComposeSignatureRef.current = "";
    setComposeDraftId(undefined);
    setComposeScheduledId(undefined);
    setGraphTargetMailboxes({});
    setComposeAdvancedSenderOpen(false);
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

    if (!hasBackendAccountId(props.accountId)) {
      setSendIdentities([]);
      setSendIdentityCandidates([]);
      setGraphTargetMailboxes({});
      setComposeFrom("");
      setMailDrafts([]);
      setDraftsLoading(false);
      setOutboxItems([]);
      setOutboxNotice("");
      setDraftsNotice("");
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
  const detailAttachments = props.hasSelectedMail
    ? props.selectedDetail?.attachments
    : undefined;
  const visibleAttachmentCount =
    detailAttachments?.length ??
    (props.hasSelectedMail
      ? props.api
        ? props.selectedMail.attachmentCount
        : PREVIEW_ATTACHMENT_ROWS.length
      : 0);
  const previewAttachments =
    props.hasSelectedMail && !props.api ? PREVIEW_ATTACHMENT_ROWS : [];
  const readerBodyText = props.hasSelectedMail
    ? messageReaderText(props.selectedDetail, props.selectedMail)
    : "";
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeAutosaveStatus("idle");
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
      const payload = composeDraftPayload(signatureInput);
      const request = composeDraftId
        ? props.api!.updateMailDraft({
            ...payload,
            draftId: composeDraftId,
          })
        : props.api!.createMailDraft(payload);
      composeAutosaveInFlightRef.current = {
        accountId: props.accountId,
        ...(composeDraftId ? { draftId: composeDraftId } : {}),
        sessionId: composeDraftSessionRef.current,
        signature,
        promise: request,
      };

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
        })
        .finally(() => {
          if (composeAutosaveInFlightRef.current?.promise === request) {
            composeAutosaveInFlightRef.current = undefined;
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
    if (!hasBackendAccountId(props.accountId)) {
      setSendIdentities([]);
      setSendIdentityCandidates([]);
      setGraphTargetMailboxes({});
      setComposeFrom("");
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
    if (!hasBackendAccountId(props.accountId)) {
      setOutboxItems([]);
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
    if (!hasBackendAccountId(props.accountId)) {
      setMailDrafts([]);
      setDraftsNotice("");
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
      return;
    }
    if (candidate.verificationState !== "verified" || !candidate.enabled) {
      setComposeNotice("Outlook 共享发件人未验证。");
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
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
    invalidateOutboxEditRequest();
    composeDraftSessionRef.current += 1;
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
    composeDraftSessionRef.current += 1;
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
    setComposeNotice(scheduled ? "待发草稿已打开。" : "草稿已打开。");
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
    if (!props.hasSelectedMail) {
      setComposeNotice("未打开邮件。");
      return;
    }

    const requestId = beginComposeMessageRequest();
    const selectedMail = props.selectedMail;
    const from = selectedComposeFrom;
    try {
      const seed = await props.api.createComposeSeed({
        accountId: selectedMail.accountId,
        messageId: selectedMail.id,
        mode,
        ...(from ? { from } : {}),
      });
      if (!isCurrentComposeMessageRequest(requestId)) {
        return;
      }
      applySeedToCompose(seed);
      openComposeSurface(
        "reader",
        seed.warnings.includes("missing_recipient") ? "to" : "body",
      );
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
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
          : "预览已生成，仍有提示项。",
      );
    } catch {
      setComposeNotice("预览生成失败。");
    } finally {
      setComposeBusy(false);
    }
  }

  async function askHermesForReaderSummary() {
    if (!props.api) {
      setReaderHermesNotice("Hermes 暂时不可用。");
      return;
    }
    if (!props.hasSelectedMail) {
      setReaderHermesNotice("未打开邮件。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("summary");
    setReaderHermesNotice("");
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
      setReaderHermesNotice("Hermes 已完成线程总结。");
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
        hermesNoticeActionFromError(error),
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
    if (!props.hasSelectedMail) {
      setReaderHermesNotice("未打开邮件。");
      return;
    }

    const requestId = readerHermesRequestRef.current + 1;
    readerHermesRequestRef.current = requestId;
    setReaderHermesBusy("translation");
    setReaderHermesNotice("");
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
        options.forceRefresh ? "Hermes 已重新翻译。" : "Hermes 已翻译。",
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
        hermesNoticeActionFromError(error),
      );
    } finally {
      if (readerHermesRequestRef.current === requestId) {
        setReaderHermesBusy(undefined);
      }
    }
  }

  async function rememberReaderTranslationPreference() {
    if (!props.api || !props.hasSelectedMail || !readerHermesTranslation) {
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
    if (!props.hasSelectedMail) {
      setReaderHermesNotice("未打开邮件。");
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
    setReaderHermesNotice("");
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
      setReaderHermesNotice("Hermes 已整理这封邮件。");
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
        hermesNoticeActionFromError(error),
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
    if (!props.hasSelectedMail) {
      setReaderHermesNotice("未打开邮件。");
      return;
    }

    setReaderHermesApplyBusy(action.id);
    setReaderHermesNotice("");

    const requestId = readerHermesApplyRequestRef.current + 1;
    readerHermesApplyRequestRef.current = requestId;
    const accountId = props.selectedMail.accountId;
    const messageId = props.selectedMail.id;
    let applied = false;
    let successNotice: string | undefined;
    try {
      if (action.kind === "mail") {
        applied = await props.onArchive();
      } else if (action.kind === "smart_inbox") {
        applied = await props.onSmartInboxFeedback(action.action);
      } else if (!props.api) {
        if (readerHermesApplyRequestRef.current === requestId) {
          setReaderHermesNotice("Hermes 标签建议暂时不可用。");
        }
        return;
      } else {
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
          messageId,
          action: "apply_labels",
          labelIds: [labelId],
        });
        if (readerHermesApplyRequestRef.current !== requestId) {
          return;
        }
        props.onMailActionResult(result);
        props.onLabelsChanged(accountId);
        applied = true;
        successNotice = `Hermes 建议已应用：${action.label}。写回状态：${result.command.status}。`;
      }
    } catch {
      applied = false;
    } finally {
      if (readerHermesApplyRequestRef.current === requestId) {
        setReaderHermesApplyBusy(undefined);
      }
    }

    if (readerHermesApplyRequestRef.current !== requestId) {
      return;
    }

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

    if (!props.api || !props.hasSelectedMail) {
      setReaderHermesNotice("Hermes 待办提醒暂时不可用。");
      return;
    }

    if (!item.dueAt) {
      setReaderHermesNotice("Hermes 待办缺少明确时间，暂不自动创建提醒。");
      return;
    }

    const busyId = hermesActionItemApplyId(item, index);
    const requestId = readerHermesApplyRequestRef.current + 1;
    readerHermesApplyRequestRef.current = requestId;
    const accountId = props.selectedMail.accountId;
    const messageId = props.selectedMail.id;
    const skillRunId = readerHermesOrganization?.actionItems.skillRunId;
    setReaderHermesApplyBusy(busyId);
    setReaderHermesNotice("");

    try {
      const followUp = await props.api.createFollowUp({
        accountId,
        messageId,
        dueAt: item.dueAt,
        kind: "manual",
        title: item.title,
        note: formatHermesActionItemNote(item),
        source: "hermes_followup",
        hermesSkillRunId: skillRunId,
      });
      if (readerHermesApplyRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesNotice(`Hermes 待办提醒已创建：${followUp.title ?? item.title}。`);
    } catch {
      if (readerHermesApplyRequestRef.current !== requestId) {
        return;
      }
      setReaderHermesNotice("Hermes 待办提醒创建失败。");
    } finally {
      if (readerHermesApplyRequestRef.current === requestId) {
        setReaderHermesApplyBusy(undefined);
      }
    }
  }

  async function askHermesForReplyDraft() {
    if (!props.api) {
      setComposeNotice("Hermes 暂时不可用。");
      return;
    }
    if (!props.hasSelectedMail) {
      setComposeNotice("未打开邮件。");
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
        notice: "Hermes 已生成回复草稿。",
      });
      openComposeSurface("reader", "body");
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
        hermesNoticeActionFromError(error),
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
    if (!props.hasSelectedMail) {
      setComposeNotice("未打开邮件。");
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
        notice: "Hermes 已生成快速回复。",
      });
      openComposeSurface("reader", "body");
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
        hermesNoticeActionFromError(error),
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
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
          setComposeNotice("待发邮件已提交立即发送。");
          clearComposeForm();
          await refreshOutbox();
          return;
        }

        await props.api.sendMailDraft({
          accountId: props.accountId,
          draftId: draft.id,
        });
        setComposeNotice("邮件已进入发送队列。");
        clearComposeForm();
        await refreshMailDrafts();
        await refreshOutbox();
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
          ? "待发草稿已更新。"
          : composeDraftId
            ? "草稿已更新。"
            : "草稿已保存。",
      );
      if (composeScheduledId) {
        await refreshOutbox();
      } else {
        await refreshMailDrafts();
      }
    } catch {
      setComposeNotice("写信操作失败。");
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

  async function adoptInFlightComposeAutosave(signature: string) {
    const inFlight = composeAutosaveInFlightRef.current;
    if (
      !inFlight ||
      inFlight.accountId !== props.accountId ||
      inFlight.sessionId !== composeDraftSessionRef.current
    ) {
      return undefined;
    }
    if (composeDraftId) {
      if (inFlight.draftId !== composeDraftId) {
        return undefined;
      }
    } else if (inFlight.draftId) {
      return undefined;
    }

    try {
      const draft = await inFlight.promise;
      if (
        inFlight.accountId !== props.accountId ||
        inFlight.sessionId !== composeDraftSessionRef.current
      ) {
        return undefined;
      }
      return {
        draft,
        signatureMatches: inFlight.signature === signature,
      };
    } catch {
      return undefined;
    }
  }

  async function saveOrUpdateComposeDraft(input: {
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

    const signature = currentComposeSignature(input);
    const autosaved = await adoptInFlightComposeAutosave(signature);
    if (autosaved) {
      setComposeDraftId(autosaved.draft.id);
      if (autosaved.signatureMatches) {
        return autosaved.draft;
      }
      return props.api!.updateMailDraft({
        ...payload,
        draftId: autosaved.draft.id,
      });
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
    if (props.api && !hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
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

  function insertComposeTemplate(template: {
    label: string;
    subject: string;
    bodyText: string;
  }) {
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
    invalidateOutboxEditRequest();
    composeDraftSessionRef.current += 1;
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
      return;
    }

    const bodyText = composeBody.trim();
    if (!bodyText) {
      setComposeNotice("正文为空。");
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
      setComposeNotice("Hermes 已翻译草稿。");
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
        hermesNoticeActionFromError(error),
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
    if (!hasBackendAccountId(props.accountId)) {
      setComposeNotice("未选择邮箱。");
      return;
    }

    const bodyText = composeBody.trim();
    if (!bodyText) {
      setComposeNotice("正文为空。");
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
      setComposeNotice("Hermes 已润色草稿。");
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
        hermesNoticeActionFromError(error),
      );
    } finally {
      finishComposeMessageRequest(requestId);
    }
  }

  function editMailDraft(draft: MailDraftDto) {
    invalidateOutboxEditRequest();
    applyDraftToCompose(draft);
    setDraftsNotice("已载入草稿。");
    openComposeSurface("floating", "body");
  }

  async function editOutboxItem(item: ScheduledSendDto) {
    if (!props.api || !item.canEdit) {
      return;
    }
    if (!hasBackendAccountId(props.accountId)) {
      setOutboxNotice("未选择邮箱。");
      return;
    }

    setOutboxBusyId(item.id);
    const requestId = outboxEditRequestRef.current + 1;
    outboxEditRequestRef.current = requestId;
    try {
      const detail = await props.api.getScheduledDraft({
        accountId: props.accountId,
        scheduledId: item.id,
      });
      if (outboxEditRequestRef.current !== requestId) {
        return;
      }
      applyDraftToCompose(detail.draft, detail.scheduledSend);
      setOutboxNotice("已载入待发草稿。");
      openComposeSurface("floating", "body");
    } catch {
      if (outboxEditRequestRef.current === requestId) {
        setOutboxNotice("待发草稿读取失败。");
      }
    } finally {
      if (outboxEditRequestRef.current === requestId) {
        setOutboxBusyId(undefined);
      }
    }
  }

  async function sendOutboxItemNow(item: ScheduledSendDto) {
    if (!props.api || !item.canSendNow) {
      return;
    }
    if (!hasBackendAccountId(props.accountId)) {
      setOutboxNotice("未选择邮箱。");
      return;
    }

    setOutboxBusyId(item.id);
    try {
      await props.api.sendScheduledNow({
        accountId: props.accountId,
        scheduledId: item.id,
      });
      setOutboxNotice("已提交立即发送。");
      await refreshOutbox();
    } catch {
      setOutboxNotice("立即发送失败。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  async function rescheduleOutboxItem(item: ScheduledSendDto) {
    if (!props.api || !item.canEdit) {
      return;
    }
    if (!hasBackendAccountId(props.accountId)) {
      setOutboxNotice("未选择邮箱。");
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
      setOutboxNotice("改时间失败。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  async function cancelOutboxItem(item: ScheduledSendDto) {
    if (!props.api || !item.canDelete) {
      return;
    }
    if (!hasBackendAccountId(props.accountId)) {
      setOutboxNotice("未选择邮箱。");
      return;
    }

    setOutboxBusyId(item.id);
    try {
      await props.api.cancelScheduledSend({
        accountId: props.accountId,
        scheduledId: item.id,
      });
      setOutboxNotice("已取消定时发送。");
      await refreshOutbox();
    } catch {
      setOutboxNotice("取消定时发送失败。");
    } finally {
      setOutboxBusyId(undefined);
    }
  }

  function submitTopSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = topSearchQuery.trim();
    props.onGlobalSearch(trimmedQuery, topSearchOptions());
  }

  function topSearchOptions(): HermesSearchLaunchOptions {
    if (topSearchScope === "all") {
      return {};
    }

    const accountOption = hasBackendAccountId(props.accountId)
      ? { accountId: props.accountId }
      : {};

    if (topSearchScope === "account") {
      return accountOption;
    }

    if (props.activeFolder.startsWith("label:")) {
      return {
        ...accountOption,
        labelIds: [props.activeFolder.slice("label:".length)],
        tagMode: "any",
      };
    }

    const category = props.quickCategories.find(
      (item) => item.id === props.activeFolder,
    );
    if (category) {
      return {
        ...accountOption,
        savedView: category.id,
      };
    }

    const aggregateFilter = aggregateMessageFilterForFolder(props.activeFolder);
    if (Object.keys(aggregateFilter).length > 0) {
      return {
        ...accountOption,
        ...aggregateFilter,
      };
    }

    if (
      hasBackendAccountId(props.accountId) &&
      props.folders.some((item) => item.id === props.activeFolder) &&
      props.activeFolder !== "all"
    ) {
      return {
        ...accountOption,
        mailboxId: props.activeFolder,
      };
    }

    return {
      ...accountOption,
    };
  }

  async function submitNewLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newLabelName.trim();
    if (!name) {
      setLabelNotice("请输入标签名称。");
      return;
    }
    if (!props.api) {
      setLabelNotice("标签暂时无法创建。");
      return;
    }
    if (!hasBackendAccountId(props.accountId)) {
      setLabelNotice("未选择邮箱。");
      return;
    }

    setLabelBusy(true);
    setLabelNotice("");
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
      setLabelNotice("标签创建失败。");
    } finally {
      setLabelBusy(false);
    }
  }

  async function downloadMessageAttachment(attachment: AttachmentDto) {
    if (!props.api) {
      setAttachmentDownloadNotice("附件下载服务暂时不可用。");
      return;
    }
    if (!hasBackendAccountId(props.accountId)) {
      setAttachmentDownloadNotice("未选择邮箱。");
      return;
    }

    const requestId = attachmentDownloadRequestRef.current + 1;
    attachmentDownloadRequestRef.current = requestId;
    setAttachmentDownloadBusyId(attachment.id);
    setAttachmentDownloadNotice("");
    try {
      const download = await props.api.downloadAttachment({
        accountId: props.accountId,
        attachmentId: attachment.id,
      });
      saveAttachmentDownload(download, attachment.filename);
      if (attachmentDownloadRequestRef.current === requestId) {
        setAttachmentDownloadNotice(`附件已开始下载：${attachment.filename}`);
      }
    } catch {
      if (attachmentDownloadRequestRef.current === requestId) {
        setAttachmentDownloadNotice(`附件下载失败：${attachment.filename}`);
      }
    } finally {
      if (attachmentDownloadRequestRef.current === requestId) {
        setAttachmentDownloadBusyId(undefined);
      }
    }
  }

  const visibleMailKeys = useMemo(
    () => new Set(props.mail.map((mail) => mailItemKey(mail))),
    [props.mail],
  );
  const selectedVisibleMail = props.mail.filter((mail) =>
    selectedMailKeys.has(mailItemKey(mail)),
  );
  const allVisibleSelected =
    props.mail.length > 0 && selectedVisibleMail.length === props.mail.length;
  const mailGridStyle = {
    "--mail-directory-width": `${directoryResize.size}px`,
    "--message-list-width": `${messageListResize.size}px`,
  } as CSSProperties;
  const composeContextClass = composeReplyToMessageId
    ? "compose-context-reply"
    : "compose-context-new";
  const composeSurfaceClass = [
    "compose-outbox-band",
    `compose-surface-${composeSurface}`,
    composeContextClass,
  ].join(" ");
  const composePortalTarget =
    composeSurface === "floating" ? document.body : composeSlotElement;
  const composeTitle =
    composeSource === "forward"
      ? "转发邮件"
      : composeReplyToMessageId
        ? "回复邮件"
        : "写邮件";
  const composeStatusParts = [
    selectedComposeIdentity ? formatSendIdentity(selectedComposeIdentity) : "当前账号",
    composeDraftId ? "已保存草稿" : "",
    composeScheduledId ? "已加入待发" : "",
    composeAutosaveStatus !== "idle"
      ? formatComposeAutosaveStatus(composeAutosaveStatus)
      : "",
  ].filter(Boolean);

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

  useEffect(() => {
    attachmentDownloadRequestRef.current += 1;
    setAttachmentDownloadBusyId(undefined);
    setAttachmentDownloadNotice("");
  }, [props.selectedMail.accountId, props.selectedMail.id]);

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

  function handleComposeWindowKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (composeSurface === "floating" && event.key === "Escape") {
      closeComposeSurface();
    }
  }

  return (
    <section className="workspace-page mail-page">
      <header className="topbar">
        <div>
          <h1>邮箱</h1>
        </div>
        <form
          className="top-search"
          role="search"
          aria-label="全局邮件搜索"
          onSubmit={submitTopSearch}
        >
          <Search size={18} />
          <select
            aria-label="搜索范围"
            value={topSearchScope}
            onChange={(event) =>
              setTopSearchScope(event.currentTarget.value as TopSearchScope)
            }
          >
            <option value="all">全部账号</option>
            <option value="account">当前账号</option>
            <option value="current">当前范围</option>
          </select>
          <input
            aria-label="全局搜索邮件"
            placeholder="搜索邮件、联系人或主题"
            value={topSearchQuery}
            onChange={(event) => setTopSearchQuery(event.target.value)}
          />
          <kbd>Ctrl /</kbd>
        </form>
        <div className="top-actions">
          <button
            className="primary-button"
            type="button"
            onClick={openNewComposeSurface}
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

      <MailComposePanels
        composeSurface={composeSurface}
        composePortalTarget={composePortalTarget}
        composeSurfaceClass={composeSurfaceClass}
        composeTitle={composeTitle}
        composeStatusParts={composeStatusParts}
        composeNotice={composeNotice}
        composeNoticeState={composeNoticeState}
        onOpenHermesRuntimeSettings={props.onOpenHermesRuntimeSettings}
        handleComposeWindowKeyDown={handleComposeWindowKeyDown}
        closeComposeSurface={closeComposeSurface}
        composeFrom={composeFrom}
        setComposeFrom={setComposeFrom}
        sendIdentities={sendIdentities}
        setComposePreview={setComposePreview}
        composeAdvancedSenderOpen={composeAdvancedSenderOpen}
        setComposeAdvancedSenderOpen={setComposeAdvancedSenderOpen}
        sendIdentityCandidates={sendIdentityCandidates}
        graphCandidateAddress={graphCandidateAddress}
        setGraphCandidateAddress={setGraphCandidateAddress}
        graphCandidateName={graphCandidateName}
        setGraphCandidateName={setGraphCandidateName}
        graphCandidateType={graphCandidateType}
        setGraphCandidateType={setGraphCandidateType}
        composeBusy={composeBusy}
        addGraphSendIdentityCandidate={addGraphSendIdentityCandidate}
        graphDiagnosticsByCandidate={graphDiagnosticsByCandidate}
        graphTargetMailboxes={graphTargetMailboxes}
        setGraphTargetMailboxes={setGraphTargetMailboxes}
        verifyGraphSendIdentityCandidate={verifyGraphSendIdentityCandidate}
        verifyGraphSendIdentityUserTarget={verifyGraphSendIdentityUserTarget}
        diagnoseGraphSendIdentityCandidate={diagnoseGraphSendIdentityCandidate}
        composeTo={composeTo}
        setComposeTo={setComposeTo}
        composeCc={composeCc}
        setComposeCc={setComposeCc}
        composeBcc={composeBcc}
        setComposeBcc={setComposeBcc}
        composeSubject={composeSubject}
        setComposeSubject={setComposeSubject}
        composeTemplates={COMPOSE_TEMPLATES}
        insertComposeTemplate={insertComposeTemplate}
        applyComposeBodyFormat={applyComposeBodyFormat}
        composeBody={composeBody}
        setComposeBody={setComposeBody}
        invalidateComposeMessageRequest={invalidateComposeMessageRequest}
        addComposeAttachments={addComposeAttachments}
        composeAttachments={composeAttachments}
        setComposeAttachments={setComposeAttachments}
        composeTranslationSource={composeTranslationSource}
        setComposeTranslationSource={setComposeTranslationSource}
        composeTranslationTarget={composeTranslationTarget}
        setComposeTranslationTarget={setComposeTranslationTarget}
        translateComposedMail={translateComposedMail}
        polishComposedMail={polishComposedMail}
        previewComposedMail={previewComposedMail}
        composePreview={composePreview}
        composeRichHtmlEnabled={composeRichHtmlEnabled}
        composeScheduledAt={composeScheduledAt}
        setComposeScheduledAt={setComposeScheduledAt}
        submitComposedMail={submitComposedMail}
        mailDrafts={mailDrafts}
        draftsNotice={draftsNotice}
        editMailDraft={editMailDraft}
        outboxItems={outboxItems}
        outboxNotice={outboxNotice}
        outboxBusyId={outboxBusyId}
        rescheduleTimes={rescheduleTimes}
        setRescheduleTimes={setRescheduleTimes}
        editOutboxItem={editOutboxItem}
        rescheduleOutboxItem={rescheduleOutboxItem}
        sendOutboxItemNow={sendOutboxItemNow}
        cancelOutboxItem={cancelOutboxItem}
      />

      <div
        className={`mail-grid outlook-layout layout-${props.density}`}
        aria-label="邮箱三栏工作台"
        style={mailGridStyle}
      >
        <MailDirectoryListPanes
          activeFolder={props.activeFolder}
          activeMailId={props.activeMailId}
          folders={props.folders}
          labels={props.labels}
          quickCategories={props.quickCategories}
          mail={props.mail}
          density={props.density}
          folderTitle={props.folderTitle}
          folderCount={props.folderCount}
          labelFormOpen={labelFormOpen}
          setLabelFormOpen={setLabelFormOpen}
          newLabelName={newLabelName}
          setNewLabelName={setNewLabelName}
          labelNotice={labelNotice}
          setLabelNotice={setLabelNotice}
          labelBusy={labelBusy}
          selectedMailKeys={selectedMailKeys}
          allVisibleSelected={allVisibleSelected}
          selectedVisibleMail={selectedVisibleMail}
          directorySeparatorProps={directoryResize.separatorProps}
          messageListSeparatorProps={messageListResize.separatorProps}
          openNewComposeSurface={openNewComposeSurface}
          onRefresh={props.onRefresh}
          onFolderChange={props.onFolderChange}
          onLabelChange={props.onLabelChange}
          onSavedViewChange={props.onSavedViewChange}
          onDensityChange={props.onDensityChange}
          onMailChange={props.onMailChange}
          submitNewLabel={submitNewLabel}
          toggleAllVisibleMail={toggleAllVisibleMail}
          toggleVisibleMail={toggleVisibleMail}
        />

        <article className="reader-panel">
          {props.hasSelectedMail ? (
            <>
          <div className="reader-toolbar">
            <button
              className="toolbar-button"
              type="button"
              disabled={readerControlsDisabled}
              onClick={() => void applyComposeSeed("reply")}
            >
              回复
            </button>
            <button
              className="toolbar-button"
              type="button"
              disabled={readerControlsDisabled}
              onClick={() => void applyComposeSeed("reply_all")}
            >
              回复全部
            </button>
            <button
              className="toolbar-button"
              type="button"
              disabled={readerControlsDisabled}
              onClick={() => void applyComposeSeed("forward")}
            >
              转发
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="完成当前邮件"
              disabled={!props.hasSelectedMail}
              onClick={() => void props.onDone()}
            >
              完成
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label={
                props.selectedMail.starred
                  ? "Unstar selected message"
                  : "Star selected message"
              }
              disabled={!props.hasSelectedMail}
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
              disabled={!props.hasSelectedMail}
              onClick={() => void props.onToggleRead()}
            >
              {props.selectedMail.unread ? "标已读" : "标未读"}
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="让 Hermes 跟进当前邮件"
              disabled={!props.hasSelectedMail}
              onClick={props.onTrackFollowUp}
            >
              Hermes 跟进
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="让 Hermes 总结当前邮件"
              disabled={readerHermesControlsDisabled}
              onClick={() => void askHermesForReaderSummary()}
            >
              Hermes 总结
            </button>
            <HermesReaderTranslationControls
              sourceLanguage={readerTranslationSource}
              targetLanguage={readerTranslationTarget}
              busy={readerHermesControlsDisabled}
              onSourceLanguageChange={selectReaderTranslationSource}
              onTargetLanguageChange={
                readerTranslationPreferences.setTargetLanguage
              }
              onTranslate={() => void askHermesForReaderTranslation()}
            />
            <button
              className="toolbar-button"
              type="button"
              aria-label="让 Hermes 整理当前邮件"
              disabled={readerHermesControlsDisabled}
              onClick={() => void askHermesToOrganizeReader()}
            >
              Hermes 整理
            </button>
            <button
              className="toolbar-button"
              type="button"
              aria-label="Archive selected message"
              disabled={!props.hasSelectedMail}
              onClick={() => void props.onArchive()}
            >
              归档
            </button>
            <button
              className="toolbar-button danger"
              type="button"
              aria-label="Trash selected message"
              disabled={!props.hasSelectedMail}
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
                  aria-label="确认 Hermes 跟进"
                  onClick={props.onConfirmHermesFollowUp}
                >
                  确认创建提醒
                </button>
              </div>
            ) : null}

            {readerHermesNotice ? (
              <HermesNotice
                notice={readerHermesNotice}
                actionLabel={hermesNoticeActionLabel(readerHermesNoticeState.action)}
                onAction={
                  readerHermesNoticeState.action === "open_runtime_settings"
                    ? props.onOpenHermesRuntimeSettings
                    : undefined
                }
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
            {composeSurface === "reader" ? (
              <div
                ref={attachComposeSlot}
                className="reader-compose-slot reader-inline-compose"
                aria-label="阅读窗回复区"
              />
            ) : null}
          </div>
            </>
          ) : (
            <div
              className="reader-content reader-content-empty"
              aria-label="空白邮件阅读区"
            />
          )}
        </article>
      </div>
    </section>
  );
}
