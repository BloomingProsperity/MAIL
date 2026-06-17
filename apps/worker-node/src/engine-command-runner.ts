import type {
  EngineCommandQueue,
  EngineCommandRecord,
} from "./engine-command-queue.js";
import { isNonRetryableQueueError } from "./queue-errors.js";

export type EngineCommandRunResult =
  | { status: "idle" }
  | (EngineCommandRunContext & { status: "processed" })
  | (EngineCommandRunContext & {
      status: "failed";
      errorMessage: string;
      finalCommandStatus: EngineCommandRecord["status"];
      attempts: number;
      maxAttempts: number;
      retryable: boolean;
      nextRunAt?: string;
    });

export interface EngineCommandRunContext {
  commandId: string;
  accountId: string;
  commandType: EngineCommandRecord["commandType"];
  idempotencyKey: string;
}

export interface RunEngineCommandOnceInput {
  queue: EngineCommandQueue;
  workerId: string;
  now: Date;
  leaseSeconds: number;
  handleCommand(command: EngineCommandRecord): Promise<void>;
}

export interface RunEngineCommandBatchInput
  extends RunEngineCommandOnceInput {
  concurrency: number;
}

export async function runEngineCommandOnce(
  input: RunEngineCommandOnceInput,
): Promise<EngineCommandRunResult> {
  const command = await input.queue.claimNext({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds,
  });

  if (!command) {
    return { status: "idle" };
  }

  return processClaimedCommand(input, command);
}

export async function runEngineCommandBatch(
  input: RunEngineCommandBatchInput,
): Promise<EngineCommandRunResult[]> {
  const commands: EngineCommandRecord[] = [];
  const concurrency = normalizeConcurrency(input.concurrency);

  for (let index = 0; index < concurrency; index += 1) {
    const command = await input.queue.claimNext({
      workerId: input.workerId,
      now: input.now,
      leaseSeconds: input.leaseSeconds,
    });

    if (!command) {
      break;
    }

    commands.push(command);
  }

  if (commands.length === 0) {
    return [{ status: "idle" }];
  }

  return Promise.all(
    commands.map((command) => processClaimedCommand(input, command)),
  );
}

async function processClaimedCommand(
  input: RunEngineCommandOnceInput,
  command: EngineCommandRecord,
): Promise<EngineCommandRunResult> {
  try {
    await input.handleCommand(command);
    await input.queue.completeCommand({
      commandId: command.id,
      workerId: input.workerId,
      now: input.now,
    });
    return { status: "processed", ...commandContext(command) };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "unknown engine command error";
    const failedCommand = await input.queue.failCommand({
      commandId: command.id,
      workerId: input.workerId,
      errorMessage,
      retryable: !isNonRetryableQueueError(error),
      now: input.now,
    });
    return {
      status: "failed",
      ...commandContext(command),
      errorMessage,
      finalCommandStatus: failedCommand.status,
      attempts: failedCommand.attempts,
      maxAttempts: failedCommand.maxAttempts,
      retryable: failedCommand.status !== "dead_letter",
      ...(failedCommand.status === "queued"
        ? { nextRunAt: failedCommand.notBefore }
        : {}),
    };
  }
}

function commandContext(command: EngineCommandRecord): EngineCommandRunContext {
  return {
    commandId: command.id,
    accountId: command.accountId,
    commandType: command.commandType,
    idempotencyKey: command.idempotencyKey,
  };
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}
