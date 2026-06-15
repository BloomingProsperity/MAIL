export type MessageListSort = "time" | "smart";

export type GatekeeperMode =
  | "before_inbox"
  | "inside_email"
  | "off_accept_all";

export type HermesRuntimeMode =
  | "builtin"
  | "external_hermes"
  | "openai_compatible";
export type HermesRuntimeUpdatePolicy = "manual" | "notify" | "auto_patch";
export type HermesRuntimeUpdateChannel = "stable" | "preview";

export type MailAction =
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "archive"
  | "trash"
  | "move"
  | "apply_labels"
  | "done"
  | "undo_done"
  | "undone";

export type SmartInboxFeedbackAction =
  | "mark_important"
  | "mark_not_important"
  | "move_to_personal"
  | "move_to_notifications"
  | "move_to_newsletters"
  | "move_to_feed"
  | "always_important_sender"
  | "mute_sender";

export type MailQuickFilter = "unread" | "starred" | "attachments" | "labels";
export type MailSearchScope = "sender" | "recipients" | "subject" | "body";
export type MailTagMode = "any" | "all";

export type MailNavigationTone = "coral" | "blue" | "green" | "yellow" | "purple";

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface MailboxDto {
  id: string;
  accountId: string;
  name: string;
  role: string;
  messageCount: number;
  unreadCount: number;
}

export interface MessageClassificationDto {
  bucket: string;
  priorityScore: number;
  reasons: string[];
}

export interface MessageSearchPreviewDto {
  source: "indexed_text";
  text: string;
}

export interface MessageListItemDto {
  id: string;
  accountId: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  receivedAt: string;
  snippet?: string;
  unread: boolean;
  starred: boolean;
  mailboxIds: string[];
  attachmentCount: number;
  classification: MessageClassificationDto;
  searchPreview?: MessageSearchPreviewDto;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  contentId?: string;
  embedded: boolean;
  inline: boolean;
}

export interface MessageDetailDto extends MessageListItemDto {
  to: string[];
  cc: string[];
  bodyText?: string;
  bodyHtml?: string;
  attachments: AttachmentDto[];
}

export interface MailActionResult {
  accountId: string;
  messageId: string;
  action: MailAction;
  state: {
    unread: boolean;
    starred: boolean;
    archived: boolean;
    deleted: boolean;
    mailboxIds: string[];
    labelIds: string[];
    doneAt?: string | null;
    undoToken?: string | null;
    undoExpiresAt?: string | null;
  };
  command: {
    id: string;
    commandType: string;
    accountId: string;
    messageId: string;
    idempotencyKey: string;
    status: string;
  };
}

export type MailBulkAction = "done";

export interface MailBulkActionResult {
  accountId: string;
  bucket: string;
  action: MailBulkAction;
  requestedCount: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  succeeded: Array<{
    messageId: string;
    undoToken?: string | null;
    undoExpiresAt?: string | null;
    commandId: string;
  }>;
  failed: Array<{
    messageId: string;
    error: "message_not_visible" | "action_failed";
    message?: string;
  }>;
}

export interface SmartInboxFeedbackResult {
  feedbackEventId: string;
  accountId: string;
  messageId: string;
  classification: MessageClassificationDto;
}

export interface GatekeeperSettingsDto {
  accountId: string;
  mode: GatekeeperMode;
  updatedAt?: string;
}

export type SenderScreeningStatus = "unknown" | "accepted" | "blocked";

export interface GatekeeperSenderDto {
  senderId: string;
  email: string;
  domain: string;
  status: SenderScreeningStatus;
  messageCount: number;
  latestMessageId?: string;
  latestReceivedAt?: string;
  bulkAvailable: boolean;
}

export interface SenderScreeningDecisionResult {
  senderId: string;
  email?: string;
  domain: string;
  status: "accepted" | "blocked";
  action: "accept" | "block_sender" | "block_domain";
  eventId: string;
}

export type SenderScreeningBulkAction = "accept" | "block";

export interface SenderScreeningBulkResult {
  items: SenderScreeningDecisionResult[];
  missingSenderIds: string[];
}

export interface HermesRuntimeSettingsDto {
  enabled: boolean;
  mode: HermesRuntimeMode;
  providerKey: string;
  endpointUrl?: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyUpdatedAt?: string;
  updatePolicy: HermesRuntimeUpdatePolicy;
  updateChannel: HermesRuntimeUpdateChannel;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  lastCheckedAt?: string;
  source: "database" | "environment" | "default";
  updatedAt?: string;
}

export type HermesProviderCategory =
  | "gateway"
  | "cloud"
  | "local"
  | "oauth"
  | "custom";

