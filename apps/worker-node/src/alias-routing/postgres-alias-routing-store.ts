import type {
  AliasDeliveryJob,
  AliasDeliveryJobStatus,
  AliasDeliveryLog,
  AliasDeliveryLogStatus,
  AliasRouteLookupInput,
  AliasRouteMatch,
  AliasRoutingStore,
  CatchAllMode,
  ClaimAliasDeliveryJobInput,
  CompleteAliasDeliveryJobInput,
  FailAliasDeliveryJobInput,
} from "./alias-router.js";

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface RouteRow extends Record<string, unknown> {
  route_type: "alias" | "catch_all";
  domain_id: string;
  domain: string;
  alias_id?: string | null;
  local_part: string;
  catch_all_mode?: string | null;
  destination_ids: unknown;
  destination_emails: unknown;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  domain_id: string;
  alias_id?: string | null;
  recipient: string;
  destination_id: string;
  destination_email: string;
  sender?: string | null;
  message_fingerprint: string;
  raw_message_ref?: string | null;
  idempotency_key: string;
  status: AliasDeliveryJobStatus;
  attempts: number;
  max_attempts: number;
  not_before: string | Date;
  lease_owner?: string | null;
  lease_expires_at?: string | Date | null;
  payload: unknown;
  error_message?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at?: string | Date | null;
}

interface LogRow extends Record<string, unknown> {
  id: string;
  domain_id?: string | null;
  alias_id?: string | null;
  recipient: string;
  status: AliasDeliveryLogStatus;
  detail?: string | null;
  created_at: string | Date;
}

export function createPostgresAliasRoutingStore(
  client: Queryable,
): AliasRoutingStore {
  return {
    async findRoute(input) {
      const exact = await findExactAliasRoute(client, input);
      if (exact) {
        return exact;
      }

      return findCatchAllRoute(client, input.domain);
    },

    async enqueueDeliveryJob(input) {
      const result = await client.query<JobRow>(
        `
          INSERT INTO alias_delivery_jobs (
            id,
            domain_id,
            alias_id,
            recipient,
            destination_id,
            destination_email,
            sender,
            message_fingerprint,
            raw_message_ref,
            idempotency_key,
            max_attempts,
            not_before,
            payload
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13)
          ON CONFLICT (idempotency_key) DO UPDATE
          SET updated_at = alias_delivery_jobs.updated_at
          RETURNING *
        `,
        [
          input.id,
          input.domainId,
          input.aliasId ?? null,
          input.recipient,
          input.destinationId,
          input.destinationEmail,
          input.sender ?? null,
          input.messageFingerprint,
          input.rawMessageRef ?? null,
          input.idempotencyKey,
          input.maxAttempts ?? 8,
          input.notBefore,
          input.payload,
        ],
      );

      return rowToJob(result.rows[0]);
    },

    async recordDeliveryLog(input) {
      const result = await client.query<LogRow>(
        `
          INSERT INTO delivery_logs (
            id,
            domain_id,
            alias_id,
            recipient,
            status,
            detail,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
          RETURNING id, domain_id, alias_id, recipient, status, detail, created_at
        `,
        [
          input.id,
          input.domainId ?? null,
          input.aliasId ?? null,
          input.recipient,
          input.status,
          input.detail ?? null,
          input.createdAt,
        ],
      );

      return rowToLog(result.rows[0]);
    },

    async claimNextDeliveryJob(input) {
      const leaseExpiresAt = new Date(
        input.now.getTime() + input.leaseSeconds * 1000,
      );
      const result = await client.query<JobRow>(
        `
          WITH candidate AS (
            SELECT id
            FROM alias_delivery_jobs
            WHERE
              (
                status = 'queued'
                AND not_before <= $1::timestamptz
              )
              OR (
                status = 'running'
                AND lease_expires_at <= $1::timestamptz
              )
            ORDER BY not_before ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE alias_delivery_jobs
          SET
            status = 'running',
            attempts = attempts + 1,
            lease_owner = $2,
            lease_expires_at = $3::timestamptz,
            updated_at = $1::timestamptz
          FROM candidate
          WHERE alias_delivery_jobs.id = candidate.id
          RETURNING alias_delivery_jobs.*
        `,
        [input.now.toISOString(), input.workerId, leaseExpiresAt.toISOString()],
      );

      return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
    },

    async completeDeliveryJob(input) {
      return completeDeliveryJob(client, input);
    },

    async failDeliveryJob(input) {
      return failDeliveryJob(client, input);
    },
  };
}

async function findExactAliasRoute(
  client: Queryable,
  input: AliasRouteLookupInput,
): Promise<AliasRouteMatch | undefined> {
  const result = await client.query<RouteRow>(
    `
      SELECT
        'alias' AS route_type,
        domains.id AS domain_id,
        domains.domain,
        aliases.id AS alias_id,
        aliases.local_part,
        NULL AS catch_all_mode,
        ARRAY_AGG(destinations.id ORDER BY destinations.id) AS destination_ids,
        ARRAY_AGG(destinations.email ORDER BY destinations.id) AS destination_emails
      FROM aliases
      JOIN domains
        ON domains.id = aliases.domain_id
      JOIN alias_routes
        ON alias_routes.alias_id = aliases.id
      JOIN destinations
        ON destinations.id = alias_routes.destination_id
      WHERE domains.domain = $1
        AND aliases.local_part = $2
        AND aliases.enabled = TRUE
      GROUP BY domains.id, domains.domain, aliases.id, aliases.local_part
      LIMIT 1
    `,
    [input.domain, input.localPart],
  );

  return result.rows[0] ? rowToRoute(result.rows[0]) : undefined;
}

