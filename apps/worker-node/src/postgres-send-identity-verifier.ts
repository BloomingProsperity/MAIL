import type { Queryable } from "./postgres-sync-job-queue.js";
import type { ScheduledSendIdentityVerifier } from "./scheduled-send-runner.js";

export function createPostgresSendIdentityVerifier(
  client: Queryable,
): ScheduledSendIdentityVerifier {
  return {
    async ensureAllowedSender(input) {
      if (!input.from) {
        return;
      }

      const result = await client.query(
        `
          WITH account_identity AS (
            SELECT lower(connected_accounts.email) AS address
            FROM connected_accounts
            WHERE connected_accounts.id = $1
          ), alias_identities AS (
            SELECT DISTINCT lower(aliases.local_part || '@' || domains.domain) AS address
            FROM connected_accounts
            JOIN destinations
              ON lower(destinations.email) = lower(connected_accounts.email)
             AND destinations.verified = TRUE
            JOIN alias_routes
              ON alias_routes.destination_id = destinations.id
            JOIN aliases
              ON aliases.id = alias_routes.alias_id
             AND aliases.enabled = TRUE
            JOIN domains
              ON domains.id = aliases.domain_id
             AND domains.verification_status = 'verified'
            WHERE connected_accounts.id = $1
          ), provider_identities AS (
            SELECT DISTINCT lower(provider_send_identities.email) AS address
            FROM provider_send_identities
            WHERE provider_send_identities.account_id = $1
              AND provider_send_identities.enabled = TRUE
              AND provider_send_identities.verification_state = 'verified'
          ), allowed_identities AS (
            SELECT address FROM account_identity
            UNION
            SELECT address FROM alias_identities
            UNION
            SELECT address FROM provider_identities
          )
          SELECT 1
          FROM allowed_identities
          WHERE address = lower($2)
          LIMIT 1
        `,
        [input.accountId, input.from.address],
      );

      if (result.rows.length === 0) {
        throw new Error("from address is not allowed");
      }
    },
  };
}
