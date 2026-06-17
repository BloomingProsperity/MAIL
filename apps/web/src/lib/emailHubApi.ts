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

export interface AttachmentDownload {
  blob: Blob;
  filename: string;
  contentType: string;
}

export interface MessageDetailDto extends MessageListItemDto {
  to: string[];
  cc: string[];
  bodyText?: string;
  bodyHtml?: string;
  attachments: AttachmentDto[];
}

export type LabelColor = "coral" | "blue" | "green" | "yellow" | "purple" | "mint";

export interface LabelDto {
  id: string;
  accountId: string;
  name: string;
  color: LabelColor;
  messageCount: number;
  createdAt: string;
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

export interface HermesMemoryDto {
  id: string;
  layer: string;
  scope: string;
  content: Record<string, unknown>;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface HermesMemoryListInput {
  layer?: string;
  scope?: string;
  limit?: number;
}

export interface HermesMemoryUpdateInput {
  id: string;
  content?: Record<string, unknown>;
  confidence?: number;
}

export interface HermesAuditLogEntryDto {
  id: string;
  eventType: string;
  skillRunId?: string;
  skillId?: string;
  skillTitle?: string;
  readMessageIds: string[];
  memoryIds: string[];
  action: Record<string, unknown>;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  createdAt: string;
}

export interface HermesAuditLogListInput {
  accountId?: string;
  skillId?: string;
  messageId?: string;
  memoryId?: string;
  limit?: number;
}

export interface HermesEmailSearchQaInput {
  accountId: string;
  mailboxId?: string;
  question: string;
  searchQuery?: string;
  language?: string;
  limit?: number;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesEmailSearchQaMatch {
  id: string;
  accountId: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  receivedAt: string;
  snippet?: string;
  searchPreview?: MessageSearchPreviewDto;
  classification: MessageClassificationDto;
}

export interface HermesEmailSearchQaCitation {
  resultIndex: number;
  messageId: string;
  accountId: string;
  subject: string;
  from: {
    email: string;
    name?: string;
  };
  receivedAt: string;
  snippet?: string;
  searchPreview?: MessageSearchPreviewDto;
  bucket: string;
  reasons: string[];
}

export interface HermesEmailSearchPlanFilterDto {
  field: string;
  operator: "contains" | "gte" | "lt" | "eq";
  value: string | boolean;
  label: string;
}

export interface HermesEmailSearchPlanDto {
  searchQuery: string;
  quickFilters: MailQuickFilter[];
  qScopes: MailSearchScope[];
  filters: HermesEmailSearchPlanFilterDto[];
  listMessagesInput: {
    q?: string;
    quickFilters?: MailQuickFilter[];
    qScopes?: MailSearchScope[];
    senderQuery?: string;
    recipientQuery?: string;
    receivedAfter?: string;
    receivedBefore?: string;
    hasAttachment?: boolean;
  };
  explanation: string[];
}

export interface HermesEmailSearchQaResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "email_search_qa";
  answerText: string;
  searchQuery: string;
  searchPlan: HermesEmailSearchPlanDto;
  citations: HermesEmailSearchQaCitation[];
  matches: HermesEmailSearchQaMatch[];
}

export type HermesRuleCandidateStatus = "shadow" | "approved" | "dismissed";
export type HermesRuleRunMode = "shadow" | "active";
export type HermesSkillMode = "read" | "draft" | "classify" | "learn";

export interface HermesSkillSettingsDto {
  enabled: boolean;
  maxContextChars: number;
  memoryLimit: number;
  allowBodyRead: boolean;
  allowMemoryWrite: boolean;
  requireConfirmation: boolean;
}

export interface HermesSkillSettingBoundsDto {
  maxContextChars: {
    min: number;
    max: number;
    step: number;
  };
  memoryLimit: {
    min: number;
    max: number;
    step: number;
  };
}

export type HermesSkillSettingsUpdateInput = Partial<HermesSkillSettingsDto>;

export interface HermesRuleCandidateDto {
  id: string;
  accountId: string;
  title: string;
  ruleType: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: number;
  status: HermesRuleCandidateStatus;
  evidenceMessageIds: string[];
  createdAt: string;
  approvedAt?: string;
}

export interface HermesRuleDto {
  id: string;
  accountId: string;
  candidateId?: string;
  title: string;
  ruleType: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: number;
  enabled: boolean;
  createdAt: string;
  approvedAt?: string;
}

export interface HermesRuleSimulationDto {
  id: string;
  accountId: string;
  candidateId: string;
  mode: HermesRuleRunMode;
  matchedCount: number;
  sampleMessageIds: string[];
  actionPreview: Record<string, unknown>;
  createdAt: string;
}

export interface HermesRuleExecutionDto {
  id: string;
  accountId: string;
  ruleId: string;
  mode: "active";
  matchedCount: number;
  appliedCount: number;
  sampleMessageIds: string[];
  actionPreview: Record<string, unknown>;
  createdAt: string;
}

export interface HermesSkillDto {
  id: string;
  title: string;
  mode: HermesSkillMode;
  description: string;
  settings: HermesSkillSettingsDto;
  settingBounds: HermesSkillSettingBoundsDto;
}

export interface HermesResourceProfileDto {
  skills: {
    total: number;
    enabled: number;
    bodyReadEnabled: number;
    memoryWriteEnabled: number;
    confirmationRequired: number;
    maxContextCharsPerRun: number;
    maxMemoryItemsPerRun: number;
    enabledContextBudgetChars: number;
    enabledMemoryBudgetItems: number;
  };
  retention: {
    retentionDays: number;
    cleanupIntervalMs: number;
    cleanupLimit: number;
    managedTables: string[];
  };
  deployment: {
    profile: "small" | "medium" | "large";
    recommendedMinimum: {
      cpuCores: number;
      memoryGb: number;
      diskGb: number;
    };
    localModelRecommendedMinimum: {
      cpuCores: number;
      memoryGb: number;
      diskGb: number;
    };
  };
  guardrails: string[];
}

export interface HermesWorkspaceOperationBoundaryDto {
  id: string;
  title: string;
  mode: "read_only" | "draft_only" | "confirmation_required";
  description: string;
}

export interface HermesWorkspaceMailEngineContextDto {
  provider: "emailengine";
  ok: boolean;
  missing: string[];
  warnings: string[];
  readiness: {
    status: "ready" | "degraded";
    summary: string;
  };
  capabilities: {
    imapSmtpOnboarding: boolean;
    attachmentDownload: boolean;
    send: boolean;
  };
}

export interface HermesWorkspaceContextDto {
  generatedAt: string;
  accountScope: {
    requestedAccountId?: string;
    availableAccountIds: string[];
    selectedAccount?: SyncCenterAccountDto;
  };
  accounts: SyncCenterAccountDto[];
  navigation?: MailNavigationSummaryDto;
  labels: LabelDto[];
  rules: HermesRuleDto[];
  pendingRuleCandidates: HermesRuleCandidateDto[];
  skills: HermesSkillDto[];
  mailEngine?: HermesWorkspaceMailEngineContextDto;
  operationBoundaries: HermesWorkspaceOperationBoundaryDto[];
  unavailableModules: string[];
}

export type HermesActionPlanIntent = "create_mailbox_rule";
export type HermesActionPlanStatus = "requires_confirmation" | "completed";

export interface HermesActionPlanStepDto {
  id: string;
  title: string;
  mode:
    | "read_only"
    | "draft"
    | "shadow_simulation"
    | "confirmation_required"
    | "mutation";
  status: "completed" | "requires_confirmation";
  detail: string;
  resource?: {
    type: string;
    id: string;
  };
}

export interface HermesActionPlanSafetyDto {
  requiresUserConfirmation: boolean;
  providerWriteback: boolean;
  appliesToHistory: boolean;
  destructive: boolean;
}

export interface HermesActionPlanWorkspaceSummaryDto {
  accountCount: number;
  selectedAccountId?: string;
  provider?: string;
  quickCategoryCount?: number;
  labelCount: number;
  ruleCount: number;
  pendingRuleCandidateCount: number;
  unavailableModules: string[];
}

export interface HermesActionPlanDto {
  id: string;
  auditEventId?: string;
  accountId: string;
  command: string;
  intent: HermesActionPlanIntent;
  status: HermesActionPlanStatus;
  createdAt: string;
  candidate: HermesRuleCandidateDto;
  simulation?: HermesRuleSimulationDto;
  workspace: HermesActionPlanWorkspaceSummaryDto;
  safety: HermesActionPlanSafetyDto;
  steps: HermesActionPlanStepDto[];
}

export interface HermesRuleHistoryBackfillDto {
  accountId: string;
  ruleId: string;
  matchedCount: number;
  appliedCount: number;
  sampleMessageIds: string[];
}

export interface HermesActionPlanConfirmationDto {
  id: string;
  auditEventId?: string;
  memory?: HermesMemoryDto;
  planId: string;
  accountId: string;
  candidateId: string;
  status: "completed";
  confirmedAt: string;
  rule: HermesRuleDto;
  historyBackfill?: HermesRuleHistoryBackfillDto;
  safety: HermesActionPlanSafetyDto;
  steps: HermesActionPlanStepDto[];
}

export type HermesPriorityLevel = "low" | "medium" | "high";
export type HermesPriorityBucket =
  | "P0 Pinned"
  | "P1 Urgent"
  | "P2 Important"
  | "P3 Needs Action"
  | "P4 FYI / Updates"
  | "P5 Transactions"
  | "P6 Feed"
  | "P7 Screen";

export interface HermesPriorityTriageInput {
  subject?: string;
  threadText: string;
  senderEmail?: string;
  currentBucket?: string;
  currentScore?: number;
  currentReasons?: string[];
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesPriorityTriageResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "priority_triage";
  priority: HermesPriorityLevel;
  bucket: HermesPriorityBucket;
  score: number;
  reasons: string[];
  explanation?: string;
}

export type HermesLabelActionType =
  | "apply_label"
  | "archive"
  | "snooze"
  | "keep_in_inbox"
  | "move_to_feed"
  | "mark_important";

export interface HermesLabelSuggestion {
  name: string;
  confidence?: number;
  reason?: string;
}

export interface HermesLabelActionSuggestion {
  type: HermesLabelActionType;
  label?: string;
  snoozeUntil?: string;
  reason?: string;
}

export interface HermesLabelSuggestInput {
  subject?: string;
  threadText: string;
  senderEmail?: string;
  currentLabels?: string[];
  availableLabels?: string[];
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesLabelSuggestResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "label_suggest";
  labels: HermesLabelSuggestion[];
  actions: HermesLabelActionSuggestion[];
}

export type HermesNewsletterSenderCategory =
  | "newsletter"
  | "marketing"
  | "transactional"
  | "personal"
  | "unknown";
export type HermesNewsletterCleanupActionType =
  | "move_to_feed"
  | "archive"
  | "unsubscribe_later"
  | "keep_in_inbox"
  | "mark_not_important";

export interface HermesNewsletterCleanupAction {
  type: HermesNewsletterCleanupActionType;
  unsubscribeUrl?: string;
  reason?: string;
}

export interface HermesNewsletterCleanupInput {
  subject?: string;
  threadText: string;
  senderEmail?: string;
  listId?: string;
  currentBucket?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesNewsletterCleanupResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "newsletter_cleanup";
  isNewsletter: boolean;
  confidence: number;
  senderCategory: HermesNewsletterSenderCategory;
  reasons: string[];
  actions: HermesNewsletterCleanupAction[];
}

export type HermesActionItemPriority = "low" | "medium" | "high";
export type HermesActionItemStatus = "open" | "waiting" | "blocked" | "done";

export interface HermesActionItem {
  title: string;
  owner?: string;
  dueAt?: string;
  dueText?: string;
  priority?: HermesActionItemPriority;
  status?: HermesActionItemStatus;
  sourceQuote?: string;
}

export interface HermesActionItemExtractInput {
  subject?: string;
  threadText: string;
  language?: string;
  now?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
}

export interface HermesActionItemExtractResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "action_item_extract";
  items: HermesActionItem[];
}

export interface HermesMessageOrganizationResult {
  accountId: string;
  messageId: string;
  priority: HermesPriorityTriageResult;
  labels: HermesLabelSuggestResult;
  newsletter: HermesNewsletterCleanupResult;
  actionItems: HermesActionItemExtractResult;
}

export interface SyncCenterAccountDto {
  accountId: string;
  email: string;
  provider: string;
  authMethod?: "password" | "oauth";
  displayName?: string;
  syncState: string;
  engineProvider?: "emailengine" | "native";
  reauthRequired?: boolean;
  nextAction?: string;
  accountUpdatedAt?: string;
  latestSyncJob?: unknown;
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

export type DomainCatchAllMode = "reject" | "forward" | "auto_create" | "discard";

export interface DomainCatchAllRuleDto {
  id: string;
  domainId: string;
  ruleType: "catch_all";
  enabled: boolean;
  config: {
    mode: DomainCatchAllMode;
    destinationIds?: string[];
  };
  createdAt: string;
}

export interface DomainCatchAllRuleResponse {
  item: DomainCatchAllRuleDto | null;
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

export interface SyncCenterImapSmtpReauthorizationInput {
  taskId: string;
  username?: string;
  secret: string;
  imap?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    secret: string;
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    secret: string;
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

export type AccountImportRowStatus =
  | "ready"
  | "needs_oauth"
  | "disabled"
  | "invalid";

export interface AccountImportPreviewRow {
  rowNumber: number;
  email?: string;
  provider?: string;
  authMethod?: "password" | "oauth";
  status: AccountImportRowStatus;
  errors: string[];
  warnings: string[];
}

export interface AccountImportTaskDto {
  rowNumber: number;
  id: string;
  email: string;
  provider: string;
  authMethod: string;
  status: string;
}

export interface AccountImportPreview {
  summary: {
    totalRows: number;
    ready: number;
    needsOAuth: number;
    disabled: number;
    invalid: number;
  };
  rows: AccountImportPreviewRow[];
}

export interface AccountImportCreateResult extends AccountImportPreview {
  createdTaskCount: number;
  tasks: AccountImportTaskDto[];
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

export interface MailEngineSetupActionDto {
  code: string;
  label: string;
  env: string[];
  effect: string;
}

export interface MailEngineHealthDto {
  provider: "emailengine";
  ok: boolean;
  detail: string;
  checks?: {
    url: "configured" | "missing";
    http: "ok" | "unavailable" | "skipped";
    accessToken: "configured" | "missing";
    apiAuth?: "ok" | "unauthorized" | "unavailable" | "skipped";
    preparedToken?: "configured" | "missing";
    webhookSecret: "custom" | "default" | "missing";
  };
  capabilities: {
    urlConfigured: boolean;
    accessTokenConfigured: boolean;
    imapSmtpOnboarding: boolean;
    attachmentDownload: boolean;
    send: boolean;
  };
  missing: string[];
  warnings: string[];
  readiness: {
    status: "ready" | "degraded";
    summary: string;
    setupActions: MailEngineSetupActionDto[];
  };
}

export interface ComposeAttachmentMaintenanceInspectionDto {
  scanned: number;
  scanLimit: number;
  scanLimited: boolean;
  uploads: number;
  totalBytes: number;
  protected: number;
  fresh: number;
  staleUnreferenced: number;
  staleUnreferencedBytes: number;
  invalid: number;
  oldestCreatedAt?: string;
  newestCreatedAt?: string;
}

export interface ComposeAttachmentMaintenanceStatusDto
  extends ComposeAttachmentMaintenanceInspectionDto {
  generatedAt: string;
  storage: "local";
  retentionMs: number;
  cleanupLimit: number;
  protectedStorageKeyCount: number;
}

export interface ComposeAttachmentMaintenanceCleanupInput {
  minAgeHours?: number;
  limit?: number;
}

export interface ComposeAttachmentMaintenanceCleanupResultDto {
  generatedAt: string;
  storage: "local";
  retentionMs: number;
  cleanupLimit: number;
  protectedStorageKeyCount: number;
  cleanup: {
    scanned: number;
    deleted: number;
    retained: number;
    skippedFresh: number;
    skippedProtected: number;
    skippedInvalid: number;
    bytesDeleted: number;
  };
  after: ComposeAttachmentMaintenanceInspectionDto;
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

export interface MailDraftAttachmentDto {
  id: string;
  source: "message_attachment" | "uploaded_file";
  attachmentId: string;
  storageKey?: string;
  filename: string;
  contentType: string;
  byteSize: number;
  inline: boolean;
  contentId?: string;
  contentBase64?: string;
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
  attachments?: MailDraftAttachmentDto[];
  hermesSkillRunId?: string;
  hermesDraftText?: string;
  providerQueueId?: string;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export type MailSendIdentitySource =
  | "account"
  | "domain_alias"
  | "provider_native";
export type MailSendIdentityType =
  | "account"
  | "alias"
  | "shared_mailbox"
  | "send_on_behalf"
  | "group"
  | "unknown";

export interface MailSendIdentityDto {
  id: string;
  accountId: string;
  from: MailAddressDto;
  source: MailSendIdentitySource;
  isDefault: boolean;
  verified: boolean;
  provider?: string;
  providerIdentityId?: string;
  identityType?: MailSendIdentityType;
}

export type MailSendIdentityVerificationState =
  | "verified"
  | "pending"
  | "unverified"
  | "failed";

export interface MailSendIdentityCandidateDto extends MailSendIdentityDto {
  provider: string;
  providerIdentityId: string;
  identityType: MailSendIdentityType;
  verificationState: MailSendIdentityVerificationState;
  enabled: boolean;
  verificationRecipient?: MailAddressDto;
  verificationError?: string;
  sendMailTargetMode?: "me" | "users";
  userSendMailEligible?: boolean;
  targetMailbox?: {
    userId?: string;
    userPrincipalName?: string;
  };
  sentItemsBehavior?: "signed_in_user" | "from_mailbox";
  userTargetVerificationError?: string;
}

export type MailSendIdentityDiagnosticStatus =
  | "ready"
  | "needs_from_verification"
  | "from_verification_failed"
  | "target_verification_recommended"
  | "target_verification_failed";

export type MailSendIdentityDiagnosticCheckStatus =
  | "pass"
  | "warning"
  | "fail"
  | "info";

export interface MailSendIdentityDiagnosticCheckDto {
  id: string;
  status: MailSendIdentityDiagnosticCheckStatus;
  title: string;
  detail: string;
  action?: string;
}

export interface MailSendIdentityDiagnosticsDto {
  accountId: string;
  candidateId: string;
  provider: "graph";
  generatedAt: string;
  from: MailAddressDto;
  identityType: MailSendIdentityType;
  status: MailSendIdentityDiagnosticStatus;
  summary: string;
  sendPath: "unavailable" | "me" | "users";
  sentItemsBehavior: "unknown" | "signed_in_user" | "from_mailbox";
  discoverySupported: false;
  checks: MailSendIdentityDiagnosticCheckDto[];
  nextActions: string[];
  candidate: MailSendIdentityCandidateDto;
}

export interface MailSendIdentityPage {
  accountId: string;
  items: MailSendIdentityDto[];
  candidates?: MailSendIdentityCandidateDto[];
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
  attachments?: MailDraftAttachmentDto[];
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

export interface DraftPageDto {
  accountId: string;
  items: MailDraftDto[];
}

export interface ScheduledDraftDetailDto {
  scheduledSend: ScheduledSendDto;
  draft: MailDraftDto;
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

export interface HermesMessageFollowupTrackerResult
  extends HermesFollowupTrackerResult {
  accountId: string;
  messageId: string;
}

export interface HermesTranslateTextResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "translate_text";
  sourceLanguage: string;
  targetLanguage: string;
  translatedText: string;
}

export interface HermesMessageTranslationResult extends HermesTranslateTextResult {
  accountId: string;
  messageId: string;
  cached: boolean;
}

export type HermesTranslationPreferenceMode = "always" | "never";

export interface HermesTranslationPreferenceResult {
  memory: HermesMemoryDto;
}

export type HermesThreadSummaryMode = "short" | "detailed" | "action_points";

export interface HermesThreadSummaryResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "thread_summarize";
  mode: HermesThreadSummaryMode;
  summaryText: string;
}

export interface HermesMessageSummaryResult extends HermesThreadSummaryResult {
  accountId: string;
  messageId: string;
  cached: boolean;
}

export interface HermesReplyDraftResult {
  skillRunId: string;
  auditEventId?: string;
  skillId: "reply_draft";
  draftText: string;
}

export interface HermesMessageReplyDraftResult extends HermesReplyDraftResult {
  accountId: string;
  messageId: string;
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

export interface HermesMessageQuickReplyResult extends HermesQuickReplyResult {
  accountId: string;
  messageId: string;
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
    senderQuery?: string;
    recipientQuery?: string;
    receivedAfter?: string;
    receivedBefore?: string;
    hasAttachment?: boolean;
  }): Promise<Page<MessageListItemDto>>;
  listLabels(input: {
    accountId: string;
  }): Promise<Page<LabelDto>>;
  upsertLabel(input: {
    accountId: string;
    name: string;
    color?: LabelColor;
  }): Promise<LabelDto>;
  getMessage(input: {
    accountId: string;
    messageId: string;
  }): Promise<MessageDetailDto>;
  downloadAttachment(input: {
    accountId: string;
    attachmentId: string;
  }): Promise<AttachmentDownload>;
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
  listHermesSkills(): Promise<HermesSkillDto[]>;
  getHermesResourceProfile(): Promise<HermesResourceProfileDto>;
  updateHermesSkillSettings(input: {
    skillId: string;
    patch: HermesSkillSettingsUpdateInput;
  }): Promise<HermesSkillDto>;
  listHermesMemories(input?: HermesMemoryListInput): Promise<Page<HermesMemoryDto>>;
  updateHermesMemory(input: HermesMemoryUpdateInput): Promise<HermesMemoryDto>;
  deleteHermesMemory(input: { id: string }): Promise<void>;
  listHermesAuditLog(
    input?: HermesAuditLogListInput,
  ): Promise<Page<HermesAuditLogEntryDto>>;
  searchMailWithHermes(
    input: HermesEmailSearchQaInput,
  ): Promise<HermesEmailSearchQaResult>;
  getHermesWorkspaceContext(input?: {
    accountId?: string;
    ruleLimit?: number;
    labelLimit?: number;
  }): Promise<HermesWorkspaceContextDto>;
  createHermesActionPlan(input: {
    accountId: string;
    command?: string;
    candidateId?: string;
    sampleLimit?: number;
  }): Promise<HermesActionPlanDto>;
  confirmHermesActionPlan(input: {
    planId: string;
    accountId: string;
    candidateId: string;
  }): Promise<HermesActionPlanConfirmationDto>;
  listHermesRules(input: {
    accountId: string;
    enabled?: boolean;
    limit?: number;
  }): Promise<Page<HermesRuleDto>>;
  listHermesRuleCandidates(input: {
    accountId: string;
    status?: HermesRuleCandidateStatus;
    limit?: number;
  }): Promise<Page<HermesRuleCandidateDto>>;
  updateHermesRuleCandidate(input: {
    accountId: string;
    candidateId: string;
    title?: string;
    labelName?: string;
    labelColor?: string;
    keywords?: string[];
    applyToHistory?: boolean;
  }): Promise<HermesRuleCandidateDto>;
  updateHermesRule(input: {
    accountId: string;
    ruleId: string;
    enabled: boolean;
  }): Promise<HermesRuleDto>;
  runHermesRule(input: {
    accountId: string;
    ruleId: string;
    limit?: number;
  }): Promise<HermesRuleExecutionDto>;
  listHermesRuleExecutions(input: {
    accountId: string;
    ruleId?: string;
    limit?: number;
  }): Promise<Page<HermesRuleExecutionDto>>;
  draftHermesRule(input: {
    accountId: string;
    command: string;
  }): Promise<{ candidates: HermesRuleCandidateDto[] }>;
  simulateHermesRule(input: {
    accountId: string;
    candidateId: string;
    sampleLimit?: number;
  }): Promise<HermesRuleSimulationDto>;
  approveHermesRule(input: {
    accountId: string;
    candidateId: string;
  }): Promise<HermesRuleDto>;
  triagePriorityWithHermes(
    input: HermesPriorityTriageInput,
  ): Promise<HermesPriorityTriageResult>;
  suggestLabelsWithHermes(
    input: HermesLabelSuggestInput,
  ): Promise<HermesLabelSuggestResult>;
  cleanupNewsletterWithHermes(
    input: HermesNewsletterCleanupInput,
  ): Promise<HermesNewsletterCleanupResult>;
  extractActionItemsWithHermes(
    input: HermesActionItemExtractInput,
  ): Promise<HermesActionItemExtractResult>;
  organizeMessage(input: {
    accountId: string;
    messageId: string;
    language?: string;
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesMessageOrganizationResult>;
  previewAccountCsv(input: { csv: string }): Promise<AccountImportPreview>;
  createAccountCsvImport(input: {
    csv: string;
  }): Promise<AccountImportCreateResult>;
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
  completeSyncCenterOAuthReauthorizationCallback(input: {
    state: string;
    code: string;
  }): Promise<OAuthCallbackResult>;
  completeSyncCenterImapSmtpReauthorization(
    input: SyncCenterImapSmtpReauthorizationInput,
  ): Promise<ImapSmtpOnboardingResult>;
  requestSyncCenterResync(input: {
    accountId: string;
  }): Promise<SyncManualResyncResult>;
  pauseSyncCenterAccount(input: { accountId: string }): Promise<SyncPauseResult>;
  resumeSyncCenterAccount(input: { accountId: string }): Promise<SyncResumeResult>;
  retryFailedSyncCenterJobs(input: {
    accountId: string;
  }): Promise<SyncRetryFailedResult>;
  getMailNavigationSummary(): Promise<MailNavigationSummaryDto>;
  getMailEngineHealth(): Promise<MailEngineHealthDto>;
  getMailProviderCapabilities(): Promise<MailProviderCapabilitiesResponse>;
  getComposeAttachmentMaintenanceStatus(): Promise<ComposeAttachmentMaintenanceStatusDto>;
  cleanupComposeAttachments(
    input?: ComposeAttachmentMaintenanceCleanupInput,
  ): Promise<ComposeAttachmentMaintenanceCleanupResultDto>;
  createDomain(input: { domain: string }): Promise<DomainDto>;
  listDomains(): Promise<Page<DomainDto>>;
  createDomainDestination(input: {
    domainId: string;
    email: string;
  }): Promise<DomainDestinationDto>;
  listDomainDestinations(input: {
    domainId: string;
  }): Promise<Page<DomainDestinationDto>>;
  createDomainAlias(input: {
    domainId: string;
    localPart: string;
    destinationIds: string[];
  }): Promise<DomainAliasDto>;
  listDomainAliases(input: {
    domainId: string;
  }): Promise<Page<DomainAliasDto>>;
  setDomainCatchAll(input: {
    domainId: string;
    mode: DomainCatchAllMode;
    destinationIds?: string[];
  }): Promise<DomainCatchAllRuleDto>;
  getDomainCatchAll(input: {
    domainId: string;
  }): Promise<DomainCatchAllRuleResponse>;
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
  trackMessageFollowup(input: {
    accountId: string;
    messageId: string;
    language?: string;
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesMessageFollowupTrackerResult>;
  translateText(input: {
    text: string;
    targetLanguage: string;
    sourceLanguage?: string;
    tone?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesTranslateTextResult>;
  translateMessage(input: {
    accountId: string;
    messageId: string;
    targetLanguage: string;
    sourceLanguage?: string;
    tone?: string;
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
    forceRefresh?: boolean;
  }): Promise<HermesMessageTranslationResult>;
  confirmTranslationPreference(input: {
    mode: HermesTranslationPreferenceMode;
    sourceLanguage: string;
    targetLanguage?: string;
    memoryScope?: string;
    reason?: string;
  }): Promise<HermesTranslationPreferenceResult>;
  summarizeThread(input: {
    subject?: string;
    threadText: string;
    mode?: HermesThreadSummaryMode;
    focus?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesThreadSummaryResult>;
  summarizeMessage(input: {
    accountId: string;
    messageId: string;
    mode?: HermesThreadSummaryMode;
    focus?: string;
    language?: string;
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
    forceRefresh?: boolean;
  }): Promise<HermesMessageSummaryResult>;
  draftMessageReply(input: {
    accountId: string;
    messageId: string;
    instruction?: string;
    tone?: string;
    language?: string;
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesMessageReplyDraftResult>;
  quickMessageReply(input: {
    accountId: string;
    messageId: string;
    scenario: HermesQuickReplyScenario;
    instruction?: string;
    tone?: string;
    language?: string;
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<HermesMessageQuickReplyResult>;
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
    attachments?: MailDraftAttachmentDto[];
    hermesSkillRunId?: string;
    hermesDraftText?: string;
  }): Promise<MailDraftDto>;
  listMailDrafts(input: {
    accountId: string;
    limit?: number;
  }): Promise<DraftPageDto>;
  updateMailDraft(input: {
    accountId: string;
    draftId: string;
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
    attachments?: MailDraftAttachmentDto[];
    hermesSkillRunId?: string;
    hermesDraftText?: string;
  }): Promise<MailDraftDto>;
  uploadComposeAttachment(input: {
    accountId: string;
    file: File;
  }): Promise<MailDraftAttachmentDto>;
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
    attachments?: MailDraftAttachmentDto[];
  }): Promise<MailComposePreviewDto>;
  listSendIdentities(input: { accountId: string }): Promise<MailSendIdentityPage>;
  addProviderSendIdentityCandidate(input: {
    accountId: string;
    provider: "graph";
    address: string;
    name?: string;
    identityType: "shared_mailbox" | "send_on_behalf" | "unknown";
  }): Promise<MailSendIdentityCandidateDto>;
  verifyProviderSendIdentityCandidate(input: {
    accountId: string;
    candidateId: string;
  }): Promise<{
    accountId: string;
    candidate: MailSendIdentityCandidateDto;
    verified: boolean;
    errorCode?: string;
  }>;
  verifyProviderSendIdentityUserTarget(input: {
    accountId: string;
    candidateId: string;
    targetMailbox: string;
  }): Promise<{
    accountId: string;
    candidate: MailSendIdentityCandidateDto;
    verified: boolean;
    errorCode?: string;
  }>;
  diagnoseProviderSendIdentityCandidate(input: {
    accountId: string;
    candidateId: string;
  }): Promise<MailSendIdentityDiagnosticsDto>;
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
  getScheduledDraft(input: {
    accountId: string;
    scheduledId: string;
  }): Promise<ScheduledDraftDetailDto>;
  updateScheduledDraft(input: {
    accountId: string;
    scheduledId: string;
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
    attachments?: MailDraftAttachmentDto[];
    hermesSkillRunId?: string;
    hermesDraftText?: string;
  }): Promise<ScheduledDraftDetailDto>;
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

export interface ApiErrorPayload {
  error?: string;
  provider?: string;
  detail?: string;
  requestId?: string;
  diagnostics?: ImapSmtpConnectionDiagnostic[];
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly provider?: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly diagnostics?: ImapSmtpConnectionDiagnostic[];
  readonly payload?: ApiErrorPayload;

  constructor(status: number, code: string, payload?: ApiErrorPayload) {
    super(code);
    this.status = status;
    this.code = code;
    this.provider = payload?.provider;
    this.detail = payload?.detail;
    this.requestId = payload?.requestId;
    this.diagnostics = payload?.diagnostics;
    this.payload = payload;
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
      appendParam(params, "sender", input.senderQuery?.trim() || undefined);
      appendParam(params, "recipient", input.recipientQuery?.trim() || undefined);
      appendParam(params, "receivedAfter", input.receivedAfter);
      appendParam(params, "receivedBefore", input.receivedBefore);
      if (typeof input.hasAttachment === "boolean") {
        appendParam(params, "hasAttachment", String(input.hasAttachment));
      }
      const path = input.accountId
        ? `/api/accounts/${encodePath(input.accountId)}/messages`
        : "/api/messages";
      return request(
        fetchImpl,
        baseUrl,
        `${path}?${params.toString()}`,
      );
    },

    listLabels(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/labels`,
      );
    },

    upsertLabel(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/labels`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              name: input.name,
              color: input.color,
            }),
          ),
        },
      );
    },

    getMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}`,
      );
    },

    downloadAttachment(input) {
      return downloadBlob(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/attachments/${encodePath(input.attachmentId)}/download`,
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

    listHermesSkills() {
      return request(fetchImpl, baseUrl, "/api/hermes/skills");
    },

    getHermesResourceProfile() {
      return request(fetchImpl, baseUrl, "/api/hermes/resource-profile");
    },

    updateHermesSkillSettings(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/skills/${encodePath(input.skillId)}/settings`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(input.patch)),
        },
      );
    },

    listHermesMemories(input = {}) {
      const params = new URLSearchParams();
      appendParam(params, "layer", input.layer?.trim() || undefined);
      appendParam(params, "scope", input.scope?.trim() || undefined);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/memories${query ? `?${query}` : ""}`,
      );
    },

    updateHermesMemory(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/memories/${encodePath(input.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            cleanObject({
              content: input.content,
              confidence: input.confidence,
            }),
          ),
        },
      );
    },

    deleteHermesMemory(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/memories/${encodePath(input.id)}`,
        { method: "DELETE" },
      );
    },

    listHermesAuditLog(input = {}) {
      const params = new URLSearchParams();
      appendParam(params, "accountId", input.accountId?.trim() || undefined);
      appendParam(params, "skillId", input.skillId?.trim() || undefined);
      appendParam(params, "messageId", input.messageId?.trim() || undefined);
      appendParam(params, "memoryId", input.memoryId?.trim() || undefined);
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/audit-log${query ? `?${query}` : ""}`,
      );
    },

    searchMailWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/email_search_qa/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    getHermesWorkspaceContext(input = {}) {
      const params = new URLSearchParams();
      if (input.accountId) {
        params.set("accountId", input.accountId);
      }
      if (input.ruleLimit !== undefined) {
        params.set("ruleLimit", String(input.ruleLimit));
      }
      if (input.labelLimit !== undefined) {
        params.set("labelLimit", String(input.labelLimit));
      }
      const query = params.toString();
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/workspace/context${query ? `?${query}` : ""}`,
      );
    },

    createHermesActionPlan(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/action-plans", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    confirmHermesActionPlan(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/action-plans/${encodePath(input.planId)}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            accountId: input.accountId,
            candidateId: input.candidateId,
          }),
        },
      );
    },

    listHermesRules(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      if (typeof input.enabled === "boolean") {
        params.set("enabled", String(input.enabled));
      }
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules?${params.toString()}`,
      );
    },

    listHermesRuleCandidates(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      if (input.status) {
        params.set("status", input.status);
      }
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-candidates?${params.toString()}`,
      );
    },

    updateHermesRuleCandidate(input) {
      const { candidateId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-candidates/${encodePath(candidateId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(body)),
        },
      );
    },

    updateHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.ruleId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            accountId: input.accountId,
            enabled: input.enabled,
          }),
        },
      );
    },

    runHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.ruleId)}/run`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              accountId: input.accountId,
              limit: input.limit,
            }),
          ),
        },
      );
    },

