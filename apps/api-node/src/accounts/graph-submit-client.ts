import type { AccessTokenProvider } from "./oauth-access-token.js";

export interface GraphSubmitClient {
  sendMail(input: {
    accountId: string;
    targetMailbox?: string;
    message?: Record<string, unknown>;
    mime?: string;
    saveToSentItems?: boolean;
  }): Promise<unknown>;
}

export class GraphSubmitError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Microsoft Graph send failed: ${status} ${code}`);
  }
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
      const url = graphSendMailUrl(baseUrl, message.targetMailbox);
      if (message.mime) {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "text/plain",
          },
          body: message.mime,
        });
        const body = await readJson(response);
        if (!response.ok) {
          throw graphError(response.status, body);
        }

        return body;
      }

      if (!message.message) {
        throw new Error("Microsoft Graph sendMail requires a message or MIME body");
      }

      const response = await fetchImpl(url, {
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
        throw graphError(response.status, body);
      }

      return body;
    },
  };
}

function graphSendMailUrl(baseUrl: string, targetMailbox: string | undefined): string {
  const normalized = targetMailbox?.trim();
  if (!normalized) {
    return `${baseUrl}/me/sendMail`;
  }

  return `${baseUrl}/users/${encodeURIComponent(normalized)}/sendMail`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function graphError(status: number, body: unknown): Error {
  return new GraphSubmitError(status, graphErrorCode(body));
}

function graphErrorCode(body: unknown): string {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
