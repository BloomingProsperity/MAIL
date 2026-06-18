import { Pool } from "pg";
import { randomUUID } from "node:crypto";

import { runAliasDeliveryBatch } from "./alias-routing/alias-delivery-runner.js";
import { createConfiguredAliasDeliveryTransport } from "./alias-routing/alias-delivery-transport.js";
import { createPostgresAliasRoutingStore } from "./alias-routing/postgres-alias-routing-store.js";
import { createPostgresAccountProviderSettingsStore } from "./account-provider-settings-store.js";
import { createAccountStateJobHandler } from "./account-state-processor.js";
import {
  createEngineCommandDispatcher,
  type NativeEngineCommandProcessor,
} from "./engine-command-dispatcher.js";
import { createPostgresEngineCommandTargetResolver } from "./engine-command-resolver.js";
import { runEngineCommandBatch } from "./engine-command-runner.js";
import { createEmailEngineClient } from "./mail-engine/email-engine-client.js";
import { createPostgresMirrorStore } from "./mail-engine/postgres-mirror-store.js";
import {
  createSyncAccountJobHandler,
  type EmailEngineReauthorizationMarker,
} from "./mail-engine/sync-account-processor.js";
import {
  createConfiguredNativeAdapters,
  createConfiguredNativeCommandProcessor,
  createConfiguredNativeSendIdentityDiscovery,
  createConfiguredNativeSendTransports,
} from "./mail-provider/native-adapters.js";
import {
  createNativeSyncProcessor,
  type NativeSyncProcessor,
} from "./mail-provider/native-sync-processor.js";
import { createPostgresProviderRefStore } from "./provider-ref-store.js";
import { createPostgresEngineCommandQueue } from "./postgres-engine-command-queue.js";
import { createPostgresFollowUpReminderStore } from "./postgres-follow-up-reminder-store.js";
import { createPostgresScheduledSendStore } from "./postgres-scheduled-send-store.js";
import { createPostgresSendIdentityVerifier } from "./postgres-send-identity-verifier.js";
import { createLocalScheduledAttachmentBlobStore } from "./compose-attachment-blob-store.js";
import { createComposeAttachmentCleanupLane } from "./compose-attachment-cleanup-runner.js";
import {
  createHermesRetentionCleanupLane,
  createPostgresHermesRetentionCleanupStore,
} from "./hermes-retention-cleanup-runner.js";
import { createPostgresComposeAttachmentReferenceStore } from "./postgres-compose-attachment-reference-store.js";
import { createPostgresSyncJobQueue } from "./postgres-sync-job-queue.js";
import { runFollowUpReminderBatch } from "./follow-up-reminder-runner.js";
import { runScheduledSendBatch } from "./scheduled-send-runner.js";
import { runAttachmentTextExtractionBatch } from "./search/attachment-text-extraction-runner.js";
import { createPostgresAttachmentTextExtractionStore } from "./search/postgres-attachment-text-extraction-store.js";
import { createSimpleAttachmentTextExtractor } from "./search/simple-attachment-text-extractor.js";
import { createSyncAccountDispatcher } from "./sync-account-dispatcher.js";
import { createPostgresSyncCursorStore } from "./sync-cursor-store.js";
import type { SyncJobQueue, SyncJobRecord } from "./sync-job-queue.js";
import { readWorkerRuntimeConfig } from "./runtime-config.js";
import { createWorkerLoopRunner } from "./worker-loop.js";
import { createWorkerTickRunner } from "./worker-poller.js";
import { describeWorker } from "./worker.js";
import { createJsonLogger } from "./logging/logger.js";
import { createPostgresOperationalEventRecorder } from "./logging/operational-events.js";
import { recordWorkerResultDiagnostic } from "./logging/worker-diagnostics.js";
import {
  createRuntimeShutdownHandler,
  type RuntimeShutdownResource,
} from "./runtime-shutdown.js";
import { NonRetryableQueueError } from "./queue-errors.js";

const worker = describeWorker();

