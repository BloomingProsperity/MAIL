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
import { parseMailComposeRoute, parseOptionalMailComposeLimit, parseMailActionRoute, parseMailBulkActionRoute, parseFollowUpRoute, parseOptionalFollowUpStatus, parseOptionalFollowUpLimit, parseSmartInboxFeedbackRoute, parseSenderScreeningRoute, parseGatekeeperSettingsRoute, parseSenderScreeningStatus, parseAttachmentDownloadRoute, parseOAuthRoute, parseMailReadRoute, parseHermesMessageTranslationRoute, parseHermesMessageSummaryRoute, parseHermesMessageReplyDraftRoute, parseHermesMessageQuickReplyRoute, parseHermesMessageOrganizationRoute, parseHermesMessageFollowupRoute, parseLimit, parseMailSort, parseMailSavedViewId, parseMailQuickFilters, parseMailMailboxRole, parseMailMailboxId, parseMailSearchScopes, parseMailLabelIds, parseMailTagMode, parseMailStructuredText, parseMailDateBound, parseOptionalMailBoolean, uniqueMailValues, isUuid, parseMailReadCursor, parseMailSearchQuery, parseSmartInboxFeedbackInput, parseSenderScreeningDomainBlockInput, parseSenderScreeningSenderDecisionInput, parseSenderScreeningBulkInput, parseGatekeeperSettingsInput, isSmartInboxFeedbackAction } from "./router-mail-parsers.js";
import { parseOAuthStartInput, parseOAuthCallbackInput, parseHermesSkillRunAccountId, parseHermesTranslateInput, parseHermesMessageTranslationInput, rejectHermesMessageTranslationClientContext, parseHermesMessageSummaryInput, parseHermesMessageReplyDraftInput, parseHermesMessageQuickReplyInput, parseHermesMessageOrganizationInput, parseHermesMessageFollowupInput, parseHermesReplyDraftInput, parseHermesQuickReplyInput, parseHermesRewritePolishInput, isHermesQuickReplyScenario, isHermesRewritePolishAction, parseHermesThreadSummaryInput, isHermesThreadSummaryMode, parseHermesActionItemExtractInput, parseHermesLabelSuggestInput, parseHermesNewsletterCleanupInput, parseHermesPriorityTriageInput, parsePriorityTriageScore, parseHermesFollowupTrackerInput, parseHermesFollowUpConfirmationInput, parseHermesTranslationPreferenceInput, isHermesTranslationPreferenceMode, parseTranslationPreferenceText, isActionableHermesFollowUpStatus, parseHermesFollowUpReasons, parseHermesDraftFeedbackInput, parseHermesMemoryListInput, parseHermesMemoryAccountId, parseHermesMemoryPatchInput, parseOptionalHermesMemoryFilter, parseHermesMemoryLimit, parseHermesRuleSuggestInput, parseHermesActionPlanCreateInput, parseHermesActionPlanConfirmInput, parseHermesRuleDraftInput, parseHermesRuleSimulationInput, parseHermesRuleUpdateInput, parseHermesRuleCandidateUpdateInput, parseHermesRuleCandidateDismissInput, parseHermesRuleRunInput, parseOptionalHermesActionPlanInteger, parseHermesRuleListInput, parseHermesRuleExecutionListInput, parseHermesRuleCandidateListInput, parseOptionalHermesRuleCandidateStatus, parseOptionalHermesRuleInteger, parseOptionalHermesRuleTextPatch, parseOptionalHermesRuleLabelColor, parseOptionalHermesRuleBooleanPatch, parseOptionalHermesRuleKeywords, parseOptionalHermesRuleBoolean, parseHermesRuleLimit, parseOptionalStringArray, parseOptionalHermesMessageTranslationArray, parseOptionalHermesMessageSummaryArray, parseOptionalHermesMessageReplyArray, parseOptionalHermesMessageOrganizationArray, parseOptionalHermesMessageFollowupArray } from "./router-hermes-inputs.js";
import { parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString } from "./router-account-compose-inputs.js";
import { writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-response-utils.js";

export function parseHermesRuntimeRoute(
  requestUrl: string | undefined,
): "settings" | "test" | "version" | "update_check" | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const pathname = new URL(requestUrl, "http://localhost").pathname;
  if (pathname === "/api/hermes/runtime") {
    return "settings";
  }
  if (pathname === "/api/hermes/runtime/test") {
    return "test";
  }
  if (pathname === "/api/hermes/runtime/version") {
    return "version";
  }
  if (pathname === "/api/hermes/runtime/update/check") {
    return "update_check";
  }

  return undefined;
}

