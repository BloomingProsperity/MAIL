import type { MailAttachmentContentStore } from "../mail-compose/mail-compose.js";
import type { EmailEngineAttachmentsClient } from "./email-engine-attachments-client.js";

export function createEmailEngineAttachmentContentStore(
  client: EmailEngineAttachmentsClient,
): MailAttachmentContentStore {
  return {
    async downloadAttachment(input) {
      const download = await client.downloadAttachment({
        accountId: input.accountId,
        providerAttachmentId: input.providerAttachmentId,
      });
      const declaredLength = parseContentLength(download.contentLength);
      if (declaredLength !== undefined && declaredLength > input.maxBytes) {
        throw new Error("attachments are too large");
      }

      return {
        bytes: await readResponseBytes(download.body, input.maxBytes),
        ...(download.contentType ? { contentType: download.contentType } : {}),
      };
    },
  };
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (maxBytes < 0 || !Number.isFinite(maxBytes)) {
    throw new Error("attachment byte limit is invalid");
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("attachments are too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseContentLength(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