export type HermesProviderAuthType =
  | "none"
  | "api_key"
  | "api_key_optional"
  | "oauth"
  | "aws_credentials";

export type HermesProviderRequestProtocol =
  | "openai_chat_completions"
  | "openai_responses"
  | "anthropic_messages"
  | "gemini_generate_content"
  | "external_oauth"
  | "aws_bedrock";

export interface HermesProviderCatalogItem {
  key: string;
  label: string;
  category: HermesProviderCategory;
  authType: HermesProviderAuthType;
  requestProtocol: HermesProviderRequestProtocol;
  endpointEditable: boolean;
  aliases: string[];
  modelExamples: string[];
  capabilities: string[];
  defaultEndpoint?: string;
  envKeys?: string[];
  note?: string;
}

export interface HermesProviderCatalogResponse {
  providers: HermesProviderCatalogItem[];
}

export interface HermesRuntimeUpdateInput {
  enabled: boolean;
  mode: HermesRuntimeMode;
  providerKey?: string;
  endpointUrl?: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
  updatePolicy: HermesRuntimeUpdatePolicy;
  updateChannel: HermesRuntimeUpdateChannel;
}

export interface HermesRuntimeTestResult {
  ok: boolean;
  checkedAt: string;
  providerKey: string;
  requestProtocol: HermesProviderRequestProtocol;
  endpointUrl: string;
  model: string;
}

export type HermesProviderProbeStatus =
  | "ready"
  | "missing_configuration"
  | "external_auth_required"
  | "connection_failed";

export type HermesProviderProbeMissing =
  | "endpoint_url"
  | "model"
  | "api_key"
  | "oauth_session"
  | "aws_credentials";

export interface HermesProviderProbeInput {
  providerKey: string;
  endpointUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface HermesProviderProbeResult {
  ok: boolean;
  status: HermesProviderProbeStatus;
  providerKey: string;
  label: string;
  category: HermesProviderCategory;
  authType: HermesProviderAuthType;
  endpointUrl?: string;
  model?: string;
  missing: HermesProviderProbeMissing[];
  checkedAt: string;
  message?: string;
}

export interface HermesRuntimeVersionStatus {
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  updatePolicy: HermesRuntimeUpdatePolicy;
  updateChannel: HermesRuntimeUpdateChannel;
  lastCheckedAt?: string;
}

export interface SyncCenterAccountDto {
  accountId: string;
  email: string;
  provider: string;
  syncState: string;
  nextAction?: string;
  latestJob?: unknown;
}

export interface ReauthorizationTaskDto {
  taskId: string;
  email: string;
  provider: string;
  authMethod: "password" | "oauth";
  status: "pending" | "failed";
  source?: string;
  displayName?: string;
  transferVersion?: number;
  reauthRequired: boolean;
  loginHint?: string;
  providerPreset?: string;
  username?: string;
  labels?: string[];
  group?: string;
  notes?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncControlJobDto {
  id: string;
  jobType: "sync_account";
  accountId: string;
  idempotencyKey: string;
  status: "queued" | "running" | "done" | "failed" | "dead_letter";
  createdAt: string;
}

export interface SyncControlAccountDto {
  accountId: string;
  email?: string;
  provider?: string;
  authMethod?: string;
  syncState: string;
  engineProvider?: string;
}

export interface SyncManualResyncResult {
  accountId: string;
  action: "manual_sync_queued";
  job: SyncControlJobDto;
}

export interface SyncPauseResult {
  accountId: string;
  action: "sync_paused";
  account: SyncControlAccountDto;
}

export interface SyncResumeResult {
  accountId: string;
  action: "sync_resumed";
  account: SyncControlAccountDto;
}

export interface SyncRetryFailedResult {
  accountId: string;
  action: "failed_sync_requeued";
  retriedJobCount: number;
}

export interface ProviderGroupDto {
  id: string;
  label: string;
  count: number;
}

export interface QuickCategoryDto {
  id: string;
  label: string;
  count: number;
  tone: MailNavigationTone;
}

export interface MailNavigationSummaryDto {
  providerGroups: ProviderGroupDto[];
  quickCategories: QuickCategoryDto[];
}

export type MailProviderAccountGroup =
  | "global"
  | "domestic"
  | "private"
  | "domain";

export interface MailProviderCapabilityDto {
  provider: string;
  label: string;
  connectionLabel: string;
  accountGroup: MailProviderAccountGroup;
  supportsLogin: boolean;
  supportsWebLogin: boolean;
  supportsScanLogin: boolean;
  supportsAppPassword: boolean;
  supportsMailboxPassword: boolean;
  supportsServerSearch: boolean;
  supportsCalendar: boolean;
  supportsContacts: boolean;
  supportsAliasSync: boolean;
  supportsRecall: boolean;
  supportsReadReceipts: boolean;
  supportsLargeAttachment: boolean;
  supportsCloudAttachment: boolean;
  supportsOnlineArchive: boolean;
  supportsJunkFiltering: boolean;
  supportsSendAsGroup: boolean;
  supportsSendOnBehalf: boolean;
  supportsLabels: boolean;
  requiresLocalBridge: boolean;
  setupHints: string[];
  providerSpecificActions: string[];
}

export interface MailProviderCapabilitiesResponse {
  providers: MailProviderCapabilityDto[];
}

export interface DomainDestinationDto {
  id: string;
  domainId?: string;
  email: string;
  verified: boolean;
  createdAt: string;
}

export interface DomainDto {
  id: string;
  domain: string;
  verificationStatus: string;
  dnsRecords: unknown;
  createdAt: string;
}

export interface DomainAliasDto {
  id: string;
  domainId: string;
  address: string;
  localPart: string;
  enabled: boolean;
  destinationIds: string[];
  createdAt: string;
}

export interface DomainDeliveryLogDto {
  id: string;
  domainId?: string;
  aliasId?: string;
  recipient: string;
  status: string;
  detail?: string;
  createdAt: string;
}

export type OAuthProvider = "gmail" | "outlook";

export interface OAuthStartResult {
  provider: OAuthProvider;
  authorizationUrl: string;
  state: string;
  task: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    status: string;
  };
}

export interface OAuthCallbackResult {
  task: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    status: string;
  };
  account?: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    syncState: string;
    engineProvider: string;
  };
}