    listHermesRuleExecutions(input) {
      const params = new URLSearchParams();
      params.set("accountId", input.accountId);
      if (input.ruleId) {
        params.set("ruleId", input.ruleId);
      }
      if (input.limit !== undefined) {
        params.set("limit", String(input.limit));
      }
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rule-runs?${params.toString()}`,
      );
    },

    draftHermesRule(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/rules/draft", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    simulateHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.candidateId)}/simulate`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              accountId: input.accountId,
              sampleLimit: input.sampleLimit,
            }),
          ),
        },
      );
    },

    approveHermesRule(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/hermes/rules/${encodePath(input.candidateId)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ accountId: input.accountId }),
        },
      );
    },

    triagePriorityWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/priority_triage/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    suggestLabelsWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/label_suggest/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    cleanupNewsletterWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/newsletter_cleanup/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    extractActionItemsWithHermes(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/action_item_extract/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    organizeMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/organize`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
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

    completeSyncCenterOAuthReauthorizationCallback(input) {
      return request(
        fetchImpl,
        baseUrl,
        "/api/sync-center/reauthorizations/oauth/callback",
        {
          method: "POST",
          body: JSON.stringify({
            state: input.state,
            code: input.code,
          }),
        },
      );
    },

    completeSyncCenterImapSmtpReauthorization(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/sync-center/reauthorizations/${encodePath(input.taskId)}/imap-smtp`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(input.username ? { username: input.username } : {}),
            secret: input.secret,
            ...(input.imap && input.smtp
              ? { imap: input.imap, smtp: input.smtp }
              : {}),
          }),
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

    getMailEngineHealth() {
      return request(fetchImpl, baseUrl, "/api/mail-engine/health");
    },

    getMailProviderCapabilities() {
      return request(fetchImpl, baseUrl, "/api/mail-providers/capabilities");
    },

    getComposeAttachmentMaintenanceStatus() {
      return request(fetchImpl, baseUrl, "/api/maintenance/compose-attachments");
    },

    cleanupComposeAttachments(input = {}) {
      return request(
        fetchImpl,
        baseUrl,
        "/api/maintenance/compose-attachments/cleanup",
        {
          method: "POST",
          body: JSON.stringify(cleanObject(input)),
        },
      );
    },

    createDomain(input) {
      return request(fetchImpl, baseUrl, "/api/domains", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    listDomains() {
      return request(fetchImpl, baseUrl, "/api/domains");
    },

    createDomainDestination(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/destinations`,
        {
          method: "POST",
          body: JSON.stringify({ email: input.email }),
        },
      );
    },

    listDomainDestinations(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/destinations`,
      );
    },

    createDomainAlias(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/aliases`,
        {
          method: "POST",
          body: JSON.stringify({
            localPart: input.localPart,
            destinationIds: input.destinationIds,
          }),
        },
      );
    },

    listDomainAliases(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/aliases`,
      );
    },

    setDomainCatchAll(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/catch-all`,
        {
          method: "PUT",
          body: JSON.stringify(
            cleanObject({
              mode: input.mode,
              destinationIds: input.destinationIds,
            }),
          ),
        },
      );
    },

    getDomainCatchAll(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/domains/${encodePath(input.domainId)}/catch-all`,
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

    trackMessageFollowup(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/followup-track`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
    },

    translateText(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/translate_text/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    translateMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/translate`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              targetLanguage: input.targetLanguage,
              sourceLanguage: input.sourceLanguage,
              tone: input.tone,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
              forceRefresh: input.forceRefresh,
            }),
          ),
        },
      );
    },

    confirmTranslationPreference(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/translation-preferences", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    summarizeThread(input) {
      return request(fetchImpl, baseUrl, "/api/hermes/skills/thread_summarize/run", {
        method: "POST",
        body: JSON.stringify(cleanObject(input)),
      });
    },

    summarizeMessage(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/summary`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              mode: input.mode,
              focus: input.focus,
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
              forceRefresh: input.forceRefresh,
            }),
          ),
        },
      );
    },

    draftMessageReply(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/reply-draft`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              instruction: input.instruction,
              tone: input.tone,
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
    },

    quickMessageReply(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/messages/${encodePath(input.messageId)}/quick-reply`,
        {
          method: "POST",
          body: JSON.stringify(
            cleanObject({
              scenario: input.scenario,
              instruction: input.instruction,
              tone: input.tone,
              language: input.language,
              memoryIds: input.memoryIds,
              memoryScope: input.memoryScope,
              memoryLayers: input.memoryLayers,
            }),
          ),
        },
      );
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

    listMailDrafts(input) {
      const query = new URLSearchParams();
      if (typeof input.limit === "number") {
        query.set("limit", String(input.limit));
      }
      const queryString = query.toString();
      const suffix = queryString ? `?${queryString}` : "";
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/drafts${suffix}`,
      );
    },

    uploadComposeAttachment(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/compose/attachments`,
        {
          method: "POST",
          headers: {
            "content-type": input.file.type || "application/octet-stream",
            "x-emailhub-filename": encodeURIComponent(
              input.file.name || "attachment",
            ),
          },
          body: input.file,
        },
      );
    },

    updateMailDraft(input) {
      const { accountId, draftId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/compose/drafts/${encodePath(draftId)}`,
        {
          method: "PATCH",
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

    addProviderSendIdentityCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: input.provider,
            address: input.address,
            ...(input.name ? { name: input.name } : {}),
            identityType: input.identityType,
          }),
        },
      );
    },

    verifyProviderSendIdentityCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates/${encodePath(input.candidateId)}/verify`,
        { method: "POST" },
      );
    },

    verifyProviderSendIdentityUserTarget(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates/${encodePath(input.candidateId)}/verify-user-target`,
        {
          method: "POST",
          body: JSON.stringify({
            targetMailbox: input.targetMailbox,
          }),
        },
      );
    },

    diagnoseProviderSendIdentityCandidate(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/send-identities/provider-candidates/${encodePath(input.candidateId)}/diagnostics`,
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

    getScheduledDraft(input) {
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(input.accountId)}/outbox/${encodePath(input.scheduledId)}/draft`,
      );
    },

    updateScheduledDraft(input) {
      const { accountId, scheduledId, ...body } = input;
      return request(
        fetchImpl,
        baseUrl,
        `/api/accounts/${encodePath(accountId)}/outbox/${encodePath(scheduledId)}/draft`,
        {
          method: "PATCH",
          body: JSON.stringify(cleanObject(body)),
        },
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
  const errorPayload = normalizeApiErrorPayload(payload);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      errorPayload?.error ?? "request_failed",
      errorPayload,
    );
  }

  return payload as T;
}

