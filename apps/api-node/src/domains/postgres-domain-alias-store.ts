import {
  buildDnsRecords,
  type AliasRecord,
  type CatchAllRuleRecord,
  type DeliveryLogRecord,
  type DestinationRecord,
  type DomainAliasStore,
  type DomainRecord,
  InvalidDomainAliasRequestError,
} from "./domain-alias.js";
import {
  type PoolLike,
  type Queryable,
  withTransaction,
} from "../db/transaction.js";

interface DomainRow extends Record<string, unknown> {
  id: string;
  domain: string;
  verification_status: string;
  created_at: string | Date;
}

interface DestinationRow extends Record<string, unknown> {
  id: string;
  email: string;
  verified: boolean;
  created_at: string | Date;
}

interface AliasRow extends Record<string, unknown> {
  id: string;
  domain_id: string;
  domain?: string;
  local_part: string;
  enabled: boolean;
  destination_ids?: unknown;
  created_at: string | Date;
}

interface CatchAllRow extends Record<string, unknown> {
  id: string;
  domain_id: string;
  rule_type: string;
  config: unknown;
  enabled: boolean;
  created_at: string | Date;
}

interface DeliveryLogRow extends Record<string, unknown> {
  id: string;
  domain_id?: string | null;
  alias_id?: string | null;
  recipient: string;
  status: string;
  detail?: string | null;
  created_at: string | Date;
}

interface DestinationIdsRow extends Record<string, unknown> {
  destination_ids: unknown;
}