export interface ImapSmtpOnboardingInput {
  email: string;
  provider: string;
  displayName?: string;
  username?: string;
  secret?: string;
  imap?: {
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    secret?: string;
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    secret?: string;
  };
}

export interface ImapSmtpConnectionCheckResult {
  ok: boolean;
  code?: string;
  error?: string;
}

export interface ImapSmtpConnectionDiagnostic {
  code: string;
  provider: string;
  severity: "action_required";
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
  diagnostics?: ImapSmtpConnectionDiagnostic[];
}

export interface ImapSmtpOnboardingResult {
  task: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    status: string;
  };
  account?: {
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    syncState: string;
    engineProvider: string;
  };
}

export type OperationalEventLevel = "debug" | "info" | "warn" | "error";

export interface OperationalEventDto {
  id: string;
  occurredAt: string;
  service: string;
  level: OperationalEventLevel;
  event: string;
  requestId?: string;
  accountId?: string;
  lane?: string;
  jobId?: string;
  message?: string;
  context: Record<string, unknown>;
}

export interface OperationalEventListInput {
  service?: string;
  level?: OperationalEventLevel;
  event?: string;
  requestId?: string;
  accountId?: string;
  lane?: string;
  jobId?: string;
  limit?: number;
}

export interface SyncCenterDiagnosticsInput {
  accountId: string;
  level?: OperationalEventLevel;
  jobId?: string;
  limit?: number;
}

export interface AccountImportPreview {
  summary: {
    totalRows: number;
    ready: number;
    needsOAuth: number;
    disabled: number;
    invalid: number;
  };
  rows: unknown[];
}

export interface AccountTransferAccount {
  email: string;
  provider: string;
  authMethod: "password" | "oauth";
  displayName?: string;
  engineProvider: "emailengine" | "native";
  providerPreset?: string;
  username?: string;
  labels?: string[];
  group?: string;
  notes?: string;
}

export interface AccountTransferPackage {
  schemaVersion: 1;
  exportedAt: string;
  accounts: AccountTransferAccount[];
}

export interface AccountTransferImportResult {
  importedTaskCount: number;
  reauthRequiredCount: number;
  tasks: Array<{
    id: string;
    email: string;
    provider: string;
    authMethod: string;
    status: string;
  }>;
}

export type FollowUpKind = "manual" | "needs_reply" | "waiting_on_them";
export type FollowUpStatus = "open" | "due" | "done" | "cancelled";
export type FollowUpListStatus = FollowUpStatus | "all";

