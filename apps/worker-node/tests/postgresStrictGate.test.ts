import { describe, expect, it } from "vitest";

import {
  requireStrictPostgresTestDatabaseUrl,
  STRICT_POSTGRES_GATE_MESSAGE,
} from "../src/postgres-strict-gate";

describe("strict Postgres gate preflight", () => {
  it("fails when TEST_DATABASE_URL is missing", () => {
    expect(() => requireStrictPostgresTestDatabaseUrl({})).toThrow(
      STRICT_POSTGRES_GATE_MESSAGE,
    );
  });

  it("returns a trimmed TEST_DATABASE_URL when configured", () => {
    expect(
      requireStrictPostgresTestDatabaseUrl({
        TEST_DATABASE_URL:
          " postgres://emailhub_test:emailhub_test@127.0.0.1:55432/emailhub_sync_jobs_test ",
      }),
    ).toBe(
      "postgres://emailhub_test:emailhub_test@127.0.0.1:55432/emailhub_sync_jobs_test",
    );
  });
});
