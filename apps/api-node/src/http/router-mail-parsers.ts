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
import { parseOAuthStartInput, parseOAuthCallbackInput, parseHermesSkillRunAccountId, parseHermesTranslateInput, parseHermesMessageTranslationInput, rejectHermesMessageTranslationClientContext, parseHermesMessageSummaryInput, parseHermesMessageReplyDraftInput, parseHermesMessageQuickReplyInput, parseHermesMessageOrganizationInput, parseHermesMessageFollowupInput, parseHermesReplyDraftInput, parseHermesQuickReplyInput, parseHermesRewritePolishInput, isHermesQuickReplyScenario, isHermesRewritePolishAction, parseHermesThreadSummaryInput, isHermesThreadSummaryMode, parseHermesActionItemExtractInput, parseHermesLabelSuggestInput, parseHermesNewsletterCleanupInput, parseHermesPriorityTriageInput, parsePriorityTriageScore, parseHermesFollowupTrackerInput, parseHermesFollowUpConfirmationInput, parseHermesTranslationPreferenceInput, isHermesTranslationPreferenceMode, parseTranslationPreferenceText, isActionableHermesFollowUpStatus, parseHermesFollowUpReasons, parseHermesDraftFeedbackInput, parseHermesMemoryListInput, parseHermesMemoryAccountId, parseHermesMemoryPatchInput, parseOptionalHermesMemoryFilter, parseHermesMemoryLimit, parseHermesRuleSuggestInput, parseHermesActionPlanCreateInput, parseHermesActionPlanConfirmInput, parseHermesRuleDraftInput, parseHermesRuleSimulationInput, parseHermesRuleUpdateInput, parseHermesRuleCandidateUpdateInput, parseHermesRuleCandidateDismissInput, parseHermesRuleRunInput, parseOptionalHermesActionPlanInteger, parseHermesRuleListInput, parseHermesRuleExecutionListInput, parseHermesRuleCandidateListInput, parseOptionalHermesRuleCandidateStatus, parseOptionalHermesRuleInteger, parseOptionalHermesRuleTextPatch, parseOptionalHermesRuleLabelColor, parseOptionalHermesRuleBooleanPatch, parseOptionalHermesRuleKeywords, parseOptionalHermesRuleBoolean, parseHermesRuleLimit, parseOptionalStringArray, parseOptionalHermesMessageTranslationArray, parseOptionalHermesMessageSummaryArray, parseOptionalHermesMessageReplyArray, parseOptionalHermesMessageOrganizationArray, parseOptionalHermesMessageFollowupArray } from "./router-hermes-inputs.js";
import { parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString } from "./router-account-compose-inputs.js";
import { writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-response-utils.js";

export function parseMailComposeRoute(
  requestUrl: string | undefined,
):
  | { action: "list_send_identities"; accountId: string }
  | { action: "add_send_identity_candidate"; accountId: string }
  | {
      action: "verify_send_identity_candidate";
      accountId: string;
      candidateId: string;
    }
  | {
      action: "verify_send_identity_user_target";
      accountId: string;
      candidateId: string;
    }
  | {
      action: "diagnose_send_identity_candidate";
      accountId: string;
      candidateId: string;
    }
  | { action: "upload_attachment"; accountId: string }
  | { action: "draft_collection"; accountId: string; limit?: number }
  | { action: "update_draft"; accountId: string; draftId: string }
  | { action: "preview_draft"; accountId: string }
  | {
      action: "create_seed";
      accountId: string;
      messageId: string;
      mode: MailComposeSeedMode;
    }
  | { action: "send_draft"; accountId: string; draftId: string }
  | { action: "schedule_draft"; accountId: string; draftId: string }
  | { action: "list_outbox"; accountId: string; limit?: number }
  | {
      action: "send_scheduled_now" | "scheduled_draft" | "scheduled_item";
      accountId: string;
      scheduledId: string;
    }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const sendIdentitiesMatch = /^\/api\/accounts\/([^/]+)\/send-identities$/.exec(
    url.pathname,
  );
  if (sendIdentitiesMatch) {
    return {
      action: "list_send_identities",
      accountId: decodeURIComponent(sendIdentitiesMatch[1]),
    };
  }

  const sendIdentityCandidatesMatch =
    /^\/api\/accounts\/([^/]+)\/send-identities\/provider-candidates$/.exec(
      url.pathname,
    );
  if (sendIdentityCandidatesMatch) {
    return {
      action: "add_send_identity_candidate",
      accountId: decodeURIComponent(sendIdentityCandidatesMatch[1]),
    };
  }

  const verifySendIdentityCandidateMatch =
    /^\/api\/accounts\/([^/]+)\/send-identities\/provider-candidates\/([^/]+)\/verify$/.exec(
      url.pathname,
    );
  if (verifySendIdentityCandidateMatch) {
    return {
      action: "verify_send_identity_candidate",
      accountId: decodeURIComponent(verifySendIdentityCandidateMatch[1]),
      candidateId: decodeURIComponent(verifySendIdentityCandidateMatch[2]),
    };
  }

  const diagnoseSendIdentityCandidateMatch =
    /^\/api\/accounts\/([^/]+)\/send-identities\/provider-candidates\/([^/]+)\/diagnostics$/.exec(
      url.pathname,
    );
  if (diagnoseSendIdentityCandidateMatch) {
    return {
      action: "diagnose_send_identity_candidate",
      accountId: decodeURIComponent(diagnoseSendIdentityCandidateMatch[1]),
      candidateId: decodeURIComponent(diagnoseSendIdentityCandidateMatch[2]),
    };
  }

  const verifySendIdentityUserTargetMatch =
    /^\/api\/accounts\/([^/]+)\/send-identities\/provider-candidates\/([^/]+)\/verify-user-target$/.exec(
      url.pathname,
    );
  if (verifySendIdentityUserTargetMatch) {
    return {
      action: "verify_send_identity_user_target",
      accountId: decodeURIComponent(verifySendIdentityUserTargetMatch[1]),
      candidateId: decodeURIComponent(verifySendIdentityUserTargetMatch[2]),
    };
  }

  const composeAttachmentUploadMatch =
    /^\/api\/accounts\/([^/]+)\/compose\/attachments$/.exec(url.pathname);
  if (composeAttachmentUploadMatch) {
    return {
      action: "upload_attachment",
      accountId: decodeURIComponent(composeAttachmentUploadMatch[1]),
    };
  }

  const outboxMatch = /^\/api\/accounts\/([^/]+)\/outbox$/.exec(url.pathname);
  if (outboxMatch) {
    return {
      action: "list_outbox",
      accountId: decodeURIComponent(outboxMatch[1]),
      ...parseOptionalMailComposeLimit(url.searchParams.get("limit")),
    };
  }

  const outboxDraftMatch =
    /^\/api\/accounts\/([^/]+)\/outbox\/([^/]+)\/draft$/.exec(url.pathname);
  if (outboxDraftMatch) {
    return {
      action: "scheduled_draft",
      accountId: decodeURIComponent(outboxDraftMatch[1]),
      scheduledId: decodeURIComponent(outboxDraftMatch[2]),
    };
  }

  const outboxItemMatch =
    /^\/api\/accounts\/([^/]+)\/outbox\/([^/]+)(?:\/(send-now))?$/.exec(
      url.pathname,
    );
  if (outboxItemMatch) {
    return {
      action: outboxItemMatch[3] ? "send_scheduled_now" : "scheduled_item",
      accountId: decodeURIComponent(outboxItemMatch[1]),
      scheduledId: decodeURIComponent(outboxItemMatch[2]),
    };
  }

  const createMatch = /^\/api\/accounts\/([^/]+)\/compose\/drafts$/.exec(
    url.pathname,
  );
  if (createMatch) {
    return {
      action: "draft_collection",
      accountId: decodeURIComponent(createMatch[1]),
      ...parseOptionalMailComposeLimit(url.searchParams.get("limit")),
    };
  }

  const previewMatch = /^\/api\/accounts\/([^/]+)\/compose\/preview$/.exec(
    url.pathname,
  );
  if (previewMatch) {
    return {
      action: "preview_draft",
      accountId: decodeURIComponent(previewMatch[1]),
    };
  }

  const seedMatch =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/compose\/(reply|reply-all|forward)$/.exec(
      url.pathname,
    );
  if (seedMatch) {
    return {
      action: "create_seed",
      accountId: decodeURIComponent(seedMatch[1]),
      messageId: decodeURIComponent(seedMatch[2]),
      mode:
        seedMatch[3] === "reply-all"
          ? "reply_all"
          : (seedMatch[3] as "reply" | "forward"),
    };
  }

  const scheduleMatch =
    /^\/api\/accounts\/([^/]+)\/compose\/drafts\/([^/]+)\/schedule$/.exec(
      url.pathname,
    );
  if (scheduleMatch) {
    return {
      action: "schedule_draft",
      accountId: decodeURIComponent(scheduleMatch[1]),
      draftId: decodeURIComponent(scheduleMatch[2]),
    };
  }

  const draftItemMatch =
    /^\/api\/accounts\/([^/]+)\/compose\/drafts\/([^/]+)$/.exec(url.pathname);
  if (draftItemMatch) {
    return {
      action: "update_draft",
      accountId: decodeURIComponent(draftItemMatch[1]),
      draftId: decodeURIComponent(draftItemMatch[2]),
    };
  }

  const sendMatch =
    /^\/api\/accounts\/([^/]+)\/compose\/drafts\/([^/]+)\/send$/.exec(
      url.pathname,
    );
  if (!sendMatch) {
    return undefined;
  }

  return {
    action: "send_draft",
    accountId: decodeURIComponent(sendMatch[1]),
    draftId: decodeURIComponent(sendMatch[2]),
  };
}

