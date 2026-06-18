import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { createPostgresBootstrapSyncJobStore } from "./accounts/bootstrap-sync-job-store.js";
import { createAccountTransferService } from "./accounts/account-transfer.js";
import { createImapSmtpOnboardingService } from "./accounts/imap-smtp-onboarding.js";
import { createAccountCsvImportService } from "./accounts/csv-import.js";
import { createOAuthOnboardingService } from "./accounts/oauth-onboarding.js";
import { createOAuthProfileClient } from "./accounts/oauth-profile-client.js";
import { createOAuthProviderRegistry } from "./accounts/oauth-providers.js";
import { createOAuthTokenClient } from "./accounts/oauth-token-client.js";
import { createPostgresAccountTransferStore } from "./accounts/postgres-account-transfer-store.js";
import { createPostgresAccountOnboardingStore } from "./accounts/postgres-onboarding-store.js";
import { createPostgresOAuthOnboardingStore } from "./accounts/postgres-oauth-onboarding-store.js";
import { createPostgresReauthorizationTaskStore } from "./accounts/postgres-reauthorization-task-store.js";
import { createReauthorizationRecoveryService } from "./accounts/reauthorization-recovery.js";
import {
  readApiConfig,
  readImapSmtpProviderPresetOverrides,
  readNativeEngineEnabled,
  readPort,
} from "./config.js";
import { createConfiguredHermesTranslationService } from "./hermes/configured-service.js";
import { createHermesFollowUpReminderService } from "./hermes/followup-reminders.js";
import { createHermesRuntimeConfigService } from "./hermes/runtime-config.js";
import { createHermesHttpVersionChecker } from "./hermes/version-checker.js";
import { createPostgresHermesRuntimeConfigStore } from "./hermes/postgres-runtime-config-store.js";
import { createPostgresHermesSkillSettingsStore } from "./hermes/postgres-skill-settings-store.js";
import { createDomainAliasService } from "./domains/domain-alias.js";
import { createPostgresDomainAliasStore } from "./domains/postgres-domain-alias-store.js";
import { createFollowUpService } from "./follow-ups/follow-ups.js";
import { createPostgresFollowUpStore } from "./follow-ups/postgres-follow-up-store.js";
import { createPostgresGatekeeperSettingsStore } from "./gatekeeper/postgres-settings-store.js";
import { createGatekeeperSettingsService } from "./gatekeeper/settings.js";
import { createPostgresSenderScreeningStore } from "./gatekeeper/postgres-sender-screening-store.js";
import { createSenderScreeningService } from "./gatekeeper/sender-screening-service.js";
import { createPostgresHermesDraftFeedbackStore } from "./hermes/draft-feedback.js";
import { createPostgresHermesMemoryStore } from "./hermes/postgres-memory-store.js";
import { createPostgresHermesRuleStore } from "./hermes/postgres-rule-store.js";
import { createPostgresHermesActionPlanStore } from "./hermes/postgres-action-plan-store.js";
import { createPostgresHermesRunStore } from "./hermes/postgres-run-store.js";
import { createPostgresHermesMessageTranslationStore } from "./hermes/postgres-message-translation-store.js";
import { createPostgresHermesMessageSummaryStore } from "./hermes/postgres-message-summary-store.js";
import { createPostgresHermesAuditLogStore } from "./hermes/postgres-audit-log-store.js";
import { createHermesActionPlanService } from "./hermes/action-plan.js";
import { createHermesAuditLogService } from "./hermes/audit-log.js";
import { createHermesMessageTranslationService } from "./hermes/message-translation.js";
import { createHermesMessageSummaryService } from "./hermes/message-summary.js";
import { createHermesMessageReplyService } from "./hermes/message-replies.js";
import { createHermesMessageOrganizationService } from "./hermes/message-organization.js";
import { createHermesMessageFollowupTrackerService } from "./hermes/message-followups.js";
import { createHermesRuleService } from "./hermes/rules.js";
import { createHermesTranslationPreferenceService } from "./hermes/translation-preferences.js";
import { getHermesSkills } from "./hermes/skills.js";
import { createHermesSkillSettingsService } from "./hermes/skill-settings.js";
import { createHermesWorkspaceContextService } from "./hermes/workspace-context.js";
import { createApiHandler } from "./http/router.js";
import { createLabelService } from "./labels/labels.js";
import { createPostgresLabelStore } from "./labels/postgres-label-store.js";
import { createJsonLogger } from "./logging/logger.js";
import { createOperationalEventLogService } from "./logging/operational-events.js";
import { createPostgresOperationalEventStore } from "./logging/postgres-operational-event-store.js";
import { createPostgresMailReadStore } from "./mail-read/postgres-mail-read-store.js";
import { createEmailEngineAccountsClient } from "./mail-engine/email-engine-accounts-client.js";
import { createEmailEngineAttachmentContentStore } from "./mail-engine/email-engine-attachment-content-store.js";
import { createEmailEngineAttachmentsClient } from "./mail-engine/email-engine-attachments-client.js";
import { createConfiguredEmailEngineAuthServerService } from "./mail-engine/email-engine-auth-server.js";
import { createEmailEngineHealthProbe } from "./mail-engine/email-engine-health-probe.js";
import { createEmailEngineSubmitClient } from "./mail-engine/email-engine-submit-client.js";
import { createMailNavigationSummaryService } from "./mail-navigation/navigation-summary.js";
import { createPostgresMailNavigationStore } from "./mail-navigation/postgres-navigation-store.js";
import { createMailActionService } from "./mail-actions/mail-actions.js";
import { createPostgresMailActionStore } from "./mail-actions/postgres-mail-action-store.js";
import { createMailComposeService } from "./mail-compose/mail-compose.js";
import { createLocalComposeAttachmentBlobStore } from "./mail-compose/compose-attachment-blob-store.js";
import {
  createComposeAttachmentMaintenanceService,
  createLocalComposeAttachmentMaintenanceBlobStore,
  createPostgresComposeAttachmentReferenceStore,
} from "./maintenance/compose-attachment-maintenance.js";
import {
  createHermesRetentionMaintenanceService,
  createPostgresHermesRetentionMaintenanceStore,
} from "./maintenance/hermes-retention-maintenance.js";
import { createPostgresMailComposeStore } from "./mail-compose/postgres-mail-compose-store.js";
import { createPostgresSendIdentityStore } from "./mail-compose/postgres-send-identity-store.js";
import { createPostgresMailThreadingStore } from "./mail-compose/postgres-threading-store.js";
import {
  createConfiguredGraphSendIdentityVerifier,
  createConfiguredNativeSendTransport,
} from "./native-send/native-send-transport.js";
import { createPostgresMailEngineIngestStore } from "./mail-engine/postgres-ingest-store.js";
import { createPostgresSmartInboxFeedbackStore } from "./smart-inbox/postgres-feedback-store.js";
import { createPostgresSyncControlStore } from "./sync-center/postgres-sync-control-store.js";
import { createSyncControlService } from "./sync-center/sync-control.js";
import { createPostgresSyncCenterStore } from "./sync-center/postgres-sync-center-store.js";
import { createInMemoryDiagnosticsLogStore } from "./logging/diagnostics.js";
import { createRuntimeShutdownHandler } from "./runtime-shutdown.js";

