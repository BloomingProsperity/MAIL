export interface EmailEngineAccountsClientOptions {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface EmailEngineEndpointCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  secret: string;
}

export interface RegisterImapSmtpAccountInput {
  accountId: string;
  email: string;
  displayName?: string;
  imap: EmailEngineEndpointCredentials;
  smtp: EmailEngineEndpointCredentials;
}

export interface RegisterOAuthAccountInput {
  accountId: string;
  email: string;
  displayName?: string;
  provider: "gmail" | "outlook";
}

export interface VerifyImapSmtpAccountInput {
  email: string;
  imap: EmailEngineEndpointCredentials;
  smtp: EmailEngineEndpointCredentials;
}

export interface EmailEngineAccountRegistrationResult {
  account: string;
  state?: string;
}

export interface EmailEngineConnectionCheck {
  success?: boolean;
  code?: string;
  error?: string;
}

export interface EmailEngineAccountVerificationResult {
  imap?: EmailEngineConnectionCheck;
  smtp?: EmailEngineConnectionCheck;
}

export interface EmailEngineAccountsClient {
  verifyImapSmtpAccount(
    input: VerifyImapSmtpAccountInput,
  ): Promise<EmailEngineAccountVerificationResult>;
  registerImapSmtpAccount(
    input: RegisterImapSmtpAccountInput,
  ): Promise<EmailEngineAccountRegistrationResult>;
  registerOAuthAccount(
    input: RegisterOAuthAccountInput,
  ): Promise<EmailEngineAccountRegistrationResult>;
}

export function createEmailEngineAccountsClient(
  options: EmailEngineAccountsClientOptions,
): EmailEngineAccountsClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit,
    failureLabel: string,
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await readJsonSafely(response);
      const code = stringField(errorBody, "code") ?? "UnknownError";
      const detail = stringField(errorBody, "error") ?? response.statusText;
      throw new Error(
        `${failureLabel}: ${response.status} ${code} ${detail}`,
      );
    }

    return (await response.json()) as T;
  }

  return {
    verifyImapSmtpAccount(input) {
      return request<EmailEngineAccountVerificationResult>(
        "/verifyAccount",
        {
          method: "POST",
          body: JSON.stringify({
            imap: toEmailEngineEndpoint(input.imap),
            smtp: toEmailEngineEndpoint(input.smtp),
          }),
        },
        "EmailEngine account verification failed",
      );
    },
    registerImapSmtpAccount(input) {
      return request<EmailEngineAccountRegistrationResult>(
        "/account",
        {
          method: "POST",
          body: JSON.stringify({
            account: input.accountId,
            name: input.displayName ?? input.email,
            email: input.email,
            imap: toEmailEngineEndpoint(input.imap),
            smtp: toEmailEngineEndpoint(input.smtp),
          }),
        },
        "EmailEngine account registration failed",
      );
    },
    registerOAuthAccount(input) {
      return request<EmailEngineAccountRegistrationResult>(
        "/account",
        {
          method: "POST",
          body: JSON.stringify({
            account: input.accountId,
            name: input.displayName ?? input.email,
            email: input.email,
            oauth2: {
              provider: input.provider,
              auth: {
                user: input.email,
              },
              useAuthServer: true,
            },
          }),
        },
        "EmailEngine OAuth account registration failed",
      );
    },
  };
}

function toEmailEngineEndpoint(endpoint: EmailEngineEndpointCredentials) {
  return {
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    auth: {
      user: endpoint.username,
      pass: endpoint.secret,
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