export function parseOptionalMailComposeLimit(
  value: string | null,
): { limit?: number } {
  if (value === null) {
    return {};
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidMailComposeRequestError("mail compose limit is invalid");
  }

  return { limit: parsed };
}

export function parseMailActionRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/actions$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseMailBulkActionRoute(
  requestUrl: string | undefined,
): { accountId: string; bucket: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/smart-inbox\/cards\/([^/]+)\/actions$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    bucket: decodeURIComponent(match[2]),
  };
}

export function parseFollowUpRoute(
  requestUrl: string | undefined,
):
  | { action: "create"; accountId: string; messageId: string }
  | {
      action: "list";
      accountId: string;
      status?: FollowUpListStatus;
      limit?: number;
    }
  | { action: "item"; id: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const create =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/follow-ups$/.exec(
      url.pathname,
    );
  if (create) {
    return {
      action: "create",
      accountId: decodeURIComponent(create[1]),
      messageId: decodeURIComponent(create[2]),
    };
  }

  if (url.pathname === "/api/follow-ups") {
    const accountId = url.searchParams.get("accountId");
    if (!isNonEmptyString(accountId)) {
      throw new InvalidFollowUpRequestError("account id is required");
    }
    return {
      action: "list",
      accountId,
      ...parseOptionalFollowUpStatus(url.searchParams.get("status")),
      ...parseOptionalFollowUpLimit(url.searchParams.get("limit")),
    };
  }

  const item = /^\/api\/follow-ups\/([^/]+)$/.exec(url.pathname);
  if (!item) {
    return undefined;
  }

  return {
    action: "item",
    id: decodeURIComponent(item[1]),
  };
}

