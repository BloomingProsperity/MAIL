export interface WorkerRuntimeConfig {
  leaseSeconds: number;
  concurrency: number;
  pollMs: number;
}

const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_MS = 5000;

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
