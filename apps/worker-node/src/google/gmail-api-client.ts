import type {
  GmailListLabelsResult,
  GmailListHistoryResult,
  GmailListMessagesResult,
  GmailMessageStub,
  GmailReadOnlyClient,
} from "../mail-provider/gmail-readonly-adapter.js";

export interface GmailAccessTokenProvider {
  getAccessToken(accountId: string): Promise<string>;
}

export interface GmailApiClientOptions {
  accessTokenProvider: GmailAccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userId?: string;
}

export interface GmailModifyMessageInput {
  accountId: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface GmailTrashMessageInput {
  accountId: string;
  messageId: string;
}

export interface GmailSendMessageInput {
  accountId: string;
  raw: string;
  threadId?: string;
}

export interface GmailSendMessageResult {
  id?: string;
  threadId?: string;
}

export interface GmailMutationClient {
  modifyMessage(input: GmailModifyMessageInput): Promise<unknown>;
  trashMessage(input: GmailTrashMessageInput): Promise<unknown>;
  sendMessage(input: GmailSendMessageInput): Promise<GmailSendMessageResult>;
}

export interface GmailApiClient
  extends GmailReadOnlyClient,
    GmailMutationClient {}

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_USER_ID = "me";
const MAX_GMAIL_PAGE_SIZE = 500;

export function createGmailApiClient(
  options: GmailApiClientOptions,
): GmailApiClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_GMAIL_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const userId = options.userId ?? DEFAULT_USER_ID;

  async function request<T>(
    accountId: string,
    path: string,
    params: URLSearchParams,
    init: Omit<RequestInit, "headers" | "body"> & { body?: unknown } = {},
  ): Promise<T> {
    const { body: requestBody, ...requestOptions } = init;
    const token = await options.accessTokenProvider.getAccessToken(accountId);
    const query = params.toString();
    const url = `${baseUrl}/users/${encodeURIComponent(userId)}${path}${
      query ? `?${query}` : ""
    }`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    const requestInit: RequestInit = {
      ...requestOptions,
      headers,
    };
    if (requestBody !== undefined) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(requestBody);
    }

    const response = await fetchImpl(url, {
      ...requestInit,
    });

    const body = await readJson(response);
    if (!response.ok) {
      throw gmailApiError(response.status, body);
    }

    return body as T;
  }

  return {
    listMessages(input) {
      const params = new URLSearchParams();
      if (input.maxResults !== undefined) {
        params.set(
          "maxResults",
          String(clampPageSize(input.maxResults)),
        );
      }
      if (input.pageToken) {
        params.set("pageToken", input.pageToken);
      }
      for (const labelId of input.labelIds ?? []) {
        params.append("labelIds", labelId);
      }

      return request<GmailListMessagesResult>(
        input.accountId,
        "/messages",
        params,
      );
    },

    listLabels(input) {
      return request<GmailListLabelsResult>(
        input.accountId,
        "/labels",
        new URLSearchParams(),
      );
    },

    getMessage(input) {
      const params = new URLSearchParams();
      params.set("format", input.format);
      return request<GmailMessageStub>(
        input.accountId,
        `/messages/${encodeURIComponent(input.messageId)}`,
        params,
      );
    },

    listHistory(input) {
      const params = new URLSearchParams();
      params.set("startHistoryId", input.startHistoryId);
      if (input.maxResults !== undefined) {
        params.set(
          "maxResults",
          String(clampPageSize(input.maxResults)),
        );
      }
      if (input.pageToken) {
        params.set("pageToken", input.pageToken);
      }

      return request<GmailListHistoryResult>(
        input.accountId,
        "/history",
        params,
      );
    },

    modifyMessage(input) {
      return request<unknown>(
        input.accountId,
        `/messages/${encodeURIComponent(input.messageId)}/modify`,
        new URLSearchParams(),
        {
          method: "POST",
          body: compactObject({
            addLabelIds: input.addLabelIds,
            removeLabelIds: input.removeLabelIds,
          }),
        },
      );
    },

    trashMessage(input) {
      return request<unknown>(
        input.accountId,
        `/messages/${encodeURIComponent(input.messageId)}/trash`,
        new URLSearchParams(),
        {
          method: "POST",
        },
      );
    },

    sendMessage(input) {
      return request<GmailSendMessageResult>(
        input.accountId,
        "/messages/send",
        new URLSearchParams(),
        {
          method: "POST",
          body: {
            raw: input.raw,
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
        },
      );
    },
  };
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.min(Math.trunc(value), MAX_GMAIL_PAGE_SIZE);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function gmailApiError(status: number, body: unknown): GmailApiError {
  const error = asRecord(asRecord(body).error);
  const code = readString(error.status) ?? "UNKNOWN";
  const detail = readString(error.message) ?? "request failed";
  return new GmailApiError(
    `Gmail API request failed: ${status} ${code} ${detail}`,
    status,
    code,
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

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined) {
        return false;
      }
      if (Array.isArray(item)) {
        return item.length > 0;
      }

      return true;
    }),
  ) as T;
}
