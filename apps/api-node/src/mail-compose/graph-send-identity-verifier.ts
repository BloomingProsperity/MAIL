import {
  MICROSOFT_OAUTH_REFRESH_TOKEN_KIND,
  createDatabaseAccessTokenProvider,
  type AccessTokenProvider,
  type Queryable,
} from "../accounts/oauth-access-token.js";
import { createMicrosoftOAuthRefreshClient } from "../accounts/oauth-token-clients.js";
import { createGraphSubmitClient, type GraphSubmitClient } from "../accounts/graph-submit-client.js";
import type {
  GraphSendIdentityVerifier,
  MailAddress,
} from "./mail-compose.js";

export function createGraphSendIdentityVerifier(input: {
  graph: GraphSubmitClient;
}): GraphSendIdentityVerifier {
  return {
    async sendVerification(message) {
      await input.graph.sendMail({
        accountId: message.accountId,
        message: {
          subject: "Email Hub shared sender verification",
          from: { emailAddress: graphEmailAddress(message.from) },
          body: {
            contentType: "Text",
            content: [
              "Email Hub is verifying this Outlook shared sender.",
              `From: ${message.from.address}`,
              `Requested at: ${message.now}`,
            ].join("\n"),
          },
          toRecipients: [
            {
              emailAddress: graphEmailAddress(message.to),
            },
          ],
        },
        saveToSentItems: false,
      });
    },

    async sendUserTargetVerification(message) {
      await input.graph.sendMail({
        accountId: message.accountId,
        targetMailbox: message.targetMailbox,
        message: {
          subject: "Email Hub shared mailbox target verification",
          from: { emailAddress: graphEmailAddress(message.from) },
          body: {
            contentType: "Text",
            content: [
              "Email Hub is verifying Outlook shared mailbox Sent Items routing.",
              `From: ${message.from.address}`,
              `Graph target mailbox: ${message.targetMailbox}`,
              `Requested at: ${message.now}`,
            ].join("\n"),
          },
          toRecipients: [
            {
              emailAddress: graphEmailAddress(message.to),
            },
          ],
        },
        saveToSentItems: true,
      });
    },
  };
}

export function createConfiguredGraphSendIdentityVerifier(input: {
  client: Queryable;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): GraphSendIdentityVerifier {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const microsoftClientId = optionalEnv(env.MICROSOFT_OAUTH_CLIENT_ID);

  return createGraphSendIdentityVerifier({
    graph: createGraphSubmitClient({
      accessTokenProvider: microsoftClientId
        ? createDatabaseAccessTokenProvider({
            client: input.client,
            credentialKind: MICROSOFT_OAUTH_REFRESH_TOKEN_KIND,
            tokenClient: createMicrosoftOAuthRefreshClient({
              clientId: microsoftClientId,
              clientSecret: optionalEnv(env.MICROSOFT_OAUTH_CLIENT_SECRET),
              tokenUrl: optionalEnv(env.MICROSOFT_OAUTH_TOKEN_URL),
              scope: optionalEnv(env.MICROSOFT_GRAPH_SCOPE),
              fetchImpl,
            }),
          })
        : missingAccessTokenProvider(
            "MICROSOFT_OAUTH_CLIENT_ID missing; cannot verify Graph send identities",
          ),
      baseUrl: optionalEnv(env.MICROSOFT_GRAPH_BASE_URL),
      fetchImpl,
    }),
  });
}

function graphEmailAddress(address: MailAddress): { address: string; name?: string } {
  return {
    address: address.address,
    ...(address.name ? { name: address.name } : {}),
  };
}

function missingAccessTokenProvider(message: string): AccessTokenProvider {
  return {
    async getAccessToken() {
      throw new Error(message);
    },
  };
}

function optionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
