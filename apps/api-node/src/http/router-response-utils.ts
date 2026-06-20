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
import { parseImapSmtpOnboardingInput, parseImapSmtpConnectionTestInput, parseImapSmtpAccountInput, parseMailComposeDraftInput, parseScheduledMailComposeDraftInput, parseMailComposePreviewInput, parseMailComposeSeedInput, parseProviderSendIdentityCandidateInput, parseProviderSendIdentityCandidateType, parseProviderSendIdentityUserTargetInput, parseComposeAttachmentUploadFilename, parseComposeAttachmentUploadContentType, parseContentLength, singleHeader, parseMailComposeFrom, parseScheduleDraftInput, parseRescheduleInput, parseMailActionInput, parseUpsertLabelInput, parseLabelColor, parseMailBulkActionInput, parseMailActionName, parseCreateFollowUpInput, parseUpdateFollowUpInput, isFollowUpKind, isFollowUpSource, isMutableFollowUpStatus, parseMailComposeSource, parseMailComposeAttachments, parseMailComposeAddresses, parseMailComposeAddress, parseCsvImportInput, parseAccountTransferExportInput, parseAccountTransferImportInput, parseReauthorizationOAuthStartInput, parseReauthorizationOAuthCallbackInput, parseReauthorizationImapSmtpInput, parseReauthorizationEndpoint, parseEndpoint, isNonEmptyString } from "./router-account-compose-inputs.js";

export function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function buildApiHealth(config: ApiConfig): Promise<{
  statusCode: 200 | 503;
  body: {
    service: string;
    ok: boolean;
    checks?: {
      database: "ok" | "unavailable";
    };
  };
}> {
  if (!config.databaseHealthCheck) {
    return {
      statusCode: 200,
      body: { service: config.apiName, ok: true },
    };
  }

  try {
    await config.databaseHealthCheck();
    return {
      statusCode: 200,
      body: {
        service: config.apiName,
        ok: true,
        checks: { database: "ok" },
      },
    };
  } catch {
    config.logger?.warn("api_health_check_failed", { check: "database" });
    return {
      statusCode: 503,
      body: {
        service: config.apiName,
        ok: false,
        checks: { database: "unavailable" },
      },
    };
  }
}

export function mailProviderCapabilityOptions(
  config: ApiConfig,
): MailProviderCapabilityOptions {
  return {
    oauthProvidersConfigured: config.oauthProvidersConfigured,
  };
}

