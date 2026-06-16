import { createHash } from "node:crypto";

import type { MessageDetailDto } from "../mail-read/mail-read-store.js";

export const DEFAULT_HERMES_MAX_CONTEXT_CHARS = 24_000;

export interface HermesReadableTextOptions {
  maxChars?: number;
}

export function messageReadableText(
  message: MessageDetailDto,
  options: HermesReadableTextOptions = {},
): string {
  const bodyText = normalizeWhitespace(message.bodyText ?? "");
  if (bodyText) {
    return limitHermesContextText(bodyText, options);
  }

  const bodyHtml = normalizeWhitespace(stripHtml(message.bodyHtml ?? ""));
  if (bodyHtml) {
    return limitHermesContextText(bodyHtml, options);
  }

  return limitHermesContextText(
    normalizeWhitespace(message.snippet ?? ""),
    options,
  );
}

export function hashMessageText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function limitHermesContextText(
  text: string,
  options: HermesReadableTextOptions = {},
): string {
  const maxChars = normalizeMaxContextChars(options.maxChars);
  if (text.length <= maxChars) {
    return text;
  }

  const notice = `\n\n[Hermes context truncated to ${maxChars} chars from ${text.length}.]`;
  const contentLength = Math.max(0, maxChars - notice.length);
  return `${text.slice(0, contentLength).trimEnd()}${notice}`;
}

function normalizeMaxContextChars(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_HERMES_MAX_CONTEXT_CHARS;
  }

  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_HERMES_MAX_CONTEXT_CHARS;
  }

  return value;
}

function stripHtml(value: string): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
