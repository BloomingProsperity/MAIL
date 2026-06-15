import { describe, expect, it } from "vitest";

import { createEmailEngineAttachmentContentStore } from "../src/mail-engine/email-engine-attachment-content-store";
import { createEmailEngineAttachmentsClient } from "../src/mail-engine/email-engine-attachments-client";

describe("EmailEngine attachments client", () => {
  it("downloads an attachment with bearer auth and v1 attachment path", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createEmailEngineAttachmentsClient({
      baseUrl: "http://emailengine:3000",
      accessToken: "secret-token",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response("file-bytes", {
          headers: {
            "content-type": "application/pdf",
            "content-length": "10",
          },
        });
      },
    });

    const download = await client.downloadAttachment({
      accountId: "acc_1",
      providerAttachmentId: "att_1",
    });

    expect(calls[0].url).toBe(
      "http://emailengine:3000/v1/account/acc_1/attachment/att_1",
    );
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
    expect(download.contentType).toBe("application/pdf");
    expect(download.contentLength).toBe("10");
    expect(Buffer.from(await download.body.arrayBuffer()).toString()).toBe(
      "file-bytes",
    );
  });

  it("throws a useful error when EmailEngine rejects an attachment download", async () => {
    const client = createEmailEngineAttachmentsClient({
      baseUrl: "http://emailengine:3000/v1/",
      accessToken: "secret-token",
      fetchImpl: async () =>
        Response.json(
          { code: "AttachmentNotFound", error: "missing" },
          { status: 404 },
        ),
    });

    await expect(
      client.downloadAttachment({
        accountId: "acc_1",
        providerAttachmentId: "missing",
      }),
    ).rejects.toThrow(
      "EmailEngine attachment download failed: 404 AttachmentNotFound missing",
    );
  });

  it("adapts EmailEngine attachment downloads into bounded content bytes", async () => {
    const contentStore = createEmailEngineAttachmentContentStore({
      async downloadAttachment(input) {
        expect(input).toEqual({
          accountId: "acc_1",
          providerAttachmentId: "att_1",
        });
        return {
          body: new Response("file-bytes"),
          contentType: "application/pdf",
          contentLength: "10",
        };
      },
    });

    const download = await contentStore.downloadAttachment({
      accountId: "acc_1",
      providerAttachmentId: "att_1",
      maxBytes: 20,
    });

    expect(download.contentType).toBe("application/pdf");
    expect(Buffer.from(download.bytes).toString()).toBe("file-bytes");
  });

  it("rejects EmailEngine attachment downloads above the content snapshot limit", async () => {
    const contentStore = createEmailEngineAttachmentContentStore({
      async downloadAttachment() {
        return {
          body: new Response("file-bytes"),
          contentLength: "10",
        };
      },
    });

    await expect(
      contentStore.downloadAttachment({
        accountId: "acc_1",
        providerAttachmentId: "att_1",
        maxBytes: 4,
      }),
    ).rejects.toThrow("attachments are too large");
  });
});
