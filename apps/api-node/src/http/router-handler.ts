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
import { buildAdminModuleCatalog } from "../admin/module-catalog.js";
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
import { DEFAULT_MAX_REQUEST_BODY_BYTES, DEFAULT_MAX_COMPOSE_REQUEST_BODY_BYTES, DEFAULT_MAX_COMPOSE_ATTACHMENT_UPLOAD_BYTES, DEFAULT_MAX_ATTACHMENT_DOWNLOAD_BYTES } from "./router-constants.js";
import { InvalidImapSmtpAccountError, InvalidOAuthRequestError, InvalidMailReadRequestError, InvalidSmartInboxFeedbackError, InvalidHermesMemoryRequestError, InvalidHermesDraftFeedbackRequestError, InvalidComposeAttachmentMaintenanceRequestError, InvalidHermesRetentionMaintenanceRequestError, RequestBodyTooLargeError } from "./router-errors.js";
import { recordOperationalEvent, ensureHermesSkillAllowed, withHermesSkillContextBudget, withHermesSkillsContextBudget, withHermesInputTextBudget, recordEmailEngineWebhookIngestEvents, recordHermesProviderProbeEvent, recordHermesRuntimeConnectionTestEvent, recordAccountOnboardingFailure, recordOAuthOnboardingFailure, sanitizeImapSmtpConnectionTestResult, sanitizeImapSmtpConnectionCheck, sanitizeImapSmtpConnectionDiagnostic, asImapSmtpOnboardingFailedError, asReauthorizationFailedError, readImapSmtpDiagnostics, isImapSmtpConnectionDiagnostic, imapSmtpInputMode, imapSmtpSensitiveValues, reauthorizationImapSmtpSensitiveValues, rememberSensitiveValues, safeErrorForDiagnostics, safeErrorMessage, scrubKnownSensitiveText, parseRequestId, isRequestPath, readScopedRouteAccountId, isAdminOnlyForAccountScopedTokenRoute, isHermesRuleAdminRoute, isHermesRuleCandidateAdminRoute, isHermesAccountQueryMissingRoute, isHermesGlobalSkillAdminRoute, isAccountScopedHermesSkillRunRoute, isAccountBodyScopedHermesSkillRunRoute, isAccountBodyScopedHermesActionPlanRoute, isAccountBodyScopedHermesRuleRoute, readHermesSkillRunAccountId, readOptionalQueryAccountId, rejectAccountScopedAccess, rejectAccountScopedAdminRoute, isDiagnosticsReadAuthorized, rejectDiagnosticsRead, getRequestPathname, isDiagnosticsLogRoute, isOperationalEventsRoute, parseComposeAttachmentMaintenanceRoute, parseHermesRetentionMaintenanceRoute, parseComposeAttachmentMaintenanceCleanupInput, parseHermesRetentionMaintenanceCleanupInput, readHermesRetentionMaintenanceInteger, readComposeAttachmentMaintenanceInteger, isHermesAuditLogRoute, parseHermesRuntimeRoute, parseHermesProviderProbeRoute, parseMailProviderCapabilityRoute, parseHermesProviderProbeInput, parseHermesProviderProbeJsonObject, parseHermesRuntimeUpdateInput, parseHermesRuntimeJsonObject, parseHermesAuditLogListInput, optionalQueryParam, parseHermesAuditLogLimit, parseDiagnosticsLogListInput, parseDiagnosticsLimit, parseOperationalEventListInput, optionalOperationalQueryParam, parseOperationalEventLimit, parseHermesMemoryRoute, parseHermesRuleRoute, parseHermesRuleExecutionRoute, parseHermesRuleCandidateRoute, parseHermesActionPlanRoute, parseHermesSkillSettingsRoute, isHermesWorkspaceContextRoute, parseHermesWorkspaceContextInput, parseHermesSkillSettingsPatch, readHermesSkillSettingsBoolean, readHermesSkillSettingsInteger, readHermesSkillSettingsCustomInstructions, optionalWorkspaceContextParam, optionalWorkspaceContextLimit, parseLabelRoute, isStringArray, parseReauthorizationRecoveryRoute, parseSyncControlRoute, parseSyncDiagnosticsRoute, isSyncDiagnosticsRoute, parseMailComposeRoute, parseOptionalMailComposeLimit, parseMailActionRoute, parseMailBulkActionRoute, parseFollowUpRoute, parseOptionalFollowUpStatus, parseOptionalFollowUpLimit, parseSmartInboxFeedbackRoute, parseSenderScreeningRoute, parseGatekeeperSettingsRoute, parseSenderScreeningStatus, parseAttachmentDownloadRoute, parseOAuthRoute, parseMailReadRoute, parseHermesMessageTranslationRoute, parseHermesMessageSummaryRoute, parseHermesMessageReplyDraftRoute, parseHermesMessageQuickReplyRoute, parseHermesMessageOrganizationRoute, parseHermesMessageFollowupRoute, parseLimit, parseMailSort, parseMailSavedViewId, parseMailQuickFilters, parseMailMailboxRole, parseMailMailboxId, parseMailSearchScopes, parseMailLabelIds, parseMailTagMode, parseMailStructuredText, parseMailDateBound, parseOptionalMailBoolean, uniqueMailValues, isUuid, parseMailReadCursor, parseMailSearchQuery, parseSmartInboxFeedbackInput, parseSenderScreeningDomainBlockInput, parseSenderScreeningSenderDecisionInput, parseSenderScreeningBulkInput, parseGatekeeperSettingsInput, isSmartInboxFeedbackAction, parseOAuthStartInput, parseOAuthCallbackInput, parseHermesSkillRunAccountId, parseHermesTranslateInput, parseHermesMessageTranslationInput, rejectHermesMessageTranslationClientContext, parseHermesMessageSummaryInput, parseHermesMessageReplyDraftInput, parseHermesMessageQuickReplyInput, parseHermesMessageOrganizationInput, parseHermesMessageFollowupInput, parseHermesReplyDraftInput, parseHermesQuickReplyInput, parseHermesRewritePolishInput, isHermesQuickReplyScenario, isHermesRewritePolishAction, parseHermesThreadSummaryInput, isHermesThreadSummaryMode, parseHermesActionItemExtractInput, parseHermesLabelSuggestInput, parseHermesNewsletterCleanupInput, parseHermesPriorityTriageInput, parsePriorityTriageScore, parseHermesFollowupTrackerInput, parseHermesFollowUpConfirmationInput, parseHermesTranslationPreferenceInput, isHermesTranslationPreferenceMode, parseTranslationPreferenceText, isActionableHermesFollowUpStatus, parseHermesFollowUpReasons, parseHermesDraftFeedbackInput, parseHermesMemoryListInput, parseHermesMemoryAccountId, parseHermesMemoryPatchInput, parseOptionalHermesMemoryFilter, parseHermesMemoryLimit, parseHermesRuleSuggestInput, parseHermesActionPlanCreateInput, parseHermesActionPlanConfirmInput, parseHermesRuleDraftInput, parseHermesRuleSimulationInput, parseHermesRuleUpdateInput, parseHermesRuleCandidateUpdateInput, parseHermesRuleCandidateDismissInput, parseHermesRuleRunInput, parseOptionalHermesActionPlanInteger, parseHermesRuleListInput, parseHermesRuleExecutionListInput, parseHermesRuleCandidateListInput, parseOptionalHermesRuleCandidateStatus, parseOptionalHermesRuleInteger, parseOptionalHermesRuleTextPatch, parseOptionalHermesRuleLabelColor, parseOptionalHermesRuleBooleanPatch, parseOptionalHermesRuleKeywords, parseOptionalHermesRuleBoolean, parseHermesRuleLimit, parseOptionalStringArray, parseOptionalHermesMessageTranslationArray, parseOptionalHermesMessageSummaryArray, parseOptionalHermesMessageReplyArray, parseOptionalHermesMessageOrganizationArray, parseOptionalHermesMessageFollowupArray, parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString, writeJson, buildApiHealth, mailProviderCapabilityOptions, buildMailEngineHealth, checkEmailEngineRuntime, writeEmailEngineAuthServerResponse, isEmailEngineAuthServerAuthorized, safeEqual, buildEmailEngineConfigurationRequired, getMissingEmailEngineConfiguration, writeAttachmentDownload, enforceAttachmentDownloadLimit, parseAttachmentContentLength, safeAttachmentContentType, isActiveAttachmentContentType, buildAttachmentContentDisposition, asciiAttachmentFilename, safeFilenameValue, encodeRfc5987Value, readBody, readBodyBuffer } from "./router-helpers.js";

