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
import { parseOAuthStartInput, parseOAuthCallbackInput, parseHermesSkillRunAccountId, parseHermesTranslateInput, parseHermesMessageTranslationInput, rejectHermesMessageTranslationClientContext, parseHermesMessageSummaryInput, parseHermesMessageReplyDraftInput, parseHermesMessageQuickReplyInput, parseHermesMessageOrganizationInput, parseHermesMessageFollowupInput, parseHermesReplyDraftInput, parseHermesQuickReplyInput, parseHermesRewritePolishInput, isHermesQuickReplyScenario, isHermesRewritePolishAction, parseHermesThreadSummaryInput, isHermesThreadSummaryMode, parseHermesActionItemExtractInput, parseHermesLabelSuggestInput, parseHermesNewsletterCleanupInput, parseHermesPriorityTriageInput, parsePriorityTriageScore, parseHermesFollowupTrackerInput, parseHermesFollowUpConfirmationInput, parseHermesTranslationPreferenceInput, isHermesTranslationPreferenceMode, parseTranslationPreferenceText, isActionableHermesFollowUpStatus, parseHermesFollowUpReasons, parseHermesDraftFeedbackInput, parseHermesMemoryListInput, parseHermesMemoryAccountId, parseHermesMemoryPatchInput, parseOptionalHermesMemoryFilter, parseHermesMemoryLimit, parseHermesRuleSuggestInput, parseHermesActionPlanCreateInput, parseHermesActionPlanConfirmInput, parseHermesRuleDraftInput, parseHermesRuleSimulationInput, parseHermesRuleUpdateInput, parseHermesRuleCandidateUpdateInput, parseHermesRuleCandidateDismissInput, parseHermesRuleRunInput, parseOptionalHermesActionPlanInteger, parseHermesRuleListInput, parseHermesRuleExecutionListInput, parseHermesRuleCandidateListInput, parseOptionalHermesRuleCandidateStatus, parseOptionalHermesRuleInteger, parseOptionalHermesRuleTextPatch, parseOptionalHermesRuleLabelColor, parseOptionalHermesRuleBooleanPatch, parseOptionalHermesRuleKeywords, parseOptionalHermesRuleBoolean, parseHermesRuleLimit, parseOptionalStringArray, parseOptionalHermesMessageTranslationArray, parseOptionalHermesMessageSummaryArray, parseOptionalHermesMessageReplyArray, parseOptionalHermesMessageOrganizationArray, parseOptionalHermesMessageFollowupArray } from "./router-hermes-inputs.js";
import { writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-response-utils.js";

export function parseImapSmtpOnboardingInput(
  body: string,
): ImapSmtpOnboardingInput {
  return parseImapSmtpAccountInput(body, "invalid_imap_smtp_account");
}

export function parseImapSmtpConnectionTestInput(
  body: string,
): ImapSmtpOnboardingInput {
  return parseImapSmtpAccountInput(
    body,
    "invalid_imap_smtp_connection_test",
  );
}

export function parseImapSmtpAccountInput(
  body: string,
  errorCode: "invalid_imap_smtp_account" | "invalid_imap_smtp_connection_test",
): ImapSmtpOnboardingInput {
  const payload = JSON.parse(body) as Partial<ImapSmtpOnboardingInput>;

  if (!isNonEmptyString(payload.email)) {
    throw new InvalidImapSmtpAccountError(errorCode, "email is required");
  }

  if (!isNonEmptyString(payload.provider)) {
    throw new InvalidImapSmtpAccountError(errorCode, "provider is required");
  }

  const provider = normalizeImapSmtpProvider(payload.provider);
  if (hasImapSmtpProviderPreset(provider) && !payload.imap && !payload.smtp) {
    if (!isNonEmptyString(payload.secret)) {
      throw new InvalidImapSmtpAccountError(errorCode, "secret is required");
    }

    return {
      email: payload.email,
      provider,
      displayName: isNonEmptyString(payload.displayName)
        ? payload.displayName
        : undefined,
      username: isNonEmptyString(payload.username) ? payload.username : undefined,
      secret: payload.secret,
    };
  }

  return {
    email: payload.email,
    provider,
    displayName: isNonEmptyString(payload.displayName)
      ? payload.displayName
      : undefined,
    imap: parseEndpoint(payload.imap, "imap", errorCode),
    smtp: parseEndpoint(payload.smtp, "smtp", errorCode),
  };
}

export function parseMailComposeDraftInput(
  accountId: string,
  body: string,
): CreateMailDraftInput;
export function parseMailComposeDraftInput(
  accountId: string,
  body: string,
  draftId: string,
): UpdateMailDraftInput;
export function parseMailComposeDraftInput(
  accountId: string,
  body: string,
  draftId?: string,
): CreateMailDraftInput | UpdateMailDraftInput {
  const payload = JSON.parse(body) as {
    from?: unknown;
    fromAddress?: unknown;
    fromName?: unknown;
    to?: unknown;
    cc?: unknown;
    bcc?: unknown;
    subject?: unknown;
    bodyText?: unknown;
    bodyHtml?: unknown;
    source?: unknown;
    replyToMessageId?: unknown;
    sourceMessageId?: unknown;
    attachments?: unknown;
    hermesSkillRunId?: unknown;
    hermesDraftText?: unknown;
  };

  const to = parseMailComposeAddresses(payload.to, true);
  const from = parseMailComposeFrom(payload);
  return {
    accountId,
    ...(draftId ? { draftId } : {}),
    ...(from ? { from } : {}),
    to,
    cc: parseMailComposeAddresses(payload.cc, false),
    bcc: parseMailComposeAddresses(payload.bcc, false),
    subject: isNonEmptyString(payload.subject) ? payload.subject : "",
    ...(isNonEmptyString(payload.bodyText) ? { bodyText: payload.bodyText } : {}),
    ...(isNonEmptyString(payload.bodyHtml) ? { bodyHtml: payload.bodyHtml } : {}),
    ...(parseMailComposeSource(payload.source)
      ? { source: parseMailComposeSource(payload.source) }
      : {}),
    ...(isNonEmptyString(payload.replyToMessageId)
      ? { replyToMessageId: payload.replyToMessageId }
      : {}),
    ...(isNonEmptyString(payload.sourceMessageId)
      ? { sourceMessageId: payload.sourceMessageId }
      : {}),
    ...(payload.attachments !== undefined
      ? { attachments: parseMailComposeAttachments(payload.attachments) }
      : {}),
    ...(isNonEmptyString(payload.hermesSkillRunId)
      ? { hermesSkillRunId: payload.hermesSkillRunId }
      : {}),
    ...(isNonEmptyString(payload.hermesDraftText)
      ? { hermesDraftText: payload.hermesDraftText }
      : {}),
  };
}

export function parseScheduledMailComposeDraftInput(
  accountId: string,
  scheduledId: string,
  body: string,
): UpdateScheduledMailDraftInput {
  return {
    ...parseMailComposeDraftInput(accountId, body),
    scheduledId,
  };
}

export function parseMailComposePreviewInput(
  accountId: string,
  body: string,
): MailComposePreviewInput {
  const payload = JSON.parse(body) as {
    from?: unknown;
    fromAddress?: unknown;
    fromName?: unknown;
    to?: unknown;
    cc?: unknown;
    bcc?: unknown;
    subject?: unknown;
    bodyText?: unknown;
    bodyHtml?: unknown;
    source?: unknown;
    replyToMessageId?: unknown;
    sourceMessageId?: unknown;
    attachments?: unknown;
  };

  const from = parseMailComposeFrom(payload);
  return {
    accountId,
    ...(from ? { from } : {}),
    to: parseMailComposeAddresses(payload.to, false),
    cc: parseMailComposeAddresses(payload.cc, false),
    bcc: parseMailComposeAddresses(payload.bcc, false),
    subject: isNonEmptyString(payload.subject) ? payload.subject : "",
    ...(isNonEmptyString(payload.bodyText) ? { bodyText: payload.bodyText } : {}),
    ...(isNonEmptyString(payload.bodyHtml) ? { bodyHtml: payload.bodyHtml } : {}),
    ...(parseMailComposeSource(payload.source)
      ? { source: parseMailComposeSource(payload.source) }
      : {}),
    ...(isNonEmptyString(payload.replyToMessageId)
      ? { replyToMessageId: payload.replyToMessageId }
      : {}),
    ...(isNonEmptyString(payload.sourceMessageId)
      ? { sourceMessageId: payload.sourceMessageId }
      : {}),
    ...(() => {
      const attachments = parseMailComposeAttachments(payload.attachments);
      return attachments.length > 0 ? { attachments } : {};
    })(),
  };
}

export function parseMailComposeSeedInput(
  accountId: string,
  messageId: string,
  mode: MailComposeSeedMode,
  body: string,
): {
  accountId: string;
  messageId: string;
  mode: MailComposeSeedMode;
  from?: MailAddress;
} {
  const payload = body.trim()
    ? (JSON.parse(body) as {
        from?: unknown;
        fromAddress?: unknown;
        fromName?: unknown;
      })
    : {};
  const from = parseMailComposeFrom(payload);
  return {
    accountId,
    messageId,
    mode,
    ...(from ? { from } : {}),
  };
}

export function parseProviderSendIdentityCandidateInput(
  accountId: string,
  body: string,
): Parameters<MailComposeService["addProviderSendIdentityCandidate"]>[0] {
  const payload = JSON.parse(body) as {
    provider?: unknown;
    address?: unknown;
    email?: unknown;
    name?: unknown;
    displayName?: unknown;
    identityType?: unknown;
  };
  if (payload.provider !== "graph") {
    throw new InvalidMailComposeRequestError("send identity provider is invalid");
  }

  const address = isNonEmptyString(payload.address)
    ? payload.address
    : isNonEmptyString(payload.email)
      ? payload.email
      : undefined;
  if (!address) {
    throw new InvalidMailComposeRequestError("send identity address is required");
  }

  const identityType = parseProviderSendIdentityCandidateType(
    payload.identityType,
  );
  const name = isNonEmptyString(payload.name)
    ? payload.name
    : isNonEmptyString(payload.displayName)
      ? payload.displayName
      : undefined;

  return {
    accountId,
    provider: "graph",
    from: {
      address,
      ...(name ? { name } : {}),
    },
    identityType,
  };
}

export function parseProviderSendIdentityCandidateType(
  value: unknown,
): "shared_mailbox" | "send_on_behalf" | "unknown" {
  if (
    value === "shared_mailbox" ||
    value === "send_on_behalf" ||
    value === "unknown"
  ) {
    return value;
  }

  return "shared_mailbox";
}

export function parseProviderSendIdentityUserTargetInput(
  accountId: string,
  candidateId: string,
  body: string,
): Parameters<MailComposeService["verifyProviderSendIdentityUserTarget"]>[0] {
  const payload = JSON.parse(body) as {
    targetMailbox?: unknown;
    targetMailboxUserPrincipalName?: unknown;
    userPrincipalName?: unknown;
  };
  const targetMailbox = isNonEmptyString(payload.targetMailbox)
    ? payload.targetMailbox
    : isNonEmptyString(payload.targetMailboxUserPrincipalName)
      ? payload.targetMailboxUserPrincipalName
      : isNonEmptyString(payload.userPrincipalName)
        ? payload.userPrincipalName
        : undefined;
  if (!targetMailbox) {
    throw new InvalidMailComposeRequestError(
      "Graph target mailbox is required",
    );
  }

  return {
    accountId,
    candidateId,
    targetMailbox,
  };
}

export function parseComposeAttachmentUploadFilename(request: IncomingMessage): string {
  const header = singleHeader(request.headers["x-emailhub-filename"]);
  if (!header) {
    return "attachment";
  }

  try {
    return decodeURIComponent(header).replace(/[\u0000-\u001f/\\]/g, "_");
  } catch {
    return header.replace(/[\u0000-\u001f/\\]/g, "_");
  }
}

export function parseComposeAttachmentUploadContentType(
  request: IncomingMessage,
): string {
  const header = singleHeader(request.headers["content-type"]);
  const contentType = header?.split(";")[0]?.trim().toLowerCase();
  return contentType?.includes("/")
    ? contentType
    : "application/octet-stream";
}

export function parseContentLength(request: IncomingMessage): number | undefined {
  const header = singleHeader(request.headers["content-length"]);
  if (!header) {
    return undefined;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function parseMailComposeFrom(payload: {
  from?: unknown;
  fromAddress?: unknown;
  fromName?: unknown;
}): MailAddress | undefined {
  if (payload.from && typeof payload.from === "object" && !Array.isArray(payload.from)) {
    const record = payload.from as Record<string, unknown>;
    if (isNonEmptyString(record.address)) {
      return {
        address: record.address,
        ...(isNonEmptyString(record.name) ? { name: record.name } : {}),
      };
    }
  }

  if (!isNonEmptyString(payload.fromAddress)) {
    return undefined;
  }

  return {
    address: payload.fromAddress,
    ...(isNonEmptyString(payload.fromName) ? { name: payload.fromName } : {}),
  };
}

export function parseScheduleDraftInput(
  accountId: string,
  draftId: string,
  body: string,
): { accountId: string; draftId: string; scheduledAt: string } {
  const payload = JSON.parse(body) as { scheduledAt?: unknown };
  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(draftId) ||
    !isNonEmptyString(payload.scheduledAt)
  ) {
    throw new InvalidMailComposeRequestError("scheduled time is required");
  }

  return {
    accountId,
    draftId,
    scheduledAt: payload.scheduledAt,
  };
}

export function parseRescheduleInput(
  accountId: string,
  scheduledId: string,
  body: string,
): { accountId: string; scheduledId: string; scheduledAt: string } {
  const payload = JSON.parse(body) as { scheduledAt?: unknown };
  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(scheduledId) ||
    !isNonEmptyString(payload.scheduledAt)
  ) {
    throw new InvalidMailComposeRequestError("scheduled time is required");
  }

  return {
    accountId,
    scheduledId,
    scheduledAt: payload.scheduledAt,
  };
}

export function parseMailActionInput(
  accountId: string,
  messageId: string,
  body: string,
): MailActionInput {
  const payload = JSON.parse(body) as {
    action?: unknown;
    mailboxId?: unknown;
    labelIds?: unknown;
    undoToken?: unknown;
  };
  const action = parseMailActionName(payload.action);
  if (action === "move") {
    if (!isNonEmptyString(payload.mailboxId)) {
      throw new InvalidMailActionRequestError();
    }
    return {
      accountId,
      messageId,
      action,
      mailboxId: payload.mailboxId,
    };
  }
  if (action === "apply_labels") {
    if (
      !Array.isArray(payload.labelIds) ||
      payload.labelIds.length === 0 ||
      !payload.labelIds.every((item) => isNonEmptyString(item))
    ) {
      throw new InvalidMailActionRequestError();
    }
    return {
      accountId,
      messageId,
      action,
      labelIds: payload.labelIds,
    };
  }
  if (action === "undo_done") {
    if (!isNonEmptyString(payload.undoToken)) {
      throw new InvalidMailActionRequestError();
    }
    return {
      accountId,
      messageId,
      action,
      undoToken: payload.undoToken,
    };
  }

  return { accountId, messageId, action };
}

export function parseUpsertLabelInput(
  accountId: string,
  body: string,
): {
  accountId: string;
  name: string;
  color?: LabelColor;
} {
  const payload = JSON.parse(body) as {
    name?: unknown;
    color?: unknown;
  };
  if (!isNonEmptyString(payload.name)) {
    throw new InvalidLabelRequestError();
  }
  return {
    accountId,
    name: payload.name,
    ...(payload.color === undefined
      ? {}
      : { color: parseLabelColor(payload.color) }),
  };
}

export function parseLabelColor(value: unknown): LabelColor {
  if (
    value === "coral" ||
    value === "blue" ||
    value === "green" ||
    value === "yellow" ||
    value === "purple" ||
    value === "mint"
  ) {
    return value;
  }
  throw new InvalidLabelRequestError();
}

export function parseMailBulkActionInput(
  accountId: string,
  bucket: string,
  body: string,
): MailBulkActionInput {
  const payload = JSON.parse(body) as {
    action?: unknown;
    messageIds?: unknown;
  };
  if (
    payload.action !== "done" ||
    !Array.isArray(payload.messageIds) ||
    payload.messageIds.length === 0 ||
    !payload.messageIds.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidMailActionRequestError();
  }

  return {
    accountId,
    bucket,
    action: "done",
    messageIds: payload.messageIds,
  };
}

export function parseMailActionName(value: unknown): MailAction {
  if (
    value === "mark_read" ||
    value === "mark_unread" ||
    value === "star" ||
    value === "unstar" ||
    value === "archive" ||
    value === "trash" ||
    value === "move" ||
    value === "apply_labels" ||
    value === "done" ||
    value === "undo_done" ||
    value === "undone"
  ) {
    return value;
  }

  throw new InvalidMailActionRequestError();
}

export function parseCreateFollowUpInput(
  accountId: string,
  messageId: string,
  body: string,
): {
  accountId: string;
  messageId: string;
  dueAt: string;
  kind?: FollowUpKind;
  title?: string;
  note?: string;
  source?: FollowUpSource;
  hermesSkillRunId?: string;
} {
  const payload = JSON.parse(body) as {
    dueAt?: unknown;
    kind?: unknown;
    title?: unknown;
    note?: unknown;
    source?: unknown;
    hermesSkillRunId?: unknown;
  };
  if (!isNonEmptyString(payload.dueAt)) {
    throw new InvalidFollowUpRequestError("due time is required");
  }

  return {
    accountId,
    messageId,
    dueAt: payload.dueAt,
    ...(isFollowUpKind(payload.kind) ? { kind: payload.kind } : {}),
    ...(isNonEmptyString(payload.title) ? { title: payload.title } : {}),
    ...(isNonEmptyString(payload.note) ? { note: payload.note } : {}),
    ...(isFollowUpSource(payload.source) ? { source: payload.source } : {}),
    ...(isNonEmptyString(payload.hermesSkillRunId)
      ? { hermesSkillRunId: payload.hermesSkillRunId }
      : {}),
  };
}

export function parseUpdateFollowUpInput(
  id: string,
  body: string,
): {
  id: string;
  dueAt?: string;
  kind?: FollowUpKind;
  status?: Exclude<FollowUpStatus, "cancelled">;
  title?: string;
  note?: string;
} {
  const payload = JSON.parse(body) as {
    dueAt?: unknown;
    kind?: unknown;
    status?: unknown;
    title?: unknown;
    note?: unknown;
  };

  return {
    id,
    ...(isNonEmptyString(payload.dueAt) ? { dueAt: payload.dueAt } : {}),
    ...(isFollowUpKind(payload.kind) ? { kind: payload.kind } : {}),
    ...(isMutableFollowUpStatus(payload.status) ? { status: payload.status } : {}),
    ...(isNonEmptyString(payload.title) ? { title: payload.title } : {}),
    ...(isNonEmptyString(payload.note) ? { note: payload.note } : {}),
  };
}

export function isFollowUpKind(value: unknown): value is FollowUpKind {
  return value === "manual" || value === "needs_reply" || value === "waiting_on_them";
}

export function isFollowUpSource(value: unknown): value is FollowUpSource {
  return value === "manual" || value === "hermes_followup";
}

export function isMutableFollowUpStatus(
  value: unknown,
): value is Exclude<FollowUpStatus, "cancelled"> {
  return value === "open" || value === "due" || value === "done";
}

export function parseMailComposeSource(value: unknown): MailDraftSource | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "manual" ||
    value === "hermes_reply" ||
    value === "reply" ||
    value === "reply_all" ||
    value === "forward"
  ) {
    return value;
  }
  throw new InvalidMailComposeRequestError();
}

