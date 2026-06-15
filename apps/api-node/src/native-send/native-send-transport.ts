import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type {
  MailAddress,
  MailSendAttachment,
  MailSendTransport,
  MailThreading,
} from "../mail-compose/mail-compose.js";
import type {
  GmailSubmitClient,
  GraphSubmitClient,
} from "./provider-submit-clients.js";
import type { Queryable } from "./oauth-access-token.js";
import {
  GOOGLE_OAUTH_REFRESH_TOKEN_KIND,
  MICROSOFT_OAUTH_REFRESH_TOKEN_KIND,
  createDatabaseAccessTokenProvider,
} from "./oauth-access-token.js";
import {
  createGoogleOAuthRefreshClient,
  createMicrosoftOAuthRefreshClient,
} from "./oauth-token-clients.js";
import {
  NativeProviderSubmitError,
  createGmailSubmitClient,
  createGraphSubmitClient,
} from "./provider-submit-clients.js";
import {
  type NativeSendReauthorizationMarker,
  createPostgresNativeSendReauthorizationMarker,
  providerForReauthorization,
} from "./reauthorization-marker.js";
import {
  createPostgresSmtpAccountSendSettingsStore,
  createPostgresSmtpSecretStore,
  createPostgresSmtpSendReauthorizationMarker,
  createSmtpNativeSendTransport,
  type SmtpSendMail,
} from "./smtp-send-transport.js";
import type { SmtpSentAppender } from "./imap-sent-appender.js";

export type NativeSendProvider = "gmail" | "graph" | "imap";

export interface NativeAccountSettingsStore {
  getNativeProvider(accountId: string): Promise<NativeSendProvider | undefined>;
}

export function createPostgresNativeAccountSettingsStore(
  client: Queryable,
): NativeAccountSettingsStore {
  return {
    async getNativeProvider(accountId) {
      const result = await client.query<{ native_provider: string | null }>(
        `
          SELECT native_provider
          FROM account_provider_settings
          WHERE account_id = $1
          LIMIT 1
        `,
        [accountId],
      );

      return nativeProvider(result.rows[0]?.native_provider);
    },
  };
}

export function createNativeSendTransport(input: {
  settingsStore: NativeAccountSettingsStore;
  gmail: GmailSubmitClient;
  graph: GraphSubmitClient;
  smtp: MailSendTransport;
  reauthorizationMarker?: NativeSendReauthorizationMarker;
  createBoundary?: () => string;
}): MailSendTransport {
  return {
    async submitMessage(message) {
      const provider = await input.settingsStore.getNativeProvider(
        message.accountId,
      );
      if (provider === "gmail") {
        const result = await submitWithReauthorizationMarking(
          input.reauthorizationMarker,
          { accountId: message.accountId, provider },
          () =>
            input.gmail.sendMessage({
              accountId: message.accountId,
              raw: base64Url(
                buildMimeMessage({
                  ...message,
                  boundary:
                    input.createBoundary?.() ?? `emailhub-${randomUUID()}`,
                }),
              ),
              ...(message.threading?.gmailThreadId
                ? { threadId: message.threading.gmailThreadId }
                : {}),
            }),
        );

        return {
          ...(result.id ? { messageId: result.id } : {}),
        };
      }

      if (provider === "graph") {
        if (hasThreadingHeaders(message.threading) || (message.attachments?.length ?? 0) > 0) {
          await submitWithReauthorizationMarking(
            input.reauthorizationMarker,
            { accountId: message.accountId, provider },
            () =>
              input.graph.sendMail({
                accountId: message.accountId,
                mime: base64(
                  buildMimeMessage({
                    ...message,
                    boundary:
                      input.createBoundary?.() ?? `emailhub-${randomUUID()}`,
                  }),
                ),
              }),
          );

          return {};
        }

        await submitWithReauthorizationMarking(
          input.reauthorizationMarker,
          { accountId: message.accountId, provider },
          () =>
            input.graph.sendMail({
              accountId: message.accountId,
              message: {
                subject: message.subject,
                ...(message.from
                  ? { from: { emailAddress: graphEmailAddress(message.from) } }
                  : {}),
                body: {
                  contentType: message.bodyHtml ? "HTML" : "Text",
                  content: message.bodyHtml ?? message.bodyText ?? "",
                },
                toRecipients: graphRecipients(message.to),
                ccRecipients: graphRecipients(message.cc),
                bccRecipients: graphRecipients(message.bcc),
              },
              saveToSentItems: true,
            }),
        );

        return {};
      }

      if (provider === "imap") {
        return input.smtp.submitMessage(message);
      }

      throw new Error(
        provider
          ? `native send is unsupported for ${provider}`
          : `native send provider is not configured for account ${message.accountId}`,
      );
    },
  };
}

