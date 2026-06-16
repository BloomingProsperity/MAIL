import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  normalizeEmailEngineWebhook,
  verifyEmailEngineSignature,
} from "../mail-engine/webhook.js";
import {
  createInMemoryMailEngineIngestStore,
  type IngestWebhookResult,
  type MailEngineIngestStore,
} from "../mail-engine/ingest-store.js";
import { getHermesSkills } from "../hermes/skills.js";
import { getHermesProviderCatalog } from "../hermes/provider-catalog.js";
import {
  findProviderCapability,
  listProviderCapabilities,
  type MailProviderCapabilityOptions,
} from "../mail-provider/provider-capabilities.js";
import { findBuiltInSavedView } from "../mail-navigation/saved-views.js";
import {
  createHermesProviderProbeService,
  InvalidHermesProviderProbeRequestError,
  type HermesProviderProbeResult,
  type HermesProviderProbeService,
} from "../hermes/provider-probe.js";
import {
  InvalidCsvImportError,
  type AccountCsvImportService,
} from "../accounts/csv-import.js";
import {
  InvalidAccountTransferError,
  validateTransferPackage,
  type AccountTransferPackage,
  type AccountTransferService,
} from "../accounts/account-transfer.js";
import {
  hasImapSmtpProviderPreset,
  normalizeImapSmtpProvider,
} from "../accounts/imap-smtp-onboarding.js";
import {
  InvalidReauthorizationRequestError,
  ReauthorizationFailedError,
  type ReauthorizationRecoveryService,
} from "../accounts/reauthorization-recovery.js";
import type {
  AttachmentDownloadRef,
  MailQuickFilter,
  MailReadStore,
  MailSearchScope,
  MailTagMode,
  MessageListSort,
} from "../mail-read/mail-read-store.js";
import { InvalidMailSavedViewError } from "../mail-read/postgres-mail-read-store.js";
import {
  decodeMailReadCursor,
  InvalidMailReadCursorError,
} from "../mail-read/cursor.js";
import type { HermesMemoryStore } from "../hermes/memory-store.js";
import type { HermesDraftFeedbackStore } from "../hermes/draft-feedback.js";
import {
  InvalidHermesRuleRequestError,
  type HermesRuleService,
} from "../hermes/rules.js";
import {
  InvalidHermesActionPlanRequestError,
  type HermesActionPlanService,
} from "../hermes/action-plan.js";
import {
  InvalidHermesWorkspaceContextRequestError,
  type HermesWorkspaceContextService,
} from "../hermes/workspace-context.js";
import {
  InvalidHermesFollowUpReminderRequestError,
  type HermesFollowUpReminderService,
  type HermesFollowUpReminderStatus,
} from "../hermes/followup-reminders.js";
import {
  InvalidHermesAuditLogRequestError,
  type HermesAuditLogService,
} from "../hermes/audit-log.js";
import {
  InvalidTranslationPreferenceRequestError,
  type HermesTranslationPreferenceMode,
  type HermesTranslationPreferenceService,
} from "../hermes/translation-preferences.js";
import {
  InvalidHermesMessageTranslationRequestError,
  type HermesMessageTranslationService,
} from "../hermes/message-translation.js";
import {
  InvalidHermesRuntimeConfigRequestError,
  type HermesRuntimeConfigService,
  type HermesRuntimeMode,
  type HermesRuntimeUpdateChannel,
  type HermesRuntimeUpdatePolicy,
} from "../hermes/runtime-config.js";
import type {
  SmartInboxFeedbackAction,
  SmartInboxFeedbackStore,
} from "../smart-inbox/feedback-store.js";
import {
  InvalidSenderScreeningRequestError,
  type SenderScreeningStatus,
  type SenderScreeningStore,
} from "../gatekeeper/sender-screening.js";
import {
  InvalidGatekeeperSettingsRequestError,
  isGatekeeperMode,
  type GatekeeperMode,
  type GatekeeperSettingsService,
} from "../gatekeeper/settings.js";
import type { SyncCenterStore } from "../sync-center/sync-center-store.js";
import {
  InvalidSyncControlRequestError,
  type SyncControlService,
} from "../sync-center/sync-control.js";
import {
  InvalidMailComposeRequestError,
  MAX_DRAFT_ATTACHMENT_BYTES,
  type CreateMailDraftAttachmentInput,
  type CreateMailDraftInput,
  type MailAddress,
  type MailComposePreviewInput,
  type MailComposeSeedMode,
  type MailComposeService,
  type MailDraftSource,
  type UpdateScheduledMailDraftInput,
  type UpdateMailDraftInput,
} from "../mail-compose/mail-compose.js";
import type { ComposeAttachmentBlobStore } from "../mail-compose/compose-attachment-blob-store.js";
import {
  InvalidMailActionRequestError,
  type MailAction,
  type MailBulkActionInput,
  type MailActionInput,
  type MailActionService,
} from "../mail-actions/mail-actions.js";
import {
  InvalidLabelRequestError,
  type LabelColor,
  type LabelService,
} from "../labels/labels.js";
import {
  InvalidDomainAliasRequestError,
  type CatchAllMode,
  type DomainAliasService,
} from "../domains/domain-alias.js";
import {
  InvalidFollowUpRequestError,
  type FollowUpKind,
  type FollowUpListStatus,
  type FollowUpService,
  type FollowUpSource,
  type FollowUpStatus,
} from "../follow-ups/follow-ups.js";
import type { MailNavigationSummaryService } from "../mail-navigation/navigation-summary.js";
import type { Logger } from "../logging/logger.js";
import { sanitizeRequestUrl } from "../logging/logger.js";
import type {
  EmailEngineHealthProbe,
  EmailEngineHealthProbeResult,
} from "../mail-engine/email-engine-health-probe.js";
import {
  isDiagnosticLogLevel,
  type DiagnosticsLogStore,
} from "../logging/diagnostics.js";
import {
  InvalidOperationalEventQueryError,
  isOperationalEventLevel,
  type OperationalEventRecordInput,
  type OperationalEventLogService,
} from "../logging/operational-events.js";

const DEFAULT_MAX_REQUEST_BODY_BYTES = 1_048_576;
const DEFAULT_MAX_COMPOSE_REQUEST_BODY_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_COMPOSE_ATTACHMENT_UPLOAD_BYTES = MAX_DRAFT_ATTACHMENT_BYTES;

export interface ImapSmtpEndpointSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  secret: string;
}

