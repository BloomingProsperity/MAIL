import { describe, expect, it } from "vitest";

import {
  createSimpleAttachmentTextExtractor,
  NonRetryableAttachmentTextExtractionError,
} from "../src/search/simple-attachment-text-extractor";

describe("simple attachment text extractor", () => {
  it("decodes text-like attachments as utf8 text", async () => {
    const extractor = createSimpleAttachmentTextExtractor();

    const result = await extractor.extractText({
      bytes: new TextEncoder().encode("invoice,total\nA-1,42"),
      filename: "invoice.csv",
      contentType: "text/csv",
      byteSize: 20,
    });

    expect(result).toEqual({ text: "invoice,total\nA-1,42" });
  });

  it("falls back to text-like extensions when content type is generic", async () => {
    const extractor = createSimpleAttachmentTextExtractor();

    const result = await extractor.extractText({
      bytes: new TextEncoder().encode("{\"code\":\"123456\"}"),
      filename: "payload.json",
      contentType: "application/octet-stream",
      byteSize: 17,
    });

    expect(result).toEqual({ text: "{\"code\":\"123456\"}" });
  });

  it("rejects unsupported binary attachments as non-retryable", async () => {
    const extractor = createSimpleAttachmentTextExtractor();

    await expect(
      extractor.extractText({
        bytes: new Uint8Array([37, 80, 68, 70]),
        filename: "contract.pdf",
        contentType: "application/pdf",
        byteSize: 45000,
      }),
    ).rejects.toBeInstanceOf(NonRetryableAttachmentTextExtractionError);
  });
});
