import type { Queryable } from "./postgres-sync-job-queue.js";

interface TransactionClient extends Queryable {
  release(): void;
}

interface TransactionalQueryable extends Queryable {
  connect?(): Promise<TransactionClient>;
}

export type ProviderSendIdentityType =
  | "account"
  | "alias"
  | "shared_mailbox"
  | "send_on_behalf"
  | "group"
  | "unknown";

export type ProviderSendIdentityVerificationState =
  | "verified"
  | "pending"
  | "unverified"
  | "failed";

export interface ProviderSendIdentityInput {
  providerIdentityId: string;
  email: string;
  displayName?: string;
  identityType: ProviderSendIdentityType;
  verificationState: ProviderSendIdentityVerificationState;
  enabled?: boolean;
  isDefault?: boolean;
  capabilities?: Record<string, unknown>;
}

export interface ProviderSendIdentityStore {
  replaceDiscoveredIdentities(input: {
    accountId: string;
    provider: string;
    discoveredAt: string;
    identities: ProviderSendIdentityInput[];
  }): Promise<{
    upserted: number;
    disabled: number;
  }>;
}

export function createPostgresProviderSendIdentityStore(
  client: TransactionalQueryable,
): ProviderSendIdentityStore {
  return {
    async replaceDiscoveredIdentities(input) {
      return withTransaction(client, async (tx) => {
        let upserted = 0;
        for (const identity of input.identities) {
          const result = await tx.query(
            `
              INSERT INTO provider_send_identities (
                id,
                account_id,
                provider,
                provider_identity_id,
                email,
                display_name,
                identity_type,
                verification_state,
                enabled,
                is_default,
                capabilities,
                discovered_at,
                last_seen_at,
                updated_at
              )
              VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                lower($4),
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11::timestamptz,
                $11::timestamptz,
                $11::timestamptz
              )
              ON CONFLICT (account_id, provider, provider_identity_id)
              DO UPDATE SET
                email = EXCLUDED.email,
                display_name = EXCLUDED.display_name,
                identity_type = EXCLUDED.identity_type,
                verification_state = EXCLUDED.verification_state,
                enabled = EXCLUDED.enabled,
                is_default = EXCLUDED.is_default,
                capabilities = EXCLUDED.capabilities,
                last_seen_at = EXCLUDED.last_seen_at,
                updated_at = EXCLUDED.updated_at
              RETURNING id
            `,
            [
              input.accountId,
              input.provider,
              identity.providerIdentityId,
              identity.email,
              identity.displayName ?? null,
              identity.identityType,
              identity.verificationState,
              identity.enabled ?? true,
              identity.isDefault ?? false,
              identity.capabilities ?? {},
              input.discoveredAt,
            ],
          );
          upserted += result.rows.length;
        }

        const disabledResult = await tx.query(
          `
            UPDATE provider_send_identities
            SET enabled = FALSE,
                updated_at = $3::timestamptz
            WHERE account_id = $1
              AND provider = $2
              AND enabled = TRUE
              AND provider_identity_id <> ALL($4::text[])
            RETURNING id
          `,
          [
            input.accountId,
            input.provider,
            input.discoveredAt,
            input.identities.map((identity) => identity.providerIdentityId),
          ],
        );

        return {
          upserted,
          disabled: disabledResult.rows.length,
        };
      });
    },
  };
}

async function withTransaction<T>(
  client: TransactionalQueryable,
  run: (client: Queryable) => Promise<T>,
): Promise<T> {
  const tx = client.connect ? await client.connect() : undefined;
  const queryable = tx ?? client;
  await queryable.query("BEGIN");
  try {
    const result = await run(queryable);
    await queryable.query("COMMIT");
    return result;
  } catch (error) {
    await queryable.query("ROLLBACK");
    throw error;
  } finally {
    tx?.release();
  }
}
