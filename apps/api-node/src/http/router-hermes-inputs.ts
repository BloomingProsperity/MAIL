import { once } from "node:events";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_EMAILENGINE_WEBHOOK_MAX_SKEW_MS, normalizeEmailEngineWebhook, verifyEmailEngineWebhookFreshness, verifyEmailEngineSignature } from "../mail-engine/webhook.js";
import { createInMemoryMailEngineIngestStore, type IngestWebhookResult, type MailEngineIngestStore } from "../mail-engine/ingest-store.js";
import { HERMES_SKILL_CUSTOM_INSTRUCTIONS_MAX_LENGTH, getHermesSkills, type HermesSkill, type HermesSkillSettingsPatch } from "../hermes/skills.js";
import { createHermesResourceProfile, type HermesRetentionPolicy } from "../hermes/resource-profile.js";
import { limitHermesContextText } from "../hermes/message-content.js";
import { HermesSkillDisabledError, InvalidHermesSkillSettingsRequestError, type HermesSkillSettingsService } from "../hermes/skill-settings.js";
import { getHermesProviderCatalog } from "../hermes/provider-catalog.js";
import { findProviderCapability, listProviderCapabilities, type MailProviderCapabilityOptions } from "../mail-provider/provider-capabilities.js";
import { findBuiltInSavedView } from "../mail-navigation/saved-views.js";
import { createHermesProviderProbeService, InvalidHermesProviderProbeRequestError, type HermesProviderProbeResult, type HermesProviderProbeService } from "../hermes/provider-probe.js";
import { InvalidCsvImportError, type AccountCsvImportService } from "../accounts/csv-import.js";
import { InvalidAccountTransferError, validateTransferPackage, type AccountTransferPackage, type AccountTransferService } from "../accounts/account-transfer.js";
import { hasImapSmtpProviderPreset, ImapSmtpOnboardingFailedError, normalizeImapSmtpProvider } from "../accounts/imap-smtp-onboarding.js";
import { InvalidReauthorizationRequestError, ReauthorizationFailedError, type ReauthorizationRecoveryService } from "../accounts/reauthorization-recovery.js";
import { InvalidOAuthCallbackError } from "../accounts/oauth-onboarding.js";
import type { AttachmentDownloadRef, MailQuickFilter, MailReadStore, MailSearchScope, MailTagMode, MessageListSort, } from "../mail-read/mail-read-store.js";
import { InvalidMailSavedViewError } from "../mail-read/postgres-mail-read-store.js";
import { decodeMailReadCursor, InvalidMailReadCursorError } from "../mail-read/cursor.js";
import type { HermesMemoryStore } from "../hermes/memory-store.js";
import type { HermesDraftFeedbackStore } from "../hermes/draft-feedback.js";
import { InvalidHermesRuleRequestError, type HermesRuleService } from "../hermes/rules.js";
import { InvalidHermesActionPlanRequestError, type HermesActionPlanService } from "../hermes/action-plan.js";
import { InvalidHermesWorkspaceContextRequestError, type HermesWorkspaceContextService } from "../hermes/workspace-context.js";
import { InvalidHermesFollowUpReminderRequestError, type HermesFollowUpReminderService, type HermesFollowUpReminderStatus } from "../hermes/followup-reminders.js";
import { InvalidHermesAuditLogRequestError, type HermesAuditLogService } from "../hermes/audit-log.js";
import { InvalidTranslationPreferenceRequestError, type HermesTranslationPreferenceMode, type HermesTranslationPreferenceService } from "../hermes/translation-preferences.js";
import { InvalidHermesMessageTranslationRequestError, type HermesMessageTranslationService } from "../hermes/message-translation.js";
import { InvalidHermesMessageSummaryRequestError, type HermesMessageSummaryService } from "../hermes/message-summary.js";
import { InvalidHermesMessageReplyRequestError, type HermesMessageReplyService } from "../hermes/message-replies.js";
import { InvalidHermesMessageOrganizationRequestError, type HermesMessageOrganizationService } from "../hermes/message-organization.js";
import { InvalidHermesMessageFollowupRequestError, type HermesMessageFollowupTrackerService } from "../hermes/message-followups.js";
import { HermesRuntimeNotConfiguredError, InvalidHermesRuntimeConfigRequestError, type HermesRuntimeConfigService, type HermesRuntimeMode, type HermesRuntimeUpdateChannel, type HermesRuntimeUpdatePolicy } from "../hermes/runtime-config.js";
import type { SmartInboxFeedbackAction, SmartInboxFeedbackStore, } from "../smart-inbox/feedback-store.js";
import { InvalidSenderScreeningRequestError, type SenderScreeningStatus, type SenderScreeningStore } from "../gatekeeper/sender-screening.js";
import { parseHermesEmailSearchQaInput } from "./hermes-search-qa-input.js";
import { InvalidGatekeeperSettingsRequestError, isGatekeeperMode, type GatekeeperMode, type GatekeeperSettingsService } from "../gatekeeper/settings.js";
import type { SyncCenterStore } from "../sync-center/sync-center-store.js";
import { InvalidSyncControlRequestError, type SyncControlService } from "../sync-center/sync-control.js";
import { InvalidMailComposeRequestError, MAX_DRAFT_ATTACHMENT_BYTES, type CreateMailDraftAttachmentInput, type CreateMailDraftInput, type MailAddress, type MailComposePreviewInput, type MailComposeSeedMode, type MailComposeService, type MailDraftSource, type UpdateScheduledMailDraftInput, type UpdateMailDraftInput } from "../mail-compose/mail-compose.js";
import { ComposeAttachmentBlobTooLargeError, type ComposeAttachmentBlobStore } from "../mail-compose/compose-attachment-blob-store.js";
import type { ComposeAttachmentMaintenanceService } from "../maintenance/compose-attachment-maintenance.js";
import type { HermesRetentionMaintenanceService } from "../maintenance/hermes-retention-maintenance.js";
import { InvalidMailActionRequestError, type MailAction, type MailBulkActionInput, type MailActionInput, type MailActionService } from "../mail-actions/mail-actions.js";
import { InvalidLabelRequestError, type LabelColor, type LabelService } from "../labels/labels.js";
import { InvalidDomainAliasRequestError, type DomainAliasService } from "../domains/domain-alias.js";
import { CloudflareDnsRequestError } from "../domains/domain-cloudflare.js";
import { handleDomainAliasRoute } from "./domain-alias-routes.js";
import { InvalidFollowUpRequestError, type FollowUpKind, type FollowUpListStatus, type FollowUpService, type FollowUpSource, type FollowUpStatus } from "../follow-ups/follow-ups.js";
import type { MailNavigationSummaryService } from "../mail-navigation/navigation-summary.js";
import type { Logger } from "../logging/logger.js";
import { sanitizeRequestUrl } from "../logging/logger.js";
import type { EmailEngineHealthProbe, EmailEngineHealthProbeResult, } from "../mail-engine/email-engine-health-probe.js";
import { InvalidEmailEngineAuthServerRequestError, isEmailEngineAuthServerProto, type EmailEngineAuthServerService } from "../mail-engine/email-engine-auth-server.js";
import { isDiagnosticLogLevel, type DiagnosticsLogStore } from "../logging/diagnostics.js";
import { InvalidOperationalEventQueryError, isOperationalEventLevel, type OperationalEventRecordInput, type OperationalEventLogService } from "../logging/operational-events.js";
import { DEFAULT_WEB_SESSION_MAX_AGE_SECONDS, handleWebSessionRoute, isWebSessionRoute, type WebSession } from "./web-session.js";
import type { WebAuthStore } from "./web-auth.js";
import { isAccountAccessAllowed, isApiAccessAccountScoped, readApiAccessToken, resolveApiRequestAccess } from "./api-access.js";
import type { ImapSmtpEndpointSettings, ImapSmtpOnboardingInput, AccountOnboardingService, ImapSmtpConnectionCheckResult, ImapSmtpConnectionDiagnostic, ImapSmtpConnectionTestResult, OAuthAccountOnboardingService, HermesService, AttachmentDownloadService, ApiConfig, ApiHandler } from "./router-types.js";
import { DEFAULT_MAX_REQUEST_BODY_BYTES, DEFAULT_MAX_COMPOSE_REQUEST_BODY_BYTES, DEFAULT_MAX_COMPOSE_ATTACHMENT_UPLOAD_BYTES, DEFAULT_MAX_ATTACHMENT_DOWNLOAD_BYTES, FALLBACK_ATTACHMENT_CONTENT_TYPE } from "./router-constants.js";
import { InvalidImapSmtpAccountError, InvalidOAuthRequestError, InvalidMailReadRequestError, InvalidSmartInboxFeedbackError, InvalidHermesMemoryRequestError, InvalidHermesDraftFeedbackRequestError, InvalidComposeAttachmentMaintenanceRequestError, InvalidHermesRetentionMaintenanceRequestError, RequestBodyTooLargeError } from "./router-errors.js";
import { recordOperationalEvent, ensureHermesSkillAllowed, withHermesSkillContextBudget, withHermesSkillsContextBudget, withHermesInputTextBudget, recordEmailEngineWebhookIngestEvents, recordHermesProviderProbeEvent, recordHermesRuntimeConnectionTestEvent, recordAccountOnboardingFailure, recordOAuthOnboardingFailure } from "./router-hermes-helpers.js";
import { sanitizeImapSmtpConnectionTestResult, sanitizeImapSmtpConnectionCheck, sanitizeImapSmtpConnectionDiagnostic, asImapSmtpOnboardingFailedError, asReauthorizationFailedError, readImapSmtpDiagnostics, isImapSmtpConnectionDiagnostic, imapSmtpInputMode, imapSmtpSensitiveValues, reauthorizationImapSmtpSensitiveValues, rememberSensitiveValues, safeErrorForDiagnostics, safeErrorMessage, scrubKnownSensitiveText, parseRequestId, isRequestPath, readScopedRouteAccountId, isAdminOnlyForAccountScopedTokenRoute, isHermesRuleAdminRoute, isHermesRuleCandidateAdminRoute, isHermesAccountQueryMissingRoute, isHermesGlobalSkillAdminRoute, isAccountScopedHermesSkillRunRoute, isAccountBodyScopedHermesSkillRunRoute, isAccountBodyScopedHermesActionPlanRoute, isAccountBodyScopedHermesRuleRoute, readHermesSkillRunAccountId, readOptionalQueryAccountId, rejectAccountScopedAccess, rejectAccountScopedAdminRoute, isDiagnosticsReadAuthorized, rejectDiagnosticsRead, getRequestPathname, isDiagnosticsLogRoute, isOperationalEventsRoute, parseComposeAttachmentMaintenanceRoute, parseHermesRetentionMaintenanceRoute, parseComposeAttachmentMaintenanceCleanupInput, parseHermesRetentionMaintenanceCleanupInput, readHermesRetentionMaintenanceInteger, readComposeAttachmentMaintenanceInteger, isHermesAuditLogRoute } from "./router-route-guards.js";
import { parseHermesRuntimeRoute, parseHermesProviderProbeRoute, parseMailProviderCapabilityRoute, parseHermesProviderProbeInput, parseHermesProviderProbeJsonObject, parseHermesRuntimeUpdateInput, parseHermesRuntimeJsonObject, parseHermesAuditLogListInput, optionalQueryParam, parseHermesAuditLogLimit, parseDiagnosticsLogListInput, parseDiagnosticsLimit, parseOperationalEventListInput, optionalOperationalQueryParam, parseOperationalEventLimit, parseHermesMemoryRoute, parseHermesRuleRoute, parseHermesRuleExecutionRoute, parseHermesRuleCandidateRoute, parseHermesActionPlanRoute, parseHermesSkillSettingsRoute, isHermesWorkspaceContextRoute, parseHermesWorkspaceContextInput, parseHermesSkillSettingsPatch, readHermesSkillSettingsBoolean, readHermesSkillSettingsInteger, readHermesSkillSettingsCustomInstructions, optionalWorkspaceContextParam, optionalWorkspaceContextLimit, parseLabelRoute, isStringArray, parseReauthorizationRecoveryRoute, parseSyncControlRoute, parseSyncDiagnosticsRoute, isSyncDiagnosticsRoute } from "./router-route-parsers.js";
import { parseMailComposeRoute, parseOptionalMailComposeLimit, parseMailActionRoute, parseMailBulkActionRoute, parseFollowUpRoute, parseOptionalFollowUpStatus, parseOptionalFollowUpLimit, parseSmartInboxFeedbackRoute, parseSenderScreeningRoute, parseGatekeeperSettingsRoute, parseSenderScreeningStatus, parseAttachmentDownloadRoute, parseOAuthRoute, parseMailReadRoute, parseHermesMessageTranslationRoute, parseHermesMessageSummaryRoute, parseHermesMessageReplyDraftRoute, parseHermesMessageQuickReplyRoute, parseHermesMessageOrganizationRoute, parseHermesMessageFollowupRoute, parseLimit, parseMailSort, parseMailSavedViewId, parseMailQuickFilters, parseMailMailboxRole, parseMailMailboxId, parseMailSearchScopes, parseMailLabelIds, parseMailTagMode, parseMailStructuredText, parseMailDateBound, parseOptionalMailBoolean, uniqueMailValues, isUuid, parseMailReadCursor, parseMailSearchQuery, parseSmartInboxFeedbackInput, parseSenderScreeningDomainBlockInput, parseSenderScreeningSenderDecisionInput, parseSenderScreeningBulkInput, parseGatekeeperSettingsInput, isSmartInboxFeedbackAction } from "./router-mail-parsers.js";
import { parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString } from "./router-account-compose-inputs.js";
import { writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-response-utils.js";

export function parseOAuthStartInput(body: string): {
  redirectUri: string;
  loginHint?: string;
} {
  const payload = JSON.parse(body) as {
    redirectUri?: unknown;
    loginHint?: unknown;
  };
  if (!isNonEmptyString(payload.redirectUri)) {
    throw new InvalidOAuthRequestError("invalid_oauth_start", 400);
  }

  return {
    redirectUri: payload.redirectUri,
    ...(isNonEmptyString(payload.loginHint)
      ? { loginHint: payload.loginHint }
      : {}),
  };
}

export function parseOAuthCallbackInput(requestUrl: string | undefined): {
  state: string;
  code: string;
} {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!isNonEmptyString(state) || !isNonEmptyString(code)) {
    throw new InvalidOAuthRequestError("invalid_oauth_callback", 400);
  }

  return { state, code };
}

