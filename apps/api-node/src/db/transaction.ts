export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface ReleasableQueryable extends Queryable {
  release(): void;
}

export interface PoolLike extends Queryable {
  connect?(): Promise<ReleasableQueryable>;
}

export async function withTransaction<T>(
  queryable: PoolLike,
  work: (client: Queryable) => Promise<T>,
): Promise<T> {
  const checkedOutClient = queryable.connect
    ? await queryable.connect()
    : undefined;
  const client = checkedOutClient ?? queryable;

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    checkedOutClient?.release();
  }
}