async function findCatchAllRoute(
  client: Queryable,
  domain: string,
): Promise<AliasRouteMatch | undefined> {
  const result = await client.query<RouteRow>(
    `
      SELECT
        'catch_all' AS route_type,
        domains.id AS domain_id,
        domains.domain,
        NULL AS alias_id,
        '*' AS local_part,
        COALESCE(routing_rules.config ->> 'mode', 'reject') AS catch_all_mode,
        ARRAY_AGG(destinations.id ORDER BY destinations.id)
          FILTER (WHERE destinations.id IS NOT NULL) AS destination_ids,
        ARRAY_AGG(destinations.email ORDER BY destinations.id)
          FILTER (WHERE destinations.email IS NOT NULL) AS destination_emails
      FROM routing_rules
      JOIN domains
        ON domains.id = routing_rules.domain_id
      LEFT JOIN LATERAL jsonb_array_elements_text(
        COALESCE(routing_rules.config -> 'destinationIds', '[]'::jsonb)
      ) AS route_destination(destination_id)
        ON TRUE
      LEFT JOIN destinations
        ON destinations.id::text = route_destination.destination_id
      WHERE domains.domain = $1
        AND routing_rules.rule_type = 'catch_all'
        AND routing_rules.enabled = TRUE
      GROUP BY
        domains.id,
        domains.domain,
        routing_rules.config
      LIMIT 1
    `,
    [domain],
  );

  return result.rows[0] ? rowToRoute(result.rows[0]) : undefined;
}

function rowToRoute(row: RouteRow): AliasRouteMatch {
  return {
    routeType: row.route_type,
    domainId: row.domain_id,
    domain: row.domain,
    ...(row.alias_id ? { aliasId: row.alias_id } : {}),
    localPart: row.local_part,
    ...(row.catch_all_mode
      ? { catchAllMode: normalizeCatchAllMode(row.catch_all_mode) }
      : {}),
    destinationIds: normalizeStringArray(row.destination_ids),
    destinationEmails: normalizeStringArray(row.destination_emails),
  };
}

async function completeDeliveryJob(
  client: Queryable,
  input: CompleteAliasDeliveryJobInput,
): Promise<AliasDeliveryJob> {
  const result = await client.query<JobRow>(
    `
      UPDATE alias_delivery_jobs
      SET
        status = 'done',
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = $3::timestamptz,
        updated_at = $3::timestamptz
      WHERE id = $1
        AND status = 'running'
        AND lease_owner = $2
      RETURNING *
    `,
    [input.jobId, input.workerId, input.now.toISOString()],
  );

  if (!result.rows[0]) {
    throw new Error(`alias delivery job lease is not owned by ${input.workerId}`);
  }

  return rowToJob(result.rows[0]);
}

async function failDeliveryJob(
  client: Queryable,
  input: FailAliasDeliveryJobInput,
): Promise<AliasDeliveryJob> {
  const result = await client.query<JobRow>(
    `
      UPDATE alias_delivery_jobs
      SET
        status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        not_before = CASE
          WHEN attempts >= max_attempts THEN not_before
          ELSE (
            $4::timestamptz +
            (
              LEAST(
                30 * POWER(2, GREATEST(attempts - 1, 0)),
                900
              ) * INTERVAL '1 second'
            )
          )
        END,
        error_message = $3,
        updated_at = $4::timestamptz
      WHERE id = $1
        AND status = 'running'
        AND lease_owner = $2
      RETURNING *
    `,
    [
      input.jobId,
      input.workerId,
      input.errorMessage,
      input.now.toISOString(),
    ],
  );

  if (!result.rows[0]) {
    throw new Error(`alias delivery job lease is not owned by ${input.workerId}`);
  }

  return rowToJob(result.rows[0]);
}

function rowToJob(row: JobRow): AliasDeliveryJob {
  return {
    id: row.id,
    domainId: row.domain_id,
    ...(row.alias_id ? { aliasId: row.alias_id } : {}),
    recipient: row.recipient,
    destinationId: row.destination_id,
    destinationEmail: row.destination_email,
    ...(row.sender ? { sender: row.sender } : {}),
    messageFingerprint: row.message_fingerprint,
    ...(row.raw_message_ref ? { rawMessageRef: row.raw_message_ref } : {}),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    notBefore: toIsoString(row.not_before),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: toIsoString(row.lease_expires_at) }
      : {}),
    payload: normalizePayload(row.payload),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(row.completed_at ? { completedAt: toIsoString(row.completed_at) } : {}),
  };
}

function rowToLog(row: LogRow): AliasDeliveryLog {
  return {
    id: row.id,
    ...(row.domain_id ? { domainId: row.domain_id } : {}),
    ...(row.alias_id ? { aliasId: row.alias_id } : {}),
    recipient: row.recipient,
    status: row.status,
    ...(row.detail ? { detail: row.detail } : {}),
    createdAt: toIsoString(row.created_at),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

function normalizePayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function normalizeCatchAllMode(value: string): CatchAllMode {
  if (
    value === "forward" ||
    value === "auto_create" ||
    value === "discard" ||
    value === "reject"
  ) {
    return value;
  }

  return "reject";
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
