import type { AccessTokenProvider } from "./oauth-access-token.js";

export interface GmailSubmitClient {
  sendMessage(input: {
    accountId: string;
    raw: string;
    threadId?: string;
  }): Promise<{ id?: string; threadId?: string }>;
}

export interface GraphSubmitClient {
  sendMail(input: {
    accountId: string;
    message?: Record<string, unknown>;
    mime?: string;
    saveToSentItems?: boolean;
  }): Promise<unknown>;
}

export class NativeProviderSubmitError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(`${provider} send failed: ${status} ${code}`);
  }
}

export function createGmailSubmitClient(input: {
  accessTokenProvider: AccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userId?: string;
}): GmailSubmitClient {
  const baseUrl = (input.baseUrl ?? "https://gmail.googleapis.com/gmail/v1").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  const userId = input.userId ?? "me";

  return {
    async sendMessage(message) {
      const token = await input.accessTokenProvider.getAccessToken(
        message.accountId,
      );
      const response = await fetchImpl(
        `${baseUrl}/users/${encodeURIComponent(userId)}/messages/send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            raw: message.raw,
            ...(message.threadId ? { threadId: message.threadId } : {}),
          }),
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        throw providerError("Gmail", response.status, body);
      }

      return asSendMessageResult(body);
    },
  };
}

export function createGraphSubmitClient(input: {
  accessTokenProvider: AccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): GraphSubmitClient {
  const baseUrl = (input.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async sendMail(message) {
      const token = await input.accessTokenProvider.getAccessToken(
        message.accountId,
      );
      if (message.mime) {
        const response = await fetchImpl(`${baseUrl}/me/sendMail`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "text/plain",
          },
          body: message.mime,
        });
        const body = await readJson(response);
        if (!response.ok) {
          throw providerError("Microsoft Graph", response.status, body);
        }

        return body;
      }

      if (!message.message) {
        throw new Error("Microsoft Graph sendMail requires a message or MIME body");
      }

      const response = await fetchImpl(`${baseUrl}/me/sendMail`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: message.message,
          saveToSentItems: message.saveToSentItems ?? true,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw providerError("Microsoft Graph", response.status, body);
      }

      return body;
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function providerError(
  provider: string,
  status: number,
  body: unknown,
): Error {
  return new NativeProviderSubmitError(provider, status, providerErrorCode(body));
}

function providerErrorCode(body: unknown): string {
  const record = asRecord(body);
  const nested = asRecord(record.error);
  return (
    readString(nested.status) ??
    readString(nested.code) ??
    readString(nested.message) ??
    readString(record.error) ??
    "unknown_error"
  );
}

function asSendMessageResult(value: unknown): { id?: string; threadId?: string } {
  const record = asRecord(value);
  return {
    ...(readString(record.id) ? { id: readString(record.id) } : {}),
    ...(readString(record.threadId) ? { threadId: readString(record.threadId) } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
