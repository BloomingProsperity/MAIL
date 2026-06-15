import { randomUUID } from "node:crypto";

import type { Queryable } from "../credentials/account-credential-store.js";
import { createPostgresAccountCredentialStore } from "../credentials/account-credential-store.js";
import { createGoogleAccessTokenProvider } from "../google/access-token-provider.js";
import { createGmailApiClient } from "../google/gmail-api-client.js";
import { createGoogleOAuthTokenClient } from "../google/oauth-token-client.js";
import { createMicrosoftAccessTokenProvider } from "../microsoft/access-token-provider.js";
import { createGraphApiClient } from "../microsoft/graph-api-client.js";
import { createMicrosoftOAuthTokenClient } from "../microsoft/oauth-token-client.js";
import { createEnvSecretStore, type EnvMap } from "../secrets/env-secret-store.js";
import type { EngineCommandTargetResolver } from "../engine-command-resolver.js";
import type { ScheduledSendTransport } from "../scheduled-send-runner.js";
import {
  createPostgresSecretStore,
  type Queryable as SecretQueryable,
} from "../secrets/postgres-secret-store.js";
import { createPrefixedSecretStore } from "../secrets/prefixed-secret-store.js";
import type { NativeMailAdapter, NativeProvider } from "./contract.js";
import {
  createNativeEngineCommandProcessor,
  type NativeEngineCommandProcessorOptions,
} from "./native-command-processor.js";
import {
  createGmailNativeSendTransport,
  createGraphNativeSendTransport,
} from "./native-send-transport.js";
import {
  createPostgresNativeSendReauthorizationMarker,
  createReauthorizationAwareNativeSendTransport,
  type NativeSendReauthorizationMarker,
} from "./native-send-reauthorization.js";
import {
  createPostgresSmtpAccountSendSettingsStore,
  createPostgresSmtpSendReauthorizationMarker,
  createSmtpNativeSendTransport,
  type SmtpSendMail,
  type SmtpSendReauthorizationMarker,
} from "./smtp-send-transport.js";
import { createGmailReadOnlyAdapter } from "./gmail-readonly-adapter.js";
import { createGraphReadOnlyAdapter } from "./graph-readonly-adapter.js";
import {
  createImapFlowMutationClient,
  createPostgresImapAccountSettingsStore,
  type ImapConnectionOptions,
  type ImapMutationSession,
} from "../imap/imapflow-mutation-client.js";

export interface ConfiguredNativeAdaptersOptions {
  credentialClient: Queryable;
  secretClient?: SecretQueryable;
  env?: EnvMap;
  fetchImpl?: typeof fetch;
}

export interface ConfiguredNativeCommandProcessorOptions
  extends ConfiguredNativeAdaptersOptions {
  targetResolver: EngineCommandTargetResolver;
  imapConnect?: (
    options: ImapConnectionOptions,
  ) => Promise<ImapMutationSession>;
}

export interface ConfiguredNativeSendTransportsOptions
  extends ConfiguredNativeAdaptersOptions {
  createId?: () => string;
  reauthorizationMarker?: NativeSendReauthorizationMarker;
  smtpReauthorizationMarker?: SmtpSendReauthorizationMarker;
  smtpSendMail?: SmtpSendMail;
}

export function createConfiguredNativeAdapters(
  options: ConfiguredNativeAdaptersOptions,
): Partial<Record<NativeProvider, NativeMailAdapter>> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    gmail: createGmailReadOnlyAdapter({
      gmail: createGmailApiClient({
        accessTokenProvider: googleAccessTokenProvider({
          credentialClient: options.credentialClient,
          secretClient: options.secretClient ?? options.credentialClient,
          env,
          fetchImpl,
        }),
        baseUrl: optionalEnv(env.GMAIL_API_BASE_URL),
        fetchImpl,
      }),
    }),
    graph: createGraphReadOnlyAdapter({
      graph: createGraphApiClient({
        accessTokenProvider: microsoftAccessTokenProvider({
          credentialClient: options.credentialClient,
          secretClient: options.secretClient ?? options.credentialClient,
          env,
          fetchImpl,
        }),
        baseUrl: optionalEnv(env.MICROSOFT_GRAPH_BASE_URL),
        fetchImpl,
      }),
    }),
  };
}

export function createConfiguredNativeCommandProcessor(
  options: ConfiguredNativeCommandProcessorOptions,
) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const processorOptions: NativeEngineCommandProcessorOptions = {
    targetResolver: options.targetResolver,
    gmail: createGmailApiClient({
      accessTokenProvider: googleAccessTokenProvider({
        credentialClient: options.credentialClient,
        secretClient: options.secretClient ?? options.credentialClient,
        env,
        fetchImpl,
      }),
      baseUrl: optionalEnv(env.GMAIL_API_BASE_URL),
      fetchImpl,
    }),
    graph: createGraphApiClient({
      accessTokenProvider: microsoftAccessTokenProvider({
        credentialClient: options.credentialClient,
        secretClient: options.secretClient ?? options.credentialClient,
        env,
        fetchImpl,
      }),
      baseUrl: optionalEnv(env.MICROSOFT_GRAPH_BASE_URL),
      fetchImpl,
    }),
    imap: createImapFlowMutationClient({
      settingsStore: createPostgresImapAccountSettingsStore(
        options.credentialClient,
      ),
      secretStore: createPrefixedSecretStore({
        env: createEnvSecretStore(env),
        db: createPostgresSecretStore(
          options.secretClient ?? options.credentialClient,
        ),
      }),
      ...(options.imapConnect ? { connect: options.imapConnect } : {}),
    }),
  };

  return createNativeEngineCommandProcessor(processorOptions);
}

