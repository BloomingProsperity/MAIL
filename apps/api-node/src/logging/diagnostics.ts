import type { LogLevel } from "./logger.js";

export type DiagnosticLogLevel = Exclude<LogLevel, "silent">;

export interface DiagnosticLogEntry {
  timestamp: string;
  level: DiagnosticLogLevel;
  service: string;
  event: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface DiagnosticsLogListInput {
  limit?: number;
  level?: DiagnosticLogLevel;
  requestId?: string;
  event?: string;
}

export interface DiagnosticsLogStore {
  append(entry: DiagnosticLogEntry): void;
  list(input?: DiagnosticsLogListInput): { items: DiagnosticLogEntry[] };
}

export interface InMemoryDiagnosticsLogStoreOptions {
  capacity?: number;
}

export function createInMemoryDiagnosticsLogStore(
  options: InMemoryDiagnosticsLogStoreOptions = {},
): DiagnosticsLogStore {
  const capacity = clampInteger(options.capacity, 1, 10_000, 500);
  const entries: DiagnosticLogEntry[] = [];

  return {
    append(entry) {
      entries.push(cloneEntry(entry));
      while (entries.length > capacity) {
        entries.shift();
      }
    },
    list(input = {}) {
      const limit = clampInteger(input.limit, 1, 200, 50);
      const requestId = input.requestId?.trim();
      const event = input.event?.trim();

      return {
        items: entries
          .slice()
          .reverse()
          .filter((entry) => !input.level || entry.level === input.level)
          .filter((entry) => !requestId || entry.requestId === requestId)
          .filter((entry) => !event || entry.event === event)
          .slice(0, limit)
          .map(cloneEntry),
      };
    },
  };
}

export function isDiagnosticLogLevel(
  value: string | undefined,
): value is DiagnosticLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function cloneEntry(entry: DiagnosticLogEntry): DiagnosticLogEntry {
  return { ...entry };
}