export function parseMailComposeAttachments(
  value: unknown,
): CreateMailDraftAttachmentInput[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InvalidMailComposeRequestError("attachments are invalid");
  }
  if (value.length > 20) {
    throw new InvalidMailComposeRequestError("too many attachments");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new InvalidMailComposeRequestError("attachment is invalid");
    }
    const record = item as Record<string, unknown>;
    const source =
      record.source === undefined
        ? "message_attachment"
        : record.source === "message_attachment" ||
            record.source === "uploaded_file"
          ? record.source
        : undefined;
    const attachmentId =
      isNonEmptyString(record.attachmentId)
        ? record.attachmentId
        : isNonEmptyString(record.id)
          ? record.id
          : undefined;
    if (!source || !attachmentId || /[\u0000-\u001f]/.test(attachmentId)) {
      throw new InvalidMailComposeRequestError("attachment is invalid");
    }

    return {
      source,
      attachmentId,
      ...(isNonEmptyString(record.filename)
        ? { filename: record.filename }
        : {}),
      ...(isNonEmptyString(record.contentType)
        ? { contentType: record.contentType }
        : {}),
      ...(typeof record.byteSize === "number" && Number.isFinite(record.byteSize)
        ? { byteSize: Math.max(0, Math.floor(record.byteSize)) }
        : {}),
      inline: record.inline === true,
      ...(isNonEmptyString(record.contentId)
        ? { contentId: record.contentId }
        : {}),
      ...(source === "uploaded_file" && isNonEmptyString(record.storageKey)
        ? { storageKey: record.storageKey }
        : {}),
      ...(source === "uploaded_file" && isNonEmptyString(record.contentBase64)
        ? { contentBase64: record.contentBase64 }
        : {}),
    };
  });
}