export function parseHermesSkillRunAccountId(
  payloadAccountId: unknown,
  routeAccountId: string | undefined,
  errorCode: InvalidOAuthRequestError["code"],
): string | undefined {
  if (payloadAccountId === undefined) {
    return routeAccountId;
  }
  if (!isNonEmptyString(payloadAccountId)) {
    throw new InvalidOAuthRequestError(errorCode, 400);
  }

  const accountId = payloadAccountId.trim();
  if (routeAccountId && accountId !== routeAccountId) {
    throw new InvalidOAuthRequestError(errorCode, 400);
  }

  return accountId;
}

export function parseHermesTranslateInput(
  body: string,
  routeAccountId?: string,
): {
  accountId?: string;
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
  tone?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    text?: unknown;
    targetLanguage?: unknown;
    sourceLanguage?: unknown;
    tone?: unknown;
    accountId?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.text)) {
    throw new InvalidOAuthRequestError("invalid_translation_request", 400);
  }
  if (!isNonEmptyString(payload.targetLanguage)) {
    throw new InvalidOAuthRequestError("invalid_translation_request", 400);
  }

  const accountId = parseHermesSkillRunAccountId(
    payload.accountId,
    routeAccountId,
    "invalid_translation_request",
  );

  return {
    ...(accountId ? { accountId } : {}),
    text: payload.text,
    targetLanguage: payload.targetLanguage,
    ...(isNonEmptyString(payload.sourceLanguage)
      ? { sourceLanguage: payload.sourceLanguage }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_translation_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_translation_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_translation_request",
    ),
  };
}

export function parseHermesMessageTranslationInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  targetLanguage: string;
  sourceLanguage?: string;
  tone?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  forceRefresh?: boolean;
} {
  const payload = JSON.parse(body) as {
    targetLanguage?: unknown;
    sourceLanguage?: unknown;
    tone?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
    forceRefresh?: unknown;
  };
  rejectHermesMessageTranslationClientContext(payload);
  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(messageId) ||
    !isNonEmptyString(payload.targetLanguage)
  ) {
    throw new InvalidHermesMessageTranslationRequestError();
  }
  if (
    payload.forceRefresh !== undefined &&
    typeof payload.forceRefresh !== "boolean"
  ) {
    throw new InvalidHermesMessageTranslationRequestError();
  }

  return {
    accountId,
    messageId,
    targetLanguage: payload.targetLanguage,
    ...(isNonEmptyString(payload.sourceLanguage)
      ? { sourceLanguage: payload.sourceLanguage }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...parseOptionalHermesMessageTranslationArray(payload.memoryIds, "memoryIds"),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalHermesMessageTranslationArray(
      payload.memoryLayers,
      "memoryLayers",
    ),
    ...(payload.forceRefresh ? { forceRefresh: true } : {}),
  };
}

export function rejectHermesMessageTranslationClientContext(
  payload: Record<string, unknown>,
): void {
  const disallowedFields = [
    "text",
    "bodyText",
    "bodyHtml",
    "subject",
    "threadText",
    "readMessageIds",
  ];
  if (
    disallowedFields.some((field) =>
      Object.prototype.hasOwnProperty.call(payload, field),
    )
  ) {
    throw new InvalidHermesMessageTranslationRequestError();
  }
}

export function parseHermesMessageSummaryInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  mode?: "short" | "detailed" | "action_points";
  focus?: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
  forceRefresh?: boolean;
} {
  const payload = JSON.parse(body) as {
    mode?: unknown;
    focus?: unknown;
    language?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
    forceRefresh?: unknown;
  };
  if (!isNonEmptyString(accountId) || !isNonEmptyString(messageId)) {
    throw new InvalidHermesMessageSummaryRequestError();
  }
  if (
    payload.mode !== undefined &&
    !isHermesThreadSummaryMode(payload.mode)
  ) {
    throw new InvalidHermesMessageSummaryRequestError();
  }
  if (
    payload.forceRefresh !== undefined &&
    typeof payload.forceRefresh !== "boolean"
  ) {
    throw new InvalidHermesMessageSummaryRequestError();
  }

  return {
    accountId,
    messageId,
    ...(payload.mode ? { mode: payload.mode } : {}),
    ...(isNonEmptyString(payload.focus) ? { focus: payload.focus } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalHermesMessageSummaryArray(payload.memoryIds, "memoryIds"),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalHermesMessageSummaryArray(
      payload.memoryLayers,
      "memoryLayers",
    ),
    ...(payload.forceRefresh ? { forceRefresh: true } : {}),
  };
}

export function parseHermesMessageReplyDraftInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  instruction?: string;
  tone?: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    readMessageIds?: unknown;
    instruction?: unknown;
    tone?: unknown;
    language?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(accountId) || !isNonEmptyString(messageId)) {
    throw new InvalidHermesMessageReplyRequestError();
  }
  if (
    payload.subject !== undefined ||
    payload.threadText !== undefined ||
    payload.readMessageIds !== undefined
  ) {
    throw new InvalidHermesMessageReplyRequestError();
  }

  return {
    accountId,
    messageId,
    ...(isNonEmptyString(payload.instruction)
      ? { instruction: payload.instruction }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalHermesMessageReplyArray(payload.memoryIds, "memoryIds"),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalHermesMessageReplyArray(
      payload.memoryLayers,
      "memoryLayers",
    ),
  };
}

export function parseHermesMessageQuickReplyInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  scenario: "confirm" | "decline" | "thanks" | "follow_up" | "custom";
  instruction?: string;
  tone?: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    readMessageIds?: unknown;
    scenario?: unknown;
    instruction?: unknown;
    tone?: unknown;
    language?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(messageId) ||
    !isHermesQuickReplyScenario(payload.scenario)
  ) {
    throw new InvalidHermesMessageReplyRequestError();
  }
  if (
    payload.subject !== undefined ||
    payload.threadText !== undefined ||
    payload.readMessageIds !== undefined
  ) {
    throw new InvalidHermesMessageReplyRequestError();
  }

  return {
    accountId,
    messageId,
    scenario: payload.scenario,
    ...(isNonEmptyString(payload.instruction)
      ? { instruction: payload.instruction }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalHermesMessageReplyArray(payload.memoryIds, "memoryIds"),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalHermesMessageReplyArray(
      payload.memoryLayers,
      "memoryLayers",
    ),
  };
}

export function parseHermesMessageOrganizationInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    senderEmail?: unknown;
    currentBucket?: unknown;
    currentScore?: unknown;
    currentReasons?: unknown;
    currentLabels?: unknown;
    availableLabels?: unknown;
    readMessageIds?: unknown;
    language?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(accountId) || !isNonEmptyString(messageId)) {
    throw new InvalidHermesMessageOrganizationRequestError();
  }
  if (
    payload.subject !== undefined ||
    payload.threadText !== undefined ||
    payload.senderEmail !== undefined ||
    payload.currentBucket !== undefined ||
    payload.currentScore !== undefined ||
    payload.currentReasons !== undefined ||
    payload.currentLabels !== undefined ||
    payload.availableLabels !== undefined ||
    payload.readMessageIds !== undefined
  ) {
    throw new InvalidHermesMessageOrganizationRequestError();
  }

  return {
    accountId,
    messageId,
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalHermesMessageOrganizationArray(
      payload.memoryIds,
      "memoryIds",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalHermesMessageOrganizationArray(
      payload.memoryLayers,
      "memoryLayers",
    ),
  };
}

export function parseHermesMessageFollowupInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  language?: string;
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    userEmail?: unknown;
    participants?: unknown;
    now?: unknown;
    readMessageIds?: unknown;
    language?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(accountId) || !isNonEmptyString(messageId)) {
    throw new InvalidHermesMessageFollowupRequestError();
  }
  if (
    payload.subject !== undefined ||
    payload.threadText !== undefined ||
    payload.userEmail !== undefined ||
    payload.participants !== undefined ||
    payload.now !== undefined ||
    payload.readMessageIds !== undefined
  ) {
    throw new InvalidHermesMessageFollowupRequestError();
  }

  return {
    accountId,
    messageId,
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalHermesMessageFollowupArray(payload.memoryIds, "memoryIds"),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalHermesMessageFollowupArray(
      payload.memoryLayers,
      "memoryLayers",
    ),
  };
}

export function parseHermesReplyDraftInput(body: string): {
  subject?: string;
  threadText: string;
  instruction?: string;
  tone?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    instruction?: unknown;
    tone?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError("invalid_reply_draft_request", 400);
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(isNonEmptyString(payload.instruction)
      ? { instruction: payload.instruction }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_reply_draft_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_reply_draft_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_reply_draft_request",
    ),
  };
}

export function parseHermesQuickReplyInput(body: string): {
  subject?: string;
  threadText: string;
  scenario: "confirm" | "decline" | "thanks" | "follow_up" | "custom";
  instruction?: string;
  tone?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    scenario?: unknown;
    instruction?: unknown;
    tone?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText) || !isHermesQuickReplyScenario(payload.scenario)) {
    throw new InvalidOAuthRequestError("invalid_quick_reply_request", 400);
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    scenario: payload.scenario,
    ...(isNonEmptyString(payload.instruction)
      ? { instruction: payload.instruction }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_quick_reply_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_quick_reply_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_quick_reply_request",
    ),
  };
}