export function parseOptionalFollowUpStatus(
  value: string | null,
): { status?: FollowUpListStatus } {
  if (value === null) {
    return {};
  }
  if (
    value === "open" ||
    value === "due" ||
    value === "done" ||
    value === "cancelled" ||
    value === "all"
  ) {
    return { status: value };
  }

  throw new InvalidFollowUpRequestError("follow-up status is invalid");
}

export function parseOptionalFollowUpLimit(value: string | null): { limit?: number } {
  if (value === null) {
    return {};
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidFollowUpRequestError("follow-up limit is invalid");
  }

  return { limit: parsed };
}

export function parseSmartInboxFeedbackRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/smart-inbox\/feedback$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseSenderScreeningRoute(
  requestUrl: string | undefined,
):
  | {
      action: "list_senders";
      accountId: string;
      status?: SenderScreeningStatus;
    }
  | { action: "accept_sender" | "block_sender"; senderId: string }
  | { action: "bulk_senders" }
  | { action: "block_domain"; domain: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/screening/senders") {
    const accountId = url.searchParams.get("accountId");
    if (!isNonEmptyString(accountId)) {
      throw new InvalidSenderScreeningRequestError();
    }

    return {
      action: "list_senders",
      accountId,
      ...parseSenderScreeningStatus(url.searchParams.get("status")),
    };
  }

  if (url.pathname === "/api/screening/senders/bulk") {
    return { action: "bulk_senders" };
  }

  const senderMatch = /^\/api\/screening\/senders\/([^/]+)\/(accept|block)$/.exec(
    url.pathname,
  );
  if (senderMatch) {
    const senderId = decodeURIComponent(senderMatch[1]);
    if (!isNonEmptyString(senderId)) {
      throw new InvalidSenderScreeningRequestError();
    }

    return {
      action: senderMatch[2] === "accept" ? "accept_sender" : "block_sender",
      senderId,
    };
  }

  const domainMatch = /^\/api\/screening\/domains\/([^/]+)\/block$/.exec(
    url.pathname,
  );
  if (domainMatch) {
    const domain = decodeURIComponent(domainMatch[1]);
    if (!isNonEmptyString(domain)) {
      throw new InvalidSenderScreeningRequestError();
    }

    return { action: "block_domain", domain };
  }

  return undefined;
}