export function createPostgresDomainAliasStore(
  client: PoolLike,
): DomainAliasStore {
  return {
    async createDomain(input) {
      const result = await client.query<DomainRow>(
        `
          INSERT INTO domains (id, domain)
          VALUES ($1, $2)
          ON CONFLICT (domain) DO UPDATE
          SET domain = EXCLUDED.domain
          RETURNING id, domain, verification_status, created_at
        `,
        [input.id, input.domain],
      );

      return rowToDomain(result.rows[0]);
    },

    async listDomains() {
      const result = await client.query<DomainRow>(
        `
          SELECT id, domain, verification_status, created_at
          FROM domains
          ORDER BY domain ASC
        `,
      );

      return result.rows.map(rowToDomain);
    },

    async getDomain(domainId) {
      const result = await client.query<DomainRow>(
        `
          SELECT id, domain, verification_status, created_at
          FROM domains
          WHERE id = $1
          LIMIT 1
        `,
        [domainId],
      );

      return result.rows[0] ? rowToDomain(result.rows[0]) : undefined;
    },

    async createDestination(input) {
      return withTransaction(client, async (tx) => {
        const result = await tx.query<DestinationRow>(
          `
            INSERT INTO destinations (id, email)
            VALUES ($1, $2)
            ON CONFLICT (email) DO UPDATE
            SET email = EXCLUDED.email
            RETURNING id, email, verified, created_at
          `,
          [input.id, input.email],
        );

        await tx.query(
          `
            INSERT INTO domain_destinations (domain_id, destination_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [input.domainId, result.rows[0].id],
        );

        return rowToDestination(result.rows[0], input.domainId);
      });
    },

    async listDestinations(input) {
      const result = await client.query<DestinationRow>(
        `
          SELECT DISTINCT
            destinations.id,
            destinations.email,
            destinations.verified,
            destinations.created_at
          FROM destinations
          JOIN domain_destinations
            ON domain_destinations.destination_id = destinations.id
          WHERE domain_destinations.domain_id = $1
          ORDER BY destinations.email ASC
        `,
        [input.domainId],
      );

      return result.rows.map((row) => rowToDestination(row, input.domainId));
    },

    async getDestinationsByIds(destinationIds) {
      if (destinationIds.length === 0) {
        return [];
      }

      const result = await client.query<DestinationRow>(
        `
          SELECT id, email, verified, created_at
          FROM destinations
          WHERE id = ANY($1::uuid[])
          ORDER BY email ASC
        `,
        [destinationIds],
      );

      return result.rows.map((row) => rowToDestination(row));
    },

    async createAlias(input) {
      return withTransaction(client, async (tx) => {
        const domain = await loadDomain(tx, input.domainId);
        await loadDestinations(tx, input.destinationIds);
        const alias = await upsertAlias(tx, input);

        await tx.query(
          `
            DELETE FROM alias_routes
            WHERE alias_id = $1
          `,
          [alias.id],
        );

        for (const destinationId of input.destinationIds) {
          await tx.query(
            `
              INSERT INTO alias_routes (alias_id, destination_id)
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING
            `,
            [alias.id, destinationId],
          );
        }

        const routeResult = await tx.query<DestinationIdsRow>(
          `
            SELECT ARRAY_AGG(destination_id ORDER BY destination_id) AS destination_ids
            FROM alias_routes
            WHERE alias_id = $1
          `,
          [alias.id],
        );

        return rowToAlias(
          { ...alias, domain: domain.domain },
          normalizeStringArray(routeResult.rows[0]?.destination_ids),
        );
      });
    },

    async listAliases(input) {
      const result = await client.query<AliasRow>(
        `
          SELECT
            aliases.id,
            aliases.domain_id,
            domains.domain,
            aliases.local_part,
            aliases.enabled,
            aliases.created_at,
            ARRAY_AGG(alias_routes.destination_id ORDER BY alias_routes.destination_id)
              FILTER (WHERE alias_routes.destination_id IS NOT NULL) AS destination_ids
          FROM aliases
          JOIN domains ON domains.id = aliases.domain_id
          LEFT JOIN alias_routes ON alias_routes.alias_id = aliases.id
          WHERE aliases.domain_id = $1
          GROUP BY aliases.id, domains.domain
          ORDER BY aliases.local_part ASC
        `,
        [input.domainId],
      );

      return result.rows.map((row) =>
        rowToAlias(row, normalizeStringArray(row.destination_ids)),
      );
    },

    async setCatchAll(input) {
      const result = await client.query<CatchAllRow>(
        `
          INSERT INTO routing_rules (id, domain_id, rule_type, config, enabled)
          VALUES ($1, $2, $3, $4::jsonb, TRUE)
          ON CONFLICT (domain_id, rule_type) WHERE rule_type = 'catch_all'
          DO UPDATE
          SET config = EXCLUDED.config,
              enabled = TRUE
          RETURNING id, domain_id, rule_type, config, enabled, created_at
        `,
        [input.id, input.domainId, "catch_all", input.config],
      );

      return rowToCatchAll(result.rows[0]);
    },

    async getCatchAll(input) {
      const result = await client.query<CatchAllRow>(
        `
          SELECT id, domain_id, rule_type, config, enabled, created_at
          FROM routing_rules
          WHERE domain_id = $1 AND rule_type = 'catch_all'
          LIMIT 1
        `,
        [input.domainId],
      );

      return result.rows[0] ? rowToCatchAll(result.rows[0]) : undefined;
    },

    async listDeliveryLogs(input) {
      const result = await client.query<DeliveryLogRow>(
        `
          SELECT id, domain_id, alias_id, recipient, status, detail, created_at
          FROM delivery_logs
          WHERE domain_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2
        `,
        [input.domainId, input.limit],
      );

      return result.rows.map(rowToDeliveryLog);
    },
  };
}

async function loadDomain(
  client: Queryable,
  domainId: string,
): Promise<DomainRow> {
  const result = await client.query<DomainRow>(
    `
      SELECT id, domain, verification_status, created_at
      FROM domains
      WHERE id = $1
      LIMIT 1
    `,
    [domainId],
  );

  if (!result.rows[0]) {
    throw new InvalidDomainAliasRequestError("domain was not found");
  }

  return result.rows[0];
}

async function loadDestinations(
  client: Queryable,
  destinationIds: string[],
): Promise<DestinationRow[]> {
  const result = await client.query<DestinationRow>(
    `
      SELECT id, email, verified, created_at
      FROM destinations
      WHERE id = ANY($1::uuid[])
      ORDER BY id ASC
    `,
    [destinationIds],
  );

  if (result.rows.length !== destinationIds.length) {
    throw new InvalidDomainAliasRequestError("destination was not found");
  }

  return result.rows;
}

async function upsertAlias(
  client: Queryable,
  input: {
    id: string;
    domainId: string;
    localPart: string;
    createdAt?: string;
  },
): Promise<AliasRow> {
  const result = await client.query<AliasRow>(
    `
      INSERT INTO aliases (id, domain_id, local_part, enabled)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (domain_id, local_part) DO UPDATE
      SET enabled = TRUE
      RETURNING id, domain_id, local_part, enabled, created_at
    `,
    [input.id, input.domainId, input.localPart],
  );

  return result.rows[0];
}

function rowToDomain(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    domain: row.domain,
    verificationStatus:
      row.verification_status === "verified" ||
      row.verification_status === "failed"
        ? row.verification_status
        : "pending",
    dnsRecords: buildDnsRecords(row.id, row.domain),
    createdAt: toIsoString(row.created_at),
  };
}

function rowToDestination(
  row: DestinationRow,
  domainId?: string,
): DestinationRecord {
  return {
    id: row.id,
    ...(domainId ? { domainId } : {}),
    email: row.email,
    verified: Boolean(row.verified),
    createdAt: toIsoString(row.created_at),
  };
}

function rowToAlias(row: AliasRow, destinationIds: string[]): AliasRecord {
  const domain = row.domain;
  if (!domain) {
    throw new InvalidDomainAliasRequestError("alias domain was not loaded");
  }

  return {
    id: row.id,
    domainId: row.domain_id,
    address: `${row.local_part}@${domain}`,
    localPart: row.local_part,
    enabled: Boolean(row.enabled),
    destinationIds,
    createdAt: toIsoString(row.created_at),
  };
}

function rowToCatchAll(row: CatchAllRow): CatchAllRuleRecord {
  const config = normalizeCatchAllConfig(row.config);
  return {
    id: row.id,
    domainId: row.domain_id,
    ruleType: "catch_all",
    enabled: Boolean(row.enabled),
    config,
    createdAt: toIsoString(row.created_at),
  };
}

function rowToDeliveryLog(row: DeliveryLogRow): DeliveryLogRecord {
  return {
    id: row.id,
    ...(row.domain_id ? { domainId: row.domain_id } : {}),
    ...(row.alias_id ? { aliasId: row.alias_id } : {}),
    recipient: row.recipient,
    status: normalizeDeliveryStatus(row.status),
    ...(typeof row.detail === "string" ? { detail: row.detail } : {}),
    createdAt: toIsoString(row.created_at),
  };
}

function normalizeCatchAllConfig(
  value: unknown,
): CatchAllRuleRecord["config"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { mode: "reject" };
  }

  const config = value as {
    mode?: unknown;
    destinationIds?: unknown;
  };
  const mode =
    config.mode === "forward" ||
    config.mode === "auto_create" ||
    config.mode === "discard"
      ? config.mode
      : "reject";

  return {
    mode,
    ...(Array.isArray(config.destinationIds)
      ? { destinationIds: normalizeStringArray(config.destinationIds) }
      : {}),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item));
}

function normalizeDeliveryStatus(status: string): DeliveryLogRecord["status"] {
  if (
    status === "accepted" ||
    status === "matched" ||
    status === "queued" ||
    status === "delivered" ||
    status === "deferred" ||
    status === "bounced" ||
    status === "dropped"
  ) {
    return status;
  }

  return "accepted";
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