export function createConfiguredNativeSendTransport(input: {
  client: Queryable;
  createId: () => string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  smtpSendMail?: SmtpSendMail;
  smtpSentAppender?: SmtpSentAppender;
}): MailSendTransport {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const googleClientId = optionalEnv(env.GOOGLE_OAUTH_CLIENT_ID);
  const microsoftClientId = optionalEnv(env.MICROSOFT_OAUTH_CLIENT_ID);

  return createNativeSendTransport({
    settingsStore: createPostgresNativeAccountSettingsStore(input.client),
    reauthorizationMarker: createPostgresNativeSendReauthorizationMarker({
      client: input.client,
      createId: input.createId,
    }),
    gmail: createGmailSubmitClient({
      accessTokenProvider: googleClientId
        ? createDatabaseAccessTokenProvider({
            client: input.client,
            credentialKind: GOOGLE_OAUTH_REFRESH_TOKEN_KIND,
            tokenClient: createGoogleOAuthRefreshClient({
              clientId: googleClientId,
              clientSecret: optionalEnv(env.GOOGLE_OAUTH_CLIENT_SECRET),
              tokenUrl: optionalEnv(env.GOOGLE_OAUTH_TOKEN_URL),
              fetchImpl,
            }),
          })
        : missingAccessTokenProvider(
            "GOOGLE_OAUTH_CLIENT_ID missing; cannot send Gmail mail natively",
          ),
      baseUrl: optionalEnv(env.GMAIL_API_BASE_URL),
      fetchImpl,
    }),
    graph: createGraphSubmitClient({
      accessTokenProvider: microsoftClientId
        ? createDatabaseAccessTokenProvider({
            client: input.client,
            credentialKind: MICROSOFT_OAUTH_REFRESH_TOKEN_KIND,
            tokenClient: createMicrosoftOAuthRefreshClient({
              clientId: microsoftClientId,
              clientSecret: optionalEnv(env.MICROSOFT_OAUTH_CLIENT_SECRET),
              tokenUrl: optionalEnv(env.MICROSOFT_OAUTH_TOKEN_URL),
              scope: optionalEnv(env.MICROSOFT_GRAPH_SCOPE),
              fetchImpl,
            }),
          })
        : missingAccessTokenProvider(
            "MICROSOFT_OAUTH_CLIENT_ID missing; cannot send Graph mail natively",
          ),
      baseUrl: optionalEnv(env.MICROSOFT_GRAPH_BASE_URL),
      fetchImpl,
    }),
    smtp: createSmtpNativeSendTransport({
      settingsStore: createPostgresSmtpAccountSendSettingsStore(input.client),
      secretStore: createPostgresSmtpSecretStore(input.client),
      reauthorizationMarker: createPostgresSmtpSendReauthorizationMarker({
        client: input.client,
        createId: input.createId,
      }),
      ...(input.smtpSendMail ? { sendMail: input.smtpSendMail } : {}),
      ...(input.smtpSentAppender ? { sentAppender: input.smtpSentAppender } : {}),
    }),
  });
}

async function submitWithReauthorizationMarking<T>(
  marker: NativeSendReauthorizationMarker | undefined,
  input: { accountId: string; provider: "gmail" | "graph" },
  submit: () => Promise<T>,
): Promise<T> {
  try {
    return await submit();
  } catch (error) {
    if (marker && isReauthorizationRequiredError(error)) {
      await marker.markRequired({
        accountId: input.accountId,
        provider: providerForReauthorization(input.provider),
        reason: safeReason(error),
      });
    }

    throw error;
  }
}

function buildMimeMessage(input: {
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: MailSendAttachment[];
  threading?: MailThreading;
  boundary: string;
}): string {
  const headers = [
    input.from ? ["From", addressHeader([input.from])] : undefined,
    ["To", addressHeader(input.to)],
    input.cc.length > 0 ? ["Cc", addressHeader(input.cc)] : undefined,
    input.bcc.length > 0 ? ["Bcc", addressHeader(input.bcc)] : undefined,
    ["Subject", encodeHeader(input.subject)],
    ...threadingHeaders(input.threading),
    ["MIME-Version", "1.0"],
  ].filter((header): header is string[] => Boolean(header));

  const attachments = sendableAttachments(input.attachments ?? []);
  return [
    ...headers.map(([name, value]) => `${name}: ${value}`),
    "",
    attachments.length > 0
      ? mimeBodyWithAttachments(input, attachments)
      : mimeBody(input),
  ].join("\r\n");
}

