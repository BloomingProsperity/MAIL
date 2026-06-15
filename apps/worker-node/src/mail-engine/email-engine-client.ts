export interface EmailEngineClientConfig {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface ListMessagesInput {
  accountId: string;
  path: string;
  pageSize?: number;
  cursor?: string;
}

export interface GetMessageInput {
  accountId: string;
  messageId: string;
  textType: "*";
  markAsSeen: false;
}

export interface UpdateMessageInput {
  accountId: string;
  messageId: string;
  flags?: {
    add?: string[];
    delete?: string[];
    set?: string[];
  };
  labels?: {
    add?: string[];
    delete?: string[];
  };
}

export interface MoveMessageInput {
  accountId: string;
  messageId: string;
  path: string;
  source?: string;
}

export interface DeleteMessageInput {
  accountId: string;
  messageId: string;
  force: boolean;
}

export interface SubmitAddress {
  address: string;
  name?: string;
}

export interface SubmitMessageInput {
  accountId: string;
  draftId: string;
  idempotencyKey: string;
  from?: SubmitAddress;
  to: SubmitAddress[];
  cc: SubmitAddress[];
  bcc: SubmitAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  threading?: SubmitThreading;
}

export interface SubmitThreading {
  action: "reply" | "reply_all";
  emailEngineMessageId?: string;
}

export interface DownloadAttachmentInput {
  accountId: string;
  providerAttachmentId: string;
  provider?: string;
  messageId?: string;
}

export interface EmailEngineClient {
  listMailboxes(accountId: string): Promise<unknown[]>;
  listMessages(input: ListMessagesInput): Promise<unknown>;
  getMessage(input: GetMessageInput): Promise<unknown>;
  updateMessage(input: UpdateMessageInput): Promise<unknown>;
  moveMessage(input: MoveMessageInput): Promise<unknown>;
  deleteMessage(input: DeleteMessageInput): Promise<unknown>;
  downloadAttachment(input: DownloadAttachmentInput): Promise<{
    bytes: Uint8Array;
    contentType?: string;
  }>;
  submitMessage(input: SubmitMessageInput): Promise<{
    queueId?: string;
    messageId?: string;
    sendAt?: string;
  }>;
}

export class EmailEngineRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(`EmailEngine request failed: ${status} ${code} ${detail}`);
    this.name = "EmailEngineRequestError";
  }
}

export function createEmailEngineClient(
  config: EmailEngineClientConfig,
): EmailEngineClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  async function request<T>(
    path: string,
    init: Omit<RequestInit, "headers" | "body"> & {
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { body, headers: extraHeaders, ...requestOptions } = init;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.accessToken}`,
      ...extraHeaders,
    };
    const requestInit: RequestInit = {
      ...requestOptions,
      headers,
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(body);
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...requestInit,
    });

    const payload = await response.json().catch(() => undefined);

    if (!response.ok) {
      const error = asRecord(payload);
      const code = typeof error.code === "string" ? error.code : "unknown";
      const message =
        typeof error.error === "string" ? error.error : response.statusText;
      throw new EmailEngineRequestError(response.status, code, message);
    }

    return payload as T;
  }

  async function binaryRequest(
    path: string,
  ): Promise<{ bytes: Uint8Array; contentType?: string }> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      const error = asRecord(payload);
      const code = typeof error.code === "string" ? error.code : "unknown";
      const message =
        typeof error.error === "string" ? error.error : response.statusText;
      throw new EmailEngineRequestError(response.status, code, message);
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      ...(response.headers.get("content-type")
        ? { contentType: response.headers.get("content-type") ?? undefined }
        : {}),
    };
  }

  return {
    listMailboxes(accountId) {
      return request<unknown[]>(
        `/account/${encodeURIComponent(accountId)}/mailboxes`,
      );
    },

    listMessages(input) {
      const params = new URLSearchParams();
      params.set("path", input.path);
      if (input.pageSize) {
        params.set("pageSize", String(input.pageSize));
      }
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }

      return request<unknown>(
        `/account/${encodeURIComponent(input.accountId)}/messages?${params}`,
      );
    },

    getMessage(input) {
      const params = new URLSearchParams();
      params.set("textType", input.textType);
      params.set("markAsSeen", String(input.markAsSeen));

      return request<unknown>(
        `/account/${encodeURIComponent(input.accountId)}/message/${encodeURIComponent(
          input.messageId,
        )}?${params}`,
      );
    },

    updateMessage(input) {
      return request<unknown>(
        `/account/${encodeURIComponent(input.accountId)}/message/${encodeURIComponent(
          input.messageId,
        )}`,
        {
          method: "PUT",
          body: compactObject({
            flags: compactObject(input.flags ?? {}),
            labels: compactObject(input.labels ?? {}),
          }),
        },
      );
    },

    moveMessage(input) {
      return request<unknown>(
        `/account/${encodeURIComponent(input.accountId)}/message/${encodeURIComponent(
          input.messageId,
        )}/move`,
        {
          method: "PUT",
          body: compactObject({
            path: input.path,
            source: input.source,
          }),
        },
      );
    },

    deleteMessage(input) {
      const params = new URLSearchParams();
      params.set("force", String(input.force));

      return request<unknown>(
        `/account/${encodeURIComponent(input.accountId)}/message/${encodeURIComponent(
          input.messageId,
        )}?${params}`,
        {
          method: "DELETE",
        },
      );
    },

    downloadAttachment(input) {
      return binaryRequest(
        `/account/${encodeURIComponent(input.accountId)}/attachment/${encodeURIComponent(
          input.providerAttachmentId,
        )}`,
      );
    },

    submitMessage(input) {
      return request<{
        queueId?: string;
        messageId?: string;
        sendAt?: string;
      }>(`/account/${encodeURIComponent(input.accountId)}/submit`, {
        method: "POST",
        headers: {
          "Idempotency-Key": input.idempotencyKey,
        },
        body: compactObject({
          from: input.from,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          subject: input.subject,
          text: input.bodyText,
          html: input.bodyHtml,
          reference: emailEngineReference(input.threading),
        }),
      });
    },
  };
}

function emailEngineReference(
  threading: SubmitThreading | undefined,
): Record<string, unknown> | undefined {
  if (!threading?.emailEngineMessageId) {
    return undefined;
  }

  return {
    message: threading.emailEngineMessageId,
    action: threading.action === "reply_all" ? "reply-all" : "reply",
    inline: false,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined) {
        return false;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return Object.keys(item).length > 0;
      }

      return true;
    }),
  ) as T;
}
