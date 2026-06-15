import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { GmailMutationClient } from "../google/gmail-api-client.js";
import type { GraphMutationClient } from "../microsoft/graph-api-client.js";
import type {
  MailAddress,
  ScheduledSendTransport,
} from "../scheduled-send-runner.js";

export function createGmailNativeSendTransport(input: {
  gmail: Pick<GmailMutationClient, "sendMessage">;
  createBoundary?: () => string;
}): ScheduledSendTransport {
  return {
    async submitMessage(message) {
      const result = await input.gmail.sendMessage({
        accountId: message.accountId,
        raw: base64Url(
          buildMimeMessage({
            ...message,
            boundary: input.createBoundary?.() ?? `emailhub-${randomUUID()}`,
          }),
        ),
      });

      return {
        ...(result.id ? { messageId: result.id } : {}),
      };
    },
  };
}

export function createGraphNativeSendTransport(input: {
  graph: Pick<GraphMutationClient, "sendMail">;
}): ScheduledSendTransport {
  return {
    async submitMessage(message) {
      await input.graph.sendMail({
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
      });

      return {};
    },
  };
}

function buildMimeMessage(input: {
  from?: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  boundary: string;
}): string {
  const headers = [
    input.from ? ["From", addressHeader([input.from])] : undefined,
    ["To", addressHeader(input.to)],
    input.cc.length > 0 ? ["Cc", addressHeader(input.cc)] : undefined,
    input.bcc.length > 0 ? ["Bcc", addressHeader(input.bcc)] : undefined,
    ["Subject", encodeHeader(input.subject)],
    ["MIME-Version", "1.0"],
  ].filter((header): header is string[] => Boolean(header));

  const body = mimeBody(input);
  return [
    ...headers.map(([name, value]) => `${name}: ${value}`),
    "",
    body,
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

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