export async function buildMailEngineHealth(config: ApiConfig): Promise<{
  provider: "emailengine";
  ok: boolean;
  detail: string;
  checks: {
    url: "configured" | "missing";
    http: "ok" | "unavailable" | "skipped";
    accessToken: "configured" | "missing";
    apiAuth: "ok" | "unauthorized" | "unavailable" | "skipped";
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
    setupActions: Array<{
      code: string;
      label: string;
      env: string[];
      effect: string;
    }>;
  };
}> {
  const urlConfigured = config.emailEngineUrl.trim().length > 0;
  const accessTokenConfigured = config.emailEngineAccessTokenConfigured === true;
  const preparedTokenConfigured = config.emailEnginePreparedTokenConfigured;
  const webhookSecretConfigured =
    config.emailEngineWebhookSecret.trim().length > 0;
  const webhookSecretUsesDefault =
    config.emailEngineWebhookSecretUsesDefault === true ||
    config.emailEngineWebhookSecret === "dev-emailhub-secret";
  const authServerSecretUsesDefault =
    config.emailEngineAuthServerSecretUsesDefault === true ||
    (config.emailEngineAuthServerSecret !== undefined &&
      config.emailEngineAuthServerSecret === "dev-emailhub-secret");
  const emailEngineServiceSecretUsesDefault =
    config.emailEngineServiceSecretUsesDefault === true;
  const probeResult = await checkEmailEngineRuntime(config, urlConfigured);
  const httpAvailable =
    probeResult.http === "ok" || probeResult.http === "skipped";
  const apiAuth = accessTokenConfigured && "auth" in probeResult
    ? probeResult.auth
    : "skipped";
  const apiAuthInternalError =
    "authError" in probeResult &&
    probeResult.authError === "emailengine_api_internal_error";
  const apiAuthAvailable = apiAuth === "ok" || apiAuth === "skipped";
  const tokenBackedServicesAvailable =
    accessTokenConfigured && apiAuthAvailable;
  const capabilities = {
    urlConfigured,
    accessTokenConfigured,
    imapSmtpOnboarding:
      tokenBackedServicesAvailable && Boolean(config.accountOnboardingService),
    attachmentDownload:
      tokenBackedServicesAvailable &&
      Boolean(config.attachmentDownloadService),
    send: tokenBackedServicesAvailable && Boolean(config.mailComposeService),
  };
  const missing = getMissingEmailEngineConfiguration(config);
  const warnings = [
    ...(probeResult.http === "unavailable"
      ? ["EMAILENGINE_HTTP_UNAVAILABLE"]
      : []),
    ...(apiAuth === "unauthorized"
      ? ["EMAILENGINE_ACCESS_TOKEN_REJECTED"]
      : []),
    ...(apiAuth === "unavailable" && apiAuthInternalError
      ? ["EMAILENGINE_API_INTERNAL_ERROR"]
      : []),
    ...(apiAuth === "unavailable" && !apiAuthInternalError
      ? ["EMAILENGINE_API_AUTH_UNAVAILABLE"]
      : []),
    ...(webhookSecretConfigured && webhookSecretUsesDefault
      ? ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"]
      : []),
    ...(authServerSecretUsesDefault
      ? ["EMAILENGINE_AUTH_SERVER_SECRET_DEFAULT"]
      : []),
    ...(emailEngineServiceSecretUsesDefault ? ["EENGINE_SECRET_DEFAULT"] : []),
    ...(accessTokenConfigured && preparedTokenConfigured === false
      ? ["EENGINE_PREPARED_TOKEN_MISSING"]
      : []),
  ];
  const setupActions = [
    ...(!urlConfigured
      ? [
          {
            code: "set_emailengine_url",
            label: "设置 EmailEngine 服务地址",
            env: ["EMAILENGINE_URL"],
            effect: "API 无法调用 EmailEngine。",
          },
        ]
      : []),
    ...(probeResult.http === "unavailable"
      ? [
          {
            code: "check_emailengine_runtime",
            label: "检查 EmailEngine 容器状态",
            env: ["EMAILENGINE_URL"],
            effect: "API 当前无法连通 EmailEngine /health。",
          },
        ]
      : []),
    ...(!accessTokenConfigured
      ? [
          {
            code: "set_emailengine_access_token",
            label: "设置 EmailEngine 访问令牌",
            env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
            effect: "添加邮箱、附件下载、发信和同步任务会失败。",
          },
        ]
      : []),
    ...(accessTokenConfigured && apiAuth === "unauthorized"
      ? [
          {
            code: "replace_emailengine_access_token",
            label: "更新 EmailEngine 访问令牌",
            env: ["EMAILENGINE_ACCESS_TOKEN", "EENGINE_PREPARED_TOKEN"],
            effect:
              "EmailEngine 拒绝当前访问令牌，添加邮箱、附件下载、发信和同步任务会失败。",
          },
        ]
      : []),
    ...(accessTokenConfigured && apiAuth === "unavailable" && apiAuthInternalError
      ? [
          {
            code: "recover_emailengine_api_state",
            label: "修复 EmailEngine API 状态",
            env: [
              "EENGINE_SECRET",
              "EENGINE_PREPARED_TOKEN",
              "EMAILENGINE_ACCESS_TOKEN",
            ],
            effect:
              "EmailEngine /health 正常但账号 API 返回 5xx，通常是旧 Redis volume 中的加密状态与当前密钥或令牌不匹配；请固定密钥或使用全新 volume 后重启。",
          },
        ]
      : []),
    ...(accessTokenConfigured && apiAuth === "unavailable" && !apiAuthInternalError
      ? [
          {
            code: "check_emailengine_api_auth",
            label: "检查 EmailEngine API 认证接口",
            env: ["EMAILENGINE_URL", "EMAILENGINE_ACCESS_TOKEN"],
            effect:
              "API 当前无法通过 EmailEngine 认证接口，添加邮箱、附件下载、发信和同步任务会失败。",
          },
        ]
      : []),
    ...(accessTokenConfigured && preparedTokenConfigured === false
      ? [
          {
            code: "set_emailengine_prepared_token",
            label: "设置 EmailEngine 预置令牌",
            env: ["EENGINE_PREPARED_TOKEN"],
            effect: "Docker 无人值守启动时 EmailEngine 容器可能不会导入 API 使用的访问令牌。",
          },
        ]
      : []),
    ...(!webhookSecretConfigured
      ? [
          {
            code: "set_emailengine_webhook_secret",
            label: "设置 EmailEngine 回调密钥",
            env: ["EMAILENGINE_WEBHOOK_SECRET", "EENGINE_SECRET"],
            effect: "EmailEngine webhook 无法安全校验。",
          },
        ]
      : []),
    ...(webhookSecretConfigured && webhookSecretUsesDefault
      ? [
          {
            code: "rotate_emailengine_webhook_secret",
            label: "替换默认回调密钥",
            env: ["EMAILENGINE_WEBHOOK_SECRET", "EENGINE_SECRET"],
            effect: "生产环境不应继续使用开发默认密钥。",
          },
        ]
      : []),
    ...(authServerSecretUsesDefault
      ? [
          {
            code: "rotate_emailengine_auth_server_secret",
            label: "替换默认 EmailEngine 授权服务密钥",
            env: ["EMAILENGINE_AUTH_SERVER_SECRET", "EMAILENGINE_AUTH_SERVER_URL"],
            effect:
              "生产环境不应继续使用开发默认授权服务密钥向 EmailEngine 提供 OAuth 凭据。",
          },
        ]
      : []),
    ...(emailEngineServiceSecretUsesDefault
      ? [
          {
            code: "rotate_emailengine_service_secret",
            label: "替换默认 EmailEngine 服务密钥",
            env: ["EENGINE_SECRET"],
            effect: "生产环境不应继续使用开发默认 EmailEngine 服务密钥。",
          },
        ]
      : []),
  ];
  const ready =
    urlConfigured &&
    accessTokenConfigured &&
    httpAvailable &&
    apiAuthAvailable &&
    setupActions.length === 0;

  return {
    provider: "emailengine",
    ok:
      urlConfigured &&
      accessTokenConfigured &&
      httpAvailable &&
      apiAuthAvailable,
    detail: `adapter boundary ready: ${config.emailEngineUrl}`,
    checks: {
      url: urlConfigured ? "configured" : "missing",
      http: probeResult.http,
      accessToken: accessTokenConfigured ? "configured" : "missing",
      apiAuth,
      ...(typeof preparedTokenConfigured === "boolean"
        ? {
            preparedToken: preparedTokenConfigured ? "configured" : "missing",
          }
        : {}),
      webhookSecret: !webhookSecretConfigured
        ? "missing"
        : webhookSecretUsesDefault
          ? "default"
          : "custom",
    },
    capabilities,
    missing,
    warnings,
    readiness: {
      status: ready ? "ready" : "degraded",
      summary: ready
        ? "EmailEngine 已具备上线配置。"
        : "EmailEngine 配置未完全就绪，部分上线能力会降级。",
      setupActions,
    },
  };
}

