import {
  NonRetryableAttachmentTextExtractionError,
  type AttachmentTextExtractor,
} from "./attachment-text-extraction-runner.js";

const TEXT_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/x-ndjson",
  "application/yaml",
  "text/calendar",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
]);

const TEXT_EXTENSIONS = new Set([
  ".csv",
  ".ics",
  ".json",
  ".log",
  ".md",
  ".ndjson",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export { NonRetryableAttachmentTextExtractionError };

export function createSimpleAttachmentTextExtractor(): AttachmentTextExtractor {
  return {
    async extractText(input) {
      if (!isTextLike(input.contentType, input.filename)) {
        throw new NonRetryableAttachmentTextExtractionError(
          `unsupported content type ${input.contentType}`,
        );
      }

      return {
        text: new TextDecoder("utf-8", { fatal: false })
          .decode(input.bytes)
          .replace(/\u0000/g, "")
          .trim(),
      };
    },
  };
}

function isTextLike(contentType: string, filename: string): boolean {
  const normalizedContentType = contentType
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (
    normalizedContentType.startsWith("text/") ||
    TEXT_CONTENT_TYPES.has(normalizedContentType)
  ) {
    return true;
  }

  const normalizedFilename = filename.toLowerCase();
  return Array.from(TEXT_EXTENSIONS).some((extension) =>
    normalizedFilename.endsWith(extension),
  );
}
