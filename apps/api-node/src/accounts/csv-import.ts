import type {
  AccountOnboardingStore,
  ImapSmtpEndpointSettings,
  ImapSmtpProviderPresetOverrides,
  OnboardingTask,
} from "./imap-smtp-onboarding.js";
import {
  hasImapSmtpProviderPreset,
  normalizeImapSmtpProvider,
  resolveImapSmtpSettings,
} from "./imap-smtp-onboarding.js";

export class InvalidCsvImportError extends Error {
  readonly code = "invalid_csv_import";
}

export type CsvImportRowStatus =
  | "ready"
  | "needs_oauth"
  | "disabled"
  | "invalid";

export interface CsvImportPreviewRow {
  rowNumber: number;
  email?: string;
  provider?: string;
  authMethod?: "password" | "oauth";
  status: CsvImportRowStatus;
  errors: string[];
  warnings: string[];
}

export interface CsvImportSummary {
  totalRows: number;
  ready: number;
  needsOAuth: number;
  disabled: number;
  invalid: number;
}

export interface CsvImportPreviewResult {
  summary: CsvImportSummary;
  rows: CsvImportPreviewRow[];
}

export interface CsvImportCreatedTask {
  rowNumber: number;
  id: string;
  email: string;
  provider: string;
  authMethod: string;
  status: string;
}

export interface CsvImportCreateResult extends CsvImportPreviewResult {
  createdTaskCount: number;
  tasks: CsvImportCreatedTask[];
}

export interface AccountCsvImportServiceOptions {
  store: Pick<AccountOnboardingStore, "createTask">;
  createId: () => string;
  providerPresetOverrides?: ImapSmtpProviderPresetOverrides;
}

export interface AccountCsvImportService {
  previewCsv(input: { csv: string }): Promise<CsvImportPreviewResult>;
  createImport(input: { csv: string }): Promise<CsvImportCreateResult>;
}

interface InternalCsvImportRow {
  preview: CsvImportPreviewRow;
  task?: Omit<OnboardingTask, "id">;
}

export function createAccountCsvImportService(
  options: AccountCsvImportServiceOptions,
): AccountCsvImportService {
  return {
    async previewCsv(input) {
      return publicPreview(buildImportRows(input.csv, options));
    },
    async createImport(input) {
      const rows = buildImportRows(input.csv, options);
      const tasks: CsvImportCreatedTask[] = [];

      for (const row of rows) {
        if (!row.task) {
          continue;
        }

        const task = await options.store.createTask({
          ...row.task,
          id: options.createId(),
        });
        tasks.push({
          rowNumber: row.preview.rowNumber,
          id: task.id,
          email: task.email,
          provider: task.provider,
          authMethod: task.authMethod,
          status: task.status,
        });
      }

      return {
        ...publicPreview(rows),
        createdTaskCount: tasks.length,
        tasks,
      };
    },
  };
}

function buildImportRows(
  csv: string,
  options: Pick<AccountCsvImportServiceOptions, "providerPresetOverrides">,
): InternalCsvImportRow[] {
  const table = parseCsv(csv);
  if (table.length < 2) {
    throw new InvalidCsvImportError("CSV requires a header and at least one row");
  }

  const headers = table[0].map(normalizeHeader);
  for (const required of ["email", "provider", "auth_method"]) {
    if (!headers.includes(required)) {
      throw new InvalidCsvImportError(`CSV missing required header: ${required}`);
    }
  }

  return table.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new InvalidCsvImportError(
        `CSV row ${rowNumber} has ${values.length} columns; expected ${headers.length}`,
      );
    }

    return buildImportRow(rowNumber, objectFromRow(headers, values), options);
  });
}

function buildImportRow(
  rowNumber: number,
  row: Record<string, string>,
  options: Pick<AccountCsvImportServiceOptions, "providerPresetOverrides">,
): InternalCsvImportRow {
  const email = row.email.trim().toLowerCase();
  const provider = normalizeProvider(row.provider);
  const authMethod = normalizeAuthMethod(row.auth_method, provider);
  const enabled = parseEnabled(row.enabled);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isEmailLike(email)) {
    errors.push("email is invalid");
  }
  if (!provider) {
    errors.push("provider is required");
  }
  if (!authMethod) {
    errors.push("auth_method is invalid");
  }
  if (provider === "outlook" && authMethod === "password") {
    errors.push("outlook CSV import requires OAuth");
  }
  if (authMethod === "oauth" && provider !== "gmail" && provider !== "outlook") {
    errors.push("OAuth CSV import is only supported for gmail and outlook");
  }

  if (!enabled) {
    return {
      preview: {
        rowNumber,
        ...(email ? { email } : {}),
        ...(provider ? { provider } : {}),
        ...(authMethod ? { authMethod } : {}),
        status: "disabled",
        errors: [],
        warnings,
      },
    };
  }

  if (authMethod === "password") {
    validatePasswordRow(row, errors);
  }

  if (errors.length > 0 || !provider || !authMethod) {
    return {
      preview: {
        rowNumber,
        ...(email ? { email } : {}),
        ...(provider ? { provider } : {}),
        ...(authMethod ? { authMethod } : {}),
        status: "invalid",
        errors,
        warnings,
      },
    };
  }

  if (authMethod === "oauth") {
    return {
      preview: {
        rowNumber,
        email,
        provider,
        authMethod,
        status: "needs_oauth",
        errors,
        warnings,
      },
      task: {
        email,
        provider,
        authMethod,
        status: "pending",
        payload: {
          source: "csv_import",
          loginHint: email,
          displayName: optionalString(row.display_name),
          labels: parseLabels(row.labels),
          group: optionalString(row.group),
          notes: optionalString(row.notes),
        },
      },
    };
  }

  const settings = resolveImapSmtpSettings(
    {
      email,
      provider,
      username: optionalString(row.username),
      secret: optionalString(row.secret),
      ...(hasImapSmtpProviderPreset(provider) &&
      !hasExplicitEndpointSettings(row)
        ? {}
        : {
            imap: endpointFromRow(row, "imap"),
            smtp: endpointFromRow(row, "smtp"),
          }),
    },
    {
      providerPresetOverrides: options.providerPresetOverrides,
    },
  );
  return {
    preview: {
      rowNumber,
      email,
      provider,
      authMethod,
      status: "ready",
      errors,
      warnings,
    },
    task: {
      email,
      provider,
      authMethod,
      status: "pending",
      payload: {
        source: "csv_import",
        displayName: optionalString(row.display_name),
        labels: parseLabels(row.labels),
        group: optionalString(row.group),
        notes: optionalString(row.notes),
        ...(settings.providerPreset
          ? { providerPreset: settings.providerPreset }
          : {}),
        imap: redactEndpoint(settings.imap),
        smtp: redactEndpoint(settings.smtp),
      },
    },
  };
}

