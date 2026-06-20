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
import { parseHermesRuntimeRoute, parseHermesProviderProbeRoute, parseMailProviderCapabilityRoute, parseHermesProviderProbeInput, parseHermesProviderProbeJsonObject, parseHermesRuntimeUpdateInput, parseHermesRuntimeJsonObject, parseHermesAuditLogListInput, optionalQueryParam, parseHermesAuditLogLimit, parseDiagnosticsLogListInput, parseDiagnosticsLimit, parseOperationalEventListInput, optionalOperationalQueryParam, parseOperationalEventLimit, parseHermesMemoryRoute, parseHermesRuleRoute, parseHermesRuleExecutionRoute, parseHermesRuleCandidateRoute, parseHermesActionPlanRoute, parseHermesSkillSettingsRoute, isHermesWorkspaceContextRoute, parseHermesWorkspaceContextInput, parseHermesSkillSettingsPatch, readHermesSkillSettingsBoolean, readHermesSkillSettingsInteger, readHermesSkillSettingsCustomInstructions, optionalWorkspaceContextParam, optionalWorkspaceContextLimit, parseLabelRoute, isStringArray, parseReauthorizationRecoveryRoute, parseSyncControlRoute, parseSyncDiagnosticsRoute, isSyncDiagnosticsRoute } from "./router-route-parsers.js";
import { parseMailComposeRoute, parseOptionalMailComposeLimit, parseMailActionRoute, parseMailBulkActionRoute, parseFollowUpRoute, parseOptionalFollowUpStatus, parseOptionalFollowUpLimit, parseSmartInboxFeedbackRoute, parseSenderScreeningRoute, parseGatekeeperSettingsRoute, parseSenderScreeningStatus, parseAttachmentDownloadRoute, parseOAuthRoute, parseMailReadRoute, parseHermesMessageTranslationRoute, parseHermesMessageSummaryRoute, parseHermesMessageReplyDraftRoute, parseHermesMessageQuickReplyRoute, parseHermesMessageOrganizationRoute, parseHermesMessageFollowupRoute, parseLimit, parseMailSort, parseMailSavedViewId, parseMailQuickFilters, parseMailMailboxRole, parseMailMailboxId, parseMailSearchScopes, parseMailLabelIds, parseMailTagMode, parseMailStructuredText, parseMailDateBound, parseOptionalMailBoolean, uniqueMailValues, isUuid, parseMailReadCursor, parseMailSearchQuery, parseSmartInboxFeedbackInput, parseSenderScreeningDomainBlockInput, parseSenderScreeningSenderDecisionInput, parseSenderScreeningBulkInput, parseGatekeeperSettingsInput, isSmartInboxFeedbackAction } from "./router-mail-parsers.js";
import { parseOAuthStartInput, parseOAuthCallbackInput, parseHermesSkillRunAccountId, parseHermesTranslateInput, parseHermesMessageTranslationInput, rejectHermesMessageTranslationClientContext, parseHermesMessageSummaryInput, parseHermesMessageReplyDraftInput, parseHermesMessageQuickReplyInput, parseHermesMessageOrganizationInput, parseHermesMessageFollowupInput, parseHermesReplyDraftInput, parseHermesQuickReplyInput, parseHermesRewritePolishInput, isHermesQuickReplyScenario, isHermesRewritePolishAction, parseHermesThreadSummaryInput, isHermesThreadSummaryMode, parseHermesActionItemExtractInput, parseHermesLabelSuggestInput, parseHermesNewsletterCleanupInput, parseHermesPriorityTriageInput, parsePriorityTriageScore, parseHermesFollowupTrackerInput, parseHermesFollowUpConfirmationInput, parseHermesTranslationPreferenceInput, isHermesTranslationPreferenceMode, parseTranslationPreferenceText, isActionableHermesFollowUpStatus, parseHermesFollowUpReasons, parseHermesDraftFeedbackInput, parseHermesMemoryListInput, parseHermesMemoryAccountId, parseHermesMemoryPatchInput, parseOptionalHermesMemoryFilter, parseHermesMemoryLimit, parseHermesRuleSuggestInput, parseHermesActionPlanCreateInput, parseHermesActionPlanConfirmInput, parseHermesRuleDraftInput, parseHermesRuleSimulationInput, parseHermesRuleUpdateInput, parseHermesRuleCandidateUpdateInput, parseHermesRuleCandidateDismissInput, parseHermesRuleRunInput, parseOptionalHermesActionPlanInteger, parseHermesRuleListInput, parseHermesRuleExecutionListInput, parseHermesRuleCandidateListInput, parseOptionalHermesRuleCandidateStatus, parseOptionalHermesRuleInteger, parseOptionalHermesRuleTextPatch, parseOptionalHermesRuleLabelColor, parseOptionalHermesRuleBooleanPatch, parseOptionalHermesRuleKeywords, parseOptionalHermesRuleBoolean, parseHermesRuleLimit, parseOptionalStringArray, parseOptionalHermesMessageTranslationArray, parseOptionalHermesMessageSummaryArray, parseOptionalHermesMessageReplyArray, parseOptionalHermesMessageOrganizationArray, parseOptionalHermesMessageFollowupArray } from "./router-hermes-inputs.js";
import { parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString } from "./router-account-compose-inputs.js";
import { writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-response-utils.js";

export function sanitizeImapSmtpConnectionTestResult(
  result: ImapSmtpConnectionTestResult,
  sensitiveValues: string[],
): ImapSmtpConnectionTestResult {
  const diagnostics = result.diagnostics?.map((diagnostic) =>
    sanitizeImapSmtpConnectionDiagnostic(diagnostic, sensitiveValues),
  );

  return {
    provider: result.provider,
    ok: result.ok,
    checks: {
      imap: sanitizeImapSmtpConnectionCheck(result.checks.imap, sensitiveValues),
      smtp: sanitizeImapSmtpConnectionCheck(result.checks.smtp, sensitiveValues),
    },
    ...(diagnostics?.length ? { diagnostics } : {}),
  };
}

export function sanitizeImapSmtpConnectionCheck(
  check: ImapSmtpConnectionCheckResult,
  sensitiveValues: string[],
): ImapSmtpConnectionCheckResult {
  return {
    ok: check.ok,
    ...(check.code ? { code: check.code } : {}),
    ...(check.error
      ? { error: scrubKnownSensitiveText(check.error, sensitiveValues) }
      : {}),
  };
}

export function sanitizeImapSmtpConnectionDiagnostic(
  diagnostic: ImapSmtpConnectionDiagnostic,
  sensitiveValues: string[],
): ImapSmtpConnectionDiagnostic {
  return {
    code: diagnostic.code,
    provider: diagnostic.provider,
    severity: diagnostic.severity,
    affected: diagnostic.affected,
    message: scrubKnownSensitiveText(diagnostic.message, sensitiveValues),
    recoveryAction: diagnostic.recoveryAction,
  };
}

export function asImapSmtpOnboardingFailedError(
  error: unknown,
):
  | {
      code: "imap_smtp_onboarding_failed";
      provider: string;
      message: string;
      diagnostics: ImapSmtpConnectionDiagnostic[];
    }
  | undefined {
  if (error instanceof ImapSmtpOnboardingFailedError) {
    return {
      code: error.code,
      provider: error.provider,
      message: error.message,
      diagnostics: error.diagnostics,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "imap_smtp_onboarding_failed" &&
    typeof (error as { provider?: unknown }).provider === "string"
  ) {
    return {
      code: "imap_smtp_onboarding_failed",
      provider: (error as { provider: string }).provider,
      message:
        error instanceof Error
          ? error.message
          : typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : "IMAP/SMTP onboarding failed",
      diagnostics: readImapSmtpDiagnostics(
        (error as { diagnostics?: unknown }).diagnostics,
      ),
    };
  }

  return undefined;
}

export function asReauthorizationFailedError(
  error: unknown,
):
  | {
      code: "reauthorization_failed";
      provider: string;
      diagnostics: ImapSmtpConnectionDiagnostic[];
    }
  | undefined {
  if (error instanceof ReauthorizationFailedError) {
    return {
      code: error.code,
      provider: error.provider,
      diagnostics: error.diagnostics,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "reauthorization_failed" &&
    typeof (error as { provider?: unknown }).provider === "string"
  ) {
    return {
      code: "reauthorization_failed",
      provider: (error as { provider: string }).provider,
      diagnostics: readImapSmtpDiagnostics(
        (error as { diagnostics?: unknown }).diagnostics,
      ),
    };
  }

  return undefined;
}

export function readImapSmtpDiagnostics(
  value: unknown,
): ImapSmtpConnectionDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isImapSmtpConnectionDiagnostic);
}

export function isImapSmtpConnectionDiagnostic(
  value: unknown,
): value is ImapSmtpConnectionDiagnostic {
  if (!value || typeof value !== "object") {
    return false;
  }

  const diagnostic = value as Partial<ImapSmtpConnectionDiagnostic>;
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

export function imapSmtpInputMode(
  input: ImapSmtpOnboardingInput,
): "preset" | "manual" {
  return input.imap || input.smtp ? "manual" : "preset";
}

export function imapSmtpSensitiveValues(input: ImapSmtpOnboardingInput): string[] {
  return [
    input.secret,
    input.imap?.secret,
    input.smtp?.secret,
  ].filter(isNonEmptyString);
}

export function reauthorizationImapSmtpSensitiveValues(input: {
  secret: string;
  imap?: ImapSmtpEndpointSettings;
  smtp?: ImapSmtpEndpointSettings;
}): string[] {
  return [
    input.secret,
    input.imap?.secret,
    input.smtp?.secret,
  ].filter(isNonEmptyString);
}

export function rememberSensitiveValues(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

export function safeErrorForDiagnostics(
  error: unknown,
  sensitiveValues: string[],
): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: scrubKnownSensitiveText(error.message, sensitiveValues),
    };
  }

  return {
    name: "Error",
    message: scrubKnownSensitiveText(String(error), sensitiveValues),
  };
}

