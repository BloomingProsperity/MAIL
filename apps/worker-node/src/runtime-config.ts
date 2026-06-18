export interface WorkerRuntimeConfig {
  leaseSeconds: number;
  concurrency: number;
  pollMs: number;
  composeAttachmentCleanupIntervalMs: number;
  composeAttachmentRetentionMs: number;
  composeAttachmentCleanupLimit: number;
  hermesRetentionCleanupIntervalMs: number;
  hermesRetentionMs: number;
  hermesRetentionCleanupLimit: number;
  nativeEngineEnabled: boolean;
}

const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_MS = 5000;
const DEFAULT_COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_COMPOSE_ATTACHMENT_RETENTION_HOURS = 24 * 7;
const DEFAULT_COMPOSE_ATTACHMENT_CLEANUP_LIMIT = 100;
const DEFAULT_HERMES_RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_HERMES_RETENTION_DAYS = 30;
const DEFAULT_HERMES_RETENTION_CLEANUP_LIMIT = 500;

export function readWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeConfig {
  return {
    leaseSeconds: readBoundedInteger({
      value: env.WORKER_LEASE_SECONDS,
      fallback: DEFAULT_LEASE_SECONDS,
      min: 1,
      max: 3600,
    }),
    concurrency: readBoundedInteger({
      value: env.WORKER_CONCURRENCY,
      fallback: DEFAULT_CONCURRENCY,
      min: 1,
      max: 64,
    }),
    pollMs: readBoundedInteger({
      value: env.WORKER_POLL_MS,
      fallback: DEFAULT_POLL_MS,
      min: 100,
      max: 300000,
    }),
    composeAttachmentCleanupIntervalMs: readBoundedInteger({
      value: env.COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS,
      fallback: DEFAULT_COMPOSE_ATTACHMENT_CLEANUP_INTERVAL_MS,
      min: 60000,
      max: 24 * 60 * 60 * 1000,
    }),
    composeAttachmentRetentionMs:
      readBoundedInteger({
        value: env.COMPOSE_ATTACHMENT_CLEANUP_RETENTION_HOURS,
        fallback: DEFAULT_COMPOSE_ATTACHMENT_RETENTION_HOURS,
        min: 1,
        max: 24 * 90,
      }) *
      60 *
      60 *
      1000,
    composeAttachmentCleanupLimit: readBoundedInteger({
      value: env.COMPOSE_ATTACHMENT_CLEANUP_LIMIT,
      fallback: DEFAULT_COMPOSE_ATTACHMENT_CLEANUP_LIMIT,
      min: 1,
      max: 10000,
    }),
    hermesRetentionCleanupIntervalMs: readBoundedInteger({
      value: env.HERMES_RETENTION_CLEANUP_INTERVAL_MS,
      fallback: DEFAULT_HERMES_RETENTION_CLEANUP_INTERVAL_MS,
      min: 60000,
      max: 24 * 60 * 60 * 1000,
    }),
    hermesRetentionMs:
      readBoundedInteger({
        value: env.HERMES_RETENTION_DAYS,
        fallback: DEFAULT_HERMES_RETENTION_DAYS,
        min: 1,
        max: 365,
      }) *
      24 *
      60 *
      60 *
      1000,
    hermesRetentionCleanupLimit: readBoundedInteger({
      value: env.HERMES_RETENTION_CLEANUP_LIMIT,
      fallback: DEFAULT_HERMES_RETENTION_CLEANUP_LIMIT,
      min: 1,
      max: 10000,
    }),
    nativeEngineEnabled:
      env.EMAILHUB_NATIVE_ENGINE_ENABLED?.trim().toLowerCase() === "true",
  };
}

function readBoundedInteger(input: {
  value?: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (!input.value) {
    return input.fallback;
  }

  const parsed = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsed)) {
    return input.fallback;
  }

  return Math.min(input.max, Math.max(input.min, parsed));
}