export function parseHermesProviderProbeRoute(
  requestUrl: string | undefined,
): { providerKey: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const match = new URL(requestUrl, "http://localhost").pathname.match(
    /^\/api\/hermes\/providers\/([^/]+)\/probe$/,
  );
  if (!match) {
    return undefined;
  }

  return { providerKey: decodeURIComponent(match[1]) };
}

export function parseMailProviderCapabilityRoute(
  requestUrl: string | undefined,
): { provider: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const match = new URL(requestUrl, "http://localhost").pathname.match(
    /^\/api\/mail-providers\/capabilities\/([^/]+)$/,
  );
  if (!match) {
    return undefined;
  }

  return { provider: decodeURIComponent(match[1]) };
}

export function parseHermesProviderProbeInput(
  providerKey: string,
  body: string,
): {
  providerKey: string;
  endpointUrl?: string;
  model?: string;
  apiKey?: string;
} {
  const payload = parseHermesProviderProbeJsonObject(body);
  if (
    (payload.endpointUrl !== undefined &&
      typeof payload.endpointUrl !== "string") ||
    (payload.model !== undefined && typeof payload.model !== "string") ||
    (payload.apiKey !== undefined && typeof payload.apiKey !== "string")
  ) {
    throw new InvalidHermesProviderProbeRequestError();
  }

  return {
    providerKey,
    ...(typeof payload.endpointUrl === "string"
      ? { endpointUrl: payload.endpointUrl }
      : {}),
    ...(typeof payload.model === "string" ? { model: payload.model } : {}),
    ...(typeof payload.apiKey === "string" ? { apiKey: payload.apiKey } : {}),
  };
}

export function parseHermesProviderProbeJsonObject(
  body: string,
): Record<string, unknown> {
  try {
    const payload = JSON.parse(body || "{}");
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new InvalidHermesProviderProbeRequestError();
    }

    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof InvalidHermesProviderProbeRequestError) {
      throw error;
    }

    throw new InvalidHermesProviderProbeRequestError();
  }
}

export function parseHermesRuntimeUpdateInput(body: string): {
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
} {
  const payload = parseHermesRuntimeJsonObject(body);
  if (
    typeof payload.enabled !== "boolean" ||
    typeof payload.mode !== "string" ||
    typeof payload.model !== "string"
  ) {
    throw new InvalidHermesRuntimeConfigRequestError();
  }

  return {
    enabled: payload.enabled,
    mode: payload.mode as HermesRuntimeMode,
    ...(typeof payload.assistantName === "string"
      ? { assistantName: payload.assistantName }
      : {}),
    ...(typeof payload.providerKey === "string"
      ? { providerKey: payload.providerKey }
      : {}),
    ...(typeof payload.endpointUrl === "string"
      ? { endpointUrl: payload.endpointUrl }
      : {}),
    model: payload.model,
    ...(typeof payload.apiKey === "string" ? { apiKey: payload.apiKey } : {}),
    ...(payload.clearApiKey === true ? { clearApiKey: true } : {}),
    updatePolicy:
      typeof payload.updatePolicy === "string"
        ? (payload.updatePolicy as HermesRuntimeUpdatePolicy)
        : "manual",
    updateChannel:
      typeof payload.updateChannel === "string"
        ? (payload.updateChannel as HermesRuntimeUpdateChannel)
        : "stable",
  };
}

export function parseHermesRuntimeJsonObject(body: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(body);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new InvalidHermesRuntimeConfigRequestError();
    }

    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof InvalidHermesRuntimeConfigRequestError) {
      throw error;
    }

    throw new InvalidHermesRuntimeConfigRequestError();
  }
}

