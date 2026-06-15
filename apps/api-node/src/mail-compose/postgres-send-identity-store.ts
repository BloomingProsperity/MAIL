import type {
  MailSendIdentityCandidate,
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

interface SendIdentityCandidateRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  address: string;
  name: string | null;
  provider: string;
  provider_identity_id: string;
  identity_type: string;
  verification_state: string;
  enabled: boolean;
  account_email: string;
  verification_error: string | null;
  target_mode: string | null;
  user_endpoint_eligible: string | null;
  target_mailbox_user_id: string | null;
  target_mailbox_upn: string | null;
  sent_items_behavior: string | null;
  user_target_verification_error: string | null;
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

    async listProviderSendIdentityCandidates(input) {
      const result = await client.query<SendIdentityCandidateRow>(
        `
          SELECT
            'provider:' || provider_send_identities.id::text AS id,
            provider_send_identities.account_id,
            lower(provider_send_identities.email) AS address,
            provider_send_identities.display_name AS name,
            provider_send_identities.provider,
            provider_send_identities.provider_identity_id,
            provider_send_identities.identity_type,
            provider_send_identities.verification_state,
            provider_send_identities.enabled,
            lower(connected_accounts.email) AS account_email,
            provider_send_identities.capabilities->>'verificationError'
              AS verification_error,
            provider_send_identities.capabilities->>'sendMailTargetMode'
              AS target_mode,
            provider_send_identities.capabilities->>'userSendMailEligible'
              AS user_endpoint_eligible,
            provider_send_identities.capabilities#>>'{targetMailbox,userId}'
              AS target_mailbox_user_id,
            provider_send_identities.capabilities#>>'{targetMailbox,userPrincipalName}'
              AS target_mailbox_upn,
            provider_send_identities.capabilities->>'sentItemsBehavior'
              AS sent_items_behavior,
            provider_send_identities.capabilities->>'userTargetVerificationError'
              AS user_target_verification_error
          FROM provider_send_identities
          JOIN connected_accounts
            ON connected_accounts.id = provider_send_identities.account_id
          WHERE provider_send_identities.account_id = $1
            AND provider_send_identities.provider = 'graph'
            AND provider_send_identities.capabilities->>'explicitCandidate' = 'true'
          ORDER BY
            provider_send_identities.verification_state = 'verified' DESC,
            lower(provider_send_identities.email) ASC
        `,
        [input.accountId],
      );

      return result.rows.map(rowToCandidate);
    },

    async upsertProviderSendIdentityCandidate(input) {
      const result = await client.query<SendIdentityCandidateRow>(
        `
          WITH graph_account AS (
            SELECT
              connected_accounts.id AS account_id,
              lower(connected_accounts.email) AS account_email
            FROM connected_accounts
            JOIN account_provider_settings
              ON account_provider_settings.account_id = connected_accounts.id
             AND account_provider_settings.native_provider = 'graph'
            WHERE connected_accounts.id = $1
          ), upserted AS (
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
            SELECT
              gen_random_uuid(),
              graph_account.account_id,
              'graph',
              lower($2),
              lower($2),
              $3,
              $4,
              'pending',
              FALSE,
              FALSE,
              jsonb_build_object(
                'explicitCandidate', TRUE,
                'verificationMethod', 'graph_me_send_mail_from',
                'requestedAt', $5::text
              ),
              $5::timestamptz,
              $5::timestamptz,
              $5::timestamptz
            FROM graph_account
            ON CONFLICT (account_id, provider, provider_identity_id)
            DO UPDATE SET
              email = EXCLUDED.email,
              display_name = EXCLUDED.display_name,
              identity_type = EXCLUDED.identity_type,
              verification_state = CASE
                WHEN provider_send_identities.verification_state = 'verified'
                  THEN 'verified'
                ELSE 'pending'
              END,
              enabled = CASE
                WHEN provider_send_identities.verification_state = 'verified'
                  THEN TRUE
                ELSE FALSE
              END,
              capabilities =
                (
                  provider_send_identities.capabilities ||
                  EXCLUDED.capabilities
                ) - 'verificationError',
              last_seen_at = EXCLUDED.last_seen_at,
              updated_at = EXCLUDED.updated_at
            RETURNING
              'provider:' || id::text AS id,
              account_id,
              lower(email) AS address,
              display_name AS name,
              provider,
              provider_identity_id,
              identity_type,
              verification_state,
              enabled,
              capabilities->>'verificationError' AS verification_error,
              capabilities->>'sendMailTargetMode' AS target_mode,
              capabilities->>'userSendMailEligible' AS user_endpoint_eligible,
              capabilities#>>'{targetMailbox,userId}' AS target_mailbox_user_id,
              capabilities#>>'{targetMailbox,userPrincipalName}' AS target_mailbox_upn,
              capabilities->>'sentItemsBehavior' AS sent_items_behavior,
              capabilities->>'userTargetVerificationError'
                AS user_target_verification_error
          )
          SELECT
            upserted.*,
            graph_account.account_email
          FROM upserted
          JOIN graph_account
            ON graph_account.account_id = upserted.account_id
        `,
        [
          input.accountId,
          input.from.address,
          input.from.name ?? null,
          input.identityType,
          input.now,
        ],
      );

      const candidate = result.rows[0];
      if (!candidate) {
        throw new Error("Graph native account was not found");
      }

      return rowToCandidate(candidate);
    },

    async getProviderSendIdentityCandidate(input) {
      const result = await client.query<SendIdentityCandidateRow>(
        `
          SELECT
            'provider:' || provider_send_identities.id::text AS id,
            provider_send_identities.account_id,
            lower(provider_send_identities.email) AS address,
            provider_send_identities.display_name AS name,
            provider_send_identities.provider,
            provider_send_identities.provider_identity_id,
            provider_send_identities.identity_type,
            provider_send_identities.verification_state,
            provider_send_identities.enabled,
            lower(connected_accounts.email) AS account_email,
            provider_send_identities.capabilities->>'verificationError'
              AS verification_error,
            provider_send_identities.capabilities->>'sendMailTargetMode'
              AS target_mode,
            provider_send_identities.capabilities->>'userSendMailEligible'
              AS user_endpoint_eligible,
            provider_send_identities.capabilities#>>'{targetMailbox,userId}'
              AS target_mailbox_user_id,
            provider_send_identities.capabilities#>>'{targetMailbox,userPrincipalName}'
              AS target_mailbox_upn,
            provider_send_identities.capabilities->>'sentItemsBehavior'
              AS sent_items_behavior,
            provider_send_identities.capabilities->>'userTargetVerificationError'
              AS user_target_verification_error
          FROM provider_send_identities
          JOIN connected_accounts
            ON connected_accounts.id = provider_send_identities.account_id
          WHERE provider_send_identities.account_id = $1
            AND provider_send_identities.provider = 'graph'
            AND provider_send_identities.capabilities->>'explicitCandidate' = 'true'
            AND (
              'provider:' || provider_send_identities.id::text = $2
              OR provider_send_identities.id::text = $2
            )
          LIMIT 1
        `,
        [input.accountId, input.candidateId],
      );

      return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined;
    },

    async markProviderSendIdentityCandidateVerification(input) {
      const result = await client.query<SendIdentityCandidateRow>(
        `
          WITH updated AS (
            UPDATE provider_send_identities
            SET verification_state = $3,
                enabled = $4,
                capabilities = CASE
                  WHEN $5::text IS NULL THEN
                    (capabilities - 'verificationError') ||
                    jsonb_build_object(
                      'verifiedAt', $6::text,
                      'verificationMethod', 'graph_me_send_mail_from',
                      'verifiedEndpoint', 'me',
                      'sendMailTargetMode', 'me',
                      'userSendMailEligible', FALSE,
                      'requiresFullAccessForUserEndpoint', TRUE,
                      'sentItemsBehavior', 'signed_in_user'
                    )
                  ELSE
                    capabilities ||
                    jsonb_build_object(
                      'verificationError', $5::text,
                      'failedAt', $6::text
                    )
                END,
                last_seen_at = $6::timestamptz,
                updated_at = $6::timestamptz
            WHERE account_id = $1
              AND provider = 'graph'
              AND capabilities->>'explicitCandidate' = 'true'
              AND (
                'provider:' || id::text = $2
                OR id::text = $2
              )
            RETURNING
              'provider:' || id::text AS id,
              account_id,
              lower(email) AS address,
              display_name AS name,
              provider,
              provider_identity_id,
              identity_type,
              verification_state,
              enabled,
              capabilities->>'verificationError' AS verification_error,
              capabilities->>'sendMailTargetMode' AS target_mode,
              capabilities->>'userSendMailEligible' AS user_endpoint_eligible,
              capabilities#>>'{targetMailbox,userId}' AS target_mailbox_user_id,
              capabilities#>>'{targetMailbox,userPrincipalName}' AS target_mailbox_upn,
              capabilities->>'sentItemsBehavior' AS sent_items_behavior,
              capabilities->>'userTargetVerificationError'
                AS user_target_verification_error
          )
          SELECT
            updated.*,
            lower(connected_accounts.email) AS account_email
          FROM updated
          JOIN connected_accounts
            ON connected_accounts.id = updated.account_id
        `,
        [
          input.accountId,
          input.candidateId,
          input.verificationState,
          input.enabled,
          input.verificationError ?? null,
          input.now,
        ],
      );

      return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined;
    },

    async markProviderSendIdentityCandidateUserTargetVerification(input) {
      const result = await client.query<SendIdentityCandidateRow>(
        `
          WITH updated AS (
            UPDATE provider_send_identities
            SET verification_state = 'verified',
                enabled = TRUE,
                capabilities = CASE
                  WHEN $4::boolean THEN
                    (
                      capabilities -
                      'verificationError' -
                      'userTargetVerificationError'
                    ) ||
                    jsonb_build_object(
                      'userTargetVerifiedAt', $6::text,
                      'verificationMethod', 'graph_user_send_mail',
                      'verifiedEndpoint', 'users',
                      'sendMailTargetMode', 'users',
                      'userSendMailEligible', TRUE,
                      'targetMailbox',
                        jsonb_build_object(
                          CASE
                            WHEN position('@' in $3::text) > 0
                              THEN 'userPrincipalName'
                            ELSE 'userId'
                          END,
                          $3::text
                        ),
                      'requiresFullAccessForUserEndpoint', TRUE,
                      'sentItemsBehavior', 'from_mailbox'
                    )
                  ELSE
                    (capabilities - 'verificationError') ||
                    jsonb_build_object(
                      'sendMailTargetMode', 'me',
                      'userSendMailEligible', FALSE,
                      'targetMailbox',
                        jsonb_build_object(
                          CASE
                            WHEN position('@' in $3::text) > 0
                              THEN 'userPrincipalName'
                            ELSE 'userId'
                          END,
                          $3::text
                        ),
                      'requiresFullAccessForUserEndpoint', TRUE,
                      'sentItemsBehavior', 'signed_in_user',
                      'userTargetVerificationError', $5::text,
                      'userTargetFailedAt', $6::text
                    )
                END,
                last_seen_at = $6::timestamptz,
                updated_at = $6::timestamptz
            WHERE account_id = $1
              AND provider = 'graph'
              AND capabilities->>'explicitCandidate' = 'true'
              AND verification_state = 'verified'
              AND enabled = TRUE
              AND (
                'provider:' || id::text = $2
                OR id::text = $2
              )
            RETURNING
              'provider:' || id::text AS id,
              account_id,
              lower(email) AS address,
              display_name AS name,
              provider,
              provider_identity_id,
              identity_type,
              verification_state,
              enabled,
              capabilities->>'verificationError' AS verification_error,
              capabilities->>'sendMailTargetMode' AS target_mode,
              capabilities->>'userSendMailEligible' AS user_endpoint_eligible,
              capabilities#>>'{targetMailbox,userId}' AS target_mailbox_user_id,
              capabilities#>>'{targetMailbox,userPrincipalName}' AS target_mailbox_upn,
              capabilities->>'sentItemsBehavior' AS sent_items_behavior,
              capabilities->>'userTargetVerificationError'
                AS user_target_verification_error
          )
          SELECT
            updated.*,
            lower(connected_accounts.email) AS account_email
          FROM updated
          JOIN connected_accounts
            ON connected_accounts.id = updated.account_id
        `,
        [
          input.accountId,
          input.candidateId,
          input.targetMailbox,
          input.verified,
          input.verificationError ?? null,
          input.now,
        ],
      );

      return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined;
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

function rowToCandidate(row: SendIdentityCandidateRow): MailSendIdentityCandidate {
  return {
    id: row.id,
    accountId: row.account_id,
    from: {
      address: row.address,
      ...(row.name ? { name: row.name } : {}),
    },
    source: "provider_native",
    isDefault: false,
    verified: row.verification_state === "verified" && row.enabled,
    provider: row.provider,
    providerIdentityId: row.provider_identity_id,
    identityType: identityType(row.identity_type),
    verificationState: verificationState(row.verification_state),
    enabled: row.enabled,
    verificationRecipient: { address: row.account_email },
    ...(row.verification_error ? { verificationError: row.verification_error } : {}),
    ...(targetMode(row.target_mode)
      ? { sendMailTargetMode: targetMode(row.target_mode) }
      : {}),
    ...(row.user_endpoint_eligible
      ? { userSendMailEligible: row.user_endpoint_eligible === "true" }
      : {}),
    ...(row.target_mailbox_user_id || row.target_mailbox_upn
      ? {
          targetMailbox: {
            ...(row.target_mailbox_user_id
              ? { userId: row.target_mailbox_user_id }
              : {}),
            ...(row.target_mailbox_upn
              ? { userPrincipalName: row.target_mailbox_upn }
              : {}),
          },
        }
      : {}),
    ...(sentItemsBehavior(row.sent_items_behavior)
      ? { sentItemsBehavior: sentItemsBehavior(row.sent_items_behavior) }
      : {}),
    ...(row.user_target_verification_error
      ? { userTargetVerificationError: row.user_target_verification_error }
      : {}),
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

function verificationState(value: string): MailSendIdentityCandidate["verificationState"] {
  if (
    value === "verified" ||
    value === "pending" ||
    value === "unverified" ||
    value === "failed"
  ) {
    return value;
  }

  return "unverified";
}

function targetMode(
  value: string | null,
): MailSendIdentityCandidate["sendMailTargetMode"] | undefined {
  if (value === "me" || value === "users") {
    return value;
  }

  return undefined;
}

function sentItemsBehavior(
  value: string | null,
): MailSendIdentityCandidate["sentItemsBehavior"] | undefined {
  if (value === "signed_in_user" || value === "from_mailbox") {
    return value;
  }

  return undefined;
}
