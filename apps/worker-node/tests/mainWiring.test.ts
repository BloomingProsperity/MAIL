import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const mainPath = join(testDir, "..", "src", "main.ts");

describe("worker main wiring", () => {
  it("runs engine commands inside the worker polling loop", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createPostgresEngineCommandQueue");
    expect(main).toContain("createEngineCommandDispatcher");
    expect(main).toContain("runEngineCommandBatch");
    expect(main).toContain("commandQueue");
  });

  it("runs follow-up reminders inside the worker polling loop", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createPostgresFollowUpReminderStore");
    expect(main).toContain("runFollowUpReminderBatch");
    expect(main).toContain("followUpReminderStore");
  });

  it("uses structured logging for worker lifecycle and job results", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createJsonLogger");
    expect(main).toContain('service: "email-hub-worker"');
    expect(main).toContain('logger.info("worker_ready"');
    expect(main).toContain('logger.info("worker_result"');
    expect(main).toContain('logger.error("worker_tick_failed"');
  });

  it("persists worker result diagnostics for API troubleshooting", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createPostgresOperationalEventRecorder");
    expect(main).toContain("recordWorkerResultDiagnostic");
    expect(main).toContain("operationalEventRecorder");
  });

  it("wires EmailEngine sync auth failures to reauthorization tasks", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createEmailEngineHandler({");
    expect(main).toContain("reauthorizationMarker: accountSettingsStore");
    expect(main).toContain("reauthorizationMarker: input.reauthorizationMarker");
  });

  it("wraps all worker lanes in one global overlap guard", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createWorkerLoopRunner");
    expect(main).toContain("lanes:");
    expect(main).toContain("runEngineCommandBatch");
    expect(main).toContain("runScheduledSendBatch");
    expect(main).toContain("runFollowUpReminderBatch");
    expect(main).toContain("runAliasDeliveryBatch");
    expect(main).toContain("runAttachmentTextExtractionBatch");
    expect(main).toContain("createComposeAttachmentCleanupLane");
    expect(main).toContain("createHermesRetentionCleanupLane");
  });

  it("keeps self-developed Native/Core processors out of worker launch wiring", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).not.toContain("nativeEngineEnabled");
    expect(main).not.toContain("createConfiguredNativeSendTransports");
    expect(main).not.toContain("createConfiguredNativeAdapters");
    expect(main).not.toContain("createConfiguredNativeCommandProcessor");
    expect(main).not.toContain("createConfiguredNativeSendIdentityDiscovery");
    expect(main).toContain("const nonEmailEngineProvidersEnabled = false");
    expect(main).toContain("createDisabledNativeSyncProcessor");
    expect(main).toContain("createDisabledNativeCommandProcessor");
    expect(main).toContain("createPostgresSendIdentityVerifier");
    expect(main).toContain("sendIdentityVerifier");
    expect(main).toContain("transports: {");
    expect(main).toContain("emailengine: emailEngine");
    expect(main).not.toContain("...nativeSendTransports");
  });

  it("names every worker lane for structured failure logs", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain('name: "sync"');
    expect(main).toContain('name: "engine_commands"');
    expect(main).toContain('name: "scheduled_send"');
    expect(main).toContain('name: "follow_up_reminders"');
    expect(main).toContain('name: "alias_delivery"');
    expect(main).toContain('name: "attachment_text_extraction"');
    expect(main).toContain('name: "compose_attachment_cleanup"');
    expect(main).toContain('name: "hermes_retention_cleanup"');
  });

  it("runs compose attachment cleanup with bounded self-hosted retention settings", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createPostgresComposeAttachmentReferenceStore");
    expect(main).toContain("createLocalScheduledAttachmentBlobStore");
    expect(main).toContain("composeAttachmentCleanupIntervalMs");
    expect(main).toContain("composeAttachmentRetentionMs");
    expect(main).toContain("composeAttachmentCleanupLimit");
  });

  it("runs Hermes retention cleanup with bounded self-hosted retention settings", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createPostgresHermesRetentionCleanupStore");
    expect(main).toContain("createHermesRetentionCleanupLane");
    expect(main).toContain("hermesRetentionCleanupIntervalMs");
    expect(main).toContain("hermesRetentionMs");
    expect(main).toContain("hermesRetentionCleanupLimit");
  });

  it("registers graceful shutdown for the poller timer and Postgres pool", async () => {
    const main = await readFile(mainPath, "utf8");

    expect(main).toContain("createRuntimeShutdownHandler");
    expect(main).toContain('process.once("SIGTERM"');
    expect(main).toContain('process.once("SIGINT"');
    expect(main).toContain("currentTick");
    expect(main).toContain('name: "worker_active_tick"');
    expect(main).toContain("clearInterval(pollTimer)");
    expect(main).toContain("pool.end()");
  });

  it("registers process signals before logging worker readiness", async () => {
    const main = await readFile(mainPath, "utf8");

    const signalIndex = main.indexOf('process.once("SIGTERM"');
    const readyIndex = main.indexOf('logger.info("worker_ready"');

    expect(signalIndex).toBeGreaterThanOrEqual(0);
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(signalIndex).toBeLessThan(readyIndex);
  });
});