export function safeErrorMessage(error: unknown, sensitiveValues: string[]): string {
  if (error instanceof Error) {
    return scrubKnownSensitiveText(error.message, sensitiveValues);
  }

  return "unknown error";
}

export function scrubKnownSensitiveText(value: string, sensitiveValues: string[]): string {
  return sensitiveValues
    .filter(isNonEmptyString)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (output, secret) => output.split(secret).join("[redacted]"),
      value,
    );
}

export function parseRequestId(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 128);
}

export function isRequestPath(
  requestUrl: string | undefined,
  expectedPathname: string,
): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === expectedPathname;
}

export function readScopedRouteAccountId(
  requestUrl: string | undefined,
): string | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const pathname = url.pathname;
  const accountRoute =
    /^\/api\/accounts\/([^/]+)\/(?:attachments|compose|gatekeeper|labels|mailboxes|messages|outbox|send-identities|smart-inbox)(?:\/|$)/.exec(
      pathname,
    );
  if (accountRoute) {
    return decodeURIComponent(accountRoute[1]);
  }

  if (pathname === "/api/follow-ups" || pathname === "/api/screening/senders") {
    const accountId = url.searchParams.get("accountId");
    return isNonEmptyString(accountId) ? accountId : undefined;
  }

  if (
    pathname === "/api/hermes/audit-log" ||
    pathname === "/api/hermes/rules" ||
    pathname === "/api/hermes/rule-runs" ||
    pathname === "/api/hermes/rule-candidates" ||
    pathname.startsWith("/api/hermes/memories")
  ) {
    const accountId = url.searchParams.get("accountId");
    return isNonEmptyString(accountId) ? accountId : undefined;
  }

  if (isAccountScopedHermesSkillRunRoute(url)) {
    return readOptionalQueryAccountId(url);
  }

  const syncRoute =
    /^\/api\/sync-center\/accounts\/([^/]+)(?:\/|$)/.exec(pathname);
  return syncRoute ? decodeURIComponent(syncRoute[1]) : undefined;
}