const port = readPort();
const config = readApiConfig();
const nativeEngineEnabled = readNativeEngineEnabled(process.env);
const diagnosticsLogStore = createInMemoryDiagnosticsLogStore({
  capacity: readDiagnosticsLogCapacity(process.env.DIAGNOSTICS_LOG_CAPACITY),
});
const logger = createJsonLogger({
  service: "email-hub-api",
  level: process.env.LOG_LEVEL,
  diagnostics: diagnosticsLogStore,
});
const databaseUrl = process.env.DATABASE_URL;
const emailEngineAccessToken = process.env.EMAILENGINE_ACCESS_TOKEN;
const providerPresetOverrides =
  readImapSmtpProviderPresetOverrides(process.env);
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
const hermesRunStore = pool ? createPostgresHermesRunStore(pool) : undefined;
const hermesMessageTranslationStore = pool
  ? createPostgresHermesMessageTranslationStore(pool)
  : undefined;
const hermesMessageSummaryStore = pool
  ? createPostgresHermesMessageSummaryStore(pool)
  : undefined;

config.emailEngineAccessTokenConfigured =
  typeof emailEngineAccessToken === "string" &&
  emailEngineAccessToken.trim().length > 0;
config.logger = logger;
config.diagnosticsLogStore = diagnosticsLogStore;
config.mailEngineHealthProbe = createEmailEngineHealthProbe({
  baseUrl: config.emailEngineUrl,
  accessToken: emailEngineAccessToken,
});
config.databaseHealthCheck = async () => {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  await pool.query("SELECT 1");
};
config.hermesRetentionPolicy = {
  retentionDays: readBoundedIntegerEnv({
    value: process.env.HERMES_RETENTION_DAYS,
    fallback: 30,
    min: 1,
    max: 365,
  }),
  cleanupIntervalMs: readBoundedIntegerEnv({
    value: process.env.HERMES_RETENTION_CLEANUP_INTERVAL_MS,
    fallback: 60 * 60 * 1000,
    min: 60_000,
    max: 24 * 60 * 60 * 1000,
  }),
  cleanupLimit: readBoundedIntegerEnv({
    value: process.env.HERMES_RETENTION_CLEANUP_LIMIT,
    fallback: 500,
    min: 1,
    max: 10_000,
  }),
};