export function parseHermesRewritePolishInput(
  body: string,
  routeAccountId?: string,
): {
  accountId?: string;
  text: string;
  action: "rewrite" | "polish" | "shorten" | "expand" | "tone" | "proofread";
  instruction?: string;
  tone?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    text?: unknown;
    action?: unknown;
    instruction?: unknown;
    tone?: unknown;
    language?: unknown;
    accountId?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (
    !isNonEmptyString(payload.text) ||
    !isHermesRewritePolishAction(payload.action)
  ) {
    throw new InvalidOAuthRequestError("invalid_rewrite_polish_request", 400);
  }

  const accountId = parseHermesSkillRunAccountId(
    payload.accountId,
    routeAccountId,
    "invalid_rewrite_polish_request",
  );

  return {
    ...(accountId ? { accountId } : {}),
    text: payload.text,
    action: payload.action,
    ...(isNonEmptyString(payload.instruction)
      ? { instruction: payload.instruction }
      : {}),
    ...(isNonEmptyString(payload.tone) ? { tone: payload.tone } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_rewrite_polish_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_rewrite_polish_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_rewrite_polish_request",
    ),
  };
}

export function isHermesQuickReplyScenario(
  value: unknown,
): value is "confirm" | "decline" | "thanks" | "follow_up" | "custom" {
  return (
    value === "confirm" ||
    value === "decline" ||
    value === "thanks" ||
    value === "follow_up" ||
    value === "custom"
  );
}

export function isHermesRewritePolishAction(
  value: unknown,
): value is "rewrite" | "polish" | "shorten" | "expand" | "tone" | "proofread" {
  return (
    value === "rewrite" ||
    value === "polish" ||
    value === "shorten" ||
    value === "expand" ||
    value === "tone" ||
    value === "proofread"
  );
}

export function parseHermesThreadSummaryInput(body: string): {
  subject?: string;
  threadText: string;
  mode?: "short" | "detailed" | "action_points";
  focus?: string;
  language?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    mode?: unknown;
    focus?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError("invalid_thread_summary_request", 400);
  }
  if (
    payload.mode !== undefined &&
    !isHermesThreadSummaryMode(payload.mode)
  ) {
    throw new InvalidOAuthRequestError("invalid_thread_summary_request", 400);
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(payload.mode ? { mode: payload.mode } : {}),
    ...(isNonEmptyString(payload.focus) ? { focus: payload.focus } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_thread_summary_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_thread_summary_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_thread_summary_request",
    ),
  };
}

export function isHermesThreadSummaryMode(
  value: unknown,
): value is "short" | "detailed" | "action_points" {
  return value === "short" || value === "detailed" || value === "action_points";
}

export function parseHermesActionItemExtractInput(body: string): {
  subject?: string;
  threadText: string;
  language?: string;
  now?: string;
  readMessageIds?: string[];
  memoryIds?: string[];
  memoryScope?: string;
  memoryLayers?: string[];
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    language?: unknown;
    now?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError(
      "invalid_action_item_extract_request",
      400,
    );
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...(isNonEmptyString(payload.now) ? { now: payload.now } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_action_item_extract_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_action_item_extract_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_action_item_extract_request",
    ),
  };
}

export function parseHermesLabelSuggestInput(body: string): {
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
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    senderEmail?: unknown;
    currentLabels?: unknown;
    availableLabels?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError("invalid_label_suggest_request", 400);
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(isNonEmptyString(payload.senderEmail)
      ? { senderEmail: payload.senderEmail }
      : {}),
    ...parseOptionalStringArray(
      payload.currentLabels,
      "currentLabels",
      "invalid_label_suggest_request",
    ),
    ...parseOptionalStringArray(
      payload.availableLabels,
      "availableLabels",
      "invalid_label_suggest_request",
    ),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_label_suggest_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_label_suggest_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_label_suggest_request",
    ),
  };
}

export function parseHermesNewsletterCleanupInput(body: string): {
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
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    senderEmail?: unknown;
    listId?: unknown;
    currentBucket?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError(
      "invalid_newsletter_cleanup_request",
      400,
    );
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(isNonEmptyString(payload.senderEmail)
      ? { senderEmail: payload.senderEmail }
      : {}),
    ...(isNonEmptyString(payload.listId) ? { listId: payload.listId } : {}),
    ...(isNonEmptyString(payload.currentBucket)
      ? { currentBucket: payload.currentBucket }
      : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_newsletter_cleanup_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_newsletter_cleanup_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_newsletter_cleanup_request",
    ),
  };
}

export function parseHermesPriorityTriageInput(body: string): {
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
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    senderEmail?: unknown;
    currentBucket?: unknown;
    currentScore?: unknown;
    currentReasons?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError("invalid_priority_triage_request", 400);
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(isNonEmptyString(payload.senderEmail)
      ? { senderEmail: payload.senderEmail }
      : {}),
    ...(isNonEmptyString(payload.currentBucket)
      ? { currentBucket: payload.currentBucket }
      : {}),
    ...(payload.currentScore !== undefined
      ? { currentScore: parsePriorityTriageScore(payload.currentScore) }
      : {}),
    ...parseOptionalStringArray(
      payload.currentReasons,
      "currentReasons",
      "invalid_priority_triage_request",
    ),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_priority_triage_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_priority_triage_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_priority_triage_request",
    ),
  };
}

export function parsePriorityTriageScore(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new InvalidOAuthRequestError("invalid_priority_triage_request", 400);
  }

  return value;
}

export function parseHermesFollowupTrackerInput(body: string): {
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
} {
  const payload = JSON.parse(body) as {
    subject?: unknown;
    threadText?: unknown;
    userEmail?: unknown;
    participants?: unknown;
    now?: unknown;
    language?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.threadText)) {
    throw new InvalidOAuthRequestError("invalid_followup_tracker_request", 400);
  }

  return {
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    threadText: payload.threadText,
    ...(isNonEmptyString(payload.userEmail)
      ? { userEmail: payload.userEmail }
      : {}),
    ...parseOptionalStringArray(
      payload.participants,
      "participants",
      "invalid_followup_tracker_request",
    ),
    ...(isNonEmptyString(payload.now) ? { now: payload.now } : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_followup_tracker_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_followup_tracker_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_followup_tracker_request",
    ),
  };
}

