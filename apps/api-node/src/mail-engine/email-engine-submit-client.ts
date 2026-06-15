export interface EmailEngineSubmitClientOptions {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
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

export interface SubmitMessageResult {
  response?: string;
  queueId?: string;
  messageId?: string;
  sendAt?: string;
}

export interface EmailEngineSubmitClient {
  submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult>;
}

export function createEmailEngineSubmitClient(
  options: EmailEngineSubmitClientOptions,
): EmailEngineSubmitClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async submitMessage(input) {
      const response = await fetchImpl(
        `${baseUrl}/account/${encodeURIComponent(input.accountId)}/submit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.accessToken}`,
            "content-type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
          },
          body: JSON.stringify(toSubmitBody(input)),
        },
      );

      if (!response.ok) {
        const errorBody = await readJsonSafely(response);
        const code = stringField(errorBody, "code") ?? "UnknownError";
        const detail = stringField(errorBody, "error") ?? response.statusText;
        throw new Error(
          `EmailEngine message submit failed: ${response.status} ${code} ${detail}`,
        );
      }

      const body = (await response.json()) as Record<string, unknown>;
      return {
        ...(stringField(body, "response")
          ? { response: stringField(body, "response") }
          : {}),
        ...(stringField(body, "queueId")
          ? { queueId: stringField(body, "queueId") }
          : {}),
        ...(stringField(body, "messageId")
          ? { messageId: stringField(body, "messageId") }
          : {}),
        ...(stringField(body, "sendAt") ? { sendAt: stringField(body, "sendAt") } : {}),
      };
    },
  };
}

function toSubmitBody(input: SubmitMessageInput): Record<string, unknown> {
  const reference = emailEngineReference(input.threading);
  return {
    ...(input.from ? { from: input.from } : {}),
    to: input.to,
    ...(input.cc.length > 0 ? { cc: input.cc } : {}),
    ...(input.bcc.length > 0 ? { bcc: input.bcc } : {}),
    subject: input.subject,
    ...(input.bodyText ? { text: input.bodyText } : {}),
    ...(input.bodyHtml ? { html: input.bodyHtml } : {}),
    ...(reference ? { reference } : {}),
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
