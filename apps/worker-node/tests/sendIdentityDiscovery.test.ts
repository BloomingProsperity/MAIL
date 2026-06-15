import { describe, expect, it } from "vitest";

import { createNativeSendIdentityDiscovery } from "../src/mail-provider/send-identity-discovery";

describe("native send identity discovery", () => {
  it("discovers Gmail send-as identities and writes provider-native cache", async () => {
    const writes: unknown[] = [];
    const discovery = createNativeSendIdentityDiscovery({
      now: () => new Date("2026-06-15T10:00:00.000Z"),
      gmail: {
        async listSendAs(input) {
          expect(input).toEqual({ accountId: "acc_1" });
          return {
            sendAs: [
              {
                sendAsEmail: "Me@Gmail.com",
                displayName: "Me",
                isDefault: true,
                isPrimary: true,
              },
              {
                sendAsEmail: "support@example.com",
                displayName: "Support",
                isDefault: false,
                isPrimary: false,
                verificationStatus: "accepted",
              },
              {
                sendAsEmail: "pending@example.com",
                displayName: "Pending",
                isPrimary: false,
                verificationStatus: "pending",
              },
              {
                displayName: "Missing email",
              },
            ],
          };
        },
      },
      store: {
        async replaceDiscoveredIdentities(input) {
          writes.push(input);
          return { upserted: input.identities.length, disabled: 1 };
        },
      },
    });

    const result = await discovery.discoverProviderSendIdentities({
      accountId: "acc_1",
      provider: "gmail",
    });

    expect(result).toEqual({
      provider: "gmail",
      accountId: "acc_1",
      discoveredCount: 3,
      upserted: 3,
      disabled: 1,
    });
    expect(writes).toEqual([
      {
        accountId: "acc_1",
        provider: "gmail",
        discoveredAt: "2026-06-15T10:00:00.000Z",
        identities: [
          {
            providerIdentityId: "me@gmail.com",
            email: "me@gmail.com",
            displayName: "Me",
            identityType: "account",
            verificationState: "verified",
            enabled: true,
            isDefault: true,
            capabilities: {
              isPrimary: true,
              verificationStatus: "unknown",
            },
          },
          {
            providerIdentityId: "support@example.com",
            email: "support@example.com",
            displayName: "Support",
            identityType: "alias",
            verificationState: "verified",
            enabled: true,
            isDefault: false,
            capabilities: {
              isPrimary: false,
              verificationStatus: "accepted",
            },
          },
          {
            providerIdentityId: "pending@example.com",
            email: "pending@example.com",
            displayName: "Pending",
            identityType: "alias",
            verificationState: "pending",
            enabled: false,
            isDefault: false,
            capabilities: {
              isPrimary: false,
              verificationStatus: "pending",
            },
          },
        ],
      },
    ]);
  });

  it("does not pretend Graph shared mailbox permissions can be enumerated", async () => {
    const discovery = createNativeSendIdentityDiscovery({
      store: {
        async replaceDiscoveredIdentities() {
          throw new Error("Graph discovery should not write cache");
        },
      },
    });

    await expect(
      discovery.discoverProviderSendIdentities({
        accountId: "acc_1",
        provider: "graph",
      }),
    ).resolves.toEqual({
      provider: "graph",
      accountId: "acc_1",
      discoveredCount: 0,
      upserted: 0,
      disabled: 0,
      skippedReason: "graph_shared_mailbox_enumeration_unavailable",
    });
  });
});