logger.info("api_configuration_loaded", {
  databaseConfigured: Boolean(databaseUrl),
  emailEngineUrl: config.emailEngineUrl,
  emailEngineAccessTokenConfigured: config.emailEngineAccessTokenConfigured,
  emailEnginePreparedTokenConfigured: config.emailEnginePreparedTokenConfigured,
});

if (pool) {
  const hermesRetentionPolicy = config.hermesRetentionPolicy ?? {};
  const composeAttachmentBlobDir =
    process.env.COMPOSE_ATTACHMENT_BLOB_DIR ??
    "/tmp/email-hub-compose-attachments";
  const composeAttachmentBlobStore = createLocalComposeAttachmentBlobStore({
    rootDir: composeAttachmentBlobDir,
    createId: randomUUID,
  });
  config.composeAttachmentMaintenanceService =
    createComposeAttachmentMaintenanceService({
      referenceStore: createPostgresComposeAttachmentReferenceStore(pool),
      blobStore: createLocalComposeAttachmentMaintenanceBlobStore({
        rootDir: composeAttachmentBlobDir,
      }),
      now: () => new Date(),
      retentionMs:
        readBoundedIntegerEnv({
          value: process.env.COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS,
          fallback: 24 * 7,
          min: 1,
          max: 24 * 90,
        }) *
        60 *
        60 *
        1000,
      cleanupLimit: readBoundedIntegerEnv({
        value: process.env.COMPOSE_ATTACHMENT_CLEANUP_LIMIT,
        fallback: 100,
        min: 1,
        max: 10000,
      }),
    });
  config.hermesRetentionMaintenanceService =
    createHermesRetentionMaintenanceService({
      store: createPostgresHermesRetentionMaintenanceStore(pool),
      actionPlanStore: createPostgresHermesActionPlanStore(pool),
      now: () => new Date(),
      retentionMs:
        (hermesRetentionPolicy.retentionDays ?? 30) * 24 * 60 * 60 * 1000,
      cleanupLimit: hermesRetentionPolicy.cleanupLimit ?? 500,
    });
  const accountOnboardingStore = createPostgresAccountOnboardingStore(pool, {
    createId: randomUUID,
  });
  const oauthOnboardingStore = createPostgresOAuthOnboardingStore(pool);
  const oauthTokenClient = createOAuthTokenClient();
  const oauthProfileClient = createOAuthProfileClient();
  const bootstrapSyncJobs = createPostgresBootstrapSyncJobStore(pool, {
    createId: randomUUID,
  });
  const oauthProviders = createOAuthProviderRegistry({
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    googleAuthorizationUrl: process.env.GOOGLE_OAUTH_AUTHORIZATION_URL,
    googleTokenUrl: process.env.GOOGLE_OAUTH_TOKEN_URL,
    gmailProfileUrl: process.env.GMAIL_PROFILE_URL,
    microsoftClientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
    microsoftClientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
    microsoftTenant: process.env.MICROSOFT_OAUTH_TENANT,
    microsoftAuthorizationUrl: process.env.MICROSOFT_OAUTH_AUTHORIZATION_URL,
    microsoftTokenUrl: process.env.MICROSOFT_OAUTH_TOKEN_URL,
    microsoftProfileUrl: process.env.MICROSOFT_GRAPH_PROFILE_URL,
  });
  const emailEngineAccounts = config.emailEngineAccessTokenConfigured
    ? createEmailEngineAccountsClient({
        baseUrl: config.emailEngineUrl,
        accessToken: emailEngineAccessToken!,
      })
    : {
        async registerImapSmtpAccount() {
          throw new Error("EMAILENGINE_ACCESS_TOKEN is not configured");
        },
        async registerOAuthAccount() {
          throw new Error("EMAILENGINE_ACCESS_TOKEN is not configured");
        },
      };
  const emailEngineAttachments = config.emailEngineAccessTokenConfigured
    ? createEmailEngineAttachmentsClient({
        baseUrl: config.emailEngineUrl,
        accessToken: emailEngineAccessToken!,
      })
    : undefined;
  config.mailEngineIngestStore = createPostgresMailEngineIngestStore(pool);
  config.emailEngineAuthServerService =
    createConfiguredEmailEngineAuthServerService({
      client: pool,
    });
  config.operationalEventLogService = createOperationalEventLogService({
    store: createPostgresOperationalEventStore(pool),
  });
  config.mailReadStore = createPostgresMailReadStore(pool);
  config.labelService = createLabelService({
    store: createPostgresLabelStore(pool),
    createId: randomUUID,
  });
  config.hermesMemoryStore = createPostgresHermesMemoryStore(pool);
  config.hermesRuntimeConfigService = createHermesRuntimeConfigService({
    store: createPostgresHermesRuntimeConfigStore(pool),
    versionChecker: createHermesHttpVersionChecker({
      url: process.env.HERMES_VERSION_CHECK_URL,
    }),
  });
  config.hermesSkillSettingsService = createHermesSkillSettingsService({
    store: createPostgresHermesSkillSettingsStore(pool),
  });
  config.hermesTranslationPreferenceService =
    createHermesTranslationPreferenceService({
      memoryStore: config.hermesMemoryStore,
      createId: randomUUID,
    });
  config.hermesRuleService = createHermesRuleService({
    store: createPostgresHermesRuleStore(pool),
    labelService: config.labelService,
    createId: randomUUID,
    now: () => new Date().toISOString(),
  });
  config.hermesAuditLogService = createHermesAuditLogService({
    store: createPostgresHermesAuditLogStore(pool),
  });
  config.hermesDraftFeedbackStore = createPostgresHermesDraftFeedbackStore(pool, {
    createId: randomUUID,
  });
  config.smartInboxFeedbackStore = createPostgresSmartInboxFeedbackStore(pool, {
    createId: randomUUID,
  });
  config.gatekeeperSettingsService = createGatekeeperSettingsService({
    store: createPostgresGatekeeperSettingsStore(pool),
  });
  config.senderScreeningStore = createSenderScreeningService({
    store: createPostgresSenderScreeningStore(pool, {
      createId: randomUUID,
    }),
    settingsService: config.gatekeeperSettingsService,
  });
  config.syncCenterStore = createPostgresSyncCenterStore(pool);
  config.mailNavigationService = createMailNavigationSummaryService(
    createPostgresMailNavigationStore(pool),
  );
  config.hermesWorkspaceContextService = createHermesWorkspaceContextService({
    syncCenterStore: config.syncCenterStore,
    mailNavigationService: config.mailNavigationService,
    labelService: config.labelService,
    hermesRuleService: config.hermesRuleService,
    getMailEngineContext: async () => {
      const http =
        (await config.mailEngineHealthProbe?.check().catch(() => ({
          http: "unavailable" as const,
          auth: "skipped" as const,
        }))) ?? { http: "skipped" as const };
      const apiAuthOk =
        !("auth" in http) ||
        http.auth === "ok" ||
        http.auth === "skipped";
      const urlConfigured = config.emailEngineUrl.trim().length > 0;
      const accessTokenConfigured =
        config.emailEngineAccessTokenConfigured === true;
      const webhookSecretConfigured =
        config.emailEngineWebhookSecret.trim().length > 0;
      const webhookSecretDefault =
        config.emailEngineWebhookSecretUsesDefault === true ||
        config.emailEngineWebhookSecret === "dev-emailhub-secret";
      const ok =
        urlConfigured &&
        http.http === "ok" &&
        apiAuthOk &&
        accessTokenConfigured &&
        webhookSecretConfigured &&
        !webhookSecretDefault;

      return {
        provider: "emailengine",
        ok,
        missing: [
          ...(urlConfigured ? [] : ["EMAILENGINE_URL"]),
          ...(accessTokenConfigured ? [] : ["EMAILENGINE_ACCESS_TOKEN"]),
          ...((accessTokenConfigured &&
            config.emailEnginePreparedTokenConfigured === false)
            ? ["EENGINE_PREPARED_TOKEN"]
            : []),
          ...(webhookSecretConfigured ? [] : ["EMAILENGINE_WEBHOOK_SECRET"]),
        ],
        warnings: [
          ...(webhookSecretConfigured && webhookSecretDefault
            ? ["EMAILENGINE_WEBHOOK_SECRET_DEFAULT"]
            : []),
          ...(accessTokenConfigured && "auth" in http && http.auth === "unauthorized"
            ? ["EMAILENGINE_ACCESS_TOKEN_REJECTED"]
            : []),
          ...(accessTokenConfigured && "auth" in http && http.auth === "unavailable"
            ? ["EMAILENGINE_API_AUTH_UNAVAILABLE"]
            : []),
          ...((accessTokenConfigured &&
            config.emailEnginePreparedTokenConfigured === false)
            ? ["EENGINE_PREPARED_TOKEN_MISSING"]
            : []),
        ],
        readiness: {
          status: ok ? "ready" : "degraded",
          summary: ok
            ? "EmailEngine 已具备上线配置。"
            : "EmailEngine 配置未完全就绪，Hermes 涉及邮箱写回的操作会受限。",
        },
        capabilities: {
          imapSmtpOnboarding: accessTokenConfigured && apiAuthOk,
          attachmentDownload: accessTokenConfigured && apiAuthOk,
          send: accessTokenConfigured && apiAuthOk,
        },
      };
    },
    getSkills: async () =>
      config.hermesSkillSettingsService?.listSkills() ?? getHermesSkills(),
    now: () => new Date().toISOString(),
  });
  config.hermesActionPlanService = createHermesActionPlanService({
    ruleService: config.hermesRuleService,
    workspaceContextService: config.hermesWorkspaceContextService,
    planStore: createPostgresHermesActionPlanStore(pool),
    runStore: hermesRunStore,
    memoryStore: config.hermesMemoryStore,
    createId: randomUUID,
    now: () => new Date().toISOString(),
  });
  config.syncControlService = createSyncControlService({
    store: createPostgresSyncControlStore(pool),
    createId: randomUUID,
  });
  config.mailComposeService = createMailComposeService({
    store: createPostgresMailComposeStore(pool),
    sendIdentityStore: createPostgresSendIdentityStore(pool),
    graphSendIdentityVerifier: createConfiguredGraphSendIdentityVerifier({
      client: pool,
    }),
    threadingStore: createPostgresMailThreadingStore(pool),
    mailReadStore: config.mailReadStore,
    ...(emailEngineAttachments
      ? {
          attachmentContentStore:
            createEmailEngineAttachmentContentStore(emailEngineAttachments),
        }
      : {}),
    attachmentBlobStore: composeAttachmentBlobStore,
    transports: {
      ...(config.emailEngineAccessTokenConfigured
        ? {
            emailengine: createEmailEngineSubmitClient({
              baseUrl: config.emailEngineUrl,
              accessToken: emailEngineAccessToken!,
            }),
          }
        : {}),
      ...(nativeEngineEnabled
        ? {
            native: createConfiguredNativeSendTransport({
              client: pool,
              createId: randomUUID,
            }),
          }
        : {}),
    },
    createId: randomUUID,
    hermesDraftFeedbackStore: config.hermesDraftFeedbackStore,
  });
  config.composeAttachmentBlobStore = composeAttachmentBlobStore;
  config.mailActionService = createMailActionService({
    store: createPostgresMailActionStore(pool, {
      createId: randomUUID,
    }),
  });
  config.domainAliasService = createDomainAliasService({
    store: createPostgresDomainAliasStore(pool),
    createId: randomUUID,
  });
  config.followUpService = createFollowUpService({
    store: createPostgresFollowUpStore(pool),
    createId: randomUUID,
  });
  config.hermesFollowUpReminderService =
    createHermesFollowUpReminderService({
      followUpService: config.followUpService,
    });
  config.accountImportService = createAccountCsvImportService({
    store: accountOnboardingStore,
    createId: randomUUID,
    providerPresetOverrides,
  });
  config.accountTransferService = createAccountTransferService({
    accountSource: createPostgresAccountTransferStore(pool),
    taskStore: accountOnboardingStore,
    createId: randomUUID,
  });
  config.reauthorizationRecoveryService = createReauthorizationRecoveryService({
    reauthorizationTasks: createPostgresReauthorizationTaskStore(pool),
    oauthStore: oauthOnboardingStore,
    accountStore: accountOnboardingStore,
    emailEngineAccounts,
    providers: oauthProviders,
    tokenClient: oauthTokenClient,
    profileClient: oauthProfileClient,
    bootstrapSyncJobs,
    createId: randomUUID,
    providerPresetOverrides,
  });
  config.oauthOnboardingService = createOAuthOnboardingService({
    store: oauthOnboardingStore,
    providers: oauthProviders,
    tokenClient: oauthTokenClient,
    profileClient: oauthProfileClient,
    emailEngineAccounts,
    bootstrapSyncJobs,
    createId: randomUUID,
  });

  if (emailEngineAttachments) {
    config.attachmentDownloadService = emailEngineAttachments;
    config.accountOnboardingService = createImapSmtpOnboardingService({
      store: accountOnboardingStore,
      emailEngineAccounts,
      bootstrapSyncJobs,
      createId: randomUUID,
      providerPresetOverrides,
    });
  }
}