function mimeBodyWithAttachments(
  input: {
    bodyText?: string;
    bodyHtml?: string;
    boundary: string;
  },
  attachments: Array<
    MailSendAttachment & { contentBase64: string }
  >,
): string {
  const boundary = sanitizeHeaderValue(input.boundary);
  const bodyBoundary = `${boundary}-body`;
  return [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    mimeBody({ ...input, boundary: bodyBoundary }),
    ...attachments.flatMap((attachment) => [
      `--${boundary}`,
      `Content-Type: ${sanitizeContentType(attachment.contentType)}; name="${encodeHeaderParameter(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${attachment.inline ? "inline" : "attachment"}; filename="${encodeHeaderParameter(attachment.filename)}"`,
      ...(attachment.contentId
        ? [`Content-ID: <${sanitizeContentId(attachment.contentId)}>`]
        : []),
      "",
      wrapBase64(attachment.contentBase64),
    ]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function mimeBody(input: {
  bodyText?: string;
  bodyHtml?: string;
  boundary: string;
}): string {
  if (input.bodyText && input.bodyHtml) {
    const boundary = sanitizeHeaderValue(input.boundary);
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyText,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyHtml,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  if (input.bodyHtml) {
    return [
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyHtml,
    ].join("\r\n");
  }

  return [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText ?? "",
  ].join("\r\n");
}

function graphRecipients(addresses: MailAddress[]): unknown[] {
  return addresses.map((address) => ({
    emailAddress: graphEmailAddress(address),
  }));
}

function graphEmailAddress(address: MailAddress): { address: string; name?: string } {
  return {
    address: address.address,
    ...(address.name ? { name: address.name } : {}),
  };
}

function addressHeader(addresses: MailAddress[]): string {
  return addresses
    .map((address) =>
      address.name
        ? `${encodeHeaderPhrase(address.name)} <${sanitizeHeaderValue(
            address.address,
          )}>`
        : sanitizeHeaderValue(address.address),
    )
    .join(", ");
}

function encodeHeader(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(sanitized)) {
    return sanitized;
  }

  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function encodeHeaderPhrase(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  if (/^[A-Za-z0-9 ._'+-]+$/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '\\"')}"`;
  }

  return encodeHeader(sanitized);
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function sanitizeContentType(value: string): string {
  const sanitized = value.replace(/[\r\n\u0000]+/g, "").trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(sanitized)
    ? sanitized
    : "application/octet-stream";
}

function encodeHeaderParameter(value: string): string {
  return sanitizeHeaderValue(value).replace(/["\\]/g, "_");
}

function sanitizeContentId(value: string): string {
  return value.replace(/[\r\n<> \u0000]+/g, "").trim();
}

function sendableAttachments(
  attachments: MailSendAttachment[],
): Array<MailSendAttachment & { contentBase64: string }> {
  return attachments.map((attachment) => {
    if (!attachment.contentBase64) {
      throw new Error("native send attachment content is unavailable");
    }
    return {
      ...attachment,
      contentBase64: attachment.contentBase64,
    };
  });
}

function wrapBase64(value: string): string {
  return value.replace(/\s+/g, "").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function threadingHeaders(threading: MailThreading | undefined): string[][] {
  if (!threading) {
    return [];
  }

  const inReplyTo = optionalHeaderValue(threading.inReplyTo);
  const references = uniqueHeaderValues(threading.references);
  return [
    ...(inReplyTo ? [["In-Reply-To", inReplyTo]] : []),
    ...(references.length > 0 ? [["References", references.join(" ")]] : []),
  ];
}

function hasThreadingHeaders(threading: MailThreading | undefined): boolean {
  return threadingHeaders(threading).length > 0;
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
  return value ? sanitizeHeaderValue(value) : undefined;
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function nativeProvider(value: unknown): NativeSendProvider | undefined {
  if (value === "gmail" || value === "graph" || value === "imap") {
    return value;
  }

  return undefined;
}

function isReauthorizationRequiredError(error: unknown): boolean {
  if (error instanceof NativeProviderSubmitError) {
    if (error.status === 401) {
      return true;
    }
    return error.status === 403 && isAuthOrPermissionCode(error.code);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("oauth refresh failed") &&
      (message.includes("invalid_grant") ||
        message.includes("invalid_client") ||
        message.includes("unauthorized_client") ||
        message.includes("invalid_scope") ||
        message.includes("insufficient_scope"))
    ) {
      return true;
    }

    return (
      message.includes("missing google_oauth_refresh_token credential") ||
      message.includes("missing microsoft_oauth_refresh_token credential") ||
      message.includes("empty google_oauth_refresh_token secret") ||
      message.includes("empty microsoft_oauth_refresh_token secret")
    );
  }

  return false;
}

function isAuthOrPermissionCode(code: string): boolean {
  const normalized = code.toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("permission") ||
    normalized.includes("insufficient") ||
    normalized.includes("accessdenied") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthenticated") ||
    normalized.includes("unauthorized")
  );
}

function safeReason(error: unknown): string {
  if (error instanceof NativeProviderSubmitError) {
    return `${error.provider} ${error.status} ${error.code}`;
  }
  if (error instanceof Error) {
    return error.message;
  }

  return "native send authorization failed";
}

function missingAccessTokenProvider(message: string) {
  return {
    async getAccessToken(): Promise<string> {
      throw new Error(message);
    },
  };
}

function optionalEnv(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