export function parseHermesFollowUpConfirmationInput(body: string): {
  accountId: string;
  messageId: string;
  skillRunId: string;
  status: HermesFollowUpReminderStatus;
  dueAt: string;
  title?: string;
  nextAction?: string;
  reasons?: string[];
  sourceQuote?: string;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    messageId?: unknown;
    skillRunId?: unknown;
    status?: unknown;
    dueAt?: unknown;
    title?: unknown;
    nextAction?: unknown;
    reasons?: unknown;
    sourceQuote?: unknown;
  };

  if (
    !isNonEmptyString(payload.accountId) ||
    !isNonEmptyString(payload.messageId) ||
    !isNonEmptyString(payload.skillRunId) ||
    !isActionableHermesFollowUpStatus(payload.status) ||
    !isNonEmptyString(payload.dueAt)
  ) {
    throw new InvalidHermesFollowUpReminderRequestError();
  }

  return {
    accountId: payload.accountId,
    messageId: payload.messageId,
    skillRunId: payload.skillRunId,
    status: payload.status,
    dueAt: payload.dueAt,
    ...(isNonEmptyString(payload.title) ? { title: payload.title } : {}),
    ...(isNonEmptyString(payload.nextAction)
      ? { nextAction: payload.nextAction }
      : {}),
    ...parseHermesFollowUpReasons(payload.reasons),
    ...(isNonEmptyString(payload.sourceQuote)
      ? { sourceQuote: payload.sourceQuote }
      : {}),
  };
}

export function parseHermesTranslationPreferenceInput(body: string): {
  accountId: string;
  mode: HermesTranslationPreferenceMode;
  sourceLanguage: string;
  targetLanguage?: string;
  memoryScope?: string;
  reason?: string;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    mode?: unknown;
    sourceLanguage?: unknown;
    targetLanguage?: unknown;
    memoryScope?: unknown;
    reason?: unknown;
  };

  const accountId = parseTranslationPreferenceText(payload.accountId, 128);
  if (!isHermesTranslationPreferenceMode(payload.mode)) {
    throw new InvalidTranslationPreferenceRequestError();
  }

  const sourceLanguage = parseTranslationPreferenceText(payload.sourceLanguage);
  const targetLanguage =
    payload.targetLanguage === undefined
      ? undefined
      : parseTranslationPreferenceText(payload.targetLanguage);

  if (payload.mode === "always" && !targetLanguage) {
    throw new InvalidTranslationPreferenceRequestError();
  }

  return {
    accountId,
    mode: payload.mode,
    sourceLanguage,
    ...(targetLanguage ? { targetLanguage } : {}),
    ...(payload.memoryScope !== undefined
      ? { memoryScope: parseTranslationPreferenceText(payload.memoryScope) }
      : {}),
    ...(payload.reason !== undefined
      ? { reason: parseTranslationPreferenceText(payload.reason, 240) }
      : {}),
  };
}

export function isHermesTranslationPreferenceMode(
  value: unknown,
): value is HermesTranslationPreferenceMode {
  return value === "always" || value === "never";
}

export function parseTranslationPreferenceText(value: unknown, maxLength = 64): string {
  if (!isNonEmptyString(value)) {
    throw new InvalidTranslationPreferenceRequestError();
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidTranslationPreferenceRequestError();
  }

  return trimmed;
}

export function isActionableHermesFollowUpStatus(
  value: unknown,
): value is "needs_reply" | "waiting_on_them" {
  return value === "needs_reply" || value === "waiting_on_them";
}

export function parseHermesFollowUpReasons(
  value: unknown,
): { reasons?: string[] } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new InvalidHermesFollowUpReminderRequestError();
  }
  const reasons = value
    .filter((item): item is string => isNonEmptyString(item))
    .map((item) => item.trim());

  if (reasons.length !== value.length) {
    throw new InvalidHermesFollowUpReminderRequestError();
  }

  return { reasons };
}

export function parseHermesDraftFeedbackInput(body: string): {
  skillRunId: string;
  draftText: string;
  finalText: string;
  subject?: string;
  recipientEmail?: string;
} {
  const payload = JSON.parse(body) as {
    skillRunId?: unknown;
    draftText?: unknown;
    finalText?: unknown;
    subject?: unknown;
    recipientEmail?: unknown;
  };
  if (
    !isNonEmptyString(payload.skillRunId) ||
    !isNonEmptyString(payload.draftText) ||
    !isNonEmptyString(payload.finalText)
  ) {
    throw new InvalidHermesDraftFeedbackRequestError();
  }

  return {
    skillRunId: payload.skillRunId,
    draftText: payload.draftText,
    finalText: payload.finalText,
    ...(isNonEmptyString(payload.subject) ? { subject: payload.subject } : {}),
    ...(isNonEmptyString(payload.recipientEmail)
      ? { recipientEmail: payload.recipientEmail }
      : {}),
  };
}

export function parseHermesMemoryListInput(requestUrl: string | undefined): {
  accountId: string;
  layer?: string;
  scope?: string;
  limit: number;
} {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const accountId = parseHermesMemoryAccountId(requestUrl);
  const layer = parseOptionalHermesMemoryFilter(url.searchParams.get("layer"));
  const scope = parseOptionalHermesMemoryFilter(url.searchParams.get("scope"));
  return {
    accountId,
    ...(layer ? { layer } : {}),
    ...(scope ? { scope } : {}),
    limit: parseHermesMemoryLimit(url.searchParams.get("limit")),
  };
}

export function parseHermesMemoryAccountId(requestUrl: string | undefined): string {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const accountId = url.searchParams.get("accountId");
  if (!isNonEmptyString(accountId)) {
    throw new InvalidHermesMemoryRequestError();
  }

  const trimmed = accountId.trim();
  if (trimmed.length > 128 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidHermesMemoryRequestError();
  }

  return trimmed;
}

export function parseHermesMemoryPatchInput(body: string): {
  content?: Record<string, unknown>;
  confidence?: number;
} {
  const payload = JSON.parse(body) as {
    content?: unknown;
    confidence?: unknown;
  };
  const output: {
    content?: Record<string, unknown>;
    confidence?: number;
  } = {};

  if (payload.content !== undefined) {
    if (
      !payload.content ||
      typeof payload.content !== "object" ||
      Array.isArray(payload.content)
    ) {
      throw new InvalidHermesMemoryRequestError();
    }
    output.content = payload.content as Record<string, unknown>;
  }

  if (payload.confidence !== undefined) {
    if (
      typeof payload.confidence !== "number" ||
      !Number.isFinite(payload.confidence) ||
      payload.confidence < 0 ||
      payload.confidence > 1
    ) {
      throw new InvalidHermesMemoryRequestError();
    }
    output.confidence = payload.confidence;
  }

  if (output.content === undefined && output.confidence === undefined) {
    throw new InvalidHermesMemoryRequestError();
  }

  return output;
}