export async function checkEmailEngineRuntime(
  config: ApiConfig,
  urlConfigured: boolean,
): Promise<EmailEngineHealthProbeResult | { http: "skipped" }> {
  if (!urlConfigured || !config.mailEngineHealthProbe) {
    return { http: "skipped" };
  }

  try {
    return await config.mailEngineHealthProbe.check();
  } catch {
    return { http: "unavailable", error: "probe_failed", auth: "skipped" };
  }
}

export async function writeEmailEngineAuthServerResponse(
  request: IncomingMessage,
  response: ServerResponse,
  config: ApiConfig,
): Promise<void> {
  if (!isEmailEngineAuthServerAuthorized(request, config)) {
    writeJson(response, 401, { error: "emailengine_auth_server_unauthorized" });
    return;
  }

  if (!config.emailEngineAuthServerService) {
    writeJson(response, 503, { error: "emailengine_auth_server_unavailable" });
    return;
  }

  const url = new URL(request.url ?? "", "http://email-hub.local");
  const accountId = url.searchParams.get("account")?.trim();
  const proto = url.searchParams.get("proto")?.trim();
  if (!accountId || !isEmailEngineAuthServerProto(proto)) {
    writeJson(response, 400, { error: "invalid_emailengine_auth_server_request" });
    return;
  }

  try {
    const credentials =
      await config.emailEngineAuthServerService.resolveCredentials({
        accountId,
        proto,
      });
    writeJson(response, 200, credentials);
  } catch (error) {
    if (error instanceof InvalidEmailEngineAuthServerRequestError) {
      writeJson(response, error.statusCode, { error: error.code });
      return;
    }

    config.logger?.warn("emailengine_auth_server_failed", {
      accountId,
      proto,
    });
    writeJson(response, 503, { error: "emailengine_auth_server_unavailable" });
  }
}

