export function sanitizeCliError(
  error: unknown,
  secrets: Array<string | undefined> = [],
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown_error";
  let sanitized = raw.trim() || "unknown_error";

  for (const secret of secrets) {
    const value = secret?.trim();
    if (value && value.length >= 4) {
      sanitized = sanitized.split(value).join("[redacted]");
    }
  }

  sanitized = sanitized
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:token|access_token|api_key|secret|password|authorization)=([^\s&]+)/gi,
      "[redacted]",
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(
      /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){3}\b/g,
      "[host]",
    );

  return sanitized.length > 240
    ? `${sanitized.slice(0, 237)}...`
    : sanitized;
}