export function parseHermesAuditLogListInput(requestUrl: string | undefined): {
  accountId?: string;
  skillId?: string;
  messageId?: string;
  memoryId?: string;
  limit?: number;
} {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const limit = parseHermesAuditLogLimit(url.searchParams.get("limit"));

  return {
    ...optionalQueryParam(url, "accountId"),
    ...optionalQueryParam(url, "skillId"),
    ...optionalQueryParam(url, "messageId"),
    ...optionalQueryParam(url, "memoryId"),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function optionalQueryParam(
  url: URL,
  key: "accountId" | "skillId" | "messageId" | "memoryId",
): Partial<Record<typeof key, string>> {
  const value = url.searchParams.get(key)?.trim();
  return value ? { [key]: value } : {};
}

export function parseHermesAuditLogLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidHermesAuditLogRequestError();
  }

  return Math.min(parsed, 100);
}

export function parseDiagnosticsLogListInput(requestUrl: string | undefined): {
  limit?: number;
  level?: "debug" | "info" | "warn" | "error";
  requestId?: string;
  event?: string;
} {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const level = url.searchParams.get("level")?.trim();
  const requestId = url.searchParams.get("requestId")?.trim();
  const event = url.searchParams.get("event")?.trim();
  const limit = parseDiagnosticsLimit(url.searchParams.get("limit"));

  return {
    ...(limit ? { limit } : {}),
    ...(isDiagnosticLogLevel(level) ? { level } : {}),
    ...(requestId ? { requestId: requestId.slice(0, 128) } : {}),
    ...(event ? { event: event.slice(0, 128) } : {}),
  };
}

export function parseDiagnosticsLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return undefined;
  }

  return Math.min(200, Math.max(1, parsed));
}

export function parseOperationalEventListInput(requestUrl: string | undefined): {
  service?: string;
  level?: "debug" | "info" | "warn" | "error";
  event?: string;
  requestId?: string;
  accountId?: string;
  lane?: string;
  jobId?: string;
  limit?: number;
} {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const rawLevel = url.searchParams.get("level")?.trim();
  const limit = parseOperationalEventLimit(url.searchParams.get("limit"));
  if (rawLevel && !isOperationalEventLevel(rawLevel)) {
    throw new InvalidOperationalEventQueryError();
  }
  const level = rawLevel && isOperationalEventLevel(rawLevel) ? rawLevel : undefined;

  return {
    ...optionalOperationalQueryParam(url, "service"),
    ...(level ? { level } : {}),
    ...optionalOperationalQueryParam(url, "event"),
    ...optionalOperationalQueryParam(url, "requestId"),
    ...optionalOperationalQueryParam(url, "accountId"),
    ...optionalOperationalQueryParam(url, "lane"),
    ...optionalOperationalQueryParam(url, "jobId"),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function optionalOperationalQueryParam<
  K extends "service" | "event" | "requestId" | "accountId" | "lane" | "jobId",
>(url: URL, key: K): Partial<Record<K, string>> {
  const value = url.searchParams.get(key)?.trim();
  if (!value) {
    return {};
  }
  if (value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    throw new InvalidOperationalEventQueryError();
  }

  return { [key]: value } as Partial<Record<K, string>>;
}

export function parseOperationalEventLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new InvalidOperationalEventQueryError();
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidOperationalEventQueryError();
  }

  return Math.min(parsed, 200);
}

export function parseHermesMemoryRoute(
  requestUrl: string | undefined,
):
  | { action: "list" }
  | { action: "item"; id: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/hermes/memories") {
    return { action: "list" };
  }

  const match = /^\/api\/hermes\/memories\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  return { action: "item", id: decodeURIComponent(match[1]) };
}

export function parseHermesRuleRoute(
  requestUrl: string | undefined,
):
  | { action: "list" }
  | { action: "draft" }
  | { action: "suggest" }
  | { action: "simulate"; candidateId: string }
  | { action: "approve"; candidateId: string }
  | { action: "run"; ruleId: string }
  | { action: "update"; ruleId: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/hermes/rules") {
    return { action: "list" };
  }
  if (url.pathname === "/api/hermes/rules/draft") {
    return { action: "draft" };
  }
  if (url.pathname === "/api/hermes/rules/suggest") {
    return { action: "suggest" };
  }

  const runMatch = /^\/api\/hermes\/rules\/([^/]+)\/run$/.exec(url.pathname);
  if (runMatch) {
    return {
      action: "run",
      ruleId: decodeURIComponent(runMatch[1]),
    };
  }

  const updateMatch = /^\/api\/hermes\/rules\/([^/]+)$/.exec(url.pathname);
  if (updateMatch) {
    return {
      action: "update",
      ruleId: decodeURIComponent(updateMatch[1]),
    };
  }

  const match = /^\/api\/hermes\/rules\/([^/]+)\/(simulate|approve)$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  return {
    action: match[2] as "simulate" | "approve",
    candidateId: decodeURIComponent(match[1]),
  };
}

