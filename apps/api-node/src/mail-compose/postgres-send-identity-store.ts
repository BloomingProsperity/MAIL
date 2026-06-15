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
              TRUE AS verified
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
              TRUE AS verified
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
          )
          SELECT *
          FROM account_identity
          UNION ALL
          SELECT *
          FROM alias_identities
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
    source: row.source === "domain_alias" ? "domain_alias" : "account",
    isDefault: row.is_default,
    verified: row.verified,
  };
}