export function isAdminOnlyForAccountScopedTokenRoute(
  requestUrl: string | undefined,
  method?: string,
): boolean {
  if (!requestUrl) {
    return false;
  }

  const url = new URL(requestUrl, "http://localhost");
  const pathname = url.pathname;
  return (
    pathname.startsWith("/api/admin/") ||
    pathname === "/api/messages" ||
    isHermesAccountQueryMissingRoute(url) ||
    pathname === "/api/maintenance/compose-attachments" ||
    pathname === "/api/maintenance/compose-attachments/cleanup" ||
    pathname === "/api/maintenance/hermes-retention" ||
    pathname === "/api/maintenance/hermes-retention/cleanup" ||
    pathname === "/api/mail-engine/health" ||
    pathname === "/api/mail-providers/capabilities" ||
    pathname.startsWith("/api/mail-providers/capabilities/") ||
    pathname === "/api/sync-center/accounts" ||
    pathname.startsWith("/api/sync-center/reauthorizations") ||
    pathname === "/api/mail-navigation/summary" ||
    pathname === "/api/hermes/providers" ||
    pathname.startsWith("/api/hermes/providers/") ||
    pathname === "/api/hermes/resource-profile" ||
    pathname === "/api/hermes/runtime" ||
    pathname.startsWith("/api/hermes/runtime/") ||
    (isHermesGlobalSkillAdminRoute(pathname) &&
      !isAccountBodyScopedHermesSkillRunRoute(url, method)) ||
    pathname === "/api/hermes/workspace/context" ||
    pathname === "/api/hermes/drafts/feedback" ||
    (pathname.startsWith("/api/hermes/action-plans") &&
      !isAccountBodyScopedHermesActionPlanRoute(url, method)) ||
    pathname.startsWith("/api/hermes/follow-ups") ||
    isHermesRuleCandidateAdminRoute(url, method) ||
    pathname.startsWith("/api/diagnostics/") ||
    pathname.startsWith("/api/domains") ||
    pathname.startsWith("/api/follow-ups/") ||
    pathname.startsWith("/api/screening/domains/") ||
    pathname === "/api/accounts/imap-smtp" ||
    pathname === "/api/accounts/imap-smtp/test" ||
    pathname.startsWith("/api/accounts/import/") ||
    pathname.startsWith("/api/accounts/oauth/") ||
    pathname.startsWith("/api/accounts/transfer/") ||
    isHermesRuleAdminRoute(url, method)
  );
}

