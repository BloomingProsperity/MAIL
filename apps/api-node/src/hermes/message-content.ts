import { createHash } from "node:crypto";

import type { MessageDetailDto } from "../mail-read/mail-read-store.js";

export function messageReadableText(message: MessageDetailDto): string {
  const bodyText = normalizeWhitespace(message.bodyText ?? "");
  if (bodyText) {
    return bodyText;
  }

  const bodyHtml = normalizeWhitespace(stripHtml(message.bodyHtml ?? ""));
  if (bodyHtml) {
    return bodyHtml;
  }

  return normalizeWhitespace(message.snippet ?? "");
}

export function hashMessageText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
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
