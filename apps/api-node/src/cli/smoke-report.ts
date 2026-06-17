import { sanitizeCliError } from "./safe-error.js";

export interface SmokeFailureReportInput {
  smoke: string;
  error: unknown;
  fields?: Record<string, unknown>;
  secrets?: Array<string | undefined>;
}

export function buildSmokeFailureReport(
  input: SmokeFailureReportInput,
): Record<string, unknown> {
  const secrets = input.secrets ?? [];
  return {
    ok: false,
    smoke: input.smoke,
    ...sanitizeReportFields(input.fields ?? {}, secrets),
    error: sanitizeCliError(input.error, secrets),
  };
}

export function writeSmokeFailureReport(
  input: SmokeFailureReportInput & {
    writeStderr?: (message: string) => void;
  },
): void {
  const writeStderr = input.writeStderr ?? console.error;
  writeStderr(JSON.stringify(buildSmokeFailureReport(input), null, 2));
}

function sanitizeReportFields(
  fields: Record<string, unknown>,
  secrets: Array<string | undefined>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "string"
          ? sanitizeCliError(value, secrets)
          : value,
      ]),
  );
}