export function parseOptionalHermesMemoryFilter(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 64 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidHermesMemoryRequestError();
  }

  return trimmed;
}

export function parseHermesMemoryLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidHermesMemoryRequestError();
  }

  return parsed;
}

export function parseHermesRuleSuggestInput(body: string): {
  accountId: string;
  behaviorWindowDays?: number;
  minEvidenceCount?: number;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    behaviorWindowDays?: unknown;
    minEvidenceCount?: unknown;
  };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    ...parseOptionalHermesRuleInteger(
      payload.behaviorWindowDays,
      "behaviorWindowDays",
      1,
      365,
    ),
    ...parseOptionalHermesRuleInteger(
      payload.minEvidenceCount,
      "minEvidenceCount",
      2,
      20,
    ),
  };
}

export function parseHermesActionPlanCreateInput(body: string): {
  accountId: string;
  command?: string;
  candidateId?: string;
  sampleLimit?: number;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    command?: unknown;
    candidateId?: unknown;
    sampleLimit?: unknown;
  };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesActionPlanRequestError();
  }
  if (payload.command !== undefined && typeof payload.command !== "string") {
    throw new InvalidHermesActionPlanRequestError();
  }
  if (payload.candidateId !== undefined && !isNonEmptyString(payload.candidateId)) {
    throw new InvalidHermesActionPlanRequestError();
  }
  const command = payload.command?.trim();
  if (!command && !payload.candidateId) {
    throw new InvalidHermesActionPlanRequestError();
  }
  if (command) {
    if (
      command.length < 2 ||
      command.length > 500 ||
      /[\u0000-\u001F\u007F]/.test(command)
    ) {
      throw new InvalidHermesActionPlanRequestError();
    }
  }

  return {
    accountId: payload.accountId,
    ...(command ? { command } : {}),
    ...(isNonEmptyString(payload.candidateId)
      ? { candidateId: payload.candidateId }
      : {}),
    ...parseOptionalHermesActionPlanInteger(
      payload.sampleLimit,
      "sampleLimit",
      1,
      100,
    ),
  };
}

export function parseHermesActionPlanConfirmInput(
  planId: string,
  body: string,
): {
  planId: string;
  accountId: string;
  candidateId: string;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    candidateId?: unknown;
  };
  if (
    !isNonEmptyString(planId) ||
    !isNonEmptyString(payload.accountId) ||
    !isNonEmptyString(payload.candidateId)
  ) {
    throw new InvalidHermesActionPlanRequestError();
  }

  return {
    planId,
    accountId: payload.accountId,
    candidateId: payload.candidateId,
  };
}

export function parseHermesRuleDraftInput(body: string): {
  accountId: string;
  command: string;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    command?: unknown;
  };
  if (!isNonEmptyString(payload.accountId) || typeof payload.command !== "string") {
    throw new InvalidHermesRuleRequestError();
  }
  const command = payload.command.trim();
  if (
    command.length < 2 ||
    command.length > 500 ||
    /[\u0000-\u001F\u007F]/.test(command)
  ) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    command,
  };
}

export function parseHermesRuleSimulationInput(
  candidateId: string,
  body: string,
): {
  accountId: string;
  candidateId: string;
  sampleLimit?: number;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    sampleLimit?: unknown;
  };
  if (!isNonEmptyString(candidateId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    candidateId,
    ...parseOptionalHermesRuleInteger(
      payload.sampleLimit,
      "sampleLimit",
      1,
      100,
    ),
  };
}

export function parseHermesRuleUpdateInput(
  ruleId: string,
  body: string,
): {
  accountId: string;
  ruleId: string;
  enabled?: boolean;
  sortOrder?: number;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    enabled?: unknown;
    sortOrder?: unknown;
  };
  if (!isNonEmptyString(ruleId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }
  if (
    payload.enabled !== undefined &&
    typeof payload.enabled !== "boolean"
  ) {
    throw new InvalidHermesRuleRequestError();
  }
  if (
    payload.sortOrder !== undefined &&
    (!Number.isInteger(payload.sortOrder) ||
      (payload.sortOrder as number) < 0 ||
      (payload.sortOrder as number) > 1_000_000)
  ) {
    throw new InvalidHermesRuleRequestError();
  }
  if (payload.enabled === undefined && payload.sortOrder === undefined) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    ruleId,
    ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
    ...(payload.sortOrder !== undefined
      ? { sortOrder: payload.sortOrder as number }
      : {}),
  };
}

export function parseHermesRuleCandidateUpdateInput(
  candidateId: string,
  body: string,
): {
  accountId: string;
  candidateId: string;
  title?: string;
  labelName?: string;
  labelColor?: LabelColor;
  keywords?: string[];
  applyToHistory?: boolean;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    title?: unknown;
    labelName?: unknown;
    labelColor?: unknown;
    keywords?: unknown;
    applyToHistory?: unknown;
  };
  if (!isNonEmptyString(candidateId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    candidateId,
    ...parseOptionalHermesRuleTextPatch(payload.title, "title"),
    ...parseOptionalHermesRuleTextPatch(payload.labelName, "labelName"),
    ...parseOptionalHermesRuleLabelColor(payload.labelColor),
    ...parseOptionalHermesRuleKeywords(payload.keywords),
    ...parseOptionalHermesRuleBooleanPatch(
      payload.applyToHistory,
      "applyToHistory",
    ),
  };
}

export function parseHermesRuleCandidateDismissInput(
  candidateId: string,
  body: string,
): {
  accountId: string;
  candidateId: string;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
  };
  if (!isNonEmptyString(candidateId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    candidateId,
  };
}

export function parseHermesRuleRunInput(
  ruleId: string,
  body: string,
): {
  accountId: string;
  ruleId: string;
  limit?: number;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    limit?: unknown;
  };
  if (!isNonEmptyString(ruleId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    ruleId,
    ...parseOptionalHermesRuleInteger(payload.limit, "limit", 1, 10000),
  };
}