export function parseMailComposeAddresses(
  value: unknown,
  required: boolean,
): MailAddress[] {
  if (value === undefined) {
    if (required) {
      throw new InvalidMailComposeRequestError();
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InvalidMailComposeRequestError();
  }
  const addresses = value.map(parseMailComposeAddress);
  if (required && addresses.length === 0) {
    throw new InvalidMailComposeRequestError();
  }
  return addresses;
}

export function parseMailComposeAddress(value: unknown): MailAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMailComposeRequestError();
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.address)) {
    throw new InvalidMailComposeRequestError();
  }
  return {
    address: record.address,
    ...(isNonEmptyString(record.name) ? { name: record.name } : {}),
  };
}

export function parseCsvImportInput(body: string): { csv: string } {
  const payload = JSON.parse(body) as { csv?: unknown };
  if (!isNonEmptyString(payload.csv)) {
    throw new InvalidCsvImportError("CSV is required");
  }

  return { csv: payload.csv };
}

export function parseAccountTransferExportInput(body: string): {
  accountIds?: string[];
} {
  const payload = JSON.parse(body || "{}") as { accountIds?: unknown };
  if (payload.accountIds === undefined) {
    return {};
  }
  if (
    !Array.isArray(payload.accountIds) ||
    !payload.accountIds.every((item) => isNonEmptyString(item))
  ) {
    throw new InvalidAccountTransferError();
  }

  return { accountIds: payload.accountIds };
}

