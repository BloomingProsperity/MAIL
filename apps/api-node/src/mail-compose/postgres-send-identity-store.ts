import type {
  MailSendIdentity,
  MailSendIdentityStore,
} from "./mail-compose.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface SendIdentityRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  address: string;
  name: string | null;
  source: string;
  is_default: boolean;
  verified: boolean;
  provider: string | null;
  provider_identity_id: string | null;
  identity_type: string | null;
}

export function createPostgresSendIdentityStore(
  client: Queryable,
): MailSendIdentityStore {
  return {
    async listSendIdentities(input) {
      const result = await client.query<SendIdentityRow>(
        `
          WITH account_identity AS (
            SELECT
              'account:' || connected_accounts.id::text AS id,
              connected_accounts.id AS account_id,
              lower(connected_accounts.email) AS address,
              connected_accounts.display_name AS name,
              'account' AS source,
              TRUE AS is_default,
              TRUE AS verified,
              NULL::text AS provider,
              NULL::text AS provider_identity_id,
              NULL::text AS identity_type
            FROM connected_accounts
            WHERE connected_accounts.id = $1
          ), alias_identities AS (
            SELECT DISTINCT
              'alias:' || aliases.id::text AS id,
              connected_accounts.id AS account_id,
              lower(aliases.local_part || '@' || domains.domain) AS address,
              NULL::text AS name,
              'domain_alias' AS source,
              FALSE AS is_default,
              TRUE AS verified,
              NULL::text AS provider,
              NULL::text AS provider_identity_id,
              NULL::text AS identity_type
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
            SELECT DISTINCT
              'provider:' || provider_send_identities.id::text AS id,
              connected_accounts.id AS account_id,
              lower(provider_send_identities.email) AS address,
              provider_send_identities.display_name AS name,
              'provider_native' AS source,
              FALSE AS is_default,
              TRUE AS verified,
              provider_send_identities.provider,
              provider_send_identities.provider_identity_id,
              provider_send_identities.identity_type
            FROM connected_accounts
            JOIN provider_send_identities
              ON provider_send_identities.account_id = connected_accounts.id
             AND provider_send_identities.enabled = TRUE
             AND provider_send_identities.verification_state = 'verified'
            WHERE connected_accounts.id = $1
              AND lower(provider_send_identities.email) <> lower(connected_accounts.email)
              AND NOT EXISTS (
                SELECT 1
                FROM destinations
                JOIN alias_routes
                  ON alias_routes.destination_id = destinations.id
                JOIN aliases
                  ON aliases.id = alias_routes.alias_id
                 AND aliases.enabled = TRUE
                JOIN domains
                  ON domains.id = aliases.domain_id
                 AND domains.verification_status = 'verified'
                WHERE lower(destinations.email) = lower(connected_accounts.email)
                  AND destinations.verified = TRUE
                  AND lower(aliases.local_part || '@' || domains.domain) =
                    lower(provider_send_identities.email)
              )
          )
          SELECT *
          FROM account_identity
          UNION ALL
          SELECT *
          FROM alias_identities
          UNION ALL
          SELECT *
          FROM provider_identities
          ORDER BY is_default DESC, address ASC
        `,
        [input.accountId],
      );

      return result.rows.map(rowToIdentity);
    },
  };
}

function rowToIdentity(row: SendIdentityRow): MailSendIdentity {
  return {
    id: row.id,
    accountId: row.account_id,
    from: {
      address: row.address,
      ...(row.name ? { name: row.name } : {}),
    },
    source: identitySource(row.source),
    isDefault: row.is_default,
    verified: row.verified,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.provider_identity_id
      ? { providerIdentityId: row.provider_identity_id }
      : {}),
    ...(row.identity_type ? { identityType: identityType(row.identity_type) } : {}),
  };
}

function identitySource(value: string): MailSendIdentity["source"] {
  if (value === "domain_alias" || value === "provider_native") {
    return value;
  }

  return "account";
}

function identityType(value: string): NonNullable<MailSendIdentity["identityType"]> {
  if (
    value === "alias" ||
    value === "shared_mailbox" ||
    value === "send_on_behalf" ||
    value === "group" ||
    value === "unknown"
  ) {
    return value;
  }

  return "account";
}
