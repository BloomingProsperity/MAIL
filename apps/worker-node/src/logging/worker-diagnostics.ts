import type {
  OperationalEventRecordInput,
  OperationalEventRecorder,
} from "./operational-events.js";

export interface WorkerResultDiagnosticInput {
  recorder: OperationalEventRecorder;
  workerId: string;
  result: Record<string, unknown> & { status: string };
}

export async function recordWorkerResultDiagnostic(
  input: WorkerResultDiagnosticInput,
): Promise<void> {
  await input.recorder.record(toOperationalEvent(input.workerId, input.result));
}

function toOperationalEvent(
  workerId: string,
  result: Record<string, unknown> & { status: string },
): OperationalEventRecordInput {
  const eventName = eventNameForResult(result);
  const message = messageForResult(result);

  return {
    service: "email-hub-worker",
    level: levelForResult(result),
    event: eventName,
    ...readString("accountId", result.accountId),
    ...readString("lane", result.laneName),
    ...readString("jobId", readWorkItemId(result)),
    ...readString("message", message),
    context: {
      workerId,
      result,
      ...readNumber("attempts", result.attempts),
      ...readNumber("maxAttempts", result.maxAttempts),
      ...readBoolean("retryable", result.retryable),
      ...readString("finalJobStatus", result.finalJobStatus),
      ...readString("nextRunAt", result.nextRunAt),
    },
  };
}

function levelForResult(
  result: Record<string, unknown> & { status: string },
): OperationalEventRecordInput["level"] {
  if (result.status === "failed") {
    return result.finalJobStatus === "dead_letter" ? "error" : "warn";
  }

  return result.status === "skipped" ? "warn" : "info";
}

function eventNameForResult(result: Record<string, unknown>): string {
  if (result.status !== "failed") {
    return "worker_result";
  }

  return result.finalJobStatus === "dead_letter"
    ? "sync_job_dead_lettered"
    : "sync_job_retry_scheduled";
}

function messageForResult(result: Record<string, unknown>): unknown {
  if (typeof result.errorMessage !== "string" || result.errorMessage.length === 0) {
    return undefined;
  }

  if (result.status !== "failed") {
    return result.errorMessage;
  }

  if (result.finalJobStatus === "dead_letter") {
    return `${result.errorMessage}; job moved to dead letter`;
  }

  if (
    typeof result.attempts === "number" &&
    typeof result.maxAttempts === "number"
  ) {
    return `${result.errorMessage}; retry ${result.attempts} of ${result.maxAttempts} scheduled`;
  }

  return result.errorMessage;
}

function readWorkItemId(result: Record<string, unknown>): unknown {
  return (
    result.jobId ??
    result.commandId ??
    result.scheduleId ??
    result.deliveryJobId ??
    result.reminderId
  );
}

function readString<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  return { [key]: value } as Partial<Record<K, string>>;
}

function readNumber<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, number>> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {};
  }

  return { [key]: value } as Partial<Record<K, number>>;
}

function readBoolean<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, boolean>> {
  if (typeof value !== "boolean") {
    return {};
  }

  return { [key]: value } as Partial<Record<K, boolean>>;
}