export interface ImapSmtpOnboardingInput {
  email: string;
  provider: string;
  displayName?: string;
  username?: string;
  secret?: string;
  imap?: ImapSmtpEndpointSettings;
  smtp?: ImapSmtpEndpointSettings;
}

export interface AccountOnboardingService {
  onboardImapSmtp(input: ImapSmtpOnboardingInput): Promise<unknown>;
  testImapSmtpConnection(
    input: ImapSmtpOnboardingInput,
  ): Promise<ImapSmtpConnectionTestResult>;
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

export interface OAuthAccountOnboardingService {
  createAuthSession(input: {
    provider: "gmail" | "outlook";
    redirectUri: string;
    loginHint?: string;
  }): Promise<unknown>;
  completeAuthCallback(input: { state: string; code: string }): Promise<unknown>;
}

export interface HermesService {
  translate(input: {
    text: string;
    targetLanguage: string;
    sourceLanguage?: string;
    tone?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<unknown>;
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
  }): Promise<unknown>;
  quickReply(input: {
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
  }): Promise<unknown>;
  rewritePolish(input: {
    text: string;
    action: "rewrite" | "polish" | "shorten" | "expand" | "tone" | "proofread";
    instruction?: string;
    tone?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<unknown>;
  summarizeThread(input: {
    subject?: string;
    threadText: string;
    mode?: "short" | "detailed" | "action_points";
    focus?: string;
    language?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<unknown>;
  searchMail?(input: {
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
  }): Promise<unknown>;
  extractActionItems(input: {
    subject?: string;
    threadText: string;
    language?: string;
    now?: string;
    readMessageIds?: string[];
    memoryIds?: string[];
    memoryScope?: string;
    memoryLayers?: string[];
  }): Promise<unknown>;
  suggestLabels(input: {
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
  }): Promise<unknown>;
  cleanupNewsletter(input: {
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
  }): Promise<unknown>;
  triagePriority(input: {
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
  }): Promise<unknown>;
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
  }): Promise<unknown>;
}

export interface AttachmentDownloadService {
  downloadAttachment(input: {
    accountId: string;
    providerAttachmentId: string;
  }): Promise<{
    body: Response;
    contentType?: string;
    contentLength?: string;
  }>;
}

export interface ApiConfig {
  apiName: string;
  emailEngineUrl: string;
  emailEngineWebhookSecret: string;
  emailEngineAccessTokenConfigured?: boolean;
  emailEnginePreparedTokenConfigured?: boolean;
  emailEngineWebhookSecretConfigured?: boolean;
  emailEngineWebhookSecretUsesDefault?: boolean;
  oauthProvidersConfigured?: MailProviderCapabilityOptions["oauthProvidersConfigured"];
  mailEngineHealthProbe?: EmailEngineHealthProbe;
  maxRequestBodyBytes?: number;
  maxComposeRequestBodyBytes?: number;
  maxComposeAttachmentUploadBytes?: number;
  mailEngineIngestStore?: MailEngineIngestStore;
  mailReadStore?: MailReadStore;
  attachmentDownloadService?: AttachmentDownloadService;
  composeAttachmentBlobStore?: ComposeAttachmentBlobStore;
  accountOnboardingService?: AccountOnboardingService;
  accountImportService?: AccountCsvImportService;
  accountTransferService?: AccountTransferService;
  oauthOnboardingService?: OAuthAccountOnboardingService;
  hermesService?: HermesService;
  hermesMessageTranslationService?: HermesMessageTranslationService;
  hermesRuntimeConfigService?: HermesRuntimeConfigService;
  hermesProviderProbeService?: HermesProviderProbeService;
  hermesTranslationPreferenceService?: HermesTranslationPreferenceService;
  hermesFollowUpReminderService?: HermesFollowUpReminderService;
  hermesAuditLogService?: HermesAuditLogService;
  hermesRuleService?: HermesRuleService;
  hermesActionPlanService?: HermesActionPlanService;
  hermesWorkspaceContextService?: HermesWorkspaceContextService;
  hermesMemoryStore?: HermesMemoryStore;
  hermesDraftFeedbackStore?: HermesDraftFeedbackStore;
  smartInboxFeedbackStore?: SmartInboxFeedbackStore;
  senderScreeningStore?: SenderScreeningStore;
  gatekeeperSettingsService?: GatekeeperSettingsService;
  syncCenterStore?: SyncCenterStore;
  reauthorizationRecoveryService?: ReauthorizationRecoveryService;
  syncControlService?: SyncControlService;
  mailComposeService?: MailComposeService;
  mailActionService?: MailActionService;
  labelService?: LabelService;
  domainAliasService?: DomainAliasService;
  followUpService?: FollowUpService;
  mailNavigationService?: MailNavigationSummaryService;
  logger?: Logger;
  diagnosticsLogStore?: DiagnosticsLogStore;
  operationalEventLogService?: OperationalEventLogService;
  databaseHealthCheck?: () => Promise<void>;
  requestIdFactory?: () => string;
}

export type ApiHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

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
      if (request.method === "GET" && request.url === "/health") {
        const health = await buildApiHealth(config);
        writeJson(response, health.statusCode, health.body);
        return;
      }

      if (request.method === "GET" && isDiagnosticsLogRoute(request.url)) {
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

      if (
        request.method === "GET" &&
        request.url === "/api/mail-engine/health"
      ) {
        writeJson(response, 200, await buildMailEngineHealth(config));
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
        writeJson(response, 200, getHermesSkills());
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

        const result = await config.hermesAuditLogService.listAuditEvents(
          parseHermesAuditLogListInput(request.url),
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

        const result =
          await config.hermesTranslationPreferenceService.confirmTranslationPreference(
            parseHermesTranslationPreferenceInput(await readRequestBody()),
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

      const syncDiagnosticsRoute = parseSyncDiagnosticsRoute(request.url);
      if (syncDiagnosticsRoute && request.method === "GET") {
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
          const bytes = await readComposeAttachmentBody();
          const attachment =
            await config.composeAttachmentBlobStore.saveUploadedAttachment({
              accountId: mailComposeRoute.accountId,
              bytes,
              filename: parseComposeAttachmentUploadFilename(request),
              contentType: parseComposeAttachmentUploadContentType(request),
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

      const domainAliasRoute = parseDomainAliasRoute(request.url);
      if (domainAliasRoute) {
        if (!config.domainAliasService) {
          writeJson(response, 503, { error: "domain_alias_unavailable" });
          return;
        }

        if (
          domainAliasRoute.action === "list_domains" &&
          request.method === "GET"
        ) {
          const result = await config.domainAliasService.listDomains();
          writeJson(response, 200, result);
          return;
        }

        if (
          domainAliasRoute.action === "list_domains" &&
          request.method === "POST"
        ) {
          const result = await config.domainAliasService.createDomain(
            parseCreateDomainInput(await readRequestBody()),
          );
          writeJson(response, 201, result);
          return;
        }

        if (
          domainAliasRoute.action === "destinations" &&
          request.method === "POST"
        ) {
          const result = await config.domainAliasService.createDestination(
            parseCreateDestinationInput(
              domainAliasRoute.domainId,
              await readRequestBody(),
            ),
          );
          writeJson(response, 201, result);
          return;
        }

        if (
          domainAliasRoute.action === "destinations" &&
          request.method === "GET"
        ) {
          const result = await config.domainAliasService.listDestinations({
            domainId: domainAliasRoute.domainId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          domainAliasRoute.action === "aliases" &&
          request.method === "POST"
        ) {
          const result = await config.domainAliasService.createAlias(
            parseCreateAliasInput(
              domainAliasRoute.domainId,
              await readRequestBody(),
            ),
          );
          writeJson(response, 201, result);
          return;
        }

        if (
          domainAliasRoute.action === "aliases" &&
          request.method === "GET"
        ) {
          const result = await config.domainAliasService.listAliases({
            domainId: domainAliasRoute.domainId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          domainAliasRoute.action === "set_catch_all" &&
          request.method === "GET"
        ) {
          const result = await config.domainAliasService.getCatchAll({
            domainId: domainAliasRoute.domainId,
          });
          writeJson(response, 200, result);
          return;
        }

        if (
          domainAliasRoute.action === "set_catch_all" &&
          request.method === "PUT"
        ) {
          const result = await config.domainAliasService.setCatchAll(
            parseCatchAllInput(domainAliasRoute.domainId, await readRequestBody()),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          domainAliasRoute.action === "list_delivery_logs" &&
          request.method === "GET"
        ) {
          const result = await config.domainAliasService.listDeliveryLogs({
            domainId: domainAliasRoute.domainId,
            limit: domainAliasRoute.limit,
          });
          writeJson(response, 200, result);
          return;
        }
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
          const result = await config.hermesMemoryStore.listMemories(
            parseHermesMemoryListInput(request.url),
          );
          writeJson(response, 200, result);
          return;
        }

        if (hermesMemoryRoute.action === "item" && request.method === "PATCH") {
          const result = await config.hermesMemoryStore.updateMemory({
            id: hermesMemoryRoute.id,
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
          const deleted = await config.hermesMemoryStore.deleteMemory({
            id: hermesMemoryRoute.id,
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

        const result =
          await config.hermesDraftFeedbackStore.recordDraftFeedback(
            parseHermesDraftFeedbackInput(await readRequestBody()),
          );
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
          const result = await config.hermesActionPlanService.createPlan(
            parseHermesActionPlanCreateInput(await readRequestBody()),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          hermesActionPlanRoute.action === "confirm" &&
          request.method === "POST"
        ) {
          const result = await config.hermesActionPlanService.confirmPlan(
            parseHermesActionPlanConfirmInput(
              hermesActionPlanRoute.planId,
              await readRequestBody(),
            ),
          );
          if (!result) {
            writeJson(response, 404, { error: "action_plan_target_not_found" });
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
          const result = await config.hermesRuleService.draftRule(
            parseHermesRuleDraftInput(await readRequestBody()),
          );
          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "suggest" && request.method === "POST") {
          const result = await config.hermesRuleService.suggestRules(
            parseHermesRuleSuggestInput(await readRequestBody()),
          );
          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "list" && request.method === "GET") {
          const result = await config.hermesRuleService.listRules(
            parseHermesRuleListInput(request.url),
          );
          writeJson(response, 200, result);
          return;
        }

        if (
          hermesRuleRoute.action === "simulate" &&
          request.method === "POST"
        ) {
          const result = await config.hermesRuleService.simulateRule(
            parseHermesRuleSimulationInput(
              hermesRuleRoute.candidateId,
              await readRequestBody(),
            ),
          );
          if (!result) {
            writeJson(response, 404, { error: "rule_candidate_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "approve" && request.method === "POST") {
          const result = await config.hermesRuleService.approveRule(
            parseHermesRuleApprovalInput(
              hermesRuleRoute.candidateId,
              await readRequestBody(),
            ),
          );
          if (!result) {
            writeJson(response, 404, { error: "rule_candidate_not_found" });
            return;
          }

          writeJson(response, 200, result);
          return;
        }

        if (hermesRuleRoute.action === "update" && request.method === "PATCH") {
          const result = await config.hermesRuleService.updateRuleEnabled(
            parseHermesRuleUpdateInput(
              hermesRuleRoute.ruleId,
              await readRequestBody(),
            ),
          );
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

        const download = await config.attachmentDownloadService.downloadAttachment({
          accountId: attachment.accountId,
          providerAttachmentId: attachment.providerAttachmentId,
        });
        await writeAttachmentDownload(response, attachment, download);
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
          const result = await config.senderScreeningStore.bulkDecideSenders(
            parseSenderScreeningBulkInput(await readRequestBody()),
          );
          writeJson(response, 202, result);
          return;
        }

        if (
          senderScreeningRoute.action === "accept_sender" &&
          request.method === "POST"
        ) {
          const result = await config.senderScreeningStore.acceptSender({
            ...parseSenderScreeningSenderDecisionInput(await readRequestBody()),
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
          const result = await config.senderScreeningStore.blockSender({
            ...parseSenderScreeningSenderDecisionInput(await readRequestBody()),
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
          const result = await config.senderScreeningStore.blockDomain({
            ...parseSenderScreeningDomainBlockInput(await readRequestBody()),
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

        const result =
          await config.hermesMessageTranslationService.translateMessage(
            parseHermesMessageTranslationInput(
              messageTranslationRoute.accountId,
              messageTranslationRoute.messageId,
              await readRequestBody(),
            ),
          );
        if (!result) {
          writeJson(response, 404, { error: "message_not_found" });
          return;
        }

        writeJson(response, result.cached ? 200 : 202, result);
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
        request.url === "/api/hermes/skills/translate_text/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const result = await config.hermesService.translate(
          parseHermesTranslateInput(await readRequestBody()),
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

        const result = await config.hermesService.draftReply(
          parseHermesReplyDraftInput(await readRequestBody()),
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

        const result = await config.hermesService.quickReply(
          parseHermesQuickReplyInput(await readRequestBody()),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/rewrite_polish/run"
      ) {
        if (!config.hermesService) {
          writeJson(response, 503, { error: "hermes_unavailable" });
          return;
        }

        const result = await config.hermesService.rewritePolish(
          parseHermesRewritePolishInput(await readRequestBody()),
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

        const result = await config.hermesService.summarizeThread(
          parseHermesThreadSummaryInput(await readRequestBody()),
        );
        writeJson(response, 202, result);
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/api/hermes/skills/email_search_qa/run"
      ) {
        if (!config.hermesService?.searchMail) {
          writeJson(response, 503, { error: "hermes_search_unavailable" });
          return;
        }

        const result = await config.hermesService.searchMail(
          parseHermesEmailSearchQaInput(await readRequestBody()),
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

        const result = await config.hermesService.extractActionItems(
          parseHermesActionItemExtractInput(await readRequestBody()),
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

        const result = await config.hermesService.suggestLabels(
          parseHermesLabelSuggestInput(await readRequestBody()),
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

        const result = await config.hermesService.cleanupNewsletter(
          parseHermesNewsletterCleanupInput(await readRequestBody()),
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

        const result = await config.hermesService.triagePriority(
          parseHermesPriorityTriageInput(await readRequestBody()),
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

        const result = await config.hermesService.trackFollowup(
          parseHermesFollowupTrackerInput(await readRequestBody()),
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

        const result =
          await config.hermesFollowUpReminderService.confirmFollowUpSuggestion(
            parseHermesFollowUpConfirmationInput(await readRequestBody()),
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
        const result = await (async () => {
          try {
            return await oauthOnboardingService.completeAuthCallback(callback);
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
            throw error;
          }
        })();
        writeJson(response, 202, result);
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
        const deliveryEventId = request.headers["x-ee-wh-event-id"];
        const events = normalizeEmailEngineWebhook(parsed, {
          deliveryEventId: Array.isArray(deliveryEventId)
            ? deliveryEventId[0]
            : deliveryEventId,
        });
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

      if (error instanceof InvalidFollowUpRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidOAuthRequestError) {
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

      if (error instanceof InvalidHermesAuditLogRequestError) {
        writeJson(response, 400, { error: error.code });
        return;
      }

      if (error instanceof InvalidHermesRuntimeConfigRequestError) {
        writeJson(response, 400, { error: error.code });
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

      if (error instanceof RequestBodyTooLargeError) {
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

async function recordOperationalEvent(
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

async function recordEmailEngineWebhookIngestEvents(
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

async function recordHermesProviderProbeEvent(
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

async function recordHermesRuntimeConnectionTestEvent(
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

async function recordAccountOnboardingFailure(
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

async function recordOAuthOnboardingFailure(
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

function sanitizeImapSmtpConnectionTestResult(
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

function sanitizeImapSmtpConnectionCheck(
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

function sanitizeImapSmtpConnectionDiagnostic(
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

function asReauthorizationFailedError(
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

function readImapSmtpDiagnostics(
  value: unknown,
): ImapSmtpConnectionDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isImapSmtpConnectionDiagnostic);
}

function isImapSmtpConnectionDiagnostic(
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

function imapSmtpInputMode(
  input: ImapSmtpOnboardingInput,
): "preset" | "manual" {
  return input.imap || input.smtp ? "manual" : "preset";
}

function imapSmtpSensitiveValues(input: ImapSmtpOnboardingInput): string[] {
  return [
    input.secret,
    input.imap?.secret,
    input.smtp?.secret,
  ].filter(isNonEmptyString);
}

function reauthorizationImapSmtpSensitiveValues(input: {
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

function rememberSensitiveValues(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function safeErrorForDiagnostics(
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

function safeErrorMessage(error: unknown, sensitiveValues: string[]): string {
  if (error instanceof Error) {
    return scrubKnownSensitiveText(error.message, sensitiveValues);
  }

  return "unknown error";
}

function scrubKnownSensitiveText(value: string, sensitiveValues: string[]): string {
  return sensitiveValues
    .filter(isNonEmptyString)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (output, secret) => output.split(secret).join("[redacted]"),
      value,
    );
}

function parseRequestId(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 128);
}

function isDiagnosticsLogRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === "/api/diagnostics/logs";
}

function isOperationalEventsRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === "/api/diagnostics/events";
}

function isHermesAuditLogRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  return new URL(requestUrl, "http://localhost").pathname === "/api/hermes/audit-log";
}

function parseHermesRuntimeRoute(
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

function parseHermesProviderProbeRoute(
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

function parseMailProviderCapabilityRoute(
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

function parseHermesProviderProbeInput(
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

function parseHermesProviderProbeJsonObject(
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

function parseHermesRuntimeUpdateInput(body: string): {
  enabled: boolean;
  mode: HermesRuntimeMode;
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

function parseHermesRuntimeJsonObject(body: string): Record<string, unknown> {
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

function parseHermesAuditLogListInput(requestUrl: string | undefined): {
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

function optionalQueryParam(
  url: URL,
  key: "accountId" | "skillId" | "messageId" | "memoryId",
): Partial<Record<typeof key, string>> {
  const value = url.searchParams.get(key)?.trim();
  return value ? { [key]: value } : {};
}

function parseHermesAuditLogLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidHermesAuditLogRequestError();
  }

  return Math.min(parsed, 100);
}

function parseDiagnosticsLogListInput(requestUrl: string | undefined): {
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

function parseDiagnosticsLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return undefined;
  }

  return Math.min(200, Math.max(1, parsed));
}

function parseOperationalEventListInput(requestUrl: string | undefined): {
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

function optionalOperationalQueryParam<
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

function parseOperationalEventLimit(value: string | null): number | undefined {
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

function parseHermesMemoryRoute(
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

function parseHermesRuleRoute(
  requestUrl: string | undefined,
):
  | { action: "list" }
  | { action: "draft" }
  | { action: "suggest" }
  | { action: "simulate"; candidateId: string }
  | { action: "approve"; candidateId: string }
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

function parseHermesActionPlanRoute(
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

function isHermesWorkspaceContextRoute(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false;
  }

  const url = new URL(requestUrl, "http://localhost");
  return url.pathname === "/api/hermes/workspace/context";
}

function parseHermesWorkspaceContextInput(requestUrl: string | undefined): {
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

function optionalWorkspaceContextParam<
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

function optionalWorkspaceContextLimit<
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

function parseLabelRoute(
  requestUrl: string | undefined,
): { accountId: string } | undefined {
  if (!requestUrl) {
    return undefined;
  }
  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/api\/accounts\/([^/]+)\/labels$/.exec(url.pathname);
  return match ? { accountId: decodeURIComponent(match[1]) } : undefined;
}

function parseDomainAliasRoute(
  requestUrl: string | undefined,
):
  | { action: "list_domains" }
  | { action: "create_destination" | "destinations"; domainId: string }
  | { action: "aliases"; domainId: string }
  | { action: "set_catch_all"; domainId: string }
  | { action: "list_delivery_logs"; domainId: string; limit: number }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/domains") {
    return { action: "list_domains" };
  }

  const destinations = /^\/api\/domains\/([^/]+)\/destinations$/.exec(
    url.pathname,
  );
  if (destinations) {
    return {
      action: "destinations",
      domainId: decodeURIComponent(destinations[1]),
    };
  }

  const aliases = /^\/api\/domains\/([^/]+)\/aliases$/.exec(url.pathname);
  if (aliases) {
    return {
      action: "aliases",
      domainId: decodeURIComponent(aliases[1]),
    };
  }

  const catchAll = /^\/api\/domains\/([^/]+)\/catch-all$/.exec(url.pathname);
  if (catchAll) {
    return {
      action: "set_catch_all",
      domainId: decodeURIComponent(catchAll[1]),
    };
  }

  const logs = /^\/api\/domains\/([^/]+)\/delivery-logs$/.exec(url.pathname);
  if (logs) {
    return {
      action: "list_delivery_logs",
      domainId: decodeURIComponent(logs[1]),
      limit: parseDomainAliasLimit(url.searchParams.get("limit")),
    };
  }

  return undefined;
}

function parseCreateDomainInput(body: string): { domain: string } {
  const payload = JSON.parse(body) as { domain?: unknown };
  if (!isNonEmptyString(payload.domain)) {
    throw new InvalidDomainAliasRequestError("domain is required");
  }

  return { domain: payload.domain };
}

function parseCreateDestinationInput(
  domainId: string,
  body: string,
): { domainId: string; email: string } {
  const payload = JSON.parse(body) as { email?: unknown };
  if (!isNonEmptyString(domainId) || !isNonEmptyString(payload.email)) {
    throw new InvalidDomainAliasRequestError("destination email is required");
  }

  return { domainId, email: payload.email };
}

function parseCreateAliasInput(
  domainId: string,
  body: string,
): { domainId: string; localPart: string; destinationIds: string[] } {
  const payload = JSON.parse(body) as {
    localPart?: unknown;
    destinationIds?: unknown;
  };
  if (!isNonEmptyString(domainId) || !isNonEmptyString(payload.localPart)) {
    throw new InvalidDomainAliasRequestError("alias local part is required");
  }
  if (!isStringArray(payload.destinationIds)) {
    throw new InvalidDomainAliasRequestError("destination ids are required");
  }

  return {
    domainId,
    localPart: payload.localPart,
    destinationIds: payload.destinationIds,
  };
}

function parseCatchAllInput(
  domainId: string,
  body: string,
): { domainId: string; mode: CatchAllMode; destinationIds?: string[] } {
  const payload = JSON.parse(body) as {
    mode?: unknown;
    destinationIds?: unknown;
  };
  if (!isNonEmptyString(domainId) || !isCatchAllMode(payload.mode)) {
    throw new InvalidDomainAliasRequestError("catch-all mode is invalid");
  }
  if (
    payload.destinationIds !== undefined &&
    !isStringArray(payload.destinationIds)
  ) {
    throw new InvalidDomainAliasRequestError("destination ids are invalid");
  }

  return {
    domainId,
    mode: payload.mode,
    ...(payload.destinationIds ? { destinationIds: payload.destinationIds } : {}),
  };
}

function parseDomainAliasLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidDomainAliasRequestError("limit is invalid");
  }

  return parsed;
}

function isCatchAllMode(value: unknown): value is CatchAllMode {
  return (
    value === "reject" ||
    value === "forward" ||
    value === "auto_create" ||
    value === "discard"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  );
}

function parseReauthorizationRecoveryRoute(
  requestUrl: string | undefined,
):
  | { action: "oauth_start"; taskId: string }
  | { action: "imap_smtp"; taskId: string }
  | undefined {
  if (!requestUrl) {
    return undefined;
  }

  const url = new URL(requestUrl, "http://localhost");
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

function parseSyncControlRoute(
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

function parseSyncDiagnosticsRoute(
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

function parseMailComposeRoute(
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

function parseOptionalMailComposeLimit(
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

function parseMailActionRoute(
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

function parseMailBulkActionRoute(
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

function parseFollowUpRoute(
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

function parseOptionalFollowUpStatus(
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

function parseOptionalFollowUpLimit(value: string | null): { limit?: number } {
  if (value === null) {
    return {};
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidFollowUpRequestError("follow-up limit is invalid");
  }

  return { limit: parsed };
}

function parseSmartInboxFeedbackRoute(
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

function parseSenderScreeningRoute(
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

function parseGatekeeperSettingsRoute(
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

function parseSenderScreeningStatus(
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

function parseAttachmentDownloadRoute(
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

function parseOAuthRoute(
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

function parseMailReadRoute(
  requestUrl: string | undefined,
):
  | { action: "list_mailboxes"; accountId: string }
  | {
      action: "list_messages";
      accountId?: string;
      mailboxId?: string;
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

  const mailboxId = url.searchParams.get("mailboxId");
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
    ...(isNonEmptyString(mailboxId) ? { mailboxId } : {}),
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

function parseHermesMessageTranslationRoute(
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

function parseLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidMailReadRequestError();
  }

  return parsed;
}

function parseMailSort(value: string | null): MessageListSort | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const sort = value.trim();
  if (sort === "smart" || sort === "time") {
    return sort;
  }

  throw new InvalidMailReadRequestError();
}

function parseMailSavedViewId(value: string | null): string | undefined {
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

function parseMailQuickFilters(params: URLSearchParams): MailQuickFilter[] {
  return uniqueMailValues(params, "quickFilter").map((value) => {
    if (
      value === "unread" ||
      value === "starred" ||
      value === "attachments" ||
      value === "labels"
    ) {
      return value;
    }

    throw new InvalidMailReadRequestError();
  });
}

function parseMailSearchScopes(params: URLSearchParams): MailSearchScope[] {
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

function parseMailLabelIds(params: URLSearchParams): string[] {
  return uniqueMailValues(params, "labelId").map((value) => {
    if (isUuid(value)) {
      return value;
    }

    throw new InvalidMailReadRequestError();
  });
}

function parseMailTagMode(value: string | null): MailTagMode | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const tagMode = value.trim().toLowerCase();
  if (tagMode === "any" || tagMode === "all") {
    return tagMode;
  }

  throw new InvalidMailReadRequestError();
}

function parseMailStructuredText(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 128 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidMailReadRequestError();
  }

  return trimmed;
}

function parseMailDateBound(value: string | null): string | undefined {
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

function parseOptionalMailBoolean(value: string | null): boolean | undefined {
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

function uniqueMailValues(params: URLSearchParams, key: string): string[] {
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseMailReadCursor(
  value: string | null,
  sort?: MessageListSort,
): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  try {
    const decoded = decodeMailReadCursor(value);
    if (sort === "smart" && decoded.priorityScore === undefined) {
      throw new InvalidMailReadCursorError();
    }
    return value;
  } catch (error) {
    if (error instanceof InvalidMailReadCursorError) {
      throw new InvalidMailReadRequestError();
    }

    throw error;
  }
}

function parseMailSearchQuery(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 256 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidMailReadRequestError();
  }

  return trimmed;
}

function parseSmartInboxFeedbackInput(body: string): {
  action: SmartInboxFeedbackAction;
} {
  const payload = JSON.parse(body) as { action?: unknown };
  if (!isSmartInboxFeedbackAction(payload.action)) {
    throw new InvalidSmartInboxFeedbackError();
  }

  return { action: payload.action };
}

function parseSenderScreeningDomainBlockInput(body: string): {
  accountId: string;
} {
  const payload = JSON.parse(body || "{}") as { accountId?: unknown };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidSenderScreeningRequestError();
  }

  return { accountId: payload.accountId };
}

function parseSenderScreeningSenderDecisionInput(body: string): {
  accountId: string;
} {
  const payload = JSON.parse(body || "{}") as { accountId?: unknown };
  if (!isNonEmptyString(payload.accountId)) {
    throw new InvalidSenderScreeningRequestError();
  }

  return { accountId: payload.accountId };
}

function parseSenderScreeningBulkInput(body: string): {
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

function parseGatekeeperSettingsInput(body: string): { mode: GatekeeperMode } {
  const payload = JSON.parse(body || "{}") as { mode?: unknown };
  if (!isGatekeeperMode(payload.mode)) {
    throw new InvalidGatekeeperSettingsRequestError();
  }

  return { mode: payload.mode };
}

function isSmartInboxFeedbackAction(
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

function parseOAuthStartInput(body: string): {
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

function parseOAuthCallbackInput(requestUrl: string | undefined): {
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

function parseHermesTranslateInput(body: string): {
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

  return {
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

function parseHermesMessageTranslationInput(
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

function parseHermesReplyDraftInput(body: string): {
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

function parseHermesQuickReplyInput(body: string): {
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

function parseHermesRewritePolishInput(body: string): {
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

  return {
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

function isHermesQuickReplyScenario(
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

function isHermesRewritePolishAction(
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

function parseHermesThreadSummaryInput(body: string): {
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

function isHermesThreadSummaryMode(
  value: unknown,
): value is "short" | "detailed" | "action_points" {
  return value === "short" || value === "detailed" || value === "action_points";
}

function parseHermesEmailSearchQaInput(body: string): {
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
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    mailboxId?: unknown;
    question?: unknown;
    searchQuery?: unknown;
    language?: unknown;
    limit?: unknown;
    readMessageIds?: unknown;
    memoryIds?: unknown;
    memoryScope?: unknown;
    memoryLayers?: unknown;
  };
  if (!isNonEmptyString(payload.accountId) || !isNonEmptyString(payload.question)) {
    throw new InvalidOAuthRequestError("invalid_email_search_qa_request", 400);
  }

  return {
    accountId: payload.accountId,
    ...(isNonEmptyString(payload.mailboxId) ? { mailboxId: payload.mailboxId } : {}),
    question: payload.question,
    ...(isNonEmptyString(payload.searchQuery)
      ? { searchQuery: payload.searchQuery }
      : {}),
    ...(isNonEmptyString(payload.language) ? { language: payload.language } : {}),
    ...(payload.limit !== undefined
      ? { limit: parseHermesSearchQaLimit(payload.limit) }
      : {}),
    ...parseOptionalStringArray(
      payload.readMessageIds,
      "readMessageIds",
      "invalid_email_search_qa_request",
    ),
    ...parseOptionalStringArray(
      payload.memoryIds,
      "memoryIds",
      "invalid_email_search_qa_request",
    ),
    ...(isNonEmptyString(payload.memoryScope)
      ? { memoryScope: payload.memoryScope }
      : {}),
    ...parseOptionalStringArray(
      payload.memoryLayers,
      "memoryLayers",
      "invalid_email_search_qa_request",
    ),
  };
}

function parseHermesSearchQaLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 20
  ) {
    throw new InvalidOAuthRequestError("invalid_email_search_qa_request", 400);
  }

  return value;
}

function parseHermesActionItemExtractInput(body: string): {
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

function parseHermesLabelSuggestInput(body: string): {
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

function parseHermesNewsletterCleanupInput(body: string): {
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

function parseHermesPriorityTriageInput(body: string): {
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

function parsePriorityTriageScore(value: unknown): number {
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

function parseHermesFollowupTrackerInput(body: string): {
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

function parseHermesFollowUpConfirmationInput(body: string): {
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

function parseHermesTranslationPreferenceInput(body: string): {
  mode: HermesTranslationPreferenceMode;
  sourceLanguage: string;
  targetLanguage?: string;
  memoryScope?: string;
  reason?: string;
} {
  const payload = JSON.parse(body) as {
    mode?: unknown;
    sourceLanguage?: unknown;
    targetLanguage?: unknown;
    memoryScope?: unknown;
    reason?: unknown;
  };

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

function isHermesTranslationPreferenceMode(
  value: unknown,
): value is HermesTranslationPreferenceMode {
  return value === "always" || value === "never";
}

function parseTranslationPreferenceText(value: unknown, maxLength = 64): string {
  if (!isNonEmptyString(value)) {
    throw new InvalidTranslationPreferenceRequestError();
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidTranslationPreferenceRequestError();
  }

  return trimmed;
}

function isActionableHermesFollowUpStatus(
  value: unknown,
): value is "needs_reply" | "waiting_on_them" {
  return value === "needs_reply" || value === "waiting_on_them";
}

function parseHermesFollowUpReasons(
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

function parseHermesDraftFeedbackInput(body: string): {
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

function parseHermesMemoryListInput(requestUrl: string | undefined): {
  layer?: string;
  scope?: string;
  limit: number;
} {
  const url = new URL(requestUrl ?? "", "http://localhost");
  const layer = parseOptionalHermesMemoryFilter(url.searchParams.get("layer"));
  const scope = parseOptionalHermesMemoryFilter(url.searchParams.get("scope"));
  return {
    ...(layer ? { layer } : {}),
    ...(scope ? { scope } : {}),
    limit: parseHermesMemoryLimit(url.searchParams.get("limit")),
  };
}

function parseHermesMemoryPatchInput(body: string): {
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

function parseOptionalHermesMemoryFilter(value: string | null): string | undefined {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > 64 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new InvalidHermesMemoryRequestError();
  }

  return trimmed;
}

function parseHermesMemoryLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidHermesMemoryRequestError();
  }

  return parsed;
}

function parseHermesRuleSuggestInput(body: string): {
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

function parseHermesActionPlanCreateInput(body: string): {
  accountId: string;
  command: string;
  sampleLimit?: number;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    command?: unknown;
    sampleLimit?: unknown;
  };
  if (!isNonEmptyString(payload.accountId) || typeof payload.command !== "string") {
    throw new InvalidHermesActionPlanRequestError();
  }
  const command = payload.command.trim();
  if (
    command.length < 2 ||
    command.length > 500 ||
    /[\u0000-\u001F\u007F]/.test(command)
  ) {
    throw new InvalidHermesActionPlanRequestError();
  }

  return {
    accountId: payload.accountId,
    command,
    ...parseOptionalHermesActionPlanInteger(
      payload.sampleLimit,
      "sampleLimit",
      1,
      100,
    ),
  };
}

function parseHermesActionPlanConfirmInput(
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

function parseHermesRuleDraftInput(body: string): {
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

function parseHermesRuleSimulationInput(
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

function parseHermesRuleApprovalInput(
  candidateId: string,
  body: string,
): {
  accountId: string;
  candidateId: string;
} {
  const payload = JSON.parse(body) as { accountId?: unknown };
  if (!isNonEmptyString(candidateId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    candidateId,
  };
}

function parseHermesRuleUpdateInput(
  ruleId: string,
  body: string,
): {
  accountId: string;
  ruleId: string;
  enabled: boolean;
} {
  const payload = JSON.parse(body) as {
    accountId?: unknown;
    enabled?: unknown;
  };
  if (!isNonEmptyString(ruleId) || !isNonEmptyString(payload.accountId)) {
    throw new InvalidHermesRuleRequestError();
  }
  if (typeof payload.enabled !== "boolean") {
    throw new InvalidHermesRuleRequestError();
  }

  return {
    accountId: payload.accountId,
    ruleId,
    enabled: payload.enabled,
  };
}

function parseOptionalHermesActionPlanInteger<
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

function parseHermesRuleListInput(requestUrl: string | undefined): {
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

function parseOptionalHermesRuleInteger<
  Key extends "behaviorWindowDays" | "minEvidenceCount" | "sampleLimit",
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

function parseOptionalHermesRuleBoolean(value: string | null): boolean | undefined {
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

function parseHermesRuleLimit(value: string | null): number {
  if (value === null) {
    return 50;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidHermesRuleRequestError();
  }

  return parsed;
}

function parseOptionalStringArray(
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

function parseOptionalHermesMessageTranslationArray(
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

function parseImapSmtpOnboardingInput(
  body: string,
): ImapSmtpOnboardingInput {
  return parseImapSmtpAccountInput(body, "invalid_imap_smtp_account");
}

function parseImapSmtpConnectionTestInput(
  body: string,
): ImapSmtpOnboardingInput {
  return parseImapSmtpAccountInput(
    body,
    "invalid_imap_smtp_connection_test",
  );
}

function parseImapSmtpAccountInput(
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

function parseMailComposeDraftInput(
  accountId: string,
  body: string,
): CreateMailDraftInput;
function parseMailComposeDraftInput(
  accountId: string,
  body: string,
  draftId: string,
): UpdateMailDraftInput;
function parseMailComposeDraftInput(
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
    ...(() => {
      const attachments = parseMailComposeAttachments(payload.attachments);
      return attachments.length > 0 ? { attachments } : {};
    })(),
    ...(isNonEmptyString(payload.hermesSkillRunId)
      ? { hermesSkillRunId: payload.hermesSkillRunId }
      : {}),
    ...(isNonEmptyString(payload.hermesDraftText)
      ? { hermesDraftText: payload.hermesDraftText }
      : {}),
  };
}

function parseScheduledMailComposeDraftInput(
  accountId: string,
  scheduledId: string,
  body: string,
): UpdateScheduledMailDraftInput {
  return {
    ...parseMailComposeDraftInput(accountId, body),
    scheduledId,
  };
}

function parseMailComposePreviewInput(
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

function parseMailComposeSeedInput(
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

function parseProviderSendIdentityCandidateInput(
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

function parseProviderSendIdentityCandidateType(
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

function parseProviderSendIdentityUserTargetInput(
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

function parseComposeAttachmentUploadFilename(request: IncomingMessage): string {
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

function parseComposeAttachmentUploadContentType(
  request: IncomingMessage,
): string {
  const header = singleHeader(request.headers["content-type"]);
  const contentType = header?.split(";")[0]?.trim().toLowerCase();
  return contentType?.includes("/")
    ? contentType
    : "application/octet-stream";
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseMailComposeFrom(payload: {
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

function parseScheduleDraftInput(
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

function parseRescheduleInput(
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

function parseMailActionInput(
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

function parseUpsertLabelInput(
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

function parseLabelColor(value: unknown): LabelColor {
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

function parseMailBulkActionInput(
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

function parseMailActionName(value: unknown): MailAction {
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

function parseCreateFollowUpInput(
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

function parseUpdateFollowUpInput(
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

function isFollowUpKind(value: unknown): value is FollowUpKind {
  return value === "manual" || value === "needs_reply" || value === "waiting_on_them";
}

function isFollowUpSource(value: unknown): value is FollowUpSource {
  return value === "manual" || value === "hermes_followup";
}

function isMutableFollowUpStatus(
  value: unknown,
): value is Exclude<FollowUpStatus, "cancelled"> {
  return value === "open" || value === "due" || value === "done";
}

function parseMailComposeSource(value: unknown): MailDraftSource | undefined {
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

function parseMailComposeAttachments(
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

function parseMailComposeAddresses(
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

function parseMailComposeAddress(value: unknown): MailAddress {
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

function parseCsvImportInput(body: string): { csv: string } {
  const payload = JSON.parse(body) as { csv?: unknown };
  if (!isNonEmptyString(payload.csv)) {
    throw new InvalidCsvImportError("CSV is required");
  }

  return { csv: payload.csv };
}

function parseAccountTransferExportInput(body: string): {
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

function parseAccountTransferImportInput(body: string): {
  package: AccountTransferPackage;
} {
  const payload = JSON.parse(body) as { package?: unknown };
  return {
    package: validateTransferPackage(payload.package),
  };
}

function parseReauthorizationOAuthStartInput(
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

function parseReauthorizationImapSmtpInput(
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

function parseReauthorizationEndpoint(
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

function parseEndpoint(
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

class InvalidImapSmtpAccountError extends Error {
  constructor(
    readonly code:
      | "invalid_imap_smtp_account"
      | "invalid_imap_smtp_connection_test" = "invalid_imap_smtp_account",
    message?: string,
  ) {
    super(message);
  }
}

class InvalidOAuthRequestError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

class InvalidMailReadRequestError extends Error {
  readonly code = "invalid_mail_read_request";
  readonly statusCode = 400;

  constructor() {
    super("invalid_mail_read_request");
  }
}

class InvalidSmartInboxFeedbackError extends Error {
  readonly code = "invalid_smart_inbox_feedback";

  constructor() {
    super("invalid_smart_inbox_feedback");
  }
}

class InvalidHermesMemoryRequestError extends Error {
  readonly code = "invalid_hermes_memory_request";

  constructor() {
    super("invalid_hermes_memory_request");
  }
}

class InvalidHermesDraftFeedbackRequestError extends Error {
  readonly code = "invalid_draft_feedback_request";

  constructor() {
    super("invalid_draft_feedback_request");
  }
}

class RequestBodyTooLargeError extends Error {
  readonly code = "request_body_too_large";

  constructor() {
    super("request_body_too_large");
  }
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function buildApiHealth(config: ApiConfig): Promise<{
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

function mailProviderCapabilityOptions(
  config: ApiConfig,
): MailProviderCapabilityOptions {
  return {
    oauthProvidersConfigured: config.oauthProvidersConfigured,
  };
}

async function buildMailEngineHealth(config: ApiConfig): Promise<{
  provider: "emailengine";
  ok: boolean;
  detail: string;
  checks: {
    url: "configured" | "missing";
    http: "ok" | "unavailable" | "skipped";
    accessToken: "configured" | "missing";
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
  const probeResult = await checkEmailEngineRuntime(config, urlConfigured);
  const httpAvailable =
    probeResult.http === "ok" || probeResult.http === "skipped";
  const capabilities = {
    urlConfigured,
    accessTokenConfigured,
    imapSmtpOnboarding:
      accessTokenConfigured && Boolean(config.accountOnboardingService),
    attachmentDownload:
      accessTokenConfigured && Boolean(config.attachmentDownloadService),
    send: accessTokenConfigured && Boolean(config.mailComposeService),
  };
  const missing = getMissingEmailEngineConfiguration(config);
  const warnings = [
    ...(probeResult.http === "unavailable"
      ? ["EMAILENGINE_HTTP_UNAVAILABLE"]
      : []),
    ...(webhookSecretConfigured && webhookSecretUsesDefault
      ? ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"]
      : []),
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
  ];
  const ready =
    urlConfigured &&
    accessTokenConfigured &&
    httpAvailable &&
    setupActions.length === 0;

  return {
    provider: "emailengine",
    ok: urlConfigured && accessTokenConfigured && httpAvailable,
    detail: `adapter boundary ready: ${config.emailEngineUrl}`,
    checks: {
      url: urlConfigured ? "configured" : "missing",
      http: probeResult.http,
      accessToken: accessTokenConfigured ? "configured" : "missing",
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

async function checkEmailEngineRuntime(
  config: ApiConfig,
  urlConfigured: boolean,
): Promise<EmailEngineHealthProbeResult | { http: "skipped" }> {
  if (!urlConfigured || !config.mailEngineHealthProbe) {
    return { http: "skipped" };
  }

  try {
    return await config.mailEngineHealthProbe.check();
  } catch {
    return { http: "unavailable", error: "probe_failed" };
  }
}

function buildEmailEngineConfigurationRequired(
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

function getMissingEmailEngineConfiguration(config: ApiConfig): string[] {
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

async function writeAttachmentDownload(
  response: ServerResponse,
  attachment: AttachmentDownloadRef,
  download: {
    body: Response;
    contentType?: string;
    contentLength?: string;
  },
): Promise<void> {
  response.writeHead(200, {
    "content-type": download.contentType ?? attachment.contentType,
    "content-disposition": `attachment; filename="${safeHeaderFilename(
      attachment.filename,
    )}"`,
    ...(download.contentLength
      ? { "content-length": download.contentLength }
      : {}),
  });

  if (!download.body.body) {
    response.end();
    return;
  }

  const reader = download.body.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value && !response.write(Buffer.from(value))) {
        await once(response, "drain");
      }
    }

    response.end();
  } catch (error) {
    response.destroy(error instanceof Error ? error : new Error("download failed"));
  }
}

function safeHeaderFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}

async function readBody(
  request: IncomingMessage,
  maxBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<string> {
  return (await readBodyBuffer(request, maxBytes)).toString("utf8");
}

async function readBodyBuffer(
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