const configuredHermesService = createConfiguredHermesTranslationService({
  runStore: hermesRunStore,
  memoryStore: config.hermesMemoryStore,
  mailReadStore: config.mailReadStore,
  runtimeConfigService: config.hermesRuntimeConfigService,
  createId: randomUUID,
});
config.hermesService = configuredHermesService;
if (configuredHermesService && config.mailReadStore) {
  config.hermesMessageTranslationService = createHermesMessageTranslationService({
    mailReadStore: config.mailReadStore,
    translationService: configuredHermesService,
    store: hermesMessageTranslationStore,
    runStore: hermesRunStore,
    createId: randomUUID,
  });
  config.hermesMessageSummaryService = createHermesMessageSummaryService({
    mailReadStore: config.mailReadStore,
    summaryService: configuredHermesService,
    store: hermesMessageSummaryStore,
    createId: randomUUID,
  });
  config.hermesMessageReplyService = createHermesMessageReplyService({
    mailReadStore: config.mailReadStore,
    replyDraftService: configuredHermesService,
    quickReplyService: configuredHermesService,
  });
  config.hermesMessageOrganizationService =
    createHermesMessageOrganizationService({
      mailReadStore: config.mailReadStore,
      priorityService: configuredHermesService,
      labelSuggestService: configuredHermesService,
      newsletterCleanupService: configuredHermesService,
      actionItemExtractService: configuredHermesService,
      labelService: config.labelService,
      now: () => new Date().toISOString(),
    });
  config.hermesMessageFollowupTrackerService =
    createHermesMessageFollowupTrackerService({
      mailReadStore: config.mailReadStore,
      followupTrackerService: configuredHermesService,
      now: () => new Date().toISOString(),
    });
}

const server = createServer(createApiHandler(config));
const shutdown = createRuntimeShutdownHandler({
  logger,
  resources: [
    { name: "http_server", close: closeHttpServer },
    ...(pool
      ? [
          {
            name: "postgres_pool",
            close: () => pool.end(),
          },
        ]
      : []),
  ],
});

server.listen(port, "0.0.0.0", () => {
  logger.info("api_listening", { port });
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

function closeHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function readDiagnosticsLogCapacity(value: string | undefined): number {
  if (!value) {
    return 500;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
    return 500;
  }

  return parsed;
}

function readBoundedIntegerEnv(input: {
  value?: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (!input.value) {
    return input.fallback;
  }

  if (!/^\d+$/.test(input.value.trim())) {
    return input.fallback;
  }

  const parsed = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsed)) {
    return input.fallback;
  }

  return Math.min(input.max, Math.max(input.min, parsed));
}
