import type { SyncCenterJobSummaryDto } from "./syncCenterTypes";
import type { EmailHubSessionApi } from "./emailHubSessionTypes";
import type { DomainAliasApiClient } from "./domainAliasApiClient";

export type MessageListSort = "time";

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

export type MailQuickFilter =
  | "unread"
  | "starred"
  | "snoozed"
  | "attachments"
  | "labels";
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
  assistantName?: string;
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

export type HermesProviderCategory = "gateway" | "cloud" | "local" | "oauth" | "custom";

export type HermesProviderAuthType = "none" | "api_key" | "api_key_optional" | "oauth" | "aws_credentials";

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
  endpointTemplate?: string;
  envKeys?: string[];
  note?: string;
}

export interface HermesProviderCatalogResponse {
  providers: HermesProviderCatalogItem[];
}

export interface HermesRuntimeUpdateInput {
  enabled: boolean;
  mode: HermesRuntimeMode;
  assistantName?: string;
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
  accountId?: string;
  layer: string;
  scope: string;
  content: Record<string, unknown>;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface HermesMemoryListInput {
  accountId: string;
  layer?: string;
  scope?: string;
  limit?: number;
}

export interface HermesMemoryUpdateInput {
  id: string;
  accountId: string;
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
  accountId?: string;
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
      labelIds?: string[];
      tagMode?: MailTagMode;
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
  customInstructions: string;
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
  customInstructions: {
    maxLength: number;
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
  sortOrder: number;
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
  latestSyncJob?: SyncCenterJobSummaryDto;
  latestJob?: SyncCenterJobSummaryDto;
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
  folders: Array<{ id: string; label: string; count: number }>;
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

export interface ApiHealthDto {
  service: string;
  ok: boolean;
  checks?: {
    database?: "ok" | "unavailable";
  };
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

export interface HermesRetentionTableStatusDto {
  table: string;
  timestampColumn: string;
  expiredRows: number;
  scanLimit: number;
  scanLimited: boolean;
}

export interface HermesRetentionMaintenanceStatusDto {
  generatedAt: string;
  retentionMs: number;
  retentionDays: number;
  cleanupLimit: number;
  cutoff: string;
  tables: HermesRetentionTableStatusDto[];
  expiredRows: number;
  scanLimited: boolean;
}

export interface HermesRetentionMaintenanceCleanupInput {
  retentionDays?: number;
  limit?: number;
}

export interface HermesRetentionMaintenanceCleanupResultDto {
  generatedAt: string;
  retentionMs: number;
  retentionDays: number;
  cleanupLimit: number;
  cutoff: string;
  cleanup: {
    messageTranslations: number;
    messageSummaries: number;
    staleActionPlanConfirmations: number;
    actionPlans: number;
    feedback: number;
    auditEvents: number;
    skillRuns: number;
    deleted: number;
  };
  after: HermesRetentionMaintenanceStatusDto;
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
  | "large_body"
  | "duplicate_recipient"
  | "possible_missing_attachment"
  | "external_recipient_warning";

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

export interface EmailHubApi extends DomainAliasApiClient {
  getSession?: EmailHubSessionApi["getSession"];
  createAdmin?: EmailHubSessionApi["createAdmin"];
  login?: EmailHubSessionApi["login"];
  logout?: EmailHubSessionApi["logout"];
  listMailboxes(input: { accountId: string }): Promise<Page<MailboxDto>>;
  listMessages(input: {
    accountId?: string;
    mailboxId?: string;
    mailboxRole?: string;
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
  listHermesMemories(input: HermesMemoryListInput): Promise<Page<HermesMemoryDto>>;
  updateHermesMemory(input: HermesMemoryUpdateInput): Promise<HermesMemoryDto>;
  deleteHermesMemory(input: { id: string; accountId: string }): Promise<void>;
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
  dismissHermesRuleCandidate(input: {
    accountId: string;
    candidateId: string;
  }): Promise<HermesRuleCandidateDto>;
  updateHermesRule(input: {
    accountId: string;
    ruleId: string;
    enabled?: boolean;
    sortOrder?: number;
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
  suggestHermesRules(input: {
    accountId: string;
    behaviorWindowDays?: number;
    minEvidenceCount?: number;
  }): Promise<{ candidates: HermesRuleCandidateDto[] }>;
  simulateHermesRule(input: {
    accountId: string;
    candidateId: string;
    sampleLimit?: number;
  }): Promise<HermesRuleSimulationDto>;
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
  getApiHealth(): Promise<ApiHealthDto>;
  getMailEngineHealth(): Promise<MailEngineHealthDto>;
  getMailProviderCapabilities(): Promise<MailProviderCapabilitiesResponse>;
  getComposeAttachmentMaintenanceStatus(): Promise<ComposeAttachmentMaintenanceStatusDto>;
  cleanupComposeAttachments(
    input?: ComposeAttachmentMaintenanceCleanupInput,
  ): Promise<ComposeAttachmentMaintenanceCleanupResultDto>;
  getHermesRetentionMaintenanceStatus(): Promise<HermesRetentionMaintenanceStatusDto>;
  cleanupHermesRetention(
    input?: HermesRetentionMaintenanceCleanupInput,
  ): Promise<HermesRetentionMaintenanceCleanupResultDto>;
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
    accountId: string;
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
    accountId: string;
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
    accountId: string;
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