export function parseHermesRuleExecutionRoute(
  requestUrl: string | undefined,
): { action: "list" } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  return url.pathname === "/api/hermes/rule-runs" ? { action: "list" } : undefined;
}

export function parseHermesRuleCandidateRoute(
  requestUrl: string | undefined,
):
  | { action: "list" }
  | { action: "update"; candidateId: string }
  | { action: "dismiss"; candidateId: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/hermes/rule-candidates") {
    return { action: "list" };
  }

  const dismissMatch = /^\/api\/hermes\/rule-candidates\/([^/]+)\/dismiss$/.exec(
    url.pathname,
  );
  if (dismissMatch) {
    return {
      action: "dismiss",
      candidateId: decodeURIComponent(dismissMatch[1]),
    };
  }

  const match = /^\/api\/hermes\/rule-candidates\/([^/]+)$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  return {
    action: "update",
    candidateId: decodeURIComponent(match[1]),
  };
}

export function parseHermesActionPlanRoute(
  requestUrl: string | undefined,
):
  | { action: "create" }
  | { action: "confirm"; planId: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/hermes/action-plans") {
    return { action: "create" };
  }

  const match = /^\/api\/hermes\/action-plans\/([^/]+)\/confirm$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  return {
    action: "confirm",
    planId: decodeURIComponent(match[1]),
  };
}

export function parseHermesSkillSettingsRoute(
  requestUrl: string | undefined,
): { skillId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/api\/hermes\/skills\/([^/]+)\/settings$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  return { skillId: decodeURIComponent(match[1]) };
}

export function isHermesWorkspaceContextRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  const url = new URL(requestUrl, "http://localhost");
  return url.pathname === "/api/hermes/workspace/context";
}

export function parseHermesWorkspaceContextInput(requestUrl: string | undefined): {
  accountId?: string;
  ruleLimit?: number;
  labelLimit?: number;
} {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  return {
    ...optionalWorkspaceContextParam(url, "accountId"),
    ...optionalWorkspaceContextLimit(url, "ruleLimit"),
    ...optionalWorkspaceContextLimit(url, "labelLimit"),
  };
}

export function parseHermesSkillSettingsPatch(body: string): HermesSkillSettingsPatch {
  const payload = JSON.parse(body) as Record<string, unknown>;
  const allowed = new Set([
    "enabled",
    "maxContextChars",
    "memoryLimit",
    "allowBodyRead",
    "allowMemoryWrite",
    "requireConfirmation",
    "customInstructions",
  ]);
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !allowed.has(key))
  ) {
    throw new InvalidHermesSkillSettingsRequestError();
  }

  const patch: HermesSkillSettingsPatch = {};
  if (payload.enabled !== undefined) {
    patch.enabled = readHermesSkillSettingsBoolean(payload.enabled);
  }
  if (payload.maxContextChars !== undefined) {
    patch.maxContextChars = readHermesSkillSettingsInteger(
      payload.maxContextChars,
    );
  }
  if (payload.memoryLimit !== undefined) {
    patch.memoryLimit = readHermesSkillSettingsInteger(payload.memoryLimit);
  }
  if (payload.allowBodyRead !== undefined) {
    patch.allowBodyRead = readHermesSkillSettingsBoolean(payload.allowBodyRead);
  }
  if (payload.allowMemoryWrite !== undefined) {
    patch.allowMemoryWrite = readHermesSkillSettingsBoolean(
      payload.allowMemoryWrite,
    );
  }
  if (payload.requireConfirmation !== undefined) {
    patch.requireConfirmation = readHermesSkillSettingsBoolean(
      payload.requireConfirmation,
    );
  }
  if (payload.customInstructions !== undefined) {
    patch.customInstructions = readHermesSkillSettingsCustomInstructions(
      payload.customInstructions,
    );
  }
  if (Object.keys(patch).length === 0) {
    throw new InvalidHermesSkillSettingsRequestError();
  }

  return patch;
}

export function readHermesSkillSettingsBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidHermesSkillSettingsRequestError();
  }

  return value;
}