export function parseAccountTransferImportInput(body: string): {
  package: AccountTransferPackage;
} {
  const payload = JSON.parse(body) as { package?: unknown };
  return {
    package: validateTransferPackage(payload.package),
  };
}

export function parseReauthorizationOAuthStartInput(
  taskId: string,
  body: string,
): {
  taskId: string;
  redirectUri: string;
} {
  const payload = JSON.parse(body) as { redirectUri?: unknown };
  if (!isNonEmptyString(taskId) || !isNonEmptyString(payload.redirectUri)) {
    throw new InvalidReauthorizationRequestError();
  }

  return { taskId, redirectUri: payload.redirectUri };
}

export function parseReauthorizationOAuthCallbackInput(body: string): {
  state: string;
  code: string;
} {
  const payload = JSON.parse(body) as { state?: unknown; code?: unknown };
  if (!isNonEmptyString(payload.state) || !isNonEmptyString(payload.code)) {
    throw new InvalidReauthorizationRequestError();
  }

  return {
    state: payload.state,
    code: payload.code,
  };
}

export function parseReauthorizationImapSmtpInput(
  taskId: string,
  body: string,
): {
  taskId: string;
  username?: string;
  secret: string;
  imap?: ImapSmtpEndpointSettings;
  smtp?: ImapSmtpEndpointSettings;
} {
  const payload = JSON.parse(body) as {
    username?: unknown;
    secret?: unknown;
    imap?: Partial<ImapSmtpEndpointSettings>;
    smtp?: Partial<ImapSmtpEndpointSettings>;
  };
  if (!isNonEmptyString(taskId) || !isNonEmptyString(payload.secret)) {
    throw new InvalidReauthorizationRequestError();
  }

  return {
    taskId,
    ...(isNonEmptyString(payload.username)
      ? { username: payload.username }
      : {}),
    secret: payload.secret,
    ...(payload.imap || payload.smtp
      ? {
          imap: parseReauthorizationEndpoint(payload.imap, "imap"),
          smtp: parseReauthorizationEndpoint(payload.smtp, "smtp"),
        }
      : {}),
  };
}