export function parseOptionalHermesActionPlanInteger<
  K extends string,
>(
  value: unknown,
  key: K,
  min: number,
  max: number,
): Partial<Record<K, number>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new InvalidHermesActionPlanRequestError();
  }
  if (value < min || value > max) {
    throw new InvalidHermesActionPlanRequestError();
  }
  return { [key]: value } as Partial<Record<K, number>>;
}

export function parseHermesRuleListInput(requestUrl: string | undefined): {
  accountId: string;
  enabled?: boolean;
  limit: number;
} {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const accountId = url.searchParams.get("accountId");
  if (!isNonEmptyString(accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  const enabled = parseOptionalHermesRuleBoolean(
    url.searchParams.get("enabled"),
  );
  return {
    accountId,
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    limit: parseHermesRuleLimit(url.searchParams.get("limit")),
  };
}

export function parseHermesRuleExecutionListInput(requestUrl: string | undefined): {
  accountId: string;
  ruleId?: string;
  limit: number;
} {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const accountId = url.searchParams.get("accountId");
  if (!isNonEmptyString(accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  const ruleId = url.searchParams.get("ruleId");
  if (ruleId !== null && !isNonEmptyString(ruleId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId,
    ...(ruleId ? { ruleId } : {}),
    limit: parseHermesRuleLimit(url.searchParams.get("limit")),
  };
}

export function parseHermesRuleCandidateListInput(requestUrl: string | undefined): {
  accountId: string;
  status?: "shadow" | "approved" | "dismissed";
  limit: number;
} {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const accountId = url.searchParams.get("accountId");
  if (!isNonEmptyString(accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  const status = parseOptionalHermesRuleCandidateStatus(
    url.searchParams.get("status"),
  );
  return {
    accountId,
    ...(status ? { status } : {}),
    limit: parseHermesRuleLimit(url.searchParams.get("limit")),
  };
}

export function parseOptionalHermesRuleCandidateStatus(
  value: string | null,
): "shadow" | "approved" | "dismissed" | undefined {
  if (value === null) {
    return undefined;
  }
  if (value === "shadow" || value === "approved" || value === "dismissed") {
    return value;
  }

  throw new InvalidHermesRuleRequestError();
}

export function parseOptionalHermesRuleInteger<
  Key extends "behaviorWindowDays" | "minEvidenceCount" | "sampleLimit" | "limit",
>(
  value: unknown,
  key: Key,
  min: number,
  max: number,
): Partial<Record<Key, number>> {
  if (value === undefined) {
    return {};
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new InvalidHermesRuleRequestError();
  }

  return { [key]: value } as Partial<Record<Key, number>>;
}

export function parseOptionalHermesRuleTextPatch<
  Key extends "title" | "labelName",
>(value: unknown, key: Key): Partial<Record<Key, string>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string") {
    throw new InvalidHermesRuleRequestError();
  }
  return { [key]: value } as Partial<Record<Key, string>>;
}

export function parseOptionalHermesRuleLabelColor(value: unknown): {
  labelColor?: LabelColor;
} {
  if (value === undefined) {
    return {};
  }
  if (
    value === "coral" ||
    value === "blue" ||
    value === "green" ||
    value === "yellow" ||
    value === "purple" ||
    value === "mint"
  ) {
    return { labelColor: value };
  }

  throw new InvalidHermesRuleRequestError();
}

export function parseOptionalHermesRuleBooleanPatch<
  Key extends "applyToHistory",
>(value: unknown, key: Key): Partial<Record<Key, boolean>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "boolean") {
    throw new InvalidHermesRuleRequestError();
  }
  return { [key]: value } as Partial<Record<Key, boolean>>;
}

export function parseOptionalHermesRuleKeywords(value: unknown): {
  keywords?: string[];
} {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new InvalidHermesRuleRequestError();
  }
  if (!value.every((item) => typeof item === "string")) {
    throw new InvalidHermesRuleRequestError();
  }
  return { keywords: value };
}

export function parseOptionalHermesRuleBoolean(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  throw new InvalidHermesRuleRequestError();
}

export function parseHermesRuleLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidHermesRuleRequestError();
  }

  return parsed;
}

export function parseOptionalStringArray(
  value: unknown,
  key:
    | "readMessageIds"
    | "memoryIds"
    | "memoryLayers"
    | "currentLabels"
    | "availableLabels"
    | "currentReasons"
    | "participants",
  errorCode: string,
): Partial<
  Record<
    | "readMessageIds"
    | "memoryIds"
    | "memoryLayers"
    | "currentLabels"
    | "availableLabels"
    | "currentReasons"
    | "participants",
    string[]
  >
> {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidOAuthRequestError(errorCode, 400);
  }

  return { [key]: value };
}

export function parseOptionalHermesMessageTranslationArray(
  value: unknown,
  key: "memoryIds" | "memoryLayers",
): Partial<Record<"memoryIds" | "memoryLayers", string[]>> {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidHermesMessageTranslationRequestError();
  }

  return { [key]: value };
}

export function parseOptionalHermesMessageSummaryArray(
  value: unknown,
  key: "memoryIds" | "memoryLayers",
): Partial<Record<"memoryIds" | "memoryLayers", string[]>> {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidHermesMessageSummaryRequestError();
  }

  return { [key]: value };
}

export function parseOptionalHermesMessageReplyArray(
  value: unknown,
  key: "memoryIds" | "memoryLayers",
): Partial<Record<"memoryIds" | "memoryLayers", string[]>> {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidHermesMessageReplyRequestError();
  }

  return { [key]: value };
}

export function parseOptionalHermesMessageOrganizationArray(
  value: unknown,
  key: "memoryIds" | "memoryLayers",
): Partial<Record<"memoryIds" | "memoryLayers", string[]>> {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidHermesMessageOrganizationRequestError();
  }

  return { [key]: value };
}

export function parseOptionalHermesMessageFollowupArray(
  value: unknown,
  key: "memoryIds" | "memoryLayers",
): Partial<Record<"memoryIds" | "memoryLayers", string[]>> {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidHermesMessageFollowupRequestError();
  }

  return { [key]: value };
}