export function readHermesSkillSettingsInteger(value: unknown): number {
  if (!Number.isInteger(value)) {
    throw new InvalidHermesSkillSettingsRequestError();
  }

  return value as number;
}

export function readHermesSkillSettingsCustomInstructions(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidHermesSkillSettingsRequestError();
  }

  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length > HERMES_SKILL_CUSTOM_INSTRUCTIONS_MAX_LENGTH ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)
  ) {
    throw new InvalidHermesSkillSettingsRequestError();
  }

  return normalized;
}

export function optionalWorkspaceContextParam<
  K extends "accountId",
>(url: URL, key: K): Partial<Record<K, string>> {
  const value = url.searchParams.get(key)?.trim();
  if (!value) {
    return {};
  }
  if (value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    throw new InvalidHermesWorkspaceContextRequestError();
  }

  return { [key]: value } as Partial<Record<K, string>>;
}

export function optionalWorkspaceContextLimit<
  K extends "ruleLimit" | "labelLimit",
>(url: URL, key: K): Partial<Record<K, number>> {
  const value = url.searchParams.get(key);
  if (!value) {
    return {};
  }
  if (!/^\d+$/.test(value)) {
    throw new InvalidHermesWorkspaceContextRequestError();
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidHermesWorkspaceContextRequestError();
  }

  return { [key]: parsed } as Partial<Record<K, number>>;
}

export function parseLabelRoute(
  requestUrl: string | undefined,
): { accountId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }
  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/api\/accounts\/([^/]+)\/labels$/.exec(url.pathname);
  return match ? { accountId: decodeURIComponent(match[1]) } : undefined;
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  );
}

export function parseReauthorizationRecoveryRoute(
  requestUrl: string | undefined,
):
  | { action: "oauth_callback" }
  | { action: "oauth_start"; taskId: string }
  | { action: "imap_smtp"; taskId: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/sync-center/reauthorizations/oauth/callback") {
    return { action: "oauth_callback" };
  }

  const match =
    /^\/api\/sync-center\/reauthorizations\/([^/]+)\/(oauth\/start|imap-smtp)$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  return {
    taskId: decodeURIComponent(match[1]),
    action: match[2] === "oauth/start" ? "oauth_start" : "imap_smtp",
  };
}

export function parseSyncControlRoute(
  requestUrl: string | undefined,
):
  | {
      accountId: string;
      action: "resync" | "pause" | "resume" | "retry_failed";
    }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match =
    /^\/api\/sync-center\/accounts\/([^/]+)\/(resync|pause|resume|retry-failed)$/.exec(
      url.pathname,
    );
  if (!match) {
    return undefined;
  }

  const action = match[2] === "retry-failed" ? "retry_failed" : match[2];
  return {
    accountId: decodeURIComponent(match[1]),
    action: action as "resync" | "pause" | "resume" | "retry_failed",
  };
}

export function parseSyncDiagnosticsRoute(
  requestUrl: string | undefined,
):
  | {
      accountId: string;
      lane: "sync";
      level?: "debug" | "info" | "warn" | "error";
      jobId?: string;
      limit?: number;
    }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/api\/sync-center\/accounts\/([^/]+)\/diagnostics$/.exec(
    url.pathname,
  );
  if (!match) {
    return undefined;
  }

  const rawLevel = url.searchParams.get("level")?.trim();
  if (rawLevel && !isOperationalEventLevel(rawLevel)) {
    throw new InvalidOperationalEventQueryError();
  }
  const level = rawLevel && isOperationalEventLevel(rawLevel) ? rawLevel : undefined;
  const jobId = url.searchParams.get("jobId")?.trim();
  if (jobId && (jobId.length > 256 || /[\u0000-\u001f]/.test(jobId))) {
    throw new InvalidOperationalEventQueryError();
  }

  return {
    accountId: decodeURIComponent(match[1]),
    lane: "sync",
    ...(level ? { level } : {}),
    ...(jobId ? { jobId } : {}),
    ...(() => {
      const limit = parseOperationalEventLimit(url.searchParams.get("limit"));
      return limit !== undefined ? { limit } : {};
    })(),
  };
}

export function isSyncDiagnosticsRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  const url = new URL(requestUrl, "http://localhost");
  return /^\/api\/sync-center\/accounts\/([^/]+)\/diagnostics$/.test(
    url.pathname,
  );
}
