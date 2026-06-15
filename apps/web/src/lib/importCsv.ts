export type Provider = "gmail" | "outlook" | "163" | "qq" | "icloud" | "proton" | "custom";
export type AuthMethod = "oauth" | "app_password" | "bridge" | "imap_smtp";

export interface AccountImportRow {
  email: string;
  provider: Provider;
  displayName: string;
  authMethod: AuthMethod;
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: string;
  username?: string;
  secret?: string;
  labels: string[];
  group?: string;
  enabled: boolean;
  syncSince?: string;
  sendEnabled: boolean;
  notes?: string;
}

export interface CsvValidationError {
  row: number;
  field: string;
  message: string;
}

export interface AccountCsvParseResult {
  validRows: AccountImportRow[];
  errors: CsvValidationError[];
}

const requiredHeaders = [
  "email",
  "provider",
  "display_name",
  "auth_method",
  "imap_host",
  "imap_port",
  "imap_security",
  "smtp_host",
  "smtp_port",
  "smtp_security",
  "username",
  "secret",
  "labels",
  "group",
  "enabled",
  "sync_since",
  "send_enabled",
  "notes"
];

export function parseAccountCsv(input: string): AccountCsvParseResult {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      validRows: [],
      errors: [{ row: 1, field: "email", message: "CSV 不能为空" }]
    };
  }

  const headers = splitCsvLine(lines[0]);
  const missingHeader = requiredHeaders.find((header) => !headers.includes(header));
  if (missingHeader) {
    return {
      validRows: [],
      errors: [{ row: 1, field: missingHeader, message: "CSV 缺少必填表头" }]
    };
  }

  const validRows: AccountImportRow[] = [];
  const errors: CsvValidationError[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitCsvLine(lines[index]);
    const raw = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const rowNumber = index + 1;
    const provider = normalizeProvider(raw.provider);
    const authMethod = normalizeAuthMethod(raw.auth_method);

    if (!raw.email.includes("@")) {
      errors.push({ row: rowNumber, field: "email", message: "邮箱地址格式不正确" });
      continue;
    }

    if (!provider) {
      errors.push({ row: rowNumber, field: "provider", message: "不支持的邮箱提供商" });
      continue;
    }

    if (!authMethod) {
      errors.push({ row: rowNumber, field: "auth_method", message: "不支持的授权方式" });
      continue;
    }

    const needsServer =
      authMethod === "imap_smtp" ||
      (authMethod === "app_password" && !usesPresetProvider(provider));
    if (needsServer && (!raw.imap_host || !raw.smtp_host || !raw.secret)) {
      errors.push({
        row: rowNumber,
        field: "imap_host",
        message: "IMAP/SMTP 账号必须填写服务器和授权码"
      });
      continue;
    }

    if (authMethod === "bridge" && !raw.imap_host) {
      errors.push({ row: rowNumber, field: "imap_host", message: "Proton Bridge 必须填写本地 Bridge 地址" });
      continue;
    }

    validRows.push({
      email: raw.email,
      provider,
      displayName: raw.display_name || raw.email,
      authMethod,
      imapHost: raw.imap_host || undefined,
      imapPort: toOptionalNumber(raw.imap_port),
      imapSecurity: raw.imap_security || undefined,
      smtpHost: raw.smtp_host || undefined,
      smtpPort: toOptionalNumber(raw.smtp_port),
      smtpSecurity: raw.smtp_security || undefined,
      username: raw.username || raw.email,
      secret: raw.secret || undefined,
      labels: raw.labels ? raw.labels.split(/[|;]/).map((label) => label.trim()).filter(Boolean) : [],
      group: raw.group || undefined,
      enabled: parseBoolean(raw.enabled, true),
      syncSince: raw.sync_since || undefined,
      sendEnabled: parseBoolean(raw.send_enabled, false),
      notes: raw.notes || undefined
    });
  }

  return { validRows, errors };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function normalizeProvider(value: string): Provider | null {
  const lower = value.trim().toLowerCase();
  const compact = lower.replace(/[\s._-]/g, "");
  if (lower === "gmail") return "gmail";
  if (lower === "outlook" || lower === "microsoft" || lower === "m365") return "outlook";
  if (lower === "163" || lower === "netease") return "163";
  if (lower === "qq") return "qq";
  if (
    [
      "icloud",
      "icloudmail",
      "icloudcom",
      "apple",
      "applemail",
      "appleicloud",
      "mecom",
      "maccom",
      "icould"
    ].includes(compact)
  ) {
    return "icloud";
  }
  if (lower === "proton") return "proton";
  if (lower === "custom" || lower === "domain") return "custom";
  return null;
}

function usesPresetProvider(provider: Provider | null): boolean {
  return provider === "icloud";
}

function normalizeAuthMethod(value: string): AuthMethod | null {
  const lower = value.toLowerCase();
  if (lower === "oauth") return "oauth";
  if (lower === "app_password" || lower === "auth_code") return "app_password";
  if (lower === "bridge") return "bridge";
  if (lower === "imap_smtp" || lower === "password") return "imap_smtp";
  return null;
}

function toOptionalNumber(value: string): number | undefined {
  if (!value) return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function parseBoolean(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["true", "1", "yes", "y", "启用"].includes(value.toLowerCase());
}
