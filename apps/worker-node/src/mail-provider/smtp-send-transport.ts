import { createHash } from "node:crypto";

import nodemailer, { type SendMailOptions } from "nodemailer";

import type { Queryable } from "../credentials/account-credential-store.js";
import type {
  MailAddress,
  MailThreading,
  ScheduledSendTransport,
} from "../scheduled-send-runner.js";
import type { SecretStore } from "../secrets/secret-store.js";

export const SMTP_PASSWORD_CREDENTIAL_KIND = "smtp_password";
export const IMAP_PASSWORD_CREDENTIAL_KIND = "imap_password";

export interface SmtpAccountSendSettings {
  accountId: string;
  provider: string;
  fromAddress: string;
  fromName?: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  secretRef?: string;
  imap?: SmtpEndpointPublicSettings;
  smtp: SmtpEndpointPublicSettings;
}

export interface SmtpEndpointPublicSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
}

export interface SmtpAccountSendSettingsStore {
  getSettings(accountId: string): Promise<SmtpAccountSendSettings | undefined>;
}

export interface SmtpSendReauthorizationMarker {
  markRequired(input: {
    accountId: string;
    reason: string;
  }): Promise<{ taskId?: string }>;
}

export type SmtpSendMail = (input: {
  settings: SmtpAccountSendSettings;
  secret: string;
  mail: SendMailOptions;
}) => Promise<{ messageId?: string }>;

interface SmtpAccountSettingsRow extends Record<string, unknown> {
  account_id: string;
  email: string;
  display_name?: string | null;
  provider: string;
  settings?: unknown;
  secret_ref?: string | null;
}

export function createPostgresSmtpAccountSendSettingsStore(
  client: Queryable,
): SmtpAccountSendSettingsStore {
  return {
    async getSettings(accountId) {
      const result = await client.query<SmtpAccountSettingsRow>(
        `
          SELECT
            connected_accounts.id AS account_id,
            connected_accounts.email,
            connected_accounts.display_name,
            connected_accounts.provider,
            account_provider_settings.settings,
            COALESCE(smtp_credential.secret_ref, imap_credential.secret_ref) AS secret_ref
          FROM connected_accounts
          JOIN account_provider_settings
            ON account_provider_settings.account_id = connected_accounts.id
           AND account_provider_settings.native_provider = 'imap'
          LEFT JOIN account_credentials AS smtp_credential
            ON smtp_credential.account_id = connected_accounts.id
           AND smtp_credential.credential_kind = $2
          LEFT JOIN account_credentials AS imap_credential
            ON imap_credential.account_id = connected_accounts.id
           AND imap_credential.credential_kind = $3
          WHERE connected_accounts.id = $1
          LIMIT 1
        `,
        [accountId, SMTP_PASSWORD_CREDENTIAL_KIND, IMAP_PASSWORD_CREDENTIAL_KIND],
      );

      return result.rows[0] ? rowToSmtpSettings(result.rows[0]) : undefined;
    },
  };
}

export function createPostgresSmtpSendReauthorizationMarker(input: {
  client: Queryable;
  createId: () => string;
}): SmtpSendReauthorizationMarker {
  return {
    async markRequired(mark) {
      const taskId = input.createId();
      const result = await input.client.query<{ task_id?: string | null }>(
        `
          WITH marked_account AS (
            UPDATE connected_accounts
            SET sync_state = 'reauth_required',
                updated_at = now()
            FROM account_provider_settings
            WHERE connected_accounts.id = $1
              AND connected_accounts.auth_method = 'password'
              AND account_provider_settings.account_id = connected_accounts.id
            RETURNING
              connected_accounts.id,
              connected_accounts.email,
              connected_accounts.provider,
              connected_accounts.auth_method,
              connected_accounts.display_name,
              account_provider_settings.settings
          ), existing_task AS (
            SELECT id
            FROM onboarding_tasks
            WHERE status IN ('pending', 'failed')
              AND payload ->> 'reauthRequired' = 'true'
              AND payload ->> 'accountId' = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          ), inserted_task AS (
            INSERT INTO onboarding_tasks (
              id,
              email,
              provider,
              auth_method,
              status,
              error_message,
              payload
            )
            SELECT
              $2,
              marked_account.email,
              marked_account.provider,
              marked_account.auth_method,
              'pending',
              $3,
              jsonb_strip_nulls(
                jsonb_build_object(
                  'source', 'native_smtp_send',
                  'reauthRequired', true,
                  'accountId', marked_account.id::text,
                  'displayName', marked_account.display_name,
                  'username', COALESCE(
                    marked_account.settings #>> '{smtp,username}',
                    marked_account.settings #>> '{imap,username}'
                  ),
                  'imap', marked_account.settings -> 'imap',
                  'smtp', marked_account.settings -> 'smtp',
                  'reason', $3
                )
              )
            FROM marked_account
            WHERE NOT EXISTS (SELECT 1 FROM existing_task)
            RETURNING id
          )
          SELECT id AS task_id FROM inserted_task
          UNION ALL
          SELECT id AS task_id FROM existing_task
          LIMIT 1
        `,
        [mark.accountId, taskId, mark.reason],
      );

      return {
        ...(result.rows[0]?.task_id
          ? { taskId: String(result.rows[0].task_id) }
          : {}),
      };
    },
  };
}