async function downloadBlob(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
): Promise<AttachmentDownload> {
  const response = await fetchImpl(`${baseUrl}${path}`, { method: "GET" });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const errorPayload = normalizeApiErrorPayload(payload);
    throw new ApiRequestError(
      response.status,
      errorPayload?.error ?? "request_failed",
      errorPayload,
    );
  }

  const blob = await response.blob();
  return {
    blob,
    filename:
      parseContentDispositionFilename(response.headers.get("content-disposition")) ??
      "attachment",
    contentType:
      response.headers.get("content-type") ??
      blob.type ??
      "application/octet-stream",
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as Record<string, unknown>;
}

async function readErrorPayload(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJson(response);
  } catch {
    return undefined;
  }
}

function normalizeApiErrorPayload(
  payload: Record<string, unknown> | undefined,
): ApiErrorPayload | undefined {
  if (!payload) {
    return undefined;
  }

  const normalized: ApiErrorPayload = {};
  if (typeof payload.error === "string") {
    normalized.error = payload.error;
  }
  if (typeof payload.provider === "string") {
    normalized.provider = payload.provider;
  }
  if (typeof payload.detail === "string") {
    normalized.detail = payload.detail;
  }
  if (typeof payload.requestId === "string") {
    normalized.requestId = payload.requestId;
  }

  const diagnostics = normalizeApiConnectionDiagnostics(payload.diagnostics);
  if (diagnostics.length > 0) {
    normalized.diagnostics = diagnostics;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeApiConnectionDiagnostics(
  value: unknown,
): ImapSmtpConnectionDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isApiConnectionDiagnostic)
    .map((diagnostic) => ({
      code: diagnostic.code,
      provider: diagnostic.provider,
      severity: diagnostic.severity,
      affected: diagnostic.affected,
      message: diagnostic.message,
      recoveryAction: diagnostic.recoveryAction,
    }));
}

function isApiConnectionDiagnostic(
  value: unknown,
): value is ImapSmtpConnectionDiagnostic {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const diagnostic = value as Record<string, unknown>;
  return (
    typeof diagnostic.code === "string" &&
    typeof diagnostic.provider === "string" &&
    diagnostic.severity === "action_required" &&
    (diagnostic.affected === "account" ||
      diagnostic.affected === "imap" ||
      diagnostic.affected === "smtp") &&
    typeof diagnostic.message === "string" &&
    typeof diagnostic.recoveryAction === "string"
  );
}

function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }

  const parts = header.split(";").map((part) => part.trim());
  const extended = parts.find((part) =>
    part.toLowerCase().startsWith("filename*="),
  );
  if (extended) {
    const value = unquoteHeaderValue(extended.slice(extended.indexOf("=") + 1));
    const encoded = value.includes("''") ? value.slice(value.indexOf("''") + 2) : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const plain = parts.find((part) => part.toLowerCase().startsWith("filename="));
  if (!plain) {
    return undefined;
  }

  return unquoteHeaderValue(plain.slice(plain.indexOf("=") + 1));
}

function unquoteHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  }

  return trimmed;
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