export function parseGatekeeperSettingsRoute(
  requestUrl: string | undefined,
): { accountId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/api\/accounts\/([^/]+)\/gatekeeper\/settings$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  const accountId = decodeURIComponent(match[1]);
  if (!isNonEmptyString(accountId)) {
    throw new InvalidGatekeeperSettingsRequestError();
  }

  return { accountId };
}

export function parseSenderScreeningStatus(
  value: string | null,
): { status?: SenderScreeningStatus } {
  if (value === null || value === "all") {
    return {};
  }
  if (value === "unknown" || value === "accepted" || value === "blocked") {
    return { status: value };
  }

  throw new InvalidSenderScreeningRequestError();
}

export function parseAttachmentDownloadRoute(
  requestUrl: string | undefined,
): { accountId: string; attachmentId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/attachments\/([^/]+)\/download$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    attachmentId: decodeURIComponent(match[2]),
  };
}

export function parseOAuthRoute(
  requestUrl: string | undefined,
):
  | { provider: "gmail" | "outlook"; action: "start" | "callback" }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const path = new URL(requestUrl, "http://localhost").pathname;
  const match = /^\/api\/accounts\/oauth\/([^/]+)\/(start|callback)$/.exec(
    path,
  );
  if (!match) {
    return undefined;
  }

  if (match[1] !== "gmail" && match[1] !== "outlook") {
    throw new InvalidOAuthRequestError(
      "unsupported_oauth_provider",
      400,
    );
  }

  return {
    provider: match[1],
    action: match[2] === "callback" ? "callback" : "start",
  };
}

