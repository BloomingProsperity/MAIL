import type {
  OperationalEventEntry,
  OperationalEventLogListInput,
  OperationalEventLogStore,
  OperationalEventLevel,
  OperationalEventStoreRecordInput,
} from "./operational-events.js";

interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export function createPostgresOperationalEventStore(
  client: Queryable,
): OperationalEventLogStore {
  return {
    async record(input) {
      const result = await client.query(
        `
          INSERT INTO operational_events (
            id,
            occurred_at,
            service,
            level,
            event,
            request_id,
            account_id,
            lane,
            job_id,
            message,
            context
          )
          VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING
            id,
            occurred_at,
            service,
            level,
            event,
            request_id,
            account_id,
            lane,
            job_id,
            message,
            context
        `,
        recordValues(input),
      );

      if (!result.rows[0]) {
        throw new Error("operational event insert returned no rows");
      }

      return mapRow(result.rows[0]);
    },

    async list(input) {
      const values: unknown[] = [];
      const where: string[] = [];

      addFilter(where, values, "service", input.service);
      addFilter(where, values, "level", input.level);
      addFilter(where, values, "event", input.event);
      addFilter(where, values, "request_id", input.requestId);
      addFilter(where, values, "account_id", input.accountId);
      addFilter(where, values, "lane", input.lane);
      addFilter(where, values, "job_id", input.jobId);

      values.push(input.limit ?? 50);
      const limitPlaceholder = `$${values.length}`;
      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const result = await client.query(
        `
          SELECT
            id,
            occurred_at,
            service,
            level,
            event,
            request_id,
            account_id,
            lane,
            job_id,
            message,
            context
          FROM operational_events
          ${whereSql}
          ORDER BY occurred_at DESC, id DESC
          LIMIT ${limitPlaceholder}
        `,
        values,
      );

      return { items: result.rows.map(mapRow) };
    },
  };
}

function recordValues(input: OperationalEventStoreRecordInput): unknown[] {
  return [
    input.id,
    input.occurredAt,
    input.service,
    input.level,
    input.event,
    input.requestId ?? null,
    input.accountId ?? null,
    input.lane ?? null,
    input.jobId ?? null,
    input.message ?? null,
    input.context,
  ];
}

function addFilter(
  where: string[],
  values: unknown[],
  column: string,
  value: unknown,
): void {
  if (value === undefined) {
    return;
  }

  values.push(value);
  where.push(`${column} = $${values.length}`);
}

function mapRow(row: Record<string, unknown>): OperationalEventEntry {
  return {
    id: String(row.id),
    occurredAt: String(row.occurred_at),
    service: String(row.service),
    level: readLevel(row.level),
    event: String(row.event),
    ...optionalString("requestId", row.request_id),
    ...optionalString("accountId", row.account_id),
    ...optionalString("lane", row.lane),
    ...optionalString("jobId", row.job_id),
    ...optionalString("message", row.message),
    context: readContext(row.context),
  };
}

function readLevel(value: unknown): OperationalEventLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  return "info";
}

function optionalString<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  return { [key]: value } as Partial<Record<K, string>>;
}

function readContext(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}