export function isHermesRuleAdminRoute(url: URL, method?: string): boolean {
  if (!url.pathname.startsWith("/api/hermes/rules")) {
    return false;
  }
  if (
    url.pathname === "/api/hermes/rules" &&
    isNonEmptyString(url.searchParams.get("accountId"))
  ) {
    return false;
  }

  return !isAccountBodyScopedHermesRuleRoute(url, method);
}

export function isHermesRuleCandidateAdminRoute(url: URL, method?: string): boolean {
  if (!url.pathname.startsWith("/api/hermes/rule-candidates")) {
    return false;
  }

  return (
    method === "GET" &&
    url.pathname === "/api/hermes/rule-candidates" &&
    !isNonEmptyString(url.searchParams.get("accountId"))
  );
}

export function isHermesAccountQueryMissingRoute(url: URL): boolean {
  const pathname = url.pathname;
  if (
    pathname !== "/api/hermes/audit-log" &&
    pathname !== "/api/hermes/rule-runs" &&
    !pathname.startsWith("/api/hermes/memories")
  ) {
    return false;
  }

  return !isNonEmptyString(url.searchParams.get("accountId"));
}

export function isHermesGlobalSkillAdminRoute(pathname: string): boolean {
  if (pathname === "/api/hermes/skills") {
    return true;
  }
  if (/^\/api\/hermes\/skills\/[^/]+\/settings$/.test(pathname)) {
    return true;
  }

  return [
    "/api/hermes/skills/translate_text/run",
    "/api/hermes/skills/reply_draft/run",
    "/api/hermes/skills/quick_reply/run",
    "/api/hermes/skills/rewrite_polish/run",
    "/api/hermes/skills/thread_summarize/run",
    "/api/hermes/skills/action_item_extract/run",
    "/api/hermes/skills/label_suggest/run",
    "/api/hermes/skills/newsletter_cleanup/run",
    "/api/hermes/skills/priority_triage/run",
    "/api/hermes/skills/followup_tracker/run",
    "/api/hermes/skills/email_search_qa/run",
  ].includes(pathname);
}