export function parseMailReadRoute(
  requestUrl: string | undefined,
):
  | { action: "list_mailboxes"; accountId: string }
  | {
      action: "list_messages";
      accountId?: string;
      mailboxId?: string;
      mailboxRole?: string;
      limit: number;
      cursor?: string;
      q?: string;
      sort?: MessageListSort;
      savedViewId?: string;
      quickFilters?: MailQuickFilter[];
      qScopes?: MailSearchScope[];
      labelIds?: string[];
      tagMode?: MailTagMode;
      senderQuery?: string;
      recipientQuery?: string;
      receivedAfter?: string;
      receivedBefore?: string;
      hasAttachment?: boolean;
    }
  | { action: "get_message"; accountId: string; messageId: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const mailboxes = /^\/api\/accounts\/([^/]+)\/mailboxes$/.exec(
    url.pathname,
  );
  if (mailboxes) {
    return {
      action: "list_mailboxes",
      accountId: decodeURIComponent(mailboxes[1]),
    };
  }

  const accountMessages =
    /^\/api\/accounts\/([^/]+)\/messages(?:\/([^/]+))?$/.exec(url.pathname);
  const globalMessages = /^\/api\/messages$/.exec(url.pathname);
  if (!accountMessages && !globalMessages) {
    return undefined;
  }

  const accountId = accountMessages
    ? decodeURIComponent(accountMessages[1])
    : undefined;
  if (accountMessages?.[2]) {
    return {
      action: "get_message",
      accountId: accountId!,
      messageId: decodeURIComponent(accountMessages[2]),
    };
  }

  const mailboxId = parseMailMailboxId(url.searchParams.get("mailboxId"));
  const mailboxRole = parseMailMailboxRole(
    url.searchParams.get("mailboxRole") ?? url.searchParams.get("folderRole"),
  );
  const sort = parseMailSort(url.searchParams.get("sort"));
  const cursor = parseMailReadCursor(url.searchParams.get("cursor"), sort);
  const q = parseMailSearchQuery(url.searchParams.get("q"));
  const savedViewId = parseMailSavedViewId(
    url.searchParams.get("savedView") ?? url.searchParams.get("savedViewId"),
  );
  const quickFilters = parseMailQuickFilters(url.searchParams);
  const qScopes = parseMailSearchScopes(url.searchParams);
  const labelIds = parseMailLabelIds(url.searchParams);
  const tagMode = parseMailTagMode(url.searchParams.get("tagMode"));
  const senderQuery = parseMailStructuredText(
    url.searchParams.get("sender") ?? url.searchParams.get("from"),
  );
  const recipientQuery = parseMailStructuredText(
    url.searchParams.get("recipient") ?? url.searchParams.get("to"),
  );
  const receivedAfter = parseMailDateBound(
    url.searchParams.get("receivedAfter") ??
      url.searchParams.get("after"),
  );
  const receivedBefore = parseMailDateBound(
    url.searchParams.get("receivedBefore") ??
      url.searchParams.get("before"),
  );
  const hasAttachment = parseOptionalMailBoolean(
    url.searchParams.get("hasAttachment"),
  );
  return {
    action: "list_messages",
    ...(accountId ? { accountId } : {}),
    ...(mailboxId ? { mailboxId } : {}),
    ...(mailboxRole ? { mailboxRole } : {}),
    limit: parseLimit(url.searchParams.get("limit")),
    ...(cursor ? { cursor } : {}),
    ...(q ? { q } : {}),
    ...(sort ? { sort } : {}),
    ...(savedViewId ? { savedViewId } : {}),
    ...(quickFilters.length > 0 ? { quickFilters } : {}),
    ...(qScopes.length > 0 ? { qScopes } : {}),
    ...(labelIds.length > 0 ? { labelIds } : {}),
    ...(tagMode ? { tagMode } : {}),
    ...(senderQuery ? { senderQuery } : {}),
    ...(recipientQuery ? { recipientQuery } : {}),
    ...(receivedAfter ? { receivedAfter } : {}),
    ...(receivedBefore ? { receivedBefore } : {}),
    ...(typeof hasAttachment === "boolean" ? { hasAttachment } : {}),
  };
}

export function parseHermesMessageTranslationRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/translate$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseHermesMessageSummaryRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/summary$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseHermesMessageReplyDraftRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/reply-draft$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseHermesMessageQuickReplyRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/quick-reply$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseHermesMessageOrganizationRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/organize$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseHermesMessageFollowupRoute(
  requestUrl: string | undefined,
): { accountId: string; messageId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/accounts\/([^/]+)\/messages\/([^/]+)\/followup-track$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    accountId: decodeURIComponent(match[1]),
    messageId: decodeURIComponent(match[2]),
  };
}

export function parseLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidMailReadRequestError();
  }

  return parsed;
}

export function parseMailSort(value: string | null): MessageListSort | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const sort = value.trim();
  if (sort === "time") {
    return "time";
  }
  if (sort === "smart") {
    return "time";
  }

  throw new InvalidMailReadRequestError();
}

export function parseMailSavedViewId(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const savedViewId = value.trim().toLowerCase();
  if (
    !findBuiltInSavedView(savedViewId) &&
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(savedViewId)
  ) {
    throw new InvalidMailReadRequestError();
  }

  return savedViewId;
}

export function parseMailQuickFilters(params: URLSearchParams): MailQuickFilter[] {
  return uniqueMailValues(params, "quickFilter").map((value) => {
    if (
      value === "unread" ||
      value === "starred" ||
      value === "snoozed" ||
      value === "attachments" ||
      value === "labels"
    ) {
      return value;
    }

    throw new InvalidMailReadRequestError();
  });
}

export function parseMailMailboxRole(value: string | null): string | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const mailboxRole = value.trim().toLowerCase();
  if (
    mailboxRole === "inbox" ||
    mailboxRole === "drafts" ||
    mailboxRole === "sent" ||
    mailboxRole === "archive" ||
    mailboxRole === "junk" ||
    mailboxRole === "trash" ||
    mailboxRole === "label" ||
    mailboxRole === "feed" ||
    mailboxRole === "important"
  ) {
    return mailboxRole;
  }

  throw new InvalidMailReadRequestError();
}