export function createSmtpNativeSendTransport(input: {
  settingsStore: SmtpAccountSendSettingsStore;
  secretStore: SecretStore;
  sendMail?: SmtpSendMail;
  reauthorizationMarker?: SmtpSendReauthorizationMarker;
}): ScheduledSendTransport {
  const sendMail = input.sendMail ?? sendWithNodemailer;
  return {
    async submitMessage(message) {
      const settings = await input.settingsStore.getSettings(message.accountId);
      if (!settings) {
        throw new Error(
          `native SMTP settings not found for account ${message.accountId}`,
        );
      }
      if (!settings.secretRef) {
        const error = new Error(
          `missing smtp_password or imap_password credential for account ${message.accountId}`,
        );
        await markSmtpReauthorization(input.reauthorizationMarker, {
          accountId: message.accountId,
          error,
        });
        throw error;
      }

      const secret = await input.secretStore.getSecret(settings.secretRef);
      if (secret.trim().length === 0) {
        const error = new Error(
          `empty smtp_password or imap_password secret for account ${message.accountId}`,
        );
        await markSmtpReauthorization(input.reauthorizationMarker, {
          accountId: message.accountId,
          error,
        });
        throw error;
      }

      const mail = mailOptions(settings, message);
      try {
        const result = await sendMail({
          settings,
          secret,
          mail,
        });

        return {
          messageId: result.messageId ?? String(mail.messageId),
        };
      } catch (error) {
        const sanitized = sanitizeSecretError(error, secret);
        await markSmtpReauthorization(input.reauthorizationMarker, {
          accountId: message.accountId,
          error: sanitized,
        });
        throw sanitized;
      }
    },
  };
}

async function sendWithNodemailer(input: {
  settings: SmtpAccountSendSettings;
  secret: string;
  mail: SendMailOptions;
}): Promise<{ messageId?: string }> {
  const transport = nodemailer.createTransport({
    host: input.settings.host,
    port: input.settings.port,
    secure: input.settings.secure,
    auth: {
      user: input.settings.username,
      pass: input.secret,
    },
  });
  const result = await transport.sendMail(input.mail);
  return {
    ...(typeof result.messageId === "string"
      ? { messageId: result.messageId }
      : {}),
  };
}

