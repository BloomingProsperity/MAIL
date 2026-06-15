export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface JsonLoggerOptions {
  service: string;
  level?: string;
  sink?: (line: string, level: Exclude<LogLevel, "silent">) => void;
  now?: () => string;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

const SENSITIVE_KEY =
  /authorization|cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|pass$/i;
const SENSITIVE_QUERY_KEY =
  /code|password|secret|token|access_token|refresh_token|api_key/i;

export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const minLevel = parseLogLevel(options.level ?? "info");
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date().toISOString());

  function write(
    level: Exclude<LogLevel, "silent">,
    event: string,
    fields: Record<string, unknown> = {},
  ) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) {
      return;
    }

    const sanitizedFields = sanitizeLogFields(fields);
    const fieldObject =
      sanitizedFields && typeof sanitizedFields === "object" && !Array.isArray(sanitizedFields)
        ? sanitizedFields
        : {};

    sink(
      JSON.stringify({
        timestamp: now(),
        level,
        service: options.service,
        event,
        ...fieldObject,
      }),
      level,
    );
  }

  return {
    debug(event, fields) {
      write("debug", event, fields);
    },
    info(event, fields) {
      write("info", event, fields);
    },
    warn(event, fields) {
      write("warn", event, fields);
    },
    error(event, fields) {
      write("error", event, fields);
    },
  };
}

export function parseLogLevel(level: string): LogLevel {
  const normalized = level.trim().toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "silent"
  ) {
    return normalized;
  }

  return "info";
}

export function sanitizeLogFields(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), undefined);
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  key: string | undefined,
): unknown {
  if (key && SENSITIVE_KEY.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    if (key === "url" || key === "path" || key?.endsWith("Url")) {
      return sanitizeRequestUrl(value);
    }
    return value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, undefined));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      output[entryKey] = sanitizeValue(entryValue, seen, entryKey);
    }
    return output;
  }

  return String(value);
}

function sanitizeRequestUrl(requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl, "http://emailhub.local");
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return requestUrl;
  }
}

function defaultSink(line: string, level: Exclude<LogLevel, "silent">): void {
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
