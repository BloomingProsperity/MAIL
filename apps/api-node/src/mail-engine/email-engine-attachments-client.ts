export interface EmailEngineAttachmentsClientOptions {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface DownloadAttachmentInput {
  accountId: string;
  providerAttachmentId: string;
}

export interface EmailEngineAttachmentDownload {
  body: Response;
  contentType?: string;
  contentLength?: string;
}

export interface EmailEngineAttachmentsClient {
  downloadAttachment(
    input: DownloadAttachmentInput,
  ): Promise<EmailEngineAttachmentDownload>;
}

export function createEmailEngineAttachmentsClient(
  options: EmailEngineAttachmentsClientOptions,
): EmailEngineAttachmentsClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async downloadAttachment(input) {
      const response = await fetchImpl(
        `${baseUrl}/account/${encodeURIComponent(
          input.accountId,
        )}/attachment/${encodeURIComponent(input.providerAttachmentId)}`,
        {
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const errorBody = await readJsonSafely(response);
        const code = stringField(errorBody, "code") ?? "UnknownError";
        const detail = stringField(errorBody, "error") ?? response.statusText;
        throw new Error(
          `EmailEngine attachment download failed: ${response.status} ${code} ${detail}`,
        );
      }

      return {
        body: response,
        ...(response.headers.get("content-type")
          ? { contentType: response.headers.get("content-type")! }
          : {}),
        ...(response.headers.get("content-length")
          ? { contentLength: response.headers.get("content-length")! }
          : {}),
      };
    },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
