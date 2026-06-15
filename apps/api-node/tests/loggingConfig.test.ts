import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("logging runtime configuration", () => {
  it("documents LOG_LEVEL and forwards it to API and worker containers", async () => {
    const envExample = await readFile(join(repoRoot, ".env.example"), "utf8");
    const compose = await readFile(
      join(repoRoot, "infra", "docker-compose.yml"),
      "utf8",
    );

    expect(envExample).toContain("LOG_LEVEL=info");
    expect(compose.match(/LOG_LEVEL: \$\{LOG_LEVEL:-info\}/g)).toHaveLength(2);
  });

  it("documents the diagnostics log buffer capacity and forwards it to the API container", async () => {
    const envExample = await readFile(join(repoRoot, ".env.example"), "utf8");
    const compose = await readFile(
      join(repoRoot, "infra", "docker-compose.yml"),
      "utf8",
    );

    expect(envExample).toContain("DIAGNOSTICS_LOG_CAPACITY=500");
    expect(compose).toContain(
      "DIAGNOSTICS_LOG_CAPACITY: ${DIAGNOSTICS_LOG_CAPACITY:-500}",
    );
  });
});