export function parseMailMailboxId(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const mailboxId = value.trim();
  if (!isUuid(mailboxId)) {
    throw new InvalidMailReadRequestError();
  }

  return mailboxId;
}

export function parseMailSearchScopes(params: URLSearchParams): MailSearchScope[] {
  return uniqueMailValues(params, "qScope").map((value) => {
    if (
      value === "sender" ||
      value === "recipients" ||
      value === "subject" ||
      value === "body"
    ) {
      return value;
    }

    throw new InvalidMailReadRequestError();
  });
}

export function parseMailLabelIds(params: URLSearchParams): string[] {
  return uniqueMailValues(params, "labelId").map((value) => {
    if (isUuid(value)) {
      return value;
    }

    throw new InvalidMailReadRequestError();
  });
}

export function parseMailTagMode(value: string | null): MailTagMode | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const tagMode = value.trim().toLowerCase();
  if (tagMode === "any" || tagMode === "all") {
    return tagMode;
  }

  throw new InvalidMailReadRequestError();
}

export function parseMailStructuredText(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 128 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidMailReadRequestError();
  }

  return trimmed;
}

export function parseMailDateBound(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 40 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidMailReadRequestError();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidMailReadRequestError();
  }

  return parsed.toISOString();
}

export function parseOptionalMailBoolean(value: string | null): boolean | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new InvalidMailReadRequestError();
}

export function uniqueMailValues(params: URLSearchParams, key: string): string[] {
  return [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  ];
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function parseMailReadCursor(
  value: string | null,
  _sort?: MessageListSort,
): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  try {
    decodeMailReadCursor(value);
    return value;
  } catch (error) {
    if (error instanceof InvalidMailReadCursorError) {
      throw new InvalidMailReadRequestError();
    }

    throw error;
  }
}

export function parseMailSearchQuery(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 256 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidMailReadRequestError();
  }

  return trimmed;
}

export function parseSmartInboxFeedbackInput(body: string): {
  action: SmartInboxFeedbackAction;
} {
  const payload = JSON.parse(body) as { action?: unknown };
  if (!isSmartInboxFeedbackAction(payload.action)) {
    throw new InvalidSmartInboxFeedbackError();
  }

  return { action: payload.action };
}

export function parseSenderScreeningDomainBlockInput(body: string): {
  accountId: string;
} {
  const payload = JSON.parse(body || "{}") as { accountId?: unknown };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidSenderScreeningRequestError();
  }

  return { accountId: payload.accountId };
}

export function parseSenderScreeningSenderDecisionInput(body: string): {
  accountId: string;
} {
  const payload = JSON.parse(body || "{}") as { accountId?: unknown };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidSenderScreeningRequestError();
  }

  return { accountId: payload.accountId };
}

export function parseSenderScreeningBulkInput(body: string): {
  accountId: string;
  senderIds: string[];
  action: "accept" | "block";
} {
  const payload = JSON.parse(body || "{}") as {
    accountId?: unknown;
    senderIds?: unknown;
    action?: unknown;
  };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidSenderScreeningRequestError();
  }
  if (
    !Array.isArray(payload.senderIds) ||
    payload.senderIds.length === 0 ||
    payload.senderIds.length > 100 ||
    !payload.senderIds.every((senderId) => isNonEmptyString(senderId))
  ) {
    throw new InvalidSenderScreeningRequestError();
  }
  if (payload.action !== "accept" && payload.action !== "block") {
    throw new InvalidSenderScreeningRequestError();
  }

  return {
    accountId: payload.accountId,
    senderIds: payload.senderIds,
    action: payload.action,
  };
}

export function parseGatekeeperSettingsInput(body: string): { mode: GatekeeperMode } {
  const payload = JSON.parse(body || "{}") as { mode?: unknown };
  if (!isGatekeeperMode(payload.mode)) {
    throw new InvalidGatekeeperSettingsRequestError();
  }

  return { mode: payload.mode };
}

export function isSmartInboxFeedbackAction(
  value: unknown,
): value is SmartInboxFeedbackAction {
  return (
    value === "mark_important" ||
    value === "mark_not_important" ||
    value === "move_to_personal" ||
    value === "move_to_notifications" ||
    value === "move_to_newsletters" ||
    value === "move_to_feed" ||
    value === "always_important_sender" ||
    value === "mute_sender"
  );
}
