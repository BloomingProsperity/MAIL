import { sanitizeCliError } from "../cli/safe-error.js";

const SENSITIVE_FIELD_PATTERN =
  /(?:authorization|credential|password|secret|token|api[_-]?key)/i;

export function safeSmokeBodySummary(
  body: unknown,
  secrets: Array<string | undefined> = [],
): string {
  try {
    return sanitizeCliError(
      JSON.stringify(redactSensitiveFields(body, 0, secrets)) ??
        "undefined",
      secrets,
    );
  } catch {
    return "[unserializable response body]";
  }
}

export function safeSmokeText(
  value: string | undefined,
  secrets: Array<string | undefined> = [],
): string | undefined {
  return value === undefined ? undefined : sanitizeCliError(value, secrets);
}

function redactSensitiveFields(
  value: unknown,
  depth = 0,
  secrets: Array<string | undefined> = [],
): unknown {
  if (depth > 8) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return sanitizeCliError(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactSensitiveFields(item, depth + 1, secrets),
    );
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key)
        ? "[redacted]"
        : redactSensitiveFields(item, depth + 1, secrets),
    ]),
  );
}