export function createConfiguredNativeSendTransports(
  options: ConfiguredNativeSendTransportsOptions,
): Partial<Record<NativeProvider, ScheduledSendTransport>> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const marker =
    options.reauthorizationMarker ??
    createPostgresNativeSendReauthorizationMarker({
      client: options.credentialClient,
      createId: options.createId ?? randomUUID,
    });
  const smtpMarker =
    options.smtpReauthorizationMarker ??
    createPostgresSmtpSendReauthorizationMarker({
      client: options.credentialClient,
      createId: options.createId ?? randomUUID,
    });
  const secretStore = createPrefixedSecretStore({
    env: createEnvSecretStore(env),
    db: createPostgresSecretStore(options.secretClient ?? options.credentialClient),
  });

  return {
    gmail: createReauthorizationAwareNativeSendTransport({
      provider: "gmail",
      marker,
      delegate: createGmailNativeSendTransport({
        gmail: createGmailApiClient({
          accessTokenProvider: googleAccessTokenProvider({
            credentialClient: options.credentialClient,
            secretClient: options.secretClient ?? options.credentialClient,
            env,
            fetchImpl,
          }),
          baseUrl: optionalEnv(env.GMAIL_API_BASE_URL),
          fetchImpl,
        }),
      }),
    }),
    graph: createReauthorizationAwareNativeSendTransport({
      provider: "graph",
      marker,
      delegate: createGraphNativeSendTransport({
        graph: createGraphApiClient({
          accessTokenProvider: microsoftAccessTokenProvider({
            credentialClient: options.credentialClient,
            secretClient: options.secretClient ?? options.credentialClient,
            env,
            fetchImpl,
          }),
          baseUrl: optionalEnv(env.MICROSOFT_GRAPH_BASE_URL),
          fetchImpl,
        }),
      }),
    }),
    imap: createSmtpNativeSendTransport({
      settingsStore: createPostgresSmtpAccountSendSettingsStore(
        options.credentialClient,
      ),
      secretStore,
      reauthorizationMarker: smtpMarker,
      ...(options.smtpSendMail ? { sendMail: options.smtpSendMail } : {}),
    }),
  };
}

function googleAccessTokenProvider(input: {
  credentialClient: Queryable;
  secretClient: SecretQueryable;
  env: EnvMap;
  fetchImpl: typeof fetch;
}) {
  const clientId = optionalEnv(input.env.GOOGLE_OAUTH_CLIENT_ID);
  if (!clientId) {
    return {
      async getAccessToken() {
        throw new Error(
          "GOOGLE_OAUTH_CLIENT_ID missing; cannot refresh Gmail access tokens",
        );
      },
    };
  }

  const credentialStore = createPostgresAccountCredentialStore(
    input.credentialClient,
  );
  const secretStore = createPrefixedSecretStore({
    env: createEnvSecretStore(input.env),
    db: createPostgresSecretStore(input.secretClient),
  });
  const tokenClient = createGoogleOAuthTokenClient({
    clientId,
    clientSecret: optionalEnv(input.env.GOOGLE_OAUTH_CLIENT_SECRET),
    tokenUrl: optionalEnv(input.env.GOOGLE_OAUTH_TOKEN_URL),
    fetchImpl: input.fetchImpl,
  });

  return createGoogleAccessTokenProvider({
    credentialStore,
    secretStore,
    tokenClient,
  });
}

function microsoftAccessTokenProvider(input: {
  credentialClient: Queryable;
  secretClient: SecretQueryable;
  env: EnvMap;
  fetchImpl: typeof fetch;
}) {
  const clientId = optionalEnv(input.env.MICROSOFT_OAUTH_CLIENT_ID);
  if (!clientId) {
    return {
      async getAccessToken() {
        throw new Error(
          "MICROSOFT_OAUTH_CLIENT_ID missing; cannot refresh Graph access tokens",
        );
      },
    };
  }

  const credentialStore = createPostgresAccountCredentialStore(
    input.credentialClient,
  );
  const secretStore = createPrefixedSecretStore({
    env: createEnvSecretStore(input.env),
    db: createPostgresSecretStore(input.secretClient),
  });
  const tokenClient = createMicrosoftOAuthTokenClient({
    clientId,
    clientSecret: optionalEnv(input.env.MICROSOFT_OAUTH_CLIENT_SECRET),
    tokenUrl: optionalEnv(input.env.MICROSOFT_OAUTH_TOKEN_URL),
    scope: optionalEnv(input.env.MICROSOFT_GRAPH_SCOPE),
    fetchImpl: input.fetchImpl,
  });

  return createMicrosoftAccessTokenProvider({
    credentialStore,
    secretStore,
    tokenClient,
  });
}

function optionalEnv(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