export interface FollowUpDto {
  id: string;
  accountId: string;
  messageId: string;
  kind: FollowUpKind;
  status: FollowUpStatus;
  dueAt: string;
  title?: string;
  note?: string;
  source: "manual" | "hermes_followup";
  hermesSkillRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

export type MailDraftSource =
  | "manual"
  | "hermes_reply"
  | "reply"
  | "reply_all"
  | "forward";
export type MailDraftStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed";
export type ScheduledSendStatus =
  | "scheduled"
  | "queued"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed"
  | "dead_letter";

export interface MailAddressDto {
  address: string;
  name?: string;
}

export interface MailDraftDto {
  id: string;
  accountId: string;
  from?: MailAddressDto;
  to: MailAddressDto[];
  cc: MailAddressDto[];
  bcc: MailAddressDto[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  status: MailDraftStatus;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  hermesSkillRunId?: string;
  hermesDraftText?: string;
  providerQueueId?: string;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export type MailSendIdentitySource = "account" | "domain_alias";

export interface MailSendIdentityDto {
  id: string;
  accountId: string;
  from: MailAddressDto;
  source: MailSendIdentitySource;
  isDefault: boolean;
  verified: boolean;
}

export interface MailSendIdentityPage {
  accountId: string;
  items: MailSendIdentityDto[];
}

export type MailComposeSeedMode = "reply" | "reply_all" | "forward";
export type MailComposePreviewWarning =
  | "missing_recipient"
  | "missing_body"
  | "missing_subject"
  | "large_body";

export interface MailComposeSeedAttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  inline: boolean;
}

export interface MailComposeSeedDto {
  accountId: string;
  messageId: string;
  mode: MailComposeSeedMode;
  from?: MailAddressDto;
  to: MailAddressDto[];
  cc: MailAddressDto[];
  bcc: MailAddressDto[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId: string;
  attachments: MailComposeSeedAttachmentDto[];
  warnings: MailComposePreviewWarning[];
  generatedAt: string;
}

export interface MailComposePreviewDto {
  accountId: string;
  from?: MailAddressDto;
  to: MailAddressDto[];
  cc: MailAddressDto[];
  bcc: MailAddressDto[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  source: MailDraftSource;
  replyToMessageId?: string;
  sourceMessageId?: string;
  warnings: MailComposePreviewWarning[];
  estimatedSizeBytes: number;
  readyToSend: boolean;
  generatedAt: string;
}

export interface SendMailDraftResult {
  accountId: string;
  draftId: string;
  action: "draft_send_queued";
  draft: MailDraftDto;
}

export interface ScheduledSendDto {
  id: string;
  accountId: string;
  draftId: string;
  scheduledAt: string;
  status: ScheduledSendStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: string;
  canEdit: boolean;
  canSendNow: boolean;
  canDelete: boolean;
  providerQueueId?: string;
  providerMessageId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface OutboxPageDto {
  accountId: string;
  items: ScheduledSendDto[];
}

export interface FollowUpPage {
  accountId: string;
  status: FollowUpListStatus;
  items: FollowUpDto[];
}

export type HermesFollowupStatus =
  | "needs_reply"
  | "waiting_on_them"
  | "no_followup"
  | "done";

export type HermesFollowupOwner = "me" | "them" | "unknown";

export interface HermesFollowupTrackerResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "followup_tracker";
  status: HermesFollowupStatus;
  followupNeeded: boolean;
  owner: HermesFollowupOwner;
  confidence: number;
  reasons: string[];
  dueAt?: string;
  dueText?: string;
  nextAction?: string;
  sourceQuote?: string;
}

export interface HermesReplyDraftResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "reply_draft";
  draftText: string;
}

export type HermesQuickReplyScenario =
  | "confirm"
  | "decline"
  | "thanks"
  | "follow_up"
  | "custom";

export interface HermesQuickReplyResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "quick_reply";
  scenario: HermesQuickReplyScenario;
  draftText: string;
  editable: boolean;
  sendsDirectly: boolean;
}

export type HermesRewritePolishAction =
  | "rewrite"
  | "polish"
  | "shorten"
  | "expand"
  | "tone"
  | "proofread";

export interface HermesRewritePolishResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "rewrite_polish";
  action: HermesRewritePolishAction;
  rewrittenText: string;
  editable: boolean;
  sendsDirectly: boolean;
}

export interface EmailHubApi {
  listMailboxes(input: { accountId: string }): Promise<Page<MailboxDto>>;
  listMessages(input: {
    accountId?: string;
    mailboxId?: string;
    limit?: number;
    cursor?: string;
    q?: string;
    sort?: MessageListSort;
    savedView?: string;
    quickFilters?: MailQuickFilter[];
    qScopes?: MailSearchScope[];
    labelIds?: string[];
    tagMode?: MailTagMode;
  }): Promise<Page<MessageListItemDto>>;
  getMessage(input: {
    accountId: string;
    messageId: string;
  }): Promise<MessageDetailDto>;
  applyMailAction(input: {
    accountId: string;
    messageId: string;
    action: MailAction;
    mailboxId?: string;
    labelIds?: string[];
    undoToken?: string;
  }): Promise<MailActionResult>;
  applySmartInboxCardBulkAction(input: {
    accountId: string;
    bucket: string;
    action: MailBulkAction;
    messageIds: string[];
  }): Promise<MailBulkActionResult>;
  recordSmartInboxFeedback(input: {
    accountId: string;
    messageId: string;
    action: SmartInboxFeedbackAction;
  }): Promise<SmartInboxFeedbackResult>;
  getGatekeeperSettings(input: {
    accountId: string;
  }): Promise<GatekeeperSettingsDto>;
  updateGatekeeperSettings(input: {
    accountId: string;
    mode: GatekeeperMode;
  }): Promise<GatekeeperSettingsDto>;
  listGatekeeperSenders(input: {
    accountId: string;
    status?: SenderScreeningStatus | "all";
  }): Promise<Page<GatekeeperSenderDto>>;
  acceptGatekeeperSender(input: {
    accountId: string;
    senderId: string;
  }): Promise<SenderScreeningDecisionResult>;
  blockGatekeeperSender(input: {
    accountId: string;
    senderId: string;
  }): Promise<SenderScreeningDecisionResult>;
  bulkDecideGatekeeperSenders(input: {
    accountId: string;
    senderIds: string[];
    action: SenderScreeningBulkAction;
  }): Promise<SenderScreeningBulkResult>;
  blockGatekeeperDomain(input: {
    accountId: string;
    domain: string;
  }): Promise<SenderScreeningDecisionResult>;
  getHermesRuntimeSettings(): Promise<HermesRuntimeSettingsDto>;
  getHermesProviders(): Promise<HermesProviderCatalogResponse>;
  updateHermesRuntimeSettings(
    input: HermesRuntimeUpdateInput,
  ): Promise<HermesRuntimeSettingsDto>;
  clearHermesRuntimeApiKey(
    input: Omit<HermesRuntimeUpdateInput, "apiKey" | "clearApiKey">,
  ): Promise<HermesRuntimeSettingsDto>;
  probeHermesProvider(
    input: HermesProviderProbeInput,
  ): Promise<HermesProviderProbeResult>;
  testHermesRuntimeConnection(): Promise<HermesRuntimeTestResult>;
  getHermesRuntimeVersion(): Promise<HermesRuntimeVersionStatus>;
  checkHermesRuntimeUpdate(): Promise<HermesRuntimeVersionStatus>;
  previewAccountCsv(input: { csv: string }): Promise<AccountImportPreview>;
  createAccountCsvImport(input: { csv: string }): Promise<AccountImportPreview>;
  exportAccountTransfer(input?: {
    accountIds?: string[];
  }): Promise<AccountTransferPackage>;
  importAccountTransfer(input: {
    package: AccountTransferPackage;
  }): Promise<AccountTransferImportResult>;
  startOAuthAccount(input: {
    provider: OAuthProvider;
    redirectUri: string;
    loginHint?: string;
  }): Promise<OAuthStartResult>;
  completeOAuthCallback(input: {
    provider: OAuthProvider;
    state: string;
    code: string;
  }): Promise<OAuthCallbackResult>;
  onboardImapSmtpAccount(
    input: ImapSmtpOnboardingInput,
  ): Promise<ImapSmtpOnboardingResult>;
  testImapSmtpConnection(
    input: ImapSmtpOnboardingInput,
  ): Promise<ImapSmtpConnectionTestResult>;
  listOperationalEvents(
    input?: OperationalEventListInput,
  ): Promise<Page<OperationalEventDto>>;
  listSyncCenterAccountDiagnostics(
    input: SyncCenterDiagnosticsInput,
  ): Promise<Page<OperationalEventDto>>;
  listSyncCenterAccounts(): Promise<Page<SyncCenterAccountDto>>;
  listSyncCenterReauthorizations(): Promise<Page<ReauthorizationTaskDto>>;
  startSyncCenterOAuthReauthorization(input: {
    taskId: string;
    redirectUri: string;
  }): Promise<OAuthStartResult>;
  requestSyncCenterResync(input: {
    accountId: string;
  }): Promise<SyncManualResyncResult>;
  pauseSyncCenterAccount(input: { accountId: string }): Promise<SyncPauseResult>;
  resumeSyncCenterAccount(input: { accountId: string }): Promise<SyncResumeResult>;
  retryFailedSyncCenterJobs(input: {
    accountId: string;
  }): Promise<SyncRetryFailedResult>;
  getMailNavigationSummary(): Promise<MailNavigationSummaryDto>;
  getMailProviderCapabilities(): Promise<MailProviderCapabilitiesResponse>;
  listDomains(): Promise<Page<DomainDto>>;
  listDomainDestinations(input: {
    domainId: string;
  }): Promise<Page<DomainDestinationDto>>;
  listDomainAliases(input: {
    domainId: string;
  }): Promise<Page<DomainAliasDto>>;
  listDomainDeliveryLogs(input: {
    domainId: string;
    limit?: number;
  }): Promise<Page<DomainDeliveryLogDto>>;
  listFollowUps(input: {
    accountId: string;
    status?: FollowUpListStatus;
    limit?: number;
  }): Promise<FollowUpPage>;
  trackFollowup(input: {
    subject?: string;
    threadText: string;
    userEmail?: string;
    participants?: string[];
    now?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesFollowupTrackerResult>;
  draftReply(input: {
    subject?: string;
    threadText: string;
    instruction?: string;
    tone?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesReplyDraftResult>;
  quickReply(input: {
    subject?: string;
    threadText: string;
    scenario: HermesQuickReplyScenario;
    instruction?: string;
    tone?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesQuickReplyResult>;
  rewritePolishDraft(input: {
    text: string;
    action: HermesRewritePolishAction;
    instruction?: string;
    tone?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesRewritePolishResult>;
  confirmHermesFollowUp(input: {
    accountId: string;
    messageId: string;
    skillRunId: string;
    status: Extract<HermesFollowupStatus, "needs_reply" | "waiting_on_them">;
    dueAt: string;
    title?: string;
    nextAction?: string;
    reasons?: string[];
    sourceQuote?: string;
  }): Promise<FollowUpDto>;
  createFollowUp(input: {
    accountId: string;
    messageId: string;
    dueAt: string;
    kind?: FollowUpKind;
    title?: string;
    note?: string;
    source?: "manual" | "hermes_followup";
    hermesSkillRunId?: string;
  }): Promise<FollowUpDto>;
  updateFollowUp(input: {
    id: string;
    dueAt?: string;
    kind?: FollowUpKind;
    status?: Exclude<FollowUpStatus, "cancelled">;
    title?: string;
    note?: string;
  }): Promise<FollowUpDto>;
  cancelFollowUp(input: { id: string }): Promise<FollowUpDto>;
  createMailDraft(input: {
    accountId: string;
    from?: MailAddressDto;
    to: MailAddressDto[];
    cc?: MailAddressDto[];
    bcc?: MailAddressDto[];
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    source?: MailDraftSource;
    replyToMessageId?: string;
    sourceMessageId?: string;
    hermesSkillRunId?: string;
    hermesDraftText?: string;
  }): Promise<MailDraftDto>;
  createComposeSeed(input: {
    accountId: string;
    messageId: string;
    mode: MailComposeSeedMode;
    from?: MailAddressDto;
  }): Promise<MailComposeSeedDto>;
  previewMailDraft(input: {
    accountId: string;
    from?: MailAddressDto;
    to?: MailAddressDto[];
    cc?: MailAddressDto[];
    bcc?: MailAddressDto[];
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    source?: MailDraftSource;
    replyToMessageId?: string;
    sourceMessageId?: string;
  }): Promise<MailComposePreviewDto>;
  listSendIdentities(input: { accountId: string }): Promise<MailSendIdentityPage>;
  sendMailDraft(input: {
    accountId: string;
    draftId: string;
  }): Promise<SendMailDraftResult>;
  scheduleMailDraft(input: {
    accountId: string;
    draftId: string;
    scheduledAt: string;
  }): Promise<ScheduledSendDto>;
  listOutbox(input: {
    accountId: string;
    limit?: number;
  }): Promise<OutboxPageDto>;
  sendScheduledNow(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSendDto>;
  rescheduleScheduledSend(input: {
    accountId: string;
    scheduledId: string;
    scheduledAt: string;
  }): Promise<ScheduledSendDto>;
  cancelScheduledSend(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledSendDto>;
}

export interface CreateEmailHubApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function createEmailHubApi(
  options: CreateEmailHubApiOptions = {},
): EmailHubApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";

  return {
    listMailboxes(input) {
      return request(fetchImpl, baseUrl, `/api/accounts/${encodePath(input.accountId)}/mailboxes`);
    },

    listMessages(input) {
      const params = new URLSearchParams();
      params.set("limit", String(input.limit ?? 50));
      appendParam(params, "mailboxId", input.mailboxId);
      appendParam(params, "cursor", input.cursor);
      appendParam(params, "q", input.q?.trim() || undefined);
      appendParam(params, "sort", input.sort);
      appendParam(params, "savedView", input.savedView);
      appendParams(params, "quickFilter", input.quickFilters);
      appendParams(params, "qScope", input.qScopes);
      appendParams(params, "labelId", input.labelIds);
      appendParam(params, "tagMode", input.tagMode);
      const path = input.accountId
        ? `/api/accounts/${encodePath(input.accountId)}/messages`
        : "/api/messages";
      return request(
        fetchImpl,
        baseUrl,
        `${path}?${params.toString()}`,
      );
    },

    getMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}`,
      );
    },

    applyMailAction(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/actions`,
        {
          method: "POST",
          body: actionBody(input),
        },
      );
    },

    applySmartInboxCardBulkAction(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/smart-inbox/cards/${encodePath(input.bucket)}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            action: input.action,
            messageIds: input.messageIds,
          }),
        },
      );
    },

    recordSmartInboxFeedback(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/smart-inbox/feedback`,
        {
          method: "POST",
          body: JSON.stringify({ action: input.action }),
        },
      );
    },

    getGatekeeperSettings(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/gatekeeper/settings`,
      );
    },

    updateGatekeeperSettings(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/gatekeeper/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({ mode: input.mode }),
        },
      );
    },