function mailOptions(
  settings: SmtpAccountSendSettings,
  message: Parameters<ScheduledSendTransport["submitMessage"]>[0],
): SendMailOptions {
  const headerFrom = message.from ?? {
    address: settings.fromAddress,
    ...(settings.fromName ? { name: settings.fromName } : {}),
  };
  return {
    from: addressValue(headerFrom),
    to: addressList(message.to),
    ...(message.cc.length > 0 ? { cc: addressList(message.cc) } : {}),
    ...(message.bcc.length > 0 ? { bcc: addressList(message.bcc) } : {}),
    subject: message.subject,
    ...(message.bodyText ? { text: message.bodyText } : {}),
    ...(message.bodyHtml ? { html: message.bodyHtml } : {}),
    messageId: deterministicMessageId(message),
    envelope: {
      from: safeHeaderAddress(settings.fromAddress),
      to: [...message.to, ...message.cc, ...message.bcc].map(
        (address) => safeHeaderAddress(address.address),
      ),
    },
    headers: {
      "X-EmailHub-Idempotency-Key": message.idempotencyKey,
      ...threadingHeaders(message.threading),
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function rowToSmtpSettings(
  row: SmtpAccountSettingsRow,
): SmtpAccountSendSettings | undefined {
  const settings = recordValue(row.settings);
  const smtp = endpointSettings(settings.smtp);
  if (!smtp) {
    return undefined;
  }
  const imap = endpointSettings(settings.imap);
  const secretRef = readString(row.secret_ref);
  const fromName = readString(row.display_name);

  return {
    accountId: row.account_id,
    provider: row.provider,
    fromAddress: row.email,
    ...(fromName ? { fromName } : {}),
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    username: smtp.username,
    ...(secretRef ? { secretRef } : {}),
    ...(imap ? { imap } : {}),
    smtp,
  };
}

function endpointSettings(value: unknown): SmtpEndpointPublicSettings | undefined {
  const endpoint = recordValue(value);
  const host = readString(endpoint.host);
  const port = readNumber(endpoint.port);
  const secure = readBoolean(endpoint.secure);
  const username = readString(endpoint.username);
  if (!host || !port || secure === undefined || !username) {
    return undefined;
  }

  return { host, port, secure, username };
}

function deterministicMessageId(
  message: Parameters<ScheduledSendTransport["submitMessage"]>[0],
): string {
  const digest = createHash("sha256")
    .update(`${message.accountId}:${message.draftId}:${message.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `<${digest}@emailhub.local>`;
}

function threadingHeaders(
  threading: MailThreading | undefined,
): Record<string, string> {
  if (!threading) {
    return {};
  }

  const inReplyTo = optionalHeaderValue(threading.inReplyTo);
  const references = uniqueHeaderValues(threading.references);
  return {
    ...(inReplyTo ? { "In-Reply-To": inReplyTo } : {}),
    ...(references.length > 0 ? { References: references.join(" ") } : {}),
  };
}

function uniqueHeaderValues(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map(optionalHeaderValue)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function optionalHeaderValue(value: string | undefined): string | undefined {
  return value ? value.replace(/[\r\n]+/g, " ").trim() : undefined;
}

async function markSmtpReauthorization(
  marker: SmtpSendReauthorizationMarker | undefined,
  input: { accountId: string; error: Error },
): Promise<void> {
  if (!marker || !isSmtpReauthorizationRequiredError(input.error)) {
    return;
  }

  await marker.markRequired({
    accountId: input.accountId,
    reason: input.error.message,
  });
}

function isSmtpReauthorizationRequiredError(error: Error): boolean {
  const code = String((error as { code?: unknown }).code ?? "").toUpperCase();
  if (
    [
      "EAUTH",
      "AUTH",
      "AUTHENTICATIONFAILED",
      "AUTHENTICATION_FAILED",
      "AUTHFAILED",
      "AUTH_FAILED",
      "LOGINFAILED",
      "LOGIN_FAILED",
    ].includes(code)
  ) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("missing smtp_password") ||
    message.includes("missing imap_password") ||
    message.includes("empty smtp_password") ||
    message.includes("empty imap_password") ||
    message.includes("auth") ||
    message.includes("invalid login") ||
    message.includes("invalid password") ||
    message.includes("login failed") ||
    message.includes("535") ||
    message.includes("5.7.8")
  );
}

function sanitizeSecretError(error: unknown, secret: string): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  const sanitized = new Error(base.message.split(secret).join("[redacted]"));
  const code = (base as { code?: unknown }).code;
  if (code !== undefined) {
    (sanitized as { code?: unknown }).code = code;
  }
  return sanitized;
}

function addressList(addresses: MailAddress[]): string {
  return addresses.map(addressValue).join(", ");
}

function addressValue(address: MailAddress): string {
  const mailbox = safeHeaderAddress(address.address);
  const name = address.name ? sanitizeHeaderPhrase(address.name) : undefined;
  return name ? `"${name}" <${mailbox}>` : mailbox;
}

function safeHeaderAddress(value: string): string {
  const address = value.trim();
  if (!address || /[\r\n<>]/.test(address)) {
    throw new Error("SMTP address is invalid");
  }

  return address;
}

function sanitizeHeaderPhrase(value: string): string {
  return value.replace(/[\r\n"]+/g, " ").trim();
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return undefined;
}