export function parseReauthorizationEndpoint(
  value: Partial<ImapSmtpEndpointSettings> | undefined,
  label: "imap" | "smtp",
): ImapSmtpEndpointSettings {
  if (!value || typeof value !== "object") {
    throw new InvalidReauthorizationRequestError(`${label} settings required`);
  }
  if (!isNonEmptyString(value.host)) {
    throw new InvalidReauthorizationRequestError(`${label}.host required`);
  }
  if (
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  ) {
    throw new InvalidReauthorizationRequestError(`${label}.port invalid`);
  }
  if (typeof value.secure !== "boolean") {
    throw new InvalidReauthorizationRequestError(`${label}.secure required`);
  }
  if (!isNonEmptyString(value.username)) {
    throw new InvalidReauthorizationRequestError(`${label}.username required`);
  }
  if (!isNonEmptyString(value.secret)) {
    throw new InvalidReauthorizationRequestError(`${label}.secret required`);
  }

  return {
    host: value.host,
    port: value.port,
    secure: value.secure,
    username: value.username,
    secret: value.secret,
  };
}

export function parseEndpoint(
  value: Partial<ImapSmtpEndpointSettings> | undefined,
  label: "imap" | "smtp",
  errorCode: "invalid_imap_smtp_account" | "invalid_imap_smtp_connection_test",
): ImapSmtpEndpointSettings {
  if (!value || typeof value !== "object") {
    throw new InvalidImapSmtpAccountError(
      errorCode,
      `${label} settings are required`,
    );
  }

  if (!isNonEmptyString(value.host)) {
    throw new InvalidImapSmtpAccountError(
      errorCode,
      `${label}.host is required`,
    );
  }

  const port = value.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new InvalidImapSmtpAccountError(errorCode, `${label}.port is invalid`);
  }

  if (typeof value.secure !== "boolean") {
    throw new InvalidImapSmtpAccountError(
      errorCode,
      `${label}.secure is required`,
    );
  }

  if (!isNonEmptyString(value.username)) {
    throw new InvalidImapSmtpAccountError(
      errorCode,
      `${label}.username is required`,
    );
  }

  if (!isNonEmptyString(value.secret)) {
    throw new InvalidImapSmtpAccountError(
      errorCode,
      `${label}.secret is required`,
    );
  }

  return {
    host: value.host,
    port,
    secure: value.secure,
    username: value.username,
    secret: value.secret,
  };
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