    listGatekeeperSenders(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      appendParam(params, "status", input.status);
      return request(fetchImpl, baseUrl, `/api/screening/senders?${params.toString()}`);
    },

    acceptGatekeeperSender(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/screening/senders/${encodePath(input.senderId)}/accept`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    blockGatekeeperSender(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/screening/senders/${encodePath(input.senderId)}/block`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    bulkDecideGatekeeperSenders(input) {
      return request(fetchImpl, baseUrl, "/api/screening/senders/bulk", {
        method: "POST",
        body: JSON.stringify({
          accountId: input.accountId,
          senderIds: input.senderIds,
          action: input.action,
        }),
      });
    },

    blockGatekeeperDomain(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/screening/domains/${encodePath(input.domain)}/block`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    getHermesRuntimeSettings() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime");
    },

    getHermesProviders() {
      return request(fetchImpl, baseUrl, "/api/hermes/providers");
    },

    updateHermesRuntimeSettings(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime", {
        method: "PUT",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    clearHermesRuntimeApiKey(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime", {
        method: "PUT",
        body: JSON.stringify(cleanObject({ ...input, clearApiKey: true })),
      });
    },

    probeHermesProvider(input) {
      const { providerKey, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/providers/${encodePath(providerKey)}/probe`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    testHermesRuntimeConnection() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime/test", {
        method: "POST",
      });
    },