export function createApiHandler(config: ApiConfig): ApiHandler {
  const ingestStore =
    config.mailEngineIngestStore ?? createInMemoryMailEngineIngestStore();
  const maxRequestBodyBytes =
    config.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  const maxComposeRequestBodyBytes =
    config.maxComposeRequestBodyBytes ?? DEFAULT_MAX_COMPOSE_REQUEST_BODY_BYTES;
  const maxComposeAttachmentUploadBytes =
    config.maxComposeAttachmentUploadBytes ??
    DEFAULT_MAX_COMPOSE_ATTACHMENT_UPLOAD_BYTES;
  const maxAttachmentDownloadBytes =
    config.maxAttachmentDownloadBytes ?? DEFAULT_MAX_ATTACHMENT_DOWNLOAD_BYTES;
  const webSessions = new Map<string, WebSession>();
  const webSessionMaxAgeSeconds =
    config.webSessionMaxAgeSeconds ?? DEFAULT_WEB_SESSION_MAX_AGE_SECONDS;
  const nowMs = () => (config.now ?? (() => new Date()))().getTime();

  return async (request, response) => {
    const requestId =
      parseRequestId(request.headers["x-request-id"]) ??
      config.requestIdFactory?.() ??
      randomUUID();
    const requestSensitiveValues: string[] = [];
    const startedAt = Date.now();
    const requestPath = sanitizeRequestUrl(request.url);
    response.setHeader("x-request-id", requestId);
    config.logger?.info("request_started", {
      requestId,
      method: request.method,
      path: requestPath,
    });
    response.once("finish", () => {
      config.logger?.info("request_completed", {
        requestId,
        method: request.method,
        path: requestPath,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    const readRequestBody = () => readBody(request, maxRequestBodyBytes);
    const readComposeRequestBody = () =>
      readBody(request, maxComposeRequestBodyBytes);
    const readComposeAttachmentBody = () =>
      readBodyBuffer(request, maxComposeAttachmentUploadBytes);

    try {
      if (
        isWebSessionRoute(request.url) &&
        (await handleWebSessionRoute({
          request,
          response,
          config,
          sessions: webSessions,
          readRequestBody,
          nowMs,
          maxAgeSeconds: webSessionMaxAgeSeconds,
        }))
      ) {
        return;
      }

      const apiAccess = resolveApiRequestAccess(
        request,
        config,
        webSessions,
        nowMs,
      );
      if (!apiAccess.authorized) {
        config.logger?.warn("api_request_unauthorized", {
          requestId,
          method: request.method,
          path: requestPath,
        });
        response.setHeader("www-authenticate", 'Bearer realm="email-hub"');
        writeJson(response, 401, { error: "api_unauthorized" });
        return;
      }
      const apiAccessContext = apiAccess.context;
      const scopedAccountId = readScopedRouteAccountId(request.url);
      if (
        scopedAccountId &&
        !isAccountAccessAllowed(apiAccessContext, scopedAccountId)
      ) {
        rejectAccountScopedAccess(
          response,
          config,
          requestId,
          requestPath,
          scopedAccountId,
        );
        return;
      }
      if (
        isApiAccessAccountScoped(apiAccessContext) &&
        isAdminOnlyForAccountScopedTokenRoute(request.url, request.method)
      ) {
        rejectAccountScopedAdminRoute(response, config, requestId, requestPath);
        return;
      }
      const ensureRouteAccountAccess = (accountId: string): boolean => {
        if (isAccountAccessAllowed(apiAccessContext, accountId)) {
          return true;
        }

        rejectAccountScopedAccess(
          response,
          config,
          requestId,
          requestPath,
          accountId,
        );
        return false;
      };

      if (request.method === "GET" && request.url === "/health") {
        const health = await buildApiHealth(config); writeJson(response, health.statusCode, health.body);
        return;
      }
      if (request.method === "GET" && request.url === "/api/admin/modules") return writeJson(response, 200, buildAdminModuleCatalog(config));
      if (request.method === "GET" && isDiagnosticsLogRoute(request.url)) {
        if (!isDiagnosticsReadAuthorized(request, config)) {
          rejectDiagnosticsRead(request, response, config, requestId, requestPath);
          return;
        }

        if (!config.diagnosticsLogStore) {
          writeJson(response, 503, { error: "diagnostics_logs_unavailable" });
          return;
        }

        writeJson(
          response,
          200,
          config.diagnosticsLogStore.list(parseDiagnosticsLogListInput(request.url)),
        );
        return;
      }

      if (request.method === "GET" && isOperationalEventsRoute(request.url)) {
        if (!isDiagnosticsReadAuthorized(request, config)) {
          rejectDiagnosticsRead(request, response, config, requestId, requestPath);
          return;
        }

        if (!config.operationalEventLogService) {
          writeJson(response, 503, { error: "operational_events_unavailable" });
          return;
        }

        const result = await config.operationalEventLogService.listEvents(
          parseOperationalEventListInput(request.url),
        );
        writeJson(response, 200, result);
        return;
      }

      const composeAttachmentMaintenanceRoute =
        parseComposeAttachmentMaintenanceRoute(request.url);
      if (composeAttachmentMaintenanceRoute) {
        if (!config.composeAttachmentMaintenanceService) {
          writeJson(response, 503, {
            error: "compose_attachment_maintenance_unavailable",
          });
          return;
        }

        if (
          composeAttachmentMaintenanceRoute === "status" &&
          request.method === "GET"
        ) {
          writeJson(
            response,
            200,
            await config.composeAttachmentMaintenanceService.getStatus(),
          );
          return;
        }

        if (
          composeAttachmentMaintenanceRoute === "cleanup" &&
          request.method === "POST"
        ) {
          writeJson(
            response,
            202,
            await config.composeAttachmentMaintenanceService.cleanup(
              parseComposeAttachmentMaintenanceCleanupInput(
                await readRequestBody(),
              ),
            ),
          );
          return;
        }
      }

      const hermesRetentionMaintenanceRoute =
        parseHermesRetentionMaintenanceRoute(request.url);
      if (hermesRetentionMaintenanceRoute) {
        if (!config.hermesRetentionMaintenanceService) {
          writeJson(response, 503, {
            error: "hermes_retention_maintenance_unavailable",
          });
          return;
        }

        if (
          hermesRetentionMaintenanceRoute === "status" &&
          request.method === "GET"
        ) {
          writeJson(
            response,
            200,
            await config.hermesRetentionMaintenanceService.getStatus(),
          );
          return;
        }

        if (
          hermesRetentionMaintenanceRoute === "cleanup" &&
          request.method === "POST"
        ) {
          writeJson(
            response,
            202,
            await config.hermesRetentionMaintenanceService.cleanup(
              parseHermesRetentionMaintenanceCleanupInput(
                await readRequestBody(),
              ),
            ),
          );
          return;
        }
      }

      if (
        request.method === "GET" &&
        request.url === "/api/mail-engine/health"
      ) {
        writeJson(response, 200, await buildMailEngineHealth(config));
        return;
      }

      if (
        request.method === "GET" &&
        request.url?.startsWith("/api/mail-engine/auth-server")
      ) {
        await writeEmailEngineAuthServerResponse(request, response, config);
        return;
      }

      if (request.method === "GET" && request.url === "/api/hermes/providers") {
        writeJson(response, 200, {
          providers: getHermesProviderCatalog(),
        });
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/api/mail-providers/capabilities"
      ) {
        writeJson(response, 200, {
          providers: listProviderCapabilities(
            mailProviderCapabilityOptions(config),
          ),
        });
        return;
      }

      const mailProviderCapabilityRoute = parseMailProviderCapabilityRoute(
        request.url,
      );
      if (request.method === "GET" && mailProviderCapabilityRoute) {
        const capability = findProviderCapability(
          mailProviderCapabilityRoute.provider,
          mailProviderCapabilityOptions(config),
        );
        if (!capability) {
          writeJson(response, 404, {
            error: "mail_provider_capability_not_found",
          });
          return;
        }

        writeJson(response, 200, capability);
        return;
      }

      const hermesProviderProbeRoute = parseHermesProviderProbeRoute(request.url);
      if (hermesProviderProbeRoute && request.method === "POST") {
        const service =
          config.hermesProviderProbeService ??
          createHermesProviderProbeService();
        const result = await service.probe(
          parseHermesProviderProbeInput(
            hermesProviderProbeRoute.providerKey,
            await readRequestBody(),
          ),
        );
        await recordHermesProviderProbeEvent(config, {
          requestId,
          result,
        });
        writeJson(
          response,
          200,
          result,
        );
        return;
      }

      const hermesRuntimeRoute = parseHermesRuntimeRoute(request.url);
      if (hermesRuntimeRoute) {
        if (!config.hermesRuntimeConfigService) {
          writeJson(response, 503, {
            error: "hermes_runtime_config_unavailable",
          });
          return;
        }

        if (hermesRuntimeRoute === "settings" && request.method === "GET") {
          writeJson(
            response,
            200,
            await config.hermesRuntimeConfigService.getSettings(),
          );
          return;
        }

        if (hermesRuntimeRoute === "settings" && request.method === "PUT") {
          writeJson(
            response,
            200,
            await config.hermesRuntimeConfigService.updateSettings(
              parseHermesRuntimeUpdateInput(await readRequestBody()),
            ),
          );
          return;
        }

        if (hermesRuntimeRoute === "test" && request.method === "POST") {
          try {
            const result =
              await config.hermesRuntimeConfigService.testConnection();
            await recordHermesRuntimeConnectionTestEvent(config, {
              requestId,
              ok: true,
              context: {
                action: "test_runtime_connection",
                providerKey: result.providerKey,
                requestProtocol: result.requestProtocol,
                endpointUrl: result.endpointUrl,
                model: result.model,
              },
            });
            writeJson(response, 200, result);
          } catch (error) {
            if (error instanceof InvalidHermesRuntimeConfigRequestError) {
              throw error;
            }
            await recordHermesRuntimeConnectionTestEvent(config, {
              requestId,
              ok: false,
              context: {
                action: "test_runtime_connection",
                error: {
                  name: error instanceof Error ? error.name : "Error",
                  message: "Hermes runtime connection test failed",
                },
              },
            });
            writeJson(response, 400, {
              error: "hermes_runtime_connection_test_failed",
            });
          }
          return;
        }

        if (hermesRuntimeRoute === "version" && request.method === "GET") {
          writeJson(
            response,
            200,
            await config.hermesRuntimeConfigService.getVersionStatus(),
          );
          return;
        }

        if (
          hermesRuntimeRoute === "update_check" &&
          request.method === "POST"
        ) {
          writeJson(
            response,
            200,
            await config.hermesRuntimeConfigService.checkForUpdates(),
          );
          return;
        }
      }

      if (request.method === "GET" && request.url === "/api/hermes/skills") {
        writeJson(
          response,
          200,
          config.hermesSkillSettingsService
            ? await config.hermesSkillSettingsService.listSkills()
            : getHermesSkills(),
        );
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/api/hermes/resource-profile"
      ) {
        const skills = config.hermesSkillSettingsService
          ? await config.hermesSkillSettingsService.listSkills()
          : getHermesSkills();
        writeJson(
          response,
          200,
          createHermesResourceProfile({
            skills,
            retention: config.hermesRetentionPolicy,
          }),
        );
        return;
      }

      const hermesSkillSettingsRoute = parseHermesSkillSettingsRoute(
        request.url,
      );
      if (hermesSkillSettingsRoute && request.method === "PATCH") {
        if (!config.hermesSkillSettingsService) {
          writeJson(response, 503, {
            error: "hermes_skill_settings_unavailable",
          });
          return;
        }

        const result = await config.hermesSkillSettingsService.updateSkillSettings(
          {
            skillId: hermesSkillSettingsRoute.skillId,
            patch: parseHermesSkillSettingsPatch(await readRequestBody()),
          },
        );
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "GET" &&
        isHermesWorkspaceContextRoute(request.url)
      ) {
        if (!config.hermesWorkspaceContextService) {
          writeJson(response, 503, {
            error: "hermes_workspace_context_unavailable",
          });
          return;
        }

        writeJson(
          response,
          200,
          await config.hermesWorkspaceContextService.getContext(
            parseHermesWorkspaceContextInput(request.url),
          ),
        );
        return;
      }

      if (request.method === "GET" && isHermesAuditLogRoute(request.url)) {
        if (!config.hermesAuditLogService) {
          writeJson(response, 503, { error: "hermes_audit_log_unavailable" });
          return;
        }

        const input = parseHermesAuditLogListInput(request.url);
        if (isApiAccessAccountScoped(apiAccessContext) && !input.accountId) {
          rejectAccountScopedAdminRoute(response, config, requestId, requestPath);
          return;
        }
        if (input.accountId && !ensureRouteAccountAccess(input.accountId)) {
          return;
        }
        const result = await config.hermesAuditLogService.listAuditEvents(
          input,
        );
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/translation-preferences"
      ) {
        if (!config.hermesTranslationPreferenceService) {
          writeJson(response, 503, {
            error: "translation_preferences_unavailable",
          });
          return;
        }

        const input = parseHermesTranslationPreferenceInput(
          await readRequestBody(),
        );
        if (!ensureRouteAccountAccess(input.accountId)) {
          return;
        }
        await ensureHermesSkillAllowed(config, "translate_text", {
          requiresMemoryWrite: true,
        });
        const result =
          await config.hermesTranslationPreferenceService.confirmTranslationPreference(
            input,
          );
        writeJson(response, 201, result);
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/api/sync-center/accounts"
      ) {
        if (!config.syncCenterStore) {
          writeJson(response, 503, { error: "sync_center_unavailable" });
          return;
        }

        const result = await config.syncCenterStore.listAccounts();
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/api/mail-navigation/summary"
      ) {
        if (!config.mailNavigationService) {
          writeJson(response, 503, { error: "mail_navigation_unavailable" });
          return;
        }

        writeJson(response, 200, await config.mailNavigationService.getSummary());
        return;
      }

      if (
        request.method === "GET" &&
        request.url === "/api/sync-center/reauthorizations"
      ) {
        if (!config.syncCenterStore) {
          writeJson(response, 503, { error: "sync_center_unavailable" });
          return;
        }

        const result = await config.syncCenterStore.listReauthorizations();
        writeJson(response, 200, result);
        return;
      }

      if (isSyncDiagnosticsRoute(request.url) && request.method === "GET") {
        if (!isDiagnosticsReadAuthorized(request, config)) {
          rejectDiagnosticsRead(request, response, config, requestId, requestPath);
          return;
        }

        const syncDiagnosticsRoute = parseSyncDiagnosticsRoute(request.url);
        if (!syncDiagnosticsRoute) {
          writeJson(response, 404, { error: "not_found" });
          return;
        }

        if (!config.operationalEventLogService) {
          writeJson(response, 503, { error: "sync_diagnostics_unavailable" });
          return;
        }

        writeJson(
          response,
          200,
          await config.operationalEventLogService.listEvents(syncDiagnosticsRoute),
        );
        return;
      }

      const syncControlRoute = parseSyncControlRoute(request.url);
      if (syncControlRoute && request.method === "POST") {
        if (!config.syncControlService) {
          writeJson(response, 503, { error: "sync_control_unavailable" });
          return;
        }

        const input = { accountId: syncControlRoute.accountId };
        if (syncControlRoute.action === "resync") {
          const result = await config.syncControlService.requestManualSync(input);
          writeJson(response, 202, result);
          return;
        }
        if (syncControlRoute.action === "pause") {
          const result = await config.syncControlService.pause(input);
          writeJson(response, 202, result);
          return;
        }
        if (syncControlRoute.action === "resume") {
          const result = await config.syncControlService.resume(input);
          writeJson(response, 202, result);
          return;
        }

        const result = await config.syncControlService.retryFailed(input);
        await recordOperationalEvent(config, {
          service: "email-hub-api",
          level: "info",
          event: "sync_control_retry_failed",
          accountId: result.accountId,
          message: `Requeued ${result.retriedJobCount} failed sync jobs`,
          context: {
            action: result.action,
            retriedJobCount: result.retriedJobCount,
            retriedJobIds: result.retriedJobIds,
          },
        });
        writeJson(response, 202, result);
        return;
      }

      const mailComposeRoute = parseMailComposeRoute(request.url);
      if (mailComposeRoute) {
        if (!config.mailComposeService) {
          writeJson(response, 503, { error: "mail_compose_unavailable" });
          return;
        }

        if (
          mailComposeRoute.action === "list_send_identities" &&
          request.method === "GET"
        ) {
          writeJson(
            response,
            200,
            await config.mailComposeService.listSendIdentities({
              accountId: mailComposeRoute.accountId,
            }),
          );
          return;
        }

        if (
          mailComposeRoute.action === "add_send_identity_candidate" &&
          request.method === "POST"
        ) {
          const result =
            await config.mailComposeService.addProviderSendIdentityCandidate(
              parseProviderSendIdentityCandidateInput(
                mailComposeRoute.accountId,
                await readRequestBody(),
              ),
            );
          writeJson(response, 201, result);
          return;
        }

        if (
          mailComposeRoute.action === "verify_send_identity_candidate" &&
          request.method === "POST"
        ) {
          const result =
            await config.mailComposeService.verifyProviderSendIdentityCandidate({
              accountId: mailComposeRoute.accountId,
              candidateId: mailComposeRoute.candidateId,
            });
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "diagnose_send_identity_candidate" &&
          request.method === "GET"
        ) {
          const result =
            await config.mailComposeService.diagnoseProviderSendIdentityCandidate(
              {
                accountId: mailComposeRoute.accountId,
                candidateId: mailComposeRoute.candidateId,
              },
            );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "verify_send_identity_user_target" &&
          request.method === "POST"
        ) {
          const result =
            await config.mailComposeService.verifyProviderSendIdentityUserTarget(
              parseProviderSendIdentityUserTargetInput(
                mailComposeRoute.accountId,
                mailComposeRoute.candidateId,
                await readRequestBody(),
              ),
            );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "upload_attachment" &&
          request.method === "POST"
        ) {
          if (!config.composeAttachmentBlobStore) {
            writeJson(response, 503, {
              error: "compose_attachment_storage_unavailable",
            });
            return;
          }
          const declaredUploadBytes = parseContentLength(request);
          if (
            declaredUploadBytes !== undefined &&
            declaredUploadBytes > maxComposeAttachmentUploadBytes
          ) {
            throw new RequestBodyTooLargeError();
          }
          const uploadInput = {
            accountId: mailComposeRoute.accountId,
            filename: parseComposeAttachmentUploadFilename(request),
            contentType: parseComposeAttachmentUploadContentType(request),
          };
          const attachment =
            config.composeAttachmentBlobStore.saveUploadedAttachmentStream
              ? await config.composeAttachmentBlobStore.saveUploadedAttachmentStream({
                  ...uploadInput,
                  stream: request,
                  maxBytes: maxComposeAttachmentUploadBytes,
                })
              : await config.composeAttachmentBlobStore.saveUploadedAttachment({
                  ...uploadInput,
                  bytes: await readComposeAttachmentBody(),
                });
          writeJson(response, 201, {
            id: attachment.id,
            source: attachment.source,
            attachmentId: attachment.attachmentId,
            ...(attachment.storageKey
              ? { storageKey: attachment.storageKey }
              : {}),
            filename: attachment.filename,
            contentType: attachment.contentType,
            byteSize: attachment.byteSize,
            inline: attachment.inline,
            ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
          });
          return;
        }

        if (
          mailComposeRoute.action === "draft_collection" &&
          request.method === "GET"
        ) {
          const result = await config.mailComposeService.listDrafts({
            accountId: mailComposeRoute.accountId,
            limit: mailComposeRoute.limit,
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "draft_collection" &&
          request.method === "POST"
        ) {
          const result = await config.mailComposeService.createDraft(
            parseMailComposeDraftInput(
              mailComposeRoute.accountId,
              await readComposeRequestBody(),
            ),
          );
          writeJson(response, 201, result);
          return;
        }

        if (
          mailComposeRoute.action === "update_draft" &&
          request.method === "PATCH"
        ) {
          const result = await config.mailComposeService.updateDraft(
            parseMailComposeDraftInput(
              mailComposeRoute.accountId,
              await readComposeRequestBody(),
              mailComposeRoute.draftId,
            ),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "preview_draft" &&
          request.method === "POST"
        ) {
          const result = await config.mailComposeService.previewDraft(
            parseMailComposePreviewInput(
              mailComposeRoute.accountId,
              await readComposeRequestBody(),
            ),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "create_seed" &&
          request.method === "POST"
        ) {
          const result = await config.mailComposeService.createComposeSeed(
            parseMailComposeSeedInput(
              mailComposeRoute.accountId,
              mailComposeRoute.messageId,
              mailComposeRoute.mode,
              await readRequestBody(),
            ),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "send_draft" &&
          request.method === "POST"
        ) {
          const result = await config.mailComposeService.sendDraft({
            accountId: mailComposeRoute.accountId,
            draftId: mailComposeRoute.draftId,
          });
          writeJson(response, 202, result);
          return;
        }

        if (
          mailComposeRoute.action === "schedule_draft" &&
          request.method === "POST"
        ) {
          const result = await config.mailComposeService.scheduleDraft(
            parseScheduleDraftInput(
              mailComposeRoute.accountId,
              mailComposeRoute.draftId,
              await readRequestBody(),
            ),
          );
          writeJson(response, 202, result);
          return;
        }

        if (
          mailComposeRoute.action === "list_outbox" &&
          request.method === "GET"
        ) {
          const result = await config.mailComposeService.listOutbox({
            accountId: mailComposeRoute.accountId,
            limit: mailComposeRoute.limit,
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "send_scheduled_now" &&
          request.method === "POST"
        ) {
          const result = await config.mailComposeService.sendScheduledNow({
            accountId: mailComposeRoute.accountId,
            scheduledId: mailComposeRoute.scheduledId,
          });
          writeJson(response, 202, result);
          return;
        }

        if (
          mailComposeRoute.action === "scheduled_draft" &&
          request.method === "GET"
        ) {
          const result = await config.mailComposeService.getScheduledDraft({
            accountId: mailComposeRoute.accountId,
            scheduledId: mailComposeRoute.scheduledId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "scheduled_draft" &&
          request.method === "PATCH"
        ) {
          const result = await config.mailComposeService.updateScheduledDraft(
            parseScheduledMailComposeDraftInput(
              mailComposeRoute.accountId,
              mailComposeRoute.scheduledId,
              await readComposeRequestBody(),
            ),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "scheduled_item" &&
          request.method === "PATCH"
        ) {
          const result =
            await config.mailComposeService.rescheduleScheduledSend(
              parseRescheduleInput(
                mailComposeRoute.accountId,
                mailComposeRoute.scheduledId,
                await readRequestBody(),
              ),
            );
          writeJson(response, 200, result);
          return;
        }

        if (
          mailComposeRoute.action === "scheduled_item" &&
          request.method === "DELETE"
        ) {
          const result = await config.mailComposeService.cancelScheduledSend({
            accountId: mailComposeRoute.accountId,
            scheduledId: mailComposeRoute.scheduledId,
          });
          writeJson(response, 200, result);
          return;
        }
      }

      const mailBulkActionRoute = parseMailBulkActionRoute(request.url);
      if (mailBulkActionRoute && request.method === "POST") {
        if (
          !config.mailActionService ||
          typeof config.mailActionService.applyBulkAction !== "function"
        ) {
          writeJson(response, 503, { error: "mail_actions_unavailable" });
          return;
        }

        const result = await config.mailActionService.applyBulkAction(
          parseMailBulkActionInput(
            mailBulkActionRoute.accountId,
            mailBulkActionRoute.bucket,
            await readRequestBody(),
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      const mailActionRoute = parseMailActionRoute(request.url);
      if (mailActionRoute && request.method === "POST") {
        if (!config.mailActionService) {
          writeJson(response, 503, { error: "mail_actions_unavailable" });
          return;
        }

        const result = await config.mailActionService.applyAction(
          parseMailActionInput(
            mailActionRoute.accountId,
            mailActionRoute.messageId,
            await readRequestBody(),
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      const followUpRoute = parseFollowUpRoute(request.url);
      if (followUpRoute) {
        if (!config.followUpService) {
          writeJson(response, 503, { error: "follow_ups_unavailable" });
          return;
        }

        if (
          followUpRoute.action === "create" &&
          request.method === "POST"
        ) {
          const result = await config.followUpService.createFollowUp(
            parseCreateFollowUpInput(
              followUpRoute.accountId,
              followUpRoute.messageId,
              await readRequestBody(),
            ),
          );
          writeJson(response, 201, result);
          return;
        }

        if (followUpRoute.action === "list" && request.method === "GET") {
          if (!ensureRouteAccountAccess(followUpRoute.accountId)) {
            return;
          }

          const result = await config.followUpService.listFollowUps({
            accountId: followUpRoute.accountId,
            status: followUpRoute.status,
            limit: followUpRoute.limit,
          });
          writeJson(response, 200, result);
          return;
        }

        if (followUpRoute.action === "item" && request.method === "PATCH") {
          const result = await config.followUpService.updateFollowUp(
            parseUpdateFollowUpInput(
              followUpRoute.id,
              await readRequestBody(),
            ),
          );
          writeJson(response, 200, result);
          return;
        }

        if (followUpRoute.action === "item" && request.method === "DELETE") {
          const result = await config.followUpService.cancelFollowUp({
            id: followUpRoute.id,
          });
          writeJson(response, 200, result);
          return;
        }
      }

      if (
        await handleDomainAliasRoute({
          request,
          response,
          service: config.domainAliasService,
          readBody: readRequestBody,
        })
      ) {
        return;
      }

      const reauthorizationRoute = parseReauthorizationRecoveryRoute(
        request.url,
      );
      if (reauthorizationRoute && request.method === "POST") {
        if (!config.reauthorizationRecoveryService) {
          writeJson(response, 503, {
            error: "reauthorization_recovery_unavailable",
          });
          return;
        }

        if (reauthorizationRoute.action === "oauth_callback") {
          const payload = parseReauthorizationOAuthCallbackInput(
            await readRequestBody(),
          );
          rememberSensitiveValues(requestSensitiveValues, [payload.code]);
          const result = await (async () => {
            try {
              return await config.reauthorizationRecoveryService!.completeOAuthCallback(
                payload,
              );
            } catch (error) {
              await recordOperationalEvent(config, {
                service: "email-hub-api",
                level: "error",
                event: "reauthorization_oauth_callback_failed",
                requestId,
                lane: "account_reauthorization",
                message: "OAuth reauthorization callback failed",
                context: {
                  action: "complete_oauth_reauthorization",
                  state: payload.state,
                  error: safeErrorForDiagnostics(
                    error,
                    requestSensitiveValues,
                  ),
                },
              });
              throw error;
            }
          })();
          writeJson(response, 202, result);
          return;
        }

        if (reauthorizationRoute.action === "oauth_start") {
          const result = await config.reauthorizationRecoveryService.startOAuth(
            parseReauthorizationOAuthStartInput(
              reauthorizationRoute.taskId,
              await readRequestBody(),
            ),
          );
          writeJson(response, 202, result);
          return;
        }

        const payload = parseReauthorizationImapSmtpInput(
          reauthorizationRoute.taskId,
          await readRequestBody(),
        );
        rememberSensitiveValues(
          requestSensitiveValues,
          reauthorizationImapSmtpSensitiveValues(payload),
        );
        const result = await (async () => {
          try {
            return await config.reauthorizationRecoveryService!.completeImapSmtp(
              payload,
            );
          } catch (error) {
            const failure = asReauthorizationFailedError(error);
            if (failure) {
              const diagnostics = failure.diagnostics.map((diagnostic) =>
                sanitizeImapSmtpConnectionDiagnostic(
                  diagnostic,
                  requestSensitiveValues,
                ),
              );
              await recordOperationalEvent(config, {
                service: "email-hub-api",
                level: "error",
                event: "reauthorization_imap_smtp_failed",
                requestId,
                lane: "account_reauthorization",
                message: `IMAP/SMTP reauthorization failed for ${failure.provider}`,
                context: {
                  action: "complete_imap_smtp_reauthorization",
                  taskId: reauthorizationRoute.taskId,
                  provider: failure.provider,
                  error: safeErrorForDiagnostics(
                    error,
                    requestSensitiveValues,
                  ),
                  ...(diagnostics.length ? { diagnostics } : {}),
                },
              });
            }

            throw error;
          }
        })();
        writeJson(response, 202, result);
        return;
      }

      const hermesMemoryRoute = parseHermesMemoryRoute(request.url);
      if (hermesMemoryRoute) {
        if (!config.hermesMemoryStore) {
          writeJson(response, 503, { error: "hermes_memory_unavailable" });
          return;
        }

        if (hermesMemoryRoute.action === "list" && request.method === "GET") {
          await ensureHermesSkillAllowed(config, "memory_review");
          const input = parseHermesMemoryListInput(request.url);
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesMemoryStore.listMemories(
            input,
          );
          writeJson(response, 200, result);
          return;
        }

        if (hermesMemoryRoute.action === "item" && request.method === "PATCH") {
          await ensureHermesSkillAllowed(config, "memory_review", {
            requiresMemoryWrite: true,
          });
          const accountId = parseHermesMemoryAccountId(request.url);
          if (!ensureRouteAccountAccess(accountId)) {
            return;
          }
          const result = await config.hermesMemoryStore.updateMemory({
            id: hermesMemoryRoute.id,
            accountId,
            ...parseHermesMemoryPatchInput(await readRequestBody()),
          });
          if (!result) {
            writeJson(response, 404, { error: "memory_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }

        if (hermesMemoryRoute.action === "item" && request.method === "DELETE") {
          await ensureHermesSkillAllowed(config, "memory_review", {
            requiresMemoryWrite: true,
          });
          const accountId = parseHermesMemoryAccountId(request.url);
          if (!ensureRouteAccountAccess(accountId)) {
            return;
          }
          const deleted = await config.hermesMemoryStore.deleteMemory({
            id: hermesMemoryRoute.id,
            accountId,
          });
          if (!deleted) {
            writeJson(response, 404, { error: "memory_not_found" });
            return;
          }

          response.writeHead(204);
          response.end();
          return;
        }
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/drafts/feedback"
      ) {
        if (!config.hermesDraftFeedbackStore) {
          writeJson(response, 503, {
            error: "hermes_draft_feedback_unavailable",
          });
          return;
        }

        const input = parseHermesDraftFeedbackInput(await readRequestBody());
        const skillRun =
          await config.hermesDraftFeedbackStore.getDraftFeedbackSkillRun({
            skillRunId: input.skillRunId,
          });
        if (!skillRun) {
          writeJson(response, 404, { error: "draft_run_not_found" });
          return;
        }
        await ensureHermesSkillAllowed(config, skillRun.skillId, {
          requiresMemoryWrite: true,
        });
        const result =
          await config.hermesDraftFeedbackStore.recordDraftFeedback(input);
        if (!result) {
          writeJson(response, 404, { error: "draft_run_not_found" });
          return;
        }

        writeJson(response, 202, result);
        return;
      }

      const hermesActionPlanRoute = parseHermesActionPlanRoute(request.url);
      if (hermesActionPlanRoute) {
        if (!config.hermesActionPlanService) {
          writeJson(response, 503, {
            error: "hermes_action_plans_unavailable",
          });
          return;
        }

        if (
          hermesActionPlanRoute.action === "create" &&
          request.method === "POST"
        ) {
          const input = parseHermesActionPlanCreateInput(
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          await ensureHermesSkillAllowed(config, "action_plan");
          const result = await config.hermesActionPlanService.createPlan(
            input,
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          hermesActionPlanRoute.action === "confirm" &&
          request.method === "POST"
        ) {
          const input = parseHermesActionPlanConfirmInput(
            hermesActionPlanRoute.planId,
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          await ensureHermesSkillAllowed(config, "action_plan", {
            requiresMemoryWrite: true,
          });
          const result = await config.hermesActionPlanService.confirmPlan(
            input,
          );
          if (!result) {
            writeJson(response, 404, { error: "action_plan_target_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }
      }

      const hermesRuleExecutionRoute = parseHermesRuleExecutionRoute(request.url);
      if (hermesRuleExecutionRoute) {
        if (!config.hermesRuleService) {
          writeJson(response, 503, { error: "hermes_rules_unavailable" });
          return;
        }

        if (
          hermesRuleExecutionRoute.action === "list" &&
          request.method === "GET"
        ) {
          const input = parseHermesRuleExecutionListInput(request.url);
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.listRuleExecutions(
            input,
          );
          writeJson(response, 200, result);
          return;
        }
      }

      const hermesRuleCandidateRoute = parseHermesRuleCandidateRoute(request.url);
      if (hermesRuleCandidateRoute) {
        if (!config.hermesRuleService) {
          writeJson(response, 503, { error: "hermes_rules_unavailable" });
          return;
        }

        if (
          hermesRuleCandidateRoute.action === "list" &&
          request.method === "GET"
        ) {
          const input = parseHermesRuleCandidateListInput(request.url);
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.listRuleCandidates(
            input,
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          hermesRuleCandidateRoute.action === "update" &&
          request.method === "PATCH"
        ) {
          const input = parseHermesRuleCandidateUpdateInput(
            hermesRuleCandidateRoute.candidateId,
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.updateRuleCandidate(
            input,
          );
          if (!result) {
            writeJson(response, 404, { error: "rule_candidate_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }

        if (
          hermesRuleCandidateRoute.action === "dismiss" &&
          request.method === "POST"
        ) {
          const input = parseHermesRuleCandidateDismissInput(
            hermesRuleCandidateRoute.candidateId,
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.dismissRuleCandidate(
            input,
          );
          if (!result) {
            writeJson(response, 404, { error: "rule_candidate_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }
      }

      const hermesRuleRoute = parseHermesRuleRoute(request.url);
      if (hermesRuleRoute) {
        if (!config.hermesRuleService) {
          writeJson(response, 503, { error: "hermes_rules_unavailable" });
          return;
        }

        if (hermesRuleRoute.action === "draft" && request.method === "POST") {
          const input = parseHermesRuleDraftInput(await readRequestBody());
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          await ensureHermesSkillAllowed(config, "rule_suggest");
          const result = await config.hermesRuleService.draftRule(input);
          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "suggest" && request.method === "POST") {
          const input = parseHermesRuleSuggestInput(await readRequestBody());
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          await ensureHermesSkillAllowed(config, "rule_suggest");
          const result = await config.hermesRuleService.suggestRules(input);
          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "list" && request.method === "GET") {
          const input = parseHermesRuleListInput(request.url);
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.listRules(input);
          writeJson(response, 200, result);
          return;
        }

        if (
          hermesRuleRoute.action === "simulate" &&
          request.method === "POST"
        ) {
          const input = parseHermesRuleSimulationInput(
            hermesRuleRoute.candidateId,
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          await ensureHermesSkillAllowed(config, "rule_suggest");
          const result = await config.hermesRuleService.simulateRule(
            input,
          );
          if (!result) {
            writeJson(response, 404, { error: "rule_candidate_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "approve" && request.method === "POST") {
          writeJson(response, 409, {
            error: "hermes_rule_approval_requires_action_plan",
          });
          return;
        }

        if (hermesRuleRoute.action === "run" && request.method === "POST") {
          const input = parseHermesRuleRunInput(
            hermesRuleRoute.ruleId,
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.runRule(input);
          if (!result) {
            writeJson(response, 404, { error: "rule_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "update" && request.method === "PATCH") {
          const input = parseHermesRuleUpdateInput(
            hermesRuleRoute.ruleId,
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }
          const result = await config.hermesRuleService.updateRule(input);
          if (!result) {
            writeJson(response, 404, { error: "rule_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }
      }

      const attachmentRoute = parseAttachmentDownloadRoute(request.url);
      if (attachmentRoute && request.method === "GET") {
        if (!config.mailReadStore || !config.attachmentDownloadService) {
          if (config.emailEngineAccessTokenConfigured !== true) {
            writeJson(
              response,
              503,
              buildEmailEngineConfigurationRequired(
                config,
                "attachment_download",
              ),
            );
            return;
          }

          writeJson(response, 503, { error: "attachment_download_unavailable" });
          return;
        }

        const attachment = await config.mailReadStore.getAttachmentDownload({
          accountId: attachmentRoute.accountId,
          attachmentId: attachmentRoute.attachmentId,
        });
        if (!attachment) {
          writeJson(response, 404, { error: "attachment_not_found" });
          return;
        }
        enforceAttachmentDownloadLimit(
          attachment.byteSize,
          maxAttachmentDownloadBytes,
        );

        const download = await config.attachmentDownloadService.downloadAttachment({
          accountId: attachment.accountId,
          providerAttachmentId: attachment.providerAttachmentId,
        });
        await writeAttachmentDownload(
          response,
          attachment,
          download,
          maxAttachmentDownloadBytes,
        );
        return;
      }

      const smartInboxFeedbackRoute = parseSmartInboxFeedbackRoute(request.url);
      if (smartInboxFeedbackRoute && request.method === "POST") {
        if (!config.smartInboxFeedbackStore) {
          writeJson(response, 503, {
            error: "smart_inbox_feedback_unavailable",
          });
          return;
        }

        const payload = parseSmartInboxFeedbackInput(await readRequestBody());
        const result = await config.smartInboxFeedbackStore.recordFeedback({
          accountId: smartInboxFeedbackRoute.accountId,
          messageId: smartInboxFeedbackRoute.messageId,
          action: payload.action,
        });
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, 202, result);
        return;
      }

      const gatekeeperSettingsRoute = parseGatekeeperSettingsRoute(request.url);
      if (gatekeeperSettingsRoute) {
        if (!config.gatekeeperSettingsService) {
          writeJson(response, 503, { error: "gatekeeper_settings_unavailable" });
          return;
        }

        if (request.method === "GET") {
          const result = await config.gatekeeperSettingsService.getSettings({
            accountId: gatekeeperSettingsRoute.accountId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (request.method === "PATCH") {
          const result = await config.gatekeeperSettingsService.updateSettings({
            accountId: gatekeeperSettingsRoute.accountId,
            ...parseGatekeeperSettingsInput(await readRequestBody()),
          });
          writeJson(response, 200, result);
          return;
        }
      }

      const senderScreeningRoute = parseSenderScreeningRoute(request.url);
      if (senderScreeningRoute) {
        if (!config.senderScreeningStore) {
          writeJson(response, 503, { error: "sender_screening_unavailable" });
          return;
        }

        if (
          senderScreeningRoute.action === "list_senders" &&
          request.method === "GET"
        ) {
          if (!ensureRouteAccountAccess(senderScreeningRoute.accountId)) {
            return;
          }
          const result = await config.senderScreeningStore.listSenders({
            accountId: senderScreeningRoute.accountId,
            ...(senderScreeningRoute.status
              ? { status: senderScreeningRoute.status }
              : {}),
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          senderScreeningRoute.action === "bulk_senders" &&
          request.method === "POST"
        ) {
          const input = parseSenderScreeningBulkInput(await readRequestBody());
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }

          const result = await config.senderScreeningStore.bulkDecideSenders(input);
          writeJson(response, 202, result);
          return;
        }

        if (
          senderScreeningRoute.action === "accept_sender" &&
          request.method === "POST"
        ) {
          const input = parseSenderScreeningSenderDecisionInput(
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }

          const result = await config.senderScreeningStore.acceptSender({
            ...input,
            senderId: senderScreeningRoute.senderId,
          });
          if (!result) {
            writeJson(response, 404, {
              error: "sender_screening_rule_not_found",
            });
            return;
          }
          writeJson(response, 202, result);
          return;
        }

        if (
          senderScreeningRoute.action === "block_sender" &&
          request.method === "POST"
        ) {
          const input = parseSenderScreeningSenderDecisionInput(
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }

          const result = await config.senderScreeningStore.blockSender({
            ...input,
            senderId: senderScreeningRoute.senderId,
          });
          if (!result) {
            writeJson(response, 404, {
              error: "sender_screening_rule_not_found",
            });
            return;
          }
          writeJson(response, 202, result);
          return;
        }

        if (
          senderScreeningRoute.action === "block_domain" &&
          request.method === "POST"
        ) {
          const input = parseSenderScreeningDomainBlockInput(
            await readRequestBody(),
          );
          if (!ensureRouteAccountAccess(input.accountId)) {
            return;
          }

          const result = await config.senderScreeningStore.blockDomain({
            ...input,
            domain: senderScreeningRoute.domain,
          });
          writeJson(response, 202, result);
          return;
        }
      }

      const labelRoute = parseLabelRoute(request.url);
      if (labelRoute) {
        if (!config.labelService) {
          writeJson(response, 503, { error: "labels_unavailable" });
          return;
        }

        if (request.method === "GET") {
          const result = await config.labelService.listLabels({
            accountId: labelRoute.accountId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (request.method === "POST") {
          const result = await config.labelService.upsertLabel(
            parseUpsertLabelInput(labelRoute.accountId, await readRequestBody()),
          );
          writeJson(response, 201, result);
          return;
        }
      }

      const mailReadRoute = parseMailReadRoute(request.url);
      const messageTranslationRoute = parseHermesMessageTranslationRoute(
        request.url,
      );
      if (messageTranslationRoute && request.method === "POST") {
        if (!config.hermesMessageTranslationService) {
          writeJson(response, 503, {
            error: "hermes_message_translation_unavailable",
          });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "translate_text", {
          requiresBodyRead: true,
        });
        const result =
          await config.hermesMessageTranslationService.translateMessage(
            withHermesSkillContextBudget(
              parseHermesMessageTranslationInput(
                messageTranslationRoute.accountId,
                messageTranslationRoute.messageId,
                await readRequestBody(),
              ),
              skill,
            ),
          );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, result.cached ? 200 : 202, result);
        return;
      }

      const messageSummaryRoute = parseHermesMessageSummaryRoute(request.url);
      if (messageSummaryRoute && request.method === "POST") {
        if (!config.hermesMessageSummaryService) {
          writeJson(response, 503, {
            error: "hermes_message_summary_unavailable",
          });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "thread_summarize", {
          requiresBodyRead: true,
        });
        const result = await config.hermesMessageSummaryService.summarizeMessage(
          withHermesSkillContextBudget(
            parseHermesMessageSummaryInput(
              messageSummaryRoute.accountId,
              messageSummaryRoute.messageId,
              await readRequestBody(),
            ),
            skill,
          ),
        );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, result.cached ? 200 : 202, result);
        return;
      }

      const messageReplyDraftRoute = parseHermesMessageReplyDraftRoute(
        request.url,
      );
      if (messageReplyDraftRoute && request.method === "POST") {
        if (!config.hermesMessageReplyService) {
          writeJson(response, 503, {
            error: "hermes_message_reply_unavailable",
          });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "reply_draft", {
          requiresBodyRead: true,
        });
        const result =
          await config.hermesMessageReplyService.draftMessageReply(
            withHermesSkillContextBudget(
              parseHermesMessageReplyDraftInput(
                messageReplyDraftRoute.accountId,
                messageReplyDraftRoute.messageId,
                await readRequestBody(),
              ),
              skill,
            ),
          );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, 202, result);
        return;
      }

      const messageQuickReplyRoute = parseHermesMessageQuickReplyRoute(
        request.url,
      );
      if (messageQuickReplyRoute && request.method === "POST") {
        if (!config.hermesMessageReplyService) {
          writeJson(response, 503, {
            error: "hermes_message_reply_unavailable",
          });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "quick_reply", {
          requiresBodyRead: true,
        });
        const result =
          await config.hermesMessageReplyService.quickMessageReply(
            withHermesSkillContextBudget(
              parseHermesMessageQuickReplyInput(
                messageQuickReplyRoute.accountId,
                messageQuickReplyRoute.messageId,
                await readRequestBody(),
              ),
              skill,
            ),
          );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, 202, result);
        return;
      }

      const messageOrganizationRoute = parseHermesMessageOrganizationRoute(
        request.url,
      );
      if (messageOrganizationRoute && request.method === "POST") {
        if (!config.hermesMessageOrganizationService) {
          writeJson(response, 503, {
            error: "hermes_message_organization_unavailable",
          });
          return;
        }

        const skills = await Promise.all([
          ensureHermesSkillAllowed(config, "priority_triage", {
            requiresBodyRead: true,
          }),
          ensureHermesSkillAllowed(config, "label_suggest", {
            requiresBodyRead: true,
          }),
          ensureHermesSkillAllowed(config, "newsletter_cleanup", {
            requiresBodyRead: true,
          }),
          ensureHermesSkillAllowed(config, "action_item_extract", {
            requiresBodyRead: true,
          }),
        ]);
        const result =
          await config.hermesMessageOrganizationService.organizeMessage(
            withHermesSkillsContextBudget(
              parseHermesMessageOrganizationInput(
                messageOrganizationRoute.accountId,
                messageOrganizationRoute.messageId,
                await readRequestBody(),
              ),
              skills,
            ),
          );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, 202, result);
        return;
      }

      const messageFollowupRoute = parseHermesMessageFollowupRoute(request.url);
      if (messageFollowupRoute && request.method === "POST") {
        if (!config.hermesMessageFollowupTrackerService) {
          writeJson(response, 503, {
            error: "hermes_message_followup_unavailable",
          });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "followup_tracker", {
          requiresBodyRead: true,
        });
        const result =
          await config.hermesMessageFollowupTrackerService.trackMessageFollowup(
            withHermesSkillContextBudget(
              parseHermesMessageFollowupInput(
                messageFollowupRoute.accountId,
                messageFollowupRoute.messageId,
                await readRequestBody(),
              ),
              skill,
            ),
          );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, 202, result);
        return;
      }

      if (mailReadRoute && request.method === "GET") {
        if (!config.mailReadStore) {
          writeJson(response, 503, { error: "mail_read_unavailable" });
          return;
        }

        if (mailReadRoute.action === "list_mailboxes") {
          const result = await config.mailReadStore.listMailboxes({
            accountId: mailReadRoute.accountId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (mailReadRoute.action === "list_messages") {
          const result = await config.mailReadStore.listMessages({
            ...(mailReadRoute.accountId
              ? { accountId: mailReadRoute.accountId }
              : {}),
            ...(mailReadRoute.mailboxId
              ? { mailboxId: mailReadRoute.mailboxId }
              : {}),
            ...(mailReadRoute.mailboxRole
              ? { mailboxRole: mailReadRoute.mailboxRole }
              : {}),
            limit: mailReadRoute.limit,
            ...(mailReadRoute.cursor ? { cursor: mailReadRoute.cursor } : {}),
            ...(mailReadRoute.q ? { q: mailReadRoute.q } : {}),
            ...(mailReadRoute.sort ? { sort: mailReadRoute.sort } : {}),
            ...(mailReadRoute.savedViewId
              ? { savedViewId: mailReadRoute.savedViewId }
              : {}),
            ...(mailReadRoute.quickFilters
              ? { quickFilters: mailReadRoute.quickFilters }
              : {}),
            ...(mailReadRoute.qScopes
              ? { qScopes: mailReadRoute.qScopes }
              : {}),
            ...(mailReadRoute.labelIds
              ? { labelIds: mailReadRoute.labelIds }
              : {}),
            ...(mailReadRoute.tagMode ? { tagMode: mailReadRoute.tagMode } : {}),
            ...(mailReadRoute.senderQuery
              ? { senderQuery: mailReadRoute.senderQuery }
              : {}),
            ...(mailReadRoute.recipientQuery
              ? { recipientQuery: mailReadRoute.recipientQuery }
              : {}),
            ...(mailReadRoute.receivedAfter
              ? { receivedAfter: mailReadRoute.receivedAfter }
              : {}),
            ...(mailReadRoute.receivedBefore
              ? { receivedBefore: mailReadRoute.receivedBefore }
              : {}),
            ...(typeof mailReadRoute.hasAttachment === "boolean"
              ? { hasAttachment: mailReadRoute.hasAttachment }
              : {}),
          });
          writeJson(response, 200, result);
          return;
        }

        const message = await config.mailReadStore.getMessage({
          accountId: mailReadRoute.accountId,
          messageId: mailReadRoute.messageId,
        });
        if (!message) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, 200, message);
        return;
      }

      if (
        request.method === "POST" &&
        isRequestPath(request.url, "/api/hermes/skills/translate_text/run")
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const input = parseHermesTranslateInput(
          await readRequestBody(),
          readHermesSkillRunAccountId(
            request.url,
            "/api/hermes/skills/translate_text/run",
          ),
        );
        if (isApiAccessAccountScoped(apiAccessContext) && !input.accountId) {
          rejectAccountScopedAdminRoute(response, config, requestId, requestPath);
          return;
        }
        if (input.accountId && !ensureRouteAccountAccess(input.accountId)) {
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "translate_text");
        const result = await config.hermesService.translate(
          withHermesInputTextBudget(input, skill),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/reply_draft/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "reply_draft");
        const result = await config.hermesService.draftReply(
          withHermesInputTextBudget(
            parseHermesReplyDraftInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/quick_reply/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "quick_reply");
        const result = await config.hermesService.quickReply(
          withHermesInputTextBudget(
            parseHermesQuickReplyInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        isRequestPath(request.url, "/api/hermes/skills/rewrite_polish/run")
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const input = parseHermesRewritePolishInput(
          await readRequestBody(),
          readHermesSkillRunAccountId(
            request.url,
            "/api/hermes/skills/rewrite_polish/run",
          ),
        );
        if (isApiAccessAccountScoped(apiAccessContext) && !input.accountId) {
          rejectAccountScopedAdminRoute(response, config, requestId, requestPath);
          return;
        }
        if (input.accountId && !ensureRouteAccountAccess(input.accountId)) {
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "rewrite_polish");
        const result = await config.hermesService.rewritePolish(
          withHermesInputTextBudget(input, skill),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/thread_summarize/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "thread_summarize");
        const result = await config.hermesService.summarizeThread(
          withHermesInputTextBudget(
            parseHermesThreadSummaryInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        isRequestPath(request.url, "/api/hermes/skills/email_search_qa/run")
      ) {
        if (!config.hermesService?.searchMail) {
          writeJson(response, 503, { error: "hermes_search_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "email_search_qa");
        const input = parseHermesEmailSearchQaInput(
          await readRequestBody(),
          readHermesSkillRunAccountId(
            request.url,
            "/api/hermes/skills/email_search_qa/run",
          ),
          () =>
            new InvalidOAuthRequestError(
              "invalid_email_search_qa_request",
              400,
            ),
        );
        if (isApiAccessAccountScoped(apiAccessContext) && !input.accountId) {
          rejectAccountScopedAdminRoute(response, config, requestId, requestPath);
          return;
        }
        if (input.accountId && !ensureRouteAccountAccess(input.accountId)) {
          return;
        }

        const result = await config.hermesService.searchMail(
          withHermesSkillContextBudget(input, skill),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/action_item_extract/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "action_item_extract");
        const result = await config.hermesService.extractActionItems(
          withHermesInputTextBudget(
            parseHermesActionItemExtractInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/label_suggest/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "label_suggest");
        const result = await config.hermesService.suggestLabels(
          withHermesInputTextBudget(
            parseHermesLabelSuggestInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/newsletter_cleanup/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "newsletter_cleanup");
        const result = await config.hermesService.cleanupNewsletter(
          withHermesInputTextBudget(
            parseHermesNewsletterCleanupInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/priority_triage/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "priority_triage");
        const result = await config.hermesService.triagePriority(
          withHermesInputTextBudget(
            parseHermesPriorityTriageInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/followup_tracker/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const skill = await ensureHermesSkillAllowed(config, "followup_tracker");
        const result = await config.hermesService.trackFollowup(
          withHermesInputTextBudget(
            parseHermesFollowupTrackerInput(await readRequestBody()),
            skill,
          ),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/follow-ups/confirm"
      ) {
        if (!config.hermesFollowUpReminderService) {
          writeJson(response, 503, {
            error: "hermes_follow_up_unavailable",
          });
          return;
        }

        const input = parseHermesFollowUpConfirmationInput(
          await readRequestBody(),
        );
        if (!ensureRouteAccountAccess(input.accountId)) {
          return;
        }

        const result =
          await config.hermesFollowUpReminderService.confirmFollowUpSuggestion(
            input,
          );
        writeJson(response, 201, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/accounts/imap-smtp/test"
      ) {
        if (!config.accountOnboardingService) {
          if (config.emailEngineAccessTokenConfigured !== true) {
            writeJson(
              response,
              503,
              buildEmailEngineConfigurationRequired(
                config,
                "imap_smtp_onboarding",
              ),
            );
            return;
          }

          writeJson(response, 503, { error: "account_onboarding_unavailable" });
          return;
        }

        const payload = parseImapSmtpConnectionTestInput(await readRequestBody());
        rememberSensitiveValues(
          requestSensitiveValues,
          imapSmtpSensitiveValues(payload),
        );
        const result = sanitizeImapSmtpConnectionTestResult(
          await config.accountOnboardingService.testImapSmtpConnection(payload),
          requestSensitiveValues,
        );
        if (!result.ok) {
          await recordAccountOnboardingFailure(config, {
            requestId,
            action: "test_imap_smtp_connection",
            level: "warn",
            event: "account_onboarding_connection_test_failed",
            provider: result.provider,
            email: payload.email,
            inputMode: imapSmtpInputMode(payload),
            message: `IMAP/SMTP connection test failed for ${result.provider}`,
            context: {
              checks: result.checks,
              ...(result.diagnostics?.length
                ? { diagnostics: result.diagnostics }
                : {}),
            },
          });
        }
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/accounts/imap-smtp"
      ) {
        if (!config.accountOnboardingService) {
          if (config.emailEngineAccessTokenConfigured !== true) {
            writeJson(
              response,
              503,
              buildEmailEngineConfigurationRequired(
                config,
                "imap_smtp_onboarding",
              ),
            );
            return;
          }

          writeJson(response, 503, { error: "account_onboarding_unavailable" });
          return;
        }

        const accountOnboardingService = config.accountOnboardingService;
        const payload = parseImapSmtpOnboardingInput(await readRequestBody());
        rememberSensitiveValues(
          requestSensitiveValues,
          imapSmtpSensitiveValues(payload),
        );
        const result = await (async () => {
          try {
            return await accountOnboardingService.onboardImapSmtp(payload);
          } catch (error) {
            const onboardingFailure = asImapSmtpOnboardingFailedError(error);
            const diagnostics = onboardingFailure?.diagnostics.map((diagnostic) =>
              sanitizeImapSmtpConnectionDiagnostic(
                diagnostic,
                requestSensitiveValues,
              ),
            );
            await recordAccountOnboardingFailure(config, {
              requestId,
              action: "onboard_imap_smtp",
              level: "error",
              event: "account_onboarding_failed",
              provider: payload.provider,
              email: payload.email,
              inputMode: imapSmtpInputMode(payload),
              message: `IMAP/SMTP onboarding failed for ${payload.provider}`,
              context: {
                error: safeErrorForDiagnostics(error, requestSensitiveValues),
                ...(diagnostics?.length ? { diagnostics } : {}),
              },
            });
            throw error;
          }
        })();
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/accounts/import/csv/preview"
      ) {
        if (!config.accountImportService) {
          writeJson(response, 503, { error: "account_import_unavailable" });
          return;
        }

        const payload = parseCsvImportInput(await readRequestBody());
        const result = await config.accountImportService.previewCsv(payload);
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/accounts/import/csv"
      ) {
        if (!config.accountImportService) {
          writeJson(response, 503, { error: "account_import_unavailable" });
          return;
        }

        const payload = parseCsvImportInput(await readRequestBody());
        const result = await config.accountImportService.createImport(payload);
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/accounts/transfer/export"
      ) {
        if (!config.accountTransferService) {
          writeJson(response, 503, { error: "account_transfer_unavailable" });
          return;
        }

        const payload = parseAccountTransferExportInput(
          await readRequestBody(),
        );
        const result = await config.accountTransferService.exportConfig(payload);
        writeJson(response, 200, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/accounts/transfer/import"
      ) {
        if (!config.accountTransferService) {
          writeJson(response, 503, { error: "account_transfer_unavailable" });
          return;
        }

        const payload = parseAccountTransferImportInput(
          await readRequestBody(),
        );
        const result = await config.accountTransferService.importConfig(payload);
        writeJson(response, 202, result);
        return;
      }

      const oauthRoute = parseOAuthRoute(request.url);
      if (oauthRoute?.action === "start" && request.method === "POST") {
        if (!config.oauthOnboardingService) {
          writeJson(response, 503, { error: "oauth_onboarding_unavailable" });
          return;
        }

        const oauthOnboardingService = config.oauthOnboardingService;
        const payload = parseOAuthStartInput(await readRequestBody());
        const result = await (async () => {
          try {
            return await oauthOnboardingService.createAuthSession({
              provider: oauthRoute.provider,
              redirectUri: payload.redirectUri,
              loginHint: payload.loginHint,
            });
          } catch (error) {
            await recordOAuthOnboardingFailure(config, {
              requestId,
              action: "start_oauth_onboarding",
              event: "oauth_onboarding_start_failed",
              provider: oauthRoute.provider,
              message: `OAuth onboarding start failed for ${oauthRoute.provider}`,
              context: {
                ...(payload.loginHint ? { loginHint: payload.loginHint } : {}),
                redirectPath: sanitizeRequestUrl(payload.redirectUri),
                error: safeErrorForDiagnostics(error, requestSensitiveValues),
              },
            });
            throw error;
          }
        })();
        writeJson(response, 202, result);
        return;
      }

      if (oauthRoute?.action === "callback" && request.method === "GET") {
        if (!config.oauthOnboardingService) {
          writeJson(response, 503, { error: "oauth_onboarding_unavailable" });
          return;
        }

        const oauthOnboardingService = config.oauthOnboardingService;
        const callback = parseOAuthCallbackInput(request.url);
        rememberSensitiveValues(requestSensitiveValues, [callback.code]);
        try {
          const result = await oauthOnboardingService.completeAuthCallback({
            ...callback,
            expectedProvider: oauthRoute.provider,
          });
          writeJson(response, 202, result);
        } catch (error) {
          await recordOAuthOnboardingFailure(config, {
            requestId,
            action: "complete_oauth_callback",
            event: "oauth_onboarding_callback_failed",
            provider: oauthRoute.provider,
            message: `OAuth callback failed for ${oauthRoute.provider}`,
            context: {
              state: callback.state,
              error: safeErrorForDiagnostics(error, requestSensitiveValues),
            },
          });
          if (error instanceof InvalidOAuthCallbackError) {
            throw error;
          }
          writeJson(response, 400, {
            error: "oauth_callback_failed",
            detail: safeErrorMessage(error, requestSensitiveValues),
          });
        }
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/webhooks/emailengine"
      ) {
        const body = await readRequestBody();
        const signature = request.headers["x-ee-wh-signature"];
        const valid = verifyEmailEngineSignature({
          secret: config.emailEngineWebhookSecret,
          body,
          signature: Array.isArray(signature) ? signature[0] : signature,
        });

        if (!valid) {
          writeJson(response, 401, { error: "invalid_emailengine_signature" });
          return;
        }

        const parsed = JSON.parse(body);
        const freshness = verifyEmailEngineWebhookFreshness({
          payload: parsed,
          now: config.now?.() ?? new Date(),
          maxSkewMs:
            config.emailEngineWebhookMaxSkewMs ??
            DEFAULT_EMAILENGINE_WEBHOOK_MAX_SKEW_MS,
        });
        if (!freshness.ok) {
          const statusCode =
            freshness.reason === "outside_window" ? 401 : 400;
          writeJson(response, statusCode, {
            error:
              freshness.reason === "outside_window"
                ? "stale_emailengine_webhook"
                : "invalid_emailengine_webhook_date",
          });
          return;
        }

        const events = normalizeEmailEngineWebhook(parsed);
        const result = await ingestStore.ingestWebhook({
          events,
          rawPayload: parsed,
        });
        await recordEmailEngineWebhookIngestEvents(config, {
          requestId,
          result,
        });

        writeJson(response, 202, {
          events,
          storedEvents: result.events,
          syncJobs: result.syncJobs,
          duplicateCount: result.duplicateCount,
        });
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof InvalidImapSmtpAccountError) {
        writeJson(response, 400, {
          error: error.code,
          detail: error.message,
        });
        return;
      }

      if (error instanceof InvalidCsvImportError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidAccountTransferError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      const reauthorizationFailure = asReauthorizationFailedError(error);
      if (reauthorizationFailure) {
        const diagnostics = reauthorizationFailure.diagnostics.map((diagnostic) =>
          sanitizeImapSmtpConnectionDiagnostic(
            diagnostic,
            requestSensitiveValues,
          ),
        );
        writeJson(response, 400, {
          error: reauthorizationFailure.code,
          provider: reauthorizationFailure.provider,
          ...(diagnostics.length ? { diagnostics } : {}),
        });
        return;
      }

      const onboardingFailure = asImapSmtpOnboardingFailedError(error);
      if (onboardingFailure) {
        const diagnostics = onboardingFailure.diagnostics.map((diagnostic) =>
          sanitizeImapSmtpConnectionDiagnostic(
            diagnostic,
            requestSensitiveValues,
          ),
        );
        writeJson(response, 400, {
          error: onboardingFailure.code,
          provider: onboardingFailure.provider,
          detail: scrubKnownSensitiveText(
            onboardingFailure.message,
            requestSensitiveValues,
          ),
          ...(diagnostics.length ? { diagnostics } : {}),
        });
        return;
      }

      if (error instanceof InvalidReauthorizationRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidSyncControlRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidMailComposeRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidMailActionRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidLabelRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidDomainAliasRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof CloudflareDnsRequestError) {
        writeJson(response, error.statusCode, { error: error.code });
        return;
      }

      if (error instanceof InvalidFollowUpRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidOAuthRequestError) {
        writeJson(response, error.statusCode, { error: error.code });
        return;
      }

      if (error instanceof InvalidOAuthCallbackError) {
        writeJson(response, error.statusCode, { error: error.code });
        return;
      }

      if (error instanceof InvalidMailReadRequestError) {
        writeJson(response, error.statusCode, { error: error.code });
        return;
      }

      if (error instanceof InvalidMailSavedViewError) {
        writeJson(response, 400, { error: "invalid_mail_read_request" });
        return;
      }

      if (error instanceof InvalidSmartInboxFeedbackError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidSenderScreeningRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidGatekeeperSettingsRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesMemoryRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesDraftFeedbackRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesRuleRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesActionPlanRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesWorkspaceContextRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesFollowUpReminderRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidTranslationPreferenceRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesMessageTranslationRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesMessageSummaryRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesMessageReplyRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesMessageOrganizationRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesMessageFollowupRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesAuditLogRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesRuntimeConfigRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof HermesRuntimeNotConfiguredError) {
        writeJson(response, error.statusCode, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesSkillSettingsRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof HermesSkillDisabledError) {
        writeJson(response, error.statusCode, {
          error: error.code,
          skillId: error.skillId,
          ...(error.requiredPermission
            ? { requiredPermission: error.requiredPermission }
            : {}),
        });
        return;
      }

      if (error instanceof InvalidHermesProviderProbeRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidOperationalEventQueryError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidComposeAttachmentMaintenanceRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesRetentionMaintenanceRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (
        error instanceof RequestBodyTooLargeError ||
        error instanceof ComposeAttachmentBlobTooLargeError
      ) {
        writeJson(response, 413, { error: error.code });
        return;
      }

      config.logger?.error("request_failed", {
        requestId,
        method: request.method,
        path: requestPath,
        error: safeErrorForDiagnostics(error, requestSensitiveValues),
      });
      writeJson(response, 400, {
        error: "bad_request",
        detail: safeErrorMessage(error, requestSensitiveValues),
      });
    }
  };
}