export function isEmailEngineAuthServerAuthorized(
  request: IncomingMessage,
  config: ApiConfig,
): boolean {
  const secret = config.emailEngineAuthServerSecret;
  if (!secret) {
    return false;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  const expected = `Basic ${Buffer.from(`emailengine:${secret}`).toString(
    "base64",
  )}`;
  return safeEqual(authorization, expected);
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildEmailEngineConfigurationRequired(
  config: ApiConfig,
  capability: string,
): {
  error: "emailengine_configuration_required";
  capability: string;
  missing: string[];
} {
  return {
    error: "emailengine_configuration_required",
    capability,
    missing: getMissingEmailEngineConfiguration(config),
  };
}

export function getMissingEmailEngineConfiguration(config: ApiConfig): string[] {
  return [
    ...(config.emailEngineUrl.trim().length > 0 ? [] : ["EMAILENGINE_URL"]),
    ...(config.emailEngineAccessTokenConfigured === true
      ? []
      : ["EMAILENGINE_ACCESS_TOKEN"]),
    ...((config.emailEngineAccessTokenConfigured === true &&
      config.emailEnginePreparedTokenConfigured === false)
      ? ["EENGINE_PREPARED_TOKEN"]
      : []),
    ...(config.emailEngineWebhookSecret.trim().length > 0
      ? []
      : ["EMAILENGINE_WEBHOOK_SECRET"]),
  ];
}

export async function writeAttachmentDownload(
  response: ServerResponse,
  attachment: AttachmentDownloadRef,
  download: {
    body: Response;
    contentType?: string;
    contentLength?: string;
  },
  maxBytes: number,
): Promise<void> {
  const contentLength = parseAttachmentContentLength(download.contentLength);
  if (contentLength !== undefined) {
    enforceAttachmentDownloadLimit(contentLength, maxBytes);
  }

  response.writeHead(200, {
    "content-type": safeAttachmentContentType(
      download.contentType ?? attachment.contentType,
    ),
    "x-content-type-options": "nosniff",
    "content-disposition": buildAttachmentContentDisposition(
      attachment.filename,
    ),
    ...(contentLength !== undefined
      ? { "content-length": String(contentLength) }
      : {}),
  });

  if (!download.body.body) {
    response.end();
    return;
  }

  const reader = download.body.body.getReader();
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        response.destroy(new RequestBodyTooLargeError());
        return;
      }

      if (chunk.byteLength > 0 && !response.write(chunk)) {
        await once(response, "drain");
      }
    }

    response.end();
  } catch (error) {
    response.destroy(error instanceof Error ? error : new Error("download failed"));
  }
}

export function enforceAttachmentDownloadLimit(size: number, maxBytes: number): void {
  if (!Number.isFinite(size) || size < 0 || size > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
}

export function parseAttachmentContentLength(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function safeAttachmentContentType(value: string | undefined): string {
  const baseType = value?.split(";")[0]?.trim().toLowerCase();
  if (!baseType || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(baseType)) {
    return FALLBACK_ATTACHMENT_CONTENT_TYPE;
  }
  if (isActiveAttachmentContentType(baseType)) {
    return FALLBACK_ATTACHMENT_CONTENT_TYPE;
  }

  return baseType;
}

export function isActiveAttachmentContentType(contentType: string): boolean {
  return (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "image/svg+xml" ||
    contentType === "text/xml" ||
    contentType === "application/xml" ||
    contentType === "application/javascript" ||
    contentType === "text/javascript" ||
    contentType === "application/ecmascript" ||
    contentType === "text/ecmascript"
  );
}

export function buildAttachmentContentDisposition(filename: string): string {
  const fallback = asciiAttachmentFilename(filename);
  const encoded = encodeRfc5987Value(safeFilenameValue(filename));
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function asciiAttachmentFilename(filename: string): string {
  const sanitized = safeFilenameValue(filename)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  return (sanitized || "attachment").slice(0, 180);
}

export function safeFilenameValue(filename: string): string {
  return filename
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[\/\\]/g, "_")
    .trim()
    .slice(0, 180) || "attachment";
}

export function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function readBody(
  request: IncomingMessage,
  maxBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<string> {
  return (await readBodyBuffer(request, maxBytes)).toString("utf8");
}

export async function readBodyBuffer(
  request: IncomingMessage,
  maxBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}