    getHermesRuntimeVersion() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime/version");
    },

    checkHermesRuntimeUpdate() {
      return request(fetchImpl, baseUrl, "/api/hermes/runtime/update/check", {
        method: "POST",
      });
    },

    previewAccountCsv(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/import/csv/preview", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    createAccountCsvImport(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/import/csv", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    exportAccountTransfer(input = {}) {
      return request(fetchImpl, baseUrl, "/api/accounts/transfer/export", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    importAccountTransfer(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/transfer/import", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    startOAuthAccount(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/oauth/${encodePath(input.provider)}/start`,
        {
          method: "POST",
          body: JSON.stringify({
            redirectUri: input.redirectUri,
            ...(input.loginHint ? { loginHint: input.loginHint } : {}),
          }),
        },
      );
    },

    completeOAuthCallback(input) {
      const params = new URLSearchParams();
      params.set("state", input.state);
      params.set("code", input.code);
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/oauth/${encodePath(input.provider)}/callback?${params.toString()}`,
      );
    },

    onboardImapSmtpAccount(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/imap-smtp", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    testImapSmtpConnection(input) {
      return request(fetchImpl, baseUrl, "/api/accounts/imap-smtp/test", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    listOperationalEvents(input = {}) {
      const params = new URLSearchParams();
      appendParam(params, "service", input.service);
      appendParam(params, "level", input.level);
      appendParam(params, "event", input.event);
      appendParam(params, "requestId", input.requestId);
      appendParam(params, "accountId", input.accountId);
      appendParam(params, "lane", input.lane);
      appendParam(params, "jobId", input.jobId);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/diagnostics/events${query ? `?${query}` : ""}`,
      );
    },

    listSyncCenterAccounts() {
      return request(fetchImpl, baseUrl, "/api/sync-center/accounts");
    },

    listSyncCenterReauthorizations() {
      return request(fetchImpl, baseUrl, "/api/sync-center/reauthorizations");
    },

    startSyncCenterOAuthReauthorization(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/reauthorizations/${encodePath(input.taskId)}/oauth/start`,
        {
          method: "POST",
          body: JSON.stringify({ redirectUri: input.redirectUri }),
        },
      );
    },

    listSyncCenterAccountDiagnostics(input) {
      const params = new URLSearchParams();
      appendParam(params, "level", input.level);
      appendParam(params, "jobId", input.jobId);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/diagnostics${query ? `?${query}` : ""}`,
      );
    },

    requestSyncCenterResync(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/resync`,
        { method: "POST" },
      );
    },

    pauseSyncCenterAccount(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/pause`,
        { method: "POST" },
      );
    },

    resumeSyncCenterAccount(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/resume`,
        { method: "POST" },
      );
    },

    retryFailedSyncCenterJobs(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/accounts/${encodePath(input.accountId)}/retry-failed`,
        { method: "POST" },
      );
    },

    getMailNavigationSummary() {
      return request(fetchImpl, baseUrl, "/api/mail-navigation/summary");
    },

    getMailProviderCapabilities() {
      return request(fetchImpl, baseUrl, "/api/mail-providers/capabilities");
    },

    listDomains() {
      return request(fetchImpl, baseUrl, "/api/domains");
    },

    listDomainDestinations(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/destinations`,
      );
    },

    listDomainAliases(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/aliases`,
      );
    },

    listDomainDeliveryLogs(input) {
      const params = new URLSearchParams();
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/delivery-logs${query ? `?${query}` : ""}`,
      );
    },

    listFollowUps(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      appendParam(params, "status", input.status);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(fetchImpl, baseUrl, `/api/follow-ups?${params.toString()}`);
    },

    trackFollowup(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/followup_tracker/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    draftReply(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/reply_draft/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    quickReply(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/quick_reply/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    rewritePolishDraft(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/rewrite_polish/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    confirmHermesFollowUp(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/follow-ups/confirm", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    createFollowUp(input) {
      const { accountId, messageId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/messages/${encodePath(messageId)}/follow-ups`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
    },

    updateFollowUp(input) {
      const { id, ...body } = input;
      return request(fetchImpl, baseUrl, `/api/follow-ups/${encodePath(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },

    cancelFollowUp(input) {
      return request(fetchImpl, baseUrl, `/api/follow-ups/${encodePath(input.id)}`, {
        method: "DELETE",
      });
    },

    createMailDraft(input) {
      const { accountId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/compose/drafts`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    createComposeSeed(input) {
      const { accountId, messageId, mode, ...body } = input;
      const pathMode = mode === "reply_all" ? "reply-all" : mode;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/messages/${encodePath(messageId)}/compose/${pathMode}`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    previewMailDraft(input) {
      const { accountId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/compose/preview`,
        {
          method: "POST",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    listSendIdentities(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities`,
      );
    },

    sendMailDraft(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/drafts/${encodePath(input.draftId)}/send`,
        { method: "POST" },
      );
    },

    scheduleMailDraft(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/drafts/${encodePath(input.draftId)}/schedule`,
        {
          method: "POST",
          body: JSON.stringify({ scheduledAt: input.scheduledAt }),
        },
      );
    },

    listOutbox(input) {
      const query = new URLSearchParams();
      if (typeof input.limit === "number") {
        query.set("limit", String(input.limit));
      }
      const queryString = query.toString();
      const suffix = queryString ? `?${queryString}` : "";
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox${suffix}`,
      );
    },

    sendScheduledNow(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}/send-now`,
        { method: "POST" },
      );
    },

    rescheduleScheduledSend(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ scheduledAt: input.scheduledAt }),
        },
      );
    },

    cancelScheduledSend(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}`,
        { method: "DELETE" },
      );
    },
  };
}

async function request<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "GET",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      typeof payload?.error === "string" ? payload.error : "request_failed",
    );
  }

  return payload as T;
}

async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as Record<string, unknown>;
}

function actionBody(input: {
  action: MailAction;
  mailboxId?: string;
  labelIds?: string[];
  undoToken?: string;
}): string {
  return JSON.stringify({
    action: input.action,
    ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
    ...(input.labelIds ? { labelIds: input.labelIds } : {}),
    ...(input.undoToken ? { undoToken: input.undoToken } : {}),
  });
}

function appendParam(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    params.set(key, value);
  }
}

function appendParams(
  params: URLSearchParams,
  key: string,
  values: string[] | undefined,
): void {
  for (const value of values ?? []) {
    if (value) {
      params.append(key, value);
    }
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function cleanObject<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
