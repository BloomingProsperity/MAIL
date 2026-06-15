import type {
  GraphDeltaMessagesInput,
  GraphDeltaMessagesResult,
  GraphListMailFoldersResult,
  GraphReadOnlyClient,
} from "../mail-provider/graph-readonly-adapter.js";

export interface GraphAccessTokenProvider {
  getAccessToken(accountId: string): Promise<string>;
}

export interface GraphApiClientOptions {
  accessTokenProvider: GraphAccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface GraphGetMessageInput {
  accountId: string;
  messageId: string;
  select?: string[];
}

export interface GraphUpdateMessageInput {
  accountId: string;
  messageId: string;
  patch: Record<string, unknown>;
}

export interface GraphMoveMessageInput {
  accountId: string;
  messageId: string;
  destinationId: string;
}

export interface GraphSendMailInput {
  accountId: string;
  targetMailbox?: string;
  message?: Record<string, unknown>;
  mime?: string;
  saveToSentItems?: boolean;
}

export interface GraphMutationClient {
  getMessage(input: GraphGetMessageInput): Promise<Record<string, unknown>>;
  updateMessage(input: GraphUpdateMessageInput): Promise<unknown>;
  moveMessage(input: GraphMoveMessageInput): Promise<unknown>;
  sendMail(input: GraphSendMailInput): Promise<unknown>;
}

export interface GraphApiClient
  extends GraphReadOnlyClient,
    GraphMutationClient {}

interface GraphMailFoldersPage extends GraphListMailFoldersResult {
  nextLink?: string;
}

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const GRAPH_MESSAGE_SELECT = [
  "id",
  "changeKey",
  "conversationId",
  "internetMessageId",
  "internetMessageHeaders",
  "subject",
  "receivedDateTime",
  "sender",
  "from",
  "toRecipients",
  "ccRecipients",
  "bodyPreview",
  "isRead",
  "hasAttachments",
].join(",");

export function createGraphApiClient(
  options: GraphApiClientOptions,
): GraphApiClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_GRAPH_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    accountId: string,
    url: string,
    init: Omit<RequestInit, "headers" | "body"> & {
      body?: unknown;
      rawBody?: string;
      contentType?: string;
      prefer?: string;
    } = {},
  ): Promise<T> {
    const { body, rawBody, contentType, prefer, ...requestOptions } = init;
    const token = await options.accessTokenProvider.getAccessToken(accountId);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(prefer ? { Prefer: prefer } : {}),
    };
    const requestInit: RequestInit = {
      ...requestOptions,
      headers,
    };
    if (rawBody !== undefined) {
      headers["Content-Type"] = contentType ?? "text/plain";
      requestInit.body = rawBody;
    } else if (body !== undefined) {
      headers["Content-Type"] = contentType ?? "application/json";
      requestInit.body = JSON.stringify(body);
    }

    const response = await fetchImpl(url, requestInit);
    const responseBody = await readJson(response);
    if (!response.ok) {
      throw graphApiError(response.status, responseBody);
    }

    return responseBody as T;
  }

  return {
    async deltaMessages(input) {
      const url = requestUrl(baseUrl, input);
      const prefer = input.maxPageSize
        ? `odata.maxpagesize=${clampPageSize(input.maxPageSize)}`
        : undefined;
      const body = await request<unknown>(input.accountId, url, {
        ...(prefer ? { prefer } : {}),
      });

      return graphDeltaResult(body);
    },

    async listMailFolders(input) {
      const params = new URLSearchParams();
      params.set("$select", "id,displayName,wellKnownName");
      let url: string | undefined = `${baseUrl}/me/mailFolders?${params.toString()}`;
      const folders: GraphListMailFoldersResult["folders"] = [];

      while (url) {
        const body = await request<unknown>(input.accountId, url);
        const page = graphMailFoldersPage(body);
        folders.push(...page.folders);
        url = page.nextLink;
      }

      return { folders };
    },

    getMessage(input) {
      const params = new URLSearchParams();
      if (input.select?.length) {
        params.set("$select", input.select.join(","));
      }

      return request<Record<string, unknown>>(
        input.accountId,
        `${baseUrl}/me/messages/${encodeURIComponent(input.messageId)}${
          params.toString() ? `?${params}` : ""
        }`,
      );
    },

    updateMessage(input) {
      return request<unknown>(
        input.accountId,
        `${baseUrl}/me/messages/${encodeURIComponent(input.messageId)}`,
        {
          method: "PATCH",
          body: input.patch,
        },
      );
    },

    moveMessage(input) {
      return request<unknown>(
        input.accountId,
        `${baseUrl}/me/messages/${encodeURIComponent(input.messageId)}/move`,
        {
          method: "POST",
          body: { destinationId: input.destinationId },
        },
      );
    },

    sendMail(input) {
      const url = graphSendMailUrl(baseUrl, input.targetMailbox);
      if (input.mime) {
        return request<unknown>(input.accountId, url, {
          method: "POST",
          rawBody: input.mime,
          contentType: "text/plain",
        });
      }

      if (!input.message) {
        throw new Error("Microsoft Graph sendMail requires a message or MIME body");
      }

      return request<unknown>(input.accountId, url, {
        method: "POST",
        body: {
          message: input.message,
          saveToSentItems: input.saveToSentItems ?? true,
        },
      });
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

function graphMailFoldersPage(value: unknown): GraphMailFoldersPage {
  const record = asRecord(value);
  const folders = Array.isArray(record.value)
    ? record.value.map((folder) => asRecord(folder))
    : [];

  return {
    folders,
    ...(readString(record["@odata.nextLink"])
      ? { nextLink: readString(record["@odata.nextLink"]) }
      : {}),
  };
}

function requestUrl(baseUrl: string, input: GraphDeltaMessagesInput): string {
  if (input.deltaLink) {
    return input.deltaLink;
  }

  const params = new URLSearchParams();
  params.set("$select", GRAPH_MESSAGE_SELECT);
  return `${baseUrl}/me/mailFolders/${encodeURIComponent(
    input.folderId,
  )}/messages/delta?${params.toString()}`;
}

function graphDeltaResult(value: unknown): GraphDeltaMessagesResult {
  const record = asRecord(value);
  const messages = Array.isArray(record.value)
    ? record.value.map((message) => asRecord(message))
    : [];

  return {
    messages,
    ...(readString(record["@odata.nextLink"])
      ? { nextLink: readString(record["@odata.nextLink"]) }
      : {}),
    ...(readString(record["@odata.deltaLink"])
      ? { deltaLink: readString(record["@odata.deltaLink"]) }
      : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function graphApiError(status: number, body: unknown): GraphApiError {
  const error = asRecord(asRecord(body).error);
  const code = readString(error.code) ?? "unknown_error";
  const detail = readString(error.message) ?? "request failed";
  return new GraphApiError(
    `Microsoft Graph request failed: ${status} ${code} ${detail}`,
    status,
    code,
  );
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.min(Math.trunc(value), 999);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
