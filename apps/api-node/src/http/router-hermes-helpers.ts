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
import { sanitizeImapSmtpConnectionTestResult, sanitizeImapSmtpConnectionCheck, sanitizeImapSmtpConnectionDiagnostic, asImapSmtpOnboardingFailedError, asReauthorizationFailedError, readImapSmtpDiagnostics, isImapSmtpConnectionDiagnostic, imapSmtpInputMode, imapSmtpSensitiveValues, reauthorizationImapSmtpSensitiveValues, rememberSensitiveValues, safeErrorForDiagnostics, safeErrorMessage, scrubKnownSensitiveText, parseRequestId, isRequestPath, readScopedRouteAccountId, isAdminOnlyForAccountScopedTokenRoute, isHermesRuleAdminRoute, isHermesRuleCandidateAdminRoute, isHermesAccountQueryMissingRoute, isHermesGlobalSkillAdminRoute, isAccountScopedHermesSkillRunRoute, isAccountBodyScopedHermesSkillRunRoute, isAccountBodyScopedHermesActionPlanRoute, isAccountBodyScopedHermesRuleRoute, readHermesSkillRunAccountId, readOptionalQueryAccountId, rejectAccountScopedAccess, rejectAccountScopedAdminRoute, isDiagnosticsReadAuthorized, rejectDiagnosticsRead, getRequestPathname, isDiagnosticsLogRoute, isOperationalEventsRoute, parseComposeAttachmentMaintenanceRoute, parseHermesRetentionMaintenanceRoute, parseComposeAttachmentMaintenanceCleanupInput, parseHermesRetentionMaintenanceCleanupInput, readHermesRetentionMaintenanceInteger, readComposeAttachmentMaintenanceInteger, isHermesAuditLogRoute } from "./router-route-guards.js";
import { parseHermesRuntimeRoute, parseHermesProviderProbeRoute, parseMailProviderCapabilityRoute, parseHermesProviderProbeInput, parseHermesProviderProbeJsonObject, parseHermesRuntimeUpdateInput, parseHermesRuntimeJsonObject, parseHermesAuditLogListInput, optionalQueryParam, parseHermesAuditLogLimit, parseDiagnosticsLogListInput, parseDiagnosticsLimit, parseOperationalEventListInput, optionalOperationalQueryParam, parseOperationalEventLimit, parseHermesMemoryRoute, parseHermesRuleRoute, parseHermesRuleExecutionRoute, parseHermesRuleCandidateRoute, parseHermesActionPlanRoute, parseHermesSkillSettingsRoute, isHermesWorkspaceContextRoute, parseHermesWorkspaceContextInput, parseHermesSkillSettingsPatch, readHermesSkillSettingsBoolean, readHermesSkillSettingsInteger, readHermesSkillSettingsCustomInstructions, optionalWorkspaceContextParam, optionalWorkspaceContextLimit, parseLabelRoute, isStringArray, parseReauthorizationRecoveryRoute, parseSyncControlRoute, parseSyncDiagnosticsRoute, isSyncDiagnosticsRoute } from "./router-route-parsers.js";
import { parseMailComposeRoute, parseOptionalMailComposeLimit, parseMailActionRoute, parseMailBulkActionRoute, parseFollowUpRoute, parseOptionalFollowUpStatus, parseOptionalFollowUpLimit, parseSmartInboxFeedbackRoute, parseSenderScreeningRoute, parseGatekeeperSettingsRoute, parseSenderScreeningStatus, parseAttachmentDownloadRoute, parseOAuthRoute, parseMailReadRoute, parseHermesMessageTranslationRoute, parseHermesMessageSummaryRoute, parseHermesMessageReplyDraftRoute, parseHermesMessageQuickReplyRoute, parseHermesMessageOrganizationRoute, parseHermesMessageFollowupRoute, parseLimit, parseMailSort, parseMailSavedViewId, parseMailQuickFilters, parseMailMailboxRole, parseMailMailboxId, parseMailSearchScopes, parseMailLabelIds, parseMailTagMode, parseMailStructuredText, parseMailDateBound, parseOptionalMailBoolean, uniqueMailValues, isUuid, parseMailReadCursor, parseMailSearchQuery, parseSmartInboxFeedbackInput, parseSenderScreeningDomainBlockInput, parseSenderScreeningSenderDecisionInput, parseSenderScreeningBulkInput, parseGatekeeperSettingsInput, isSmartInboxFeedbackAction } from "./router-mail-parsers.js";
import { parseOAuthStartInput, parseOAuthCallbackInput, parseHermesSkillRunAccountId, parseHermesTranslateInput, parseHermesMessageTranslationInput, rejectHermesMessageTranslationClientContext, parseHermesMessageSummaryInput, parseHermesMessageReplyDraftInput, parseHermesMessageQuickReplyInput, parseHermesMessageOrganizationInput, parseHermesMessageFollowupInput, parseHermesReplyDraftInput, parseHermesQuickReplyInput, parseHermesRewritePolishInput, isHermesQuickReplyScenario, isHermesRewritePolishAction, parseHermesThreadSummaryInput, isHermesThreadSummaryMode, parseHermesActionItemExtractInput, parseHermesLabelSuggestInput, parseHermesNewsletterCleanupInput, parseHermesPriorityTriageInput, parsePriorityTriageScore, parseHermesFollowupTrackerInput, parseHermesFollowUpConfirmationInput, parseHermesTranslationPreferenceInput, isHermesTranslationPreferenceMode, parseTranslationPreferenceText, isActionableHermesFollowUpStatus, parseHermesFollowUpReasons, parseHermesDraftFeedbackInput, parseHermesMemoryListInput, parseHermesMemoryAccountId, parseHermesMemoryPatchInput, parseOptionalHermesMemoryFilter, parseHermesMemoryLimit, parseHermesRuleSuggestInput, parseHermesActionPlanCreateInput, parseHermesActionPlanConfirmInput, parseHermesRuleDraftInput, parseHermesRuleSimulationInput, parseHermesRuleUpdateInput, parseHermesRuleCandidateUpdateInput, parseHermesRuleCandidateDismissInput, parseHermesRuleRunInput, parseOptionalHermesActionPlanInteger, parseHermesRuleListInput, parseHermesRuleExecutionListInput, parseHermesRuleCandidateListInput, parseOptionalHermesRuleCandidateStatus, parseOptionalHermesRuleInteger, parseOptionalHermesRuleTextPatch, parseOptionalHermesRuleLabelColor, parseOptionalHermesRuleBooleanPatch, parseOptionalHermesRuleKeywords, parseOptionalHermesRuleBoolean, parseHermesRuleLimit, parseOptionalStringArray, parseOptionalHermesMessageTranslationArray, parseOptionalHermesMessageSummaryArray, parseOptionalHermesMessageReplyArray, parseOptionalHermesMessageOrganizationArray, parseOptionalHermesMessageFollowupArray } from "./router-hermes-inputs.js";
import { parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString } from "./router-account-compose-inputs.js";
import { writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-response-utils.js";

export async function recordOperationalEvent(
  config: ApiConfig,
  event: OperationalEventRecordInput,
): Promise<void> {
  if (!config.operationalEventLogService) {
    return;
  }

  try {
    await config.operationalEventLogService.recordEvent(event);
  } catch (error) {
    config.logger?.warn("operational_event_record_failed", {
      event: event.event,
      accountId: event.accountId,
      error,
    });
  }
}

export async function ensureHermesSkillAllowed(
  config: ApiConfig,
  skillId: string,
  options: { requiresBodyRead?: boolean; requiresMemoryWrite?: boolean } = {},
): Promise<HermesSkill | undefined> {
  if (!config.hermesSkillSettingsService) {
    return undefined;
  }

  const skill = await config.hermesSkillSettingsService.getSkill(skillId);
  if (!skill) {
    throw new InvalidHermesSkillSettingsRequestError("unknown Hermes skill");
  }
  if (!skill.settings.enabled) {
    throw new HermesSkillDisabledError(skillId);
  }
  if (options.requiresBodyRead && !skill.settings.allowBodyRead) {
    throw new HermesSkillDisabledError(
      skillId,
      "Hermes skill body reads are disabled",
      "body_read",
    );
  }
  if (options.requiresMemoryWrite && !skill.settings.allowMemoryWrite) {
    throw new HermesSkillDisabledError(
      skillId,
      "Hermes skill memory writes are disabled",
      "memory_write",
    );
  }

  return skill;
}

export function withHermesSkillContextBudget<T extends object>(
  input: T,
  skill: HermesSkill | undefined,
): T & {
  maxContextChars?: number;
  memoryLimit?: number;
  customInstructions?: string;
} {
  if (!skill) {
    return input;
  }

  return {
    ...input,
    maxContextChars: skill.settings.maxContextChars,
    memoryLimit: skill.settings.memoryLimit,
    ...((skill.settings.customInstructions ?? "")
      ? { customInstructions: skill.settings.customInstructions ?? "" }
      : {}),
  };
}

export function withHermesSkillsContextBudget<T extends object>(
  input: T,
  skills: Array<HermesSkill | undefined>,
): T & {
  maxContextChars?: number;
  memoryLimit?: number;
  customInstructionsBySkillId?: Record<string, string>;
} {
  const budgets = skills
    .map((skill) => skill?.settings.maxContextChars)
    .filter((value): value is number => typeof value === "number");
  const memoryLimits = skills
    .map((skill) => skill?.settings.memoryLimit)
    .filter((value): value is number => typeof value === "number");
  const customInstructionsBySkillId = Object.fromEntries(
    skills
      .filter((skill): skill is HermesSkill => Boolean(skill))
      .map((skill) => [skill.id, skill.settings.customInstructions ?? ""])
      .filter(([, customInstructions]) => customInstructions.length > 0),
  );
  const customInstructionsPatch =
    Object.keys(customInstructionsBySkillId).length > 0
      ? { customInstructionsBySkillId }
      : {};
  if (budgets.length === 0) {
    return {
      ...input,
      ...(memoryLimits.length > 0
        ? { memoryLimit: Math.min(...memoryLimits) }
        : {}),
      ...customInstructionsPatch,
    };
  }

  return {
    ...input,
    maxContextChars: Math.min(...budgets),
    ...(memoryLimits.length > 0
      ? { memoryLimit: Math.min(...memoryLimits) }
      : {}),
    ...customInstructionsPatch,
  };
}

export function withHermesInputTextBudget<T extends object>(
  input: T,
  skill: HermesSkill | undefined,
): T & { memoryLimit?: number; customInstructions?: string } {
  if (!skill) {
    return input;
  }

  const budget = { maxChars: skill.settings.maxContextChars };
  const patch: Partial<{
    text: string;
    threadText: string;
    memoryLimit: number;
    customInstructions: string;
  }> = {
    memoryLimit: skill.settings.memoryLimit,
  };
  if (skill.settings.customInstructions ?? "") {
    patch.customInstructions = skill.settings.customInstructions ?? "";
  }
  const value = input as { text?: unknown; threadText?: unknown };
  if (typeof value.text === "string") {
    patch.text = limitHermesContextText(value.text, budget);
  }
  if (typeof value.threadText === "string") {
    patch.threadText = limitHermesContextText(value.threadText, budget);
  }

  return Object.keys(patch).length > 0 ? { ...input, ...patch } : input;
}

export async function recordEmailEngineWebhookIngestEvents(
  config: ApiConfig,
  input: {
    requestId: string;
    result: IngestWebhookResult;
  },
): Promise<void> {
  const jobsByTriggerEventId = new Map(
    input.result.syncJobs.map((job) => [job.triggerEventId, job]),
  );

  for (const event of input.result.events) {
    const job = jobsByTriggerEventId.get(event.id);
    await recordOperationalEvent(config, {
      service: "email-hub-api",
      level: event.duplicate ? "debug" : "info",
      event: "emailengine_webhook_ingested",
      requestId: input.requestId,
      ...(event.accountId ? { accountId: event.accountId } : {}),
      lane: "sync",
      ...(job ? { jobId: job.id } : {}),
      message: `EmailEngine webhook ${event.kind} ingested${
        event.accountId ? ` for ${event.accountId}` : ""
      }`,
      context: {
        duplicate: event.duplicate,
        mailEngineEventId: event.id,
        mailEngineEventKind: event.kind,
        mailEngineIdempotencyKey: event.idempotencyKey,
        ...(event.providerMessageId
          ? { providerMessageId: event.providerMessageId }
          : {}),
        ...(event.providerEmailId ? { providerEmailId: event.providerEmailId } : {}),
        ...(event.rfcMessageId ? { rfcMessageId: event.rfcMessageId } : {}),
        ...(event.resourceKey ? { resourceKey: event.resourceKey } : {}),
        ...(event.resourceIdentity
          ? { resourceIdentity: event.resourceIdentity }
          : {}),
        ...(event.providerEventName
          ? { providerEventName: event.providerEventName }
          : {}),
        ...(job
          ? {
              syncJobId: job.id,
              syncJobType: job.jobType,
            }
          : {}),
      },
    });
  }
}

export async function recordHermesProviderProbeEvent(
  config: ApiConfig,
  input: {
    requestId: string;
    result: HermesProviderProbeResult;
  },
): Promise<void> {
  const { result } = input;
  await recordOperationalEvent(config, {
    service: "email-hub-api",
    level: result.ok ? "info" : result.status === "connection_failed" ? "error" : "warn",
    event: "hermes_provider_probe_completed",
    requestId: input.requestId,
    lane: "hermes",
    message: `Hermes provider probe ${result.status} for ${result.providerKey}`,
    context: {
      providerKey: result.providerKey,
      status: result.status,
      ok: result.ok,
      authType: result.authType,
      category: result.category,
      ...(result.endpointUrl ? { endpointUrl: result.endpointUrl } : {}),
      ...(result.model ? { model: result.model } : {}),
      missing: result.missing,
    },
  });
}

export async function recordHermesRuntimeConnectionTestEvent(
  config: ApiConfig,
  input: {
    requestId: string;
    ok: boolean;
    context: Record<string, unknown>;
  },
): Promise<void> {
  await recordOperationalEvent(config, {
    service: "email-hub-api",
    level: input.ok ? "info" : "error",
    event: input.ok
      ? "hermes_runtime_connection_test_completed"
      : "hermes_runtime_connection_test_failed",
    requestId: input.requestId,
    lane: "hermes",
    message: input.ok
      ? "Hermes runtime connection test completed"
      : "Hermes runtime connection test failed",
    context: input.context,
  });
}

export async function recordAccountOnboardingFailure(
  config: ApiConfig,
  input: {
    requestId: string;
    action: "test_imap_smtp_connection" | "onboard_imap_smtp";
    level: "warn" | "error";
    event:
      | "account_onboarding_connection_test_failed"
      | "account_onboarding_failed";
    provider: string;
    email: string;
    inputMode: "preset" | "manual";
    message: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  await recordOperationalEvent(config, {
    service: "email-hub-api",
    level: input.level,
    event: input.event,
    requestId: input.requestId,
    lane: "account_onboarding",
    message: input.message,
    context: {
      action: input.action,
      authMethod: "password",
      email: input.email,
      provider: input.provider,
      inputMode: input.inputMode,
      ...(input.context ?? {}),
    },
  });
}

export async function recordOAuthOnboardingFailure(
  config: ApiConfig,
  input: {
    requestId: string;
    action: "start_oauth_onboarding" | "complete_oauth_callback";
    event: "oauth_onboarding_start_failed" | "oauth_onboarding_callback_failed";
    provider: "gmail" | "outlook";
    message: string;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  await recordOperationalEvent(config, {
    service: "email-hub-api",
    level: "error",
    event: input.event,
    requestId: input.requestId,
    lane: "account_onboarding",
    message: input.message,
    context: {
      action: input.action,
      authMethod: "oauth",
      provider: input.provider,
      ...(input.context ?? {}),
    },
  });
}
