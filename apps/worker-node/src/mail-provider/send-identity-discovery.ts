import type { GmailSendIdentityClient } from "../google/gmail-api-client.js";
import type {
  ProviderSendIdentityInput,
  ProviderSendIdentityStore,
} from "../provider-send-identity-store.js";
import type { NativeProvider } from "./contract.js";

export interface NativeSendIdentityDiscovery {
  discoverProviderSendIdentities(input: {
    accountId: string;
    provider: NativeProvider;
  }): Promise<NativeSendIdentityDiscoveryResult>;
}

export interface NativeSendIdentityDiscoveryResult {
  provider: NativeProvider;
  accountId: string;
  discoveredCount: number;
  upserted: number;
  disabled: number;
  skippedReason?: string;
}

export function createNativeSendIdentityDiscovery(input: {
  store: ProviderSendIdentityStore;
  gmail?: GmailSendIdentityClient;
  now?: () => Date;
}): NativeSendIdentityDiscovery {
  return {
    async discoverProviderSendIdentities(request) {
      if (request.provider !== "gmail") {
        return {
          provider: request.provider,
          accountId: request.accountId,
          discoveredCount: 0,
          upserted: 0,
          disabled: 0,
          skippedReason:
            request.provider === "graph"
              ? "graph_shared_mailbox_enumeration_unavailable"
              : "provider_send_identity_discovery_unavailable",
        };
      }

      if (!input.gmail) {
        return {
          provider: request.provider,
          accountId: request.accountId,
          discoveredCount: 0,
          upserted: 0,
          disabled: 0,
          skippedReason: "gmail_send_as_client_unavailable",
        };
      }

      const result = await input.gmail.listSendAs({
        accountId: request.accountId,
      });
      const identities = (result.sendAs ?? [])
        .map(gmailSendAsIdentity)
        .filter((identity): identity is ProviderSendIdentityInput =>
          Boolean(identity),
        );
      const write = await input.store.replaceDiscoveredIdentities({
        accountId: request.accountId,
        provider: "gmail",
        discoveredAt: (input.now?.() ?? new Date()).toISOString(),
        identities,
      });

      return {
        provider: request.provider,
        accountId: request.accountId,
        discoveredCount: identities.length,
        upserted: write.upserted,
        disabled: write.disabled,
      };
    },
  };
}

function gmailSendAsIdentity(
  value: NonNullable<Awaited<ReturnType<GmailSendIdentityClient["listSendAs"]>>["sendAs"]>[number],
): ProviderSendIdentityInput | undefined {
  const email = value.sendAsEmail?.trim().toLowerCase();
  if (!email) {
    return undefined;
  }

  const verified = value.isPrimary === true || value.verificationStatus === "accepted";
  return {
    providerIdentityId: email,
    email,
    ...(value.displayName?.trim() ? { displayName: value.displayName.trim() } : {}),
    identityType: value.isPrimary ? "account" : "alias",
    verificationState: verified ? "verified" : "pending",
    enabled: verified,
    isDefault: value.isDefault === true,
    capabilities: {
      isPrimary: value.isPrimary === true,
      verificationStatus: value.verificationStatus ?? "unknown",
    },
  };
}