function validatePasswordRow(row: Record<string, string>, errors: string[]): void {
  if (!row.secret?.trim()) {
    errors.push("secret is required");
  }

  if (
    hasImapSmtpProviderPreset(row.provider) &&
    !hasExplicitEndpointSettings(row)
  ) {
    return;
  }

  for (const protocol of ["imap", "smtp"] as const) {
    if (!row[`${protocol}_host`]?.trim()) {
      errors.push(`${protocol}_host is required`);
    }
    const port = Number.parseInt(row[`${protocol}_port`] ?? "", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`${protocol}_port is invalid`);
    }
    if (!parseSecurity(row[`${protocol}_security`])) {
      errors.push(`${protocol}_security is invalid`);
    }
  }
}

function hasExplicitEndpointSettings(row: Record<string, string>): boolean {
  return ["imap_host", "imap_port", "imap_security", "smtp_host", "smtp_port", "smtp_security"].some(
    (key) => row[key]?.trim(),
  );
}

function endpointFromRow(
  row: Record<string, string>,
  protocol: "imap" | "smtp",
): ImapSmtpEndpointSettings {
  const port = Number.parseInt(row[`${protocol}_port`], 10);
  const security = parseSecurity(row[`${protocol}_security`]);
  if (!security) {
    throw new InvalidCsvImportError(`${protocol}_security is invalid`);
  }

  return {
    host: row[`${protocol}_host`].trim(),
    port,
    secure: security.secure,
    username: optionalString(row.username) ?? row.email.trim().toLowerCase(),
    secret: row.secret,
  };
}

function publicPreview(rows: InternalCsvImportRow[]): CsvImportPreviewResult {
  const previewRows = rows.map((row) => row.preview);
  return {
    summary: {
      totalRows: previewRows.length,
      ready: previewRows.filter((row) => row.status === "ready").length,
      needsOAuth: previewRows.filter((row) => row.status === "needs_oauth")
        .length,
      disabled: previewRows.filter((row) => row.status === "disabled").length,
      invalid: previewRows.filter((row) => row.status === "invalid").length,
    },
    rows: previewRows,
  };
}

function parseCsv(csv: string): string[][] {
  if (!csv.trim()) {
    throw new InvalidCsvImportError("CSV is empty");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) {
    throw new InvalidCsvImportError("CSV has an unclosed quoted field");
  }

  row.push(field);
  rows.push(row);
  return rows.filter((items) => items.some((item) => item.trim().length > 0));
}

function objectFromRow(
  headers: string[],
  values: string[],
): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""]),
  );
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (provider === "microsoft" || provider === "office365") {
    return "outlook";
  }

  return normalizeImapSmtpProvider(provider);
}

function normalizeAuthMethod(
  value: string,
  provider: string,
): "password" | "oauth" | undefined {
  const method = value.trim().toLowerCase();
  if (!method) {
    return provider === "gmail" || provider === "outlook"
      ? "oauth"
      : "password";
  }
  if (method === "oauth" || method === "oauth2") {
    return "oauth";
  }
  if (
    method === "password" ||
    method === "app_password" ||
    method === "authorization_code" ||
    method === "imap_smtp"
  ) {
    return "password";
  }

  return undefined;
}

function parseEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !(
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "disabled"
  );
}

function parseSecurity(
  value: string | undefined,
): { secure: boolean } | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "tls" || normalized === "ssl" || normalized === "true") {
    return { secure: true };
  }
  if (
    normalized === "starttls" ||
    normalized === "plain" ||
    normalized === "none" ||
    normalized === "false"
  ) {
    return { secure: false };
  }

  return undefined;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseLabels(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;|]/)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

function redactEndpoint(endpoint: ImapSmtpEndpointSettings) {
  return {
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    username: endpoint.username,
    secret: "[redacted]",
  };
}

function isEmailLike(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