export function isAccountScopedHermesSkillRunRoute(url: URL): boolean {
  if (
    url.pathname !== "/api/hermes/skills/translate_text/run" &&
    url.pathname !== "/api/hermes/skills/rewrite_polish/run" &&
    url.pathname !== "/api/hermes/skills/email_search_qa/run"
  ) {
    return false;
  }

  return Boolean(readOptionalQueryAccountId(url));
}

export function isAccountBodyScopedHermesSkillRunRoute(
  url: URL,
  method?: string,
): boolean {
  return (
    method === "POST" &&
    (url.pathname === "/api/hermes/skills/translate_text/run" ||
      url.pathname === "/api/hermes/skills/rewrite_polish/run" ||
      url.pathname === "/api/hermes/skills/email_search_qa/run")
  );
}

export function isAccountBodyScopedHermesActionPlanRoute(
  url: URL,
  method?: string,
): boolean {
  return (
    method === "POST" &&
    (url.pathname === "/api/hermes/action-plans" ||
      /^\/api\/hermes\/action-plans\/[^/]+\/confirm$/.test(url.pathname))
  );
}

export function isAccountBodyScopedHermesRuleRoute(
  url: URL,
  method?: string,
): boolean {
  if (method === "POST") {
    return (
      url.pathname === "/api/hermes/rules/draft" ||
      url.pathname === "/api/hermes/rules/suggest" ||
      /^\/api\/hermes\/rules\/[^/]+\/simulate$/.test(url.pathname) ||
      /^\/api\/hermes\/rules\/[^/]+\/run$/.test(url.pathname)
    );
  }

  return (
    method === "PATCH" && /^\/api\/hermes\/rules\/[^/]+$/.test(url.pathname)
  );
}

export function readHermesSkillRunAccountId(
  requestUrl: string | undefined,
  expectedPathname: string,
): string | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname !== expectedPathname) {
    return undefined;
  }

  return readOptionalQueryAccountId(url);
}

export function readOptionalQueryAccountId(url: URL): string | undefined {
  const accountId = url.searchParams.get("accountId");
  return isNonEmptyString(accountId) ? accountId.trim() : undefined;
}

export function rejectAccountScopedAccess(
  response: ServerResponse,
  config: ApiConfig,
  requestId: string,
  requestPath: string,
  accountId: string,
): void {
  config.logger?.warn("api_account_scope_denied", {
    requestId,
    path: requestPath,
    accountId,
  });
  writeJson(response, 404, { error: "account_not_found" });
}

export function rejectAccountScopedAdminRoute(
  response: ServerResponse,
  config: ApiConfig,
  requestId: string,
  requestPath: string,
): void {
  config.logger?.warn("api_account_scoped_admin_route_denied", {
    requestId,
    path: requestPath,
  });
  writeJson(response, 403, { error: "account_scope_required" });
}

