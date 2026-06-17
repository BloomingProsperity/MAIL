export type ComposeBodyFormat = "bold" | "italic" | "list" | "link" | "quote";

export interface ComposeSelectionFormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function composeBodyHtmlForPayload(
  bodyText: string,
  richHtmlEnabled: boolean,
): string | undefined {
  if (!richHtmlEnabled || !bodyText.trim()) {
    return undefined;
  }

  return composePlainTextToHtml(bodyText);
}

export function composePlainTextToHtml(text: string): string {
  const blocks = text
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split(/\n/);
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        const items = lines
          .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
          .filter(Boolean)
          .map((line) => `<li>${formatComposeInlineMarkup(line)}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (lines.every((line) => /^\s*>\s?/.test(line))) {
        const quoteLines = lines
          .map((line) => line.replace(/^\s*>\s?/, "").trim())
          .filter(Boolean)
          .map(formatComposeInlineMarkup)
          .join("<br>");
        return `<blockquote><p>${quoteLines}</p></blockquote>`;
      }

      return `<p>${lines.map(formatComposeInlineMarkup).join("<br>")}</p>`;
    })
    .join("");
}

export function formatComposeSelection(
  format: ComposeBodyFormat,
  selection: string,
): ComposeSelectionFormatResult {
  if (format === "list") {
    const body = selection.trim()
      ? selection
          .split(/\n/)
          .map((line) =>
            line.trim() ? line.replace(/^\s*(?:[-*]\s+)?/, "- ") : line,
          )
          .join("\n")
      : "- ";
    return {
      text: body,
      selectionStart: body.length,
      selectionEnd: body.length,
    };
  }

  if (format === "quote") {
    const body = selection.trim()
      ? selection
          .split(/\n/)
          .map((line) =>
            line.trim() ? line.replace(/^\s*(?:>\s?)?/, "> ") : ">",
          )
          .join("\n")
      : "> ";
    return {
      text: body,
      selectionStart: body.length,
      selectionEnd: body.length,
    };
  }

  if (format === "link") {
    const label = selection || "链接文字";
    const text = `[${label}](https://example.com)`;
    const urlStart = text.indexOf("https://example.com");
    return {
      text,
      selectionStart: urlStart,
      selectionEnd: urlStart + "https://example.com".length,
    };
  }

  const marker = format === "bold" ? "**" : "*";
  const label = selection || (format === "bold" ? "加粗文字" : "强调文字");
  return {
    text: `${marker}${label}${marker}`,
    selectionStart: marker.length,
    selectionEnd: marker.length + label.length,
  };
}

function formatComposeInlineMarkup(text: string): string {
  return escapeHtml(text)
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)"\s<>]+|mailto:[^)"\s<>]+)\)/g,
      '<a href="$2">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