const workerId = process.env.WORKER_ID ?? `${worker.name}-${process.pid}`;
const logger = createJsonLogger({
  service: "email-hub-worker",
  level: process.env.LOG_LEVEL,
});
const runtimeConfig = readWorkerRuntimeConfig(process.env);
const {
  leaseSeconds,
  concurrency,
  pollMs,
  composeAttachmentCleanupIntervalMs,
  composeAttachmentRetentionMs,
  composeAttachmentCleanupLimit,
  hermesRetentionCleanupIntervalMs,
  hermesRetentionMs,
  hermesRetentionCleanupLimit,
  nativeEngineEnabled,
} = runtimeConfig;
const databaseUrl = process.env.DATABASE_URL;
const emailEngineUrl = process.env.EMAILENGINE_URL ?? "http://emailengine:3000";
const emailEngineAccessToken = process.env.EMAILENGINE_ACCESS_TOKEN;
const aliasDeliveryWebhookUrl = process.env.ALIAS_DELIVERY_WEBHOOK_URL;
const shutdownResources: RuntimeShutdownResource[] = [];
const shutdown = createRuntimeShutdownHandler({
  logger,
  resources: shutdownResources,
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

if (!databaseUrl) {
  logWorkerReady();
  logger.warn("worker_configuration_missing", {
    workerId,
    missing: ["DATABASE_URL"],
    effect: "worker_idle",
  });
} else {
  const pool = new Pool({ connectionString: databaseUrl });
  const operationalEventRecorder = createPostgresOperationalEventRecorder(pool);
  const queue = createPostgresSyncJobQueue(pool);
  const commandQueue = createPostgresEngineCommandQueue(pool);
  const aliasRoutingStore = createPostgresAliasRoutingStore(pool);
  const scheduledSendStore = createPostgresScheduledSendStore(pool);
  const composeAttachmentReferenceStore =
    createPostgresComposeAttachmentReferenceStore(pool);
  const scheduledAttachmentBlobStore = createLocalScheduledAttachmentBlobStore({
    rootDir:
      process.env.COMPOSE_ATTACHMENT_BLOB_DIR ??
      "/tmp/email-hub-compose-attachments",
  });
  const sendIdentityVerifier = createPostgresSendIdentityVerifier(pool);
  const followUpReminderStore = createPostgresFollowUpReminderStore(pool);
  const attachmentTextExtractionStore =
    createPostgresAttachmentTextExtractionStore(pool);
  const attachmentTextExtractor = createSimpleAttachmentTextExtractor();
  const aliasDeliveryTransport = createConfiguredAliasDeliveryTransport({
    endpointUrl: aliasDeliveryWebhookUrl,
  });
  const accountSettingsStore = createPostgresAccountProviderSettingsStore(pool);
  const targetResolver = createPostgresEngineCommandTargetResolver(pool);
  const emailEngine = createEmailEngineForCommands({
    emailEngineUrl,
    emailEngineAccessToken,
  });
  const emailEngineHandler = createEmailEngineHandler({
    pool,
    continuationQueue: queue,
    emailEngineUrl,
    emailEngineAccessToken,
    reauthorizationMarker: accountSettingsStore,
  });
  const nativeSyncProcessor = nativeEngineEnabled
    ? createNativeSyncProcessor({
        adapters: createConfiguredNativeAdapters({
          credentialClient: pool,
          env: process.env,
        }),
        sendIdentityDiscovery: createConfiguredNativeSendIdentityDiscovery({
          credentialClient: pool,
          env: process.env,
        }),
        cursorStore: createPostgresSyncCursorStore(pool),
        providerRefStore: createPostgresProviderRefStore(pool),
        mirrorStore: createPostgresMirrorStore(pool),
      })
    : createDisabledNativeSyncProcessor();
  const nativeSendTransports = nativeEngineEnabled
    ? createConfiguredNativeSendTransports({
        credentialClient: pool,
        env: process.env,
      })
    : {};
  const handleJob = createSyncAccountDispatcher({
    accountSettingsStore,
    accountStateHandler: createAccountStateJobHandler({
      store: accountSettingsStore,
      diagnostics: operationalEventRecorder,
    }),
    emailEngineHandler,
    nativeSyncProcessor,
    nativeEngineEnabled,
    continuationQueue: queue,
  });
  const handleCommand = createEngineCommandDispatcher({
    accountSettingsStore,
    targetResolver,
    emailEngine,
    nativeEngineEnabled,
    nativeCommandProcessor: nativeEngineEnabled
      ? createConfiguredNativeCommandProcessor({
          credentialClient: pool,
          targetResolver,
          env: process.env,
        })
      : createDisabledNativeCommandProcessor(),
  });
  const runComposeAttachmentCleanup = createComposeAttachmentCleanupLane({
    referenceStore: composeAttachmentReferenceStore,
    blobStore: scheduledAttachmentBlobStore,
    clock: () => new Date(),
    intervalMs: composeAttachmentCleanupIntervalMs,
    minAgeMs: composeAttachmentRetentionMs,
    limit: composeAttachmentCleanupLimit,
  });
  const runHermesRetentionCleanup = createHermesRetentionCleanupLane({
    store: createPostgresHermesRetentionCleanupStore(pool),
    clock: () => new Date(),
    intervalMs: hermesRetentionCleanupIntervalMs,
    retentionMs: hermesRetentionMs,
    limit: hermesRetentionCleanupLimit,
  });

  const tick = createWorkerTickRunner({
    queue,
    workerId,
    clock: () => new Date(),
    leaseSeconds,
    concurrency,
    handleJob,
  });

  const runTick = createWorkerLoopRunner({
    lanes: [
      { name: "sync", run: tick },
      {
        name: "engine_commands",
        run: async () =>
          runEngineCommandBatch({
            queue: commandQueue,
            workerId,
            now: new Date(),
            leaseSeconds,
            concurrency,
            handleCommand,
          }),
      },
      {
        name: "scheduled_send",
        run: async () =>
          runScheduledSendBatch({
            store: scheduledSendStore,
            workerId,
            now: new Date(),
            leaseSeconds,
            concurrency,
            nativeEngineEnabled,
            transports: {
              emailengine: emailEngine,
              ...nativeSendTransports,
            },
            sendIdentityVerifier,
            attachmentBlobStore: scheduledAttachmentBlobStore,
          }),
      },
      {
        name: "follow_up_reminders",
        run: async () =>
          runFollowUpReminderBatch({
            store: followUpReminderStore,
            workerId,
            now: new Date(),
            leaseSeconds,
            concurrency,
          }),
      },
      {
        name: "alias_delivery",
        run: async () =>
          aliasDeliveryTransport
            ? runAliasDeliveryBatch({
                store: aliasRoutingStore as Required<
                  Pick<
                    typeof aliasRoutingStore,
                    | "claimNextDeliveryJob"
                    | "completeDeliveryJob"
                    | "failDeliveryJob"
                    | "recordDeliveryLog"
                  >
                >,
                workerId,
                now: new Date(),
                leaseSeconds,
                concurrency,
                transport: aliasDeliveryTransport,
                createId: randomUUID,
              })
            : [{ status: "idle" as const }],
      },
      {
        name: "attachment_text_extraction",
        run: async () =>
          runAttachmentTextExtractionBatch({
            store: attachmentTextExtractionStore,
            workerId,
            now: new Date(),
            leaseSeconds,
            concurrency,
            downloader: emailEngine,
            extractor: attachmentTextExtractor,
          }),
      },
      {
        name: "compose_attachment_cleanup",
        run: runComposeAttachmentCleanup,
      },
      {
        name: "hermes_retention_cleanup",
        run: runHermesRetentionCleanup,
      },
    ],
  });

  const runAndLogTick = async () => {
    const results = await runTick();
    for (const result of results) {
      if (result.status !== "idle") {
        logger.info("worker_result", { workerId, result });
        void recordWorkerResultDiagnostic({
          recorder: operationalEventRecorder,
          workerId,
          result,
        }).catch((error: unknown) => {
          logger.warn("operational_event_record_failed", { workerId, error });
        });
      }
    }
  };

  let currentTick: Promise<void> | undefined;
  const startTick = () => {
    const tickPromise = runAndLogTick().catch((error: unknown) => {
      logger.error("worker_tick_failed", { workerId, error });
    });
    const observedTick = tickPromise.finally(() => {
      if (currentTick === observedTick) {
        currentTick = undefined;
      }
    });
    currentTick = observedTick;
  };

  const pollTimer = setInterval(() => {
    startTick();
  }, pollMs);

  shutdownResources.push(
    {
      name: "worker_poller",
      close: () => {
        clearInterval(pollTimer);
      },
    },
    {
      name: "worker_active_tick",
      close: async () => {
        await currentTick;
      },
    },
    {
      name: "postgres_pool",
      close: () => pool.end(),
    },
  );

  logWorkerReady();
  startTick();
}

function logWorkerReady() {
  logger.info("worker_ready", {
    workerId,
    lanes: worker.lanes,
    leaseSeconds,
    concurrency,
    pollMs,
    composeAttachmentCleanupIntervalMs,
    composeAttachmentRetentionMs,
    composeAttachmentCleanupLimit,
    hermesRetentionCleanupIntervalMs,
    hermesRetentionMs,
    hermesRetentionCleanupLimit,
    databaseConfigured: Boolean(databaseUrl),
    emailEngineAccessTokenConfigured: Boolean(emailEngineAccessToken),
  });
}

function createEmailEngineForCommands(input: {
  emailEngineUrl: string;
  emailEngineAccessToken?: string;
}) {
  if (!input.emailEngineAccessToken) {
    return {
      async updateMessage() {
        throw new Error(
          "EMAILENGINE_ACCESS_TOKEN missing; cannot execute EmailEngine command",
        );
      },
      async moveMessage() {
        throw new Error(
          "EMAILENGINE_ACCESS_TOKEN missing; cannot execute EmailEngine command",
        );
      },
      async deleteMessage() {
        throw new Error(
          "EMAILENGINE_ACCESS_TOKEN missing; cannot execute EmailEngine command",
        );
      },
      async submitMessage() {
        throw new Error(
          "EMAILENGINE_ACCESS_TOKEN missing; cannot submit scheduled send",
        );
      },
      async downloadAttachment() {
        throw new Error(
          "EMAILENGINE_ACCESS_TOKEN missing; cannot download attachment",
        );
      },
    };
  }

  return createEmailEngineClient({
    baseUrl: input.emailEngineUrl,
    accessToken: input.emailEngineAccessToken,
  });
}

function createDisabledNativeSyncProcessor(): NativeSyncProcessor {
  return {
    async syncAccount(input) {
      throw new NonRetryableQueueError(
        `Native Engine is paused for EmailEngine-first launch; cannot sync native account ${input.accountId}`,
      );
    },
    async discoverMailboxes(input) {
      throw new NonRetryableQueueError(
        `Native Engine is paused for EmailEngine-first launch; cannot discover native mailboxes for ${input.accountId}`,
      );
    },
  };
}

function createDisabledNativeCommandProcessor(): NativeEngineCommandProcessor {
  return {
    async executeCommand(input) {
      throw new NonRetryableQueueError(
        `Native Engine is paused for EmailEngine-first launch; cannot execute native command ${input.command.id}`,
      );
    },
  };
}

function createEmailEngineHandler(input: {
  pool: Pool;
  continuationQueue: SyncJobQueue;
  emailEngineUrl: string;
  emailEngineAccessToken?: string;
  reauthorizationMarker?: EmailEngineReauthorizationMarker;
}) {
  if (!input.emailEngineAccessToken) {
    logger.warn("worker_configuration_missing", {
      workerId,
      missing: ["EMAILENGINE_ACCESS_TOKEN"],
      capability: "emailengine_sync",
      effect: "emailengine_account_jobs_fail_until_configured",
    });
    return async (job: SyncJobRecord) => {
      throw new Error(
        `EMAILENGINE_ACCESS_TOKEN missing; cannot process EmailEngine sync job ${job.id}`,
      );
    };
  }

  const emailEngine = createEmailEngineClient({
    baseUrl: input.emailEngineUrl,
    accessToken: input.emailEngineAccessToken,
  });
  const mirrorStore = createPostgresMirrorStore(input.pool);
  return createSyncAccountJobHandler({
    emailEngine,
    mirrorStore,
    reauthorizationMarker: input.reauthorizationMarker,
    continuationQueue: input.continuationQueue,
  });
}