export function isDiagnosticsReadAuthorized(
  request: IncomingMessage,
  config: ApiConfig,
): boolean {
  if (config.webAuthDisabled) {
    return true;
  }

  const expectedToken = config.apiAccessToken?.trim();
  if (!expectedToken) {
    return false;
  }

  const suppliedToken = readApiAccessToken(request);
  return suppliedToken ? safeEqual(suppliedToken, expectedToken) : false;
}

export function rejectDiagnosticsRead(
  request: IncomingMessage,
  response: ServerResponse,
  config: ApiConfig,
  requestId: string,
  requestPath: string,
): void {
  config.logger?.warn("diagnostics_request_unauthorized", {
    requestId,
    method: request.method,
    path: requestPath,
  });
  response.setHeader("www-authenticate", 'Bearer realm="email-hub"');
  writeJson(response, 401, { error: "api_unauthorized" });
}

export function getRequestPathname(requestUrl: string | undefined): string {
  if (!requestUrl) {
    return "/";
  }

  return new URL(requestUrl, "http://localhost").pathname;
}

export function isDiagnosticsLogRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === "/api/diagnostics/logs";
}

export function isOperationalEventsRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === "/api/diagnostics/events";
}

export function parseComposeAttachmentMaintenanceRoute(
  requestUrl: string | undefined,
): "status" | "cleanup" | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const pathname = new URL(requestUrl, "http://localhost").pathname;
  if (pathname === "/api/maintenance/compose-attachments") {
    return "status";
  }
  if (pathname === "/api/maintenance/compose-attachments/cleanup") {
    return "cleanup";
  }

  return undefined;
}

export function parseHermesRetentionMaintenanceRoute(
  requestUrl: string | undefined,
): "status" | "cleanup" | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const pathname = new URL(requestUrl, "http://localhost").pathname;
  if (pathname === "/api/maintenance/hermes-retention") {
    return "status";
  }
  if (pathname === "/api/maintenance/hermes-retention/cleanup") {
    return "cleanup";
  }

  return undefined;
}

export function parseComposeAttachmentMaintenanceCleanupInput(body: string): {
  minAgeMs?: number;
  limit?: number;
} {
  if (!body.trim()) {
    return {};
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new InvalidComposeAttachmentMaintenanceRequestError();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidComposeAttachmentMaintenanceRequestError();
  }

  const record = payload as {
    minAgeHours?: unknown;
    limit?: unknown;
  };
  return {
    ...(record.minAgeHours !== undefined
      ? {
          minAgeMs:
            readComposeAttachmentMaintenanceInteger(
              record.minAgeHours,
              1,
              24 * 90,
            ) *
            60 *
            60 *
            1000,
        }
      : {}),
    ...(record.limit !== undefined
      ? {
          limit: readComposeAttachmentMaintenanceInteger(
            record.limit,
            1,
            10000,
          ),
        }
      : {}),
  };
}

export function parseHermesRetentionMaintenanceCleanupInput(body: string): {
  retentionDays?: number;
  limit?: number;
} {
  if (!body.trim()) {
    return {};
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new InvalidHermesRetentionMaintenanceRequestError();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidHermesRetentionMaintenanceRequestError();
  }

  const record = payload as {
    retentionDays?: unknown;
    limit?: unknown;
  };
  return {
    ...(record.retentionDays !== undefined
      ? {
          retentionDays: readHermesRetentionMaintenanceInteger(
            record.retentionDays,
            1,
            365,
          ),
        }
      : {}),
    ...(record.limit !== undefined
      ? {
          limit: readHermesRetentionMaintenanceInteger(record.limit, 1, 10000),
        }
      : {}),
  };
}

export function readHermesRetentionMaintenanceInteger(
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new InvalidHermesRetentionMaintenanceRequestError();
  }

  return value;
}

export function readComposeAttachmentMaintenanceInteger(
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new InvalidComposeAttachmentMaintenanceRequestError();
  }

  return value;
}

export function isHermesAuditLogRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === "/api/hermes/audit-log";
}
